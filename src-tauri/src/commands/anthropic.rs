use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;

const SERVICE: &str = "scholara";
const ACCOUNT: &str = "anthropic_api_key";
const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub system: Option<String>,
    pub messages: Vec<Value>,
    pub tools: Option<Vec<Value>>,
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "kind")]
pub enum StreamEvent {
    #[serde(rename = "event")]
    Event { event: String, data: Value },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "done")]
    Done,
}

fn redact_key_in_message(s: &str) -> String {
    // Defense in depth: never let an Anthropic key fragment escape.
    if let Some(idx) = s.find("sk-ant-") {
        let mut out = s.to_string();
        out.replace_range(idx..s.len().min(idx + 12), "sk-ant-•••");
        out
    } else {
        s.to_string()
    }
}

fn load_api_key() -> Result<String, String> {
    let entry = Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| format!("Could not access keychain: {e}"))?;
    match entry.get_password() {
        Ok(s) => Ok(s),
        Err(KeyringError::NoEntry) => Err("missing_api_key".into()),
        Err(e) => Err(format!("Could not load api key: {e}")),
    }
}

fn build_body(req: &ChatRequest) -> Value {
    let mut body = serde_json::json!({
        "model": req.model,
        "max_tokens": req.max_tokens.unwrap_or(2048),
        "messages": req.messages,
        "stream": true,
    });
    if let Some(system) = &req.system {
        body["system"] = Value::String(system.clone());
    }
    if let Some(tools) = &req.tools {
        body["tools"] = Value::Array(tools.clone());
    }
    body
}

#[tauri::command]
pub async fn chat_stream(req: ChatRequest, on_event: Channel<StreamEvent>) -> Result<(), String> {
    let key = load_api_key()?;
    let body = build_body(&req);

    let client = reqwest::Client::new();
    let resp = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", &key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| redact_key_in_message(&format!("network_error: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(redact_key_in_message(&format!("http_{status}: {text}")));
    }

    let mut stream = resp.bytes_stream().eventsource();
    while let Some(event) = stream.next().await {
        match event {
            Ok(ev) => {
                let data: Value = serde_json::from_str(&ev.data).unwrap_or(Value::Null);
                let event_name = if ev.event.is_empty() { "message".to_string() } else { ev.event };
                on_event
                    .send(StreamEvent::Event { event: event_name, data })
                    .map_err(|e| format!("channel_error: {e}"))?;
            }
            Err(e) => {
                let msg = redact_key_in_message(&format!("sse_error: {e}"));
                let _ = on_event.send(StreamEvent::Error { message: msg.clone() });
                return Err(msg);
            }
        }
    }
    on_event
        .send(StreamEvent::Done)
        .map_err(|e| format!("channel_error: {e}"))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct OneshotRequest {
    pub model: String,
    pub system: Option<String>,
    pub messages: Vec<Value>,
    pub max_tokens: Option<u32>,
}

#[tauri::command]
pub async fn chat_oneshot(req: OneshotRequest) -> Result<Value, String> {
    let key = load_api_key()?;
    let mut body = serde_json::json!({
        "model": req.model,
        "max_tokens": req.max_tokens.unwrap_or(512),
        "messages": req.messages,
    });
    if let Some(system) = &req.system {
        body["system"] = Value::String(system.clone());
    }
    let client = reqwest::Client::new();
    let resp = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", &key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| redact_key_in_message(&format!("network_error: {e}")))?;
    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(redact_key_in_message(&format!("http_{status}: {text}")));
    }
    let value: Value = resp
        .json()
        .await
        .map_err(|e| redact_key_in_message(&format!("decode_error: {e}")))?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redacts_sk_ant_fragments() {
        let msg = "Authorization failed for sk-ant-abcdef12345 yikes";
        let red = redact_key_in_message(msg);
        assert!(!red.contains("sk-ant-abcdef"));
        assert!(red.contains("sk-ant-•••"));
    }
    #[test]
    fn no_op_when_no_key_in_message() {
        let msg = "boring error";
        assert_eq!(redact_key_in_message(msg), "boring error");
    }
}
