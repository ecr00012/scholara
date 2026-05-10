use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;

const SERVICE: &str = "scholara";
const ACCOUNT: &str = "openrouter_api_key";
const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const REFERER: &str = "https://scholara.app";
const APP_TITLE: &str = "Scholara";

#[derive(Debug, Deserialize)]
pub struct ChatRequest {
    pub model: String,
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
    if let Some(idx) = s.find("sk-or-v1-") {
        let mut out = s.to_string();
        out.replace_range(idx..s.len().min(idx + 12), "sk-or-v1-•••");
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

fn build_body(req: &ChatRequest, stream: bool) -> Value {
    let mut body = serde_json::json!({
        "model": req.model,
        "max_tokens": req.max_tokens.unwrap_or(2048),
        "messages": req.messages,
    });
    if stream {
        body["stream"] = Value::Bool(true);
    }
    if let Some(tools) = &req.tools {
        if !tools.is_empty() {
            body["tools"] = Value::Array(tools.clone());
            body["tool_choice"] = Value::String("auto".into());
        }
    }
    body
}

fn add_common_headers(builder: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    builder
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", REFERER)
        .header("X-Title", APP_TITLE)
}

#[tauri::command]
pub async fn chat_stream(req: ChatRequest, on_event: Channel<StreamEvent>) -> Result<(), String> {
    let key = load_api_key()?;
    let body = build_body(&req, true);

    let client = reqwest::Client::new();
    let resp = add_common_headers(client.post(OPENROUTER_URL), &key)
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
                // OpenRouter terminates with `data: [DONE]`.
                if ev.data.trim() == "[DONE]" {
                    break;
                }
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
    pub messages: Vec<Value>,
    pub max_tokens: Option<u32>,
}

#[tauri::command]
pub async fn chat_oneshot(req: OneshotRequest) -> Result<Value, String> {
    let key = load_api_key()?;
    let body = build_body(
        &ChatRequest {
            model: req.model,
            messages: req.messages,
            tools: None,
            max_tokens: req.max_tokens.or(Some(512)),
        },
        false,
    );
    let client = reqwest::Client::new();
    let resp = add_common_headers(client.post(OPENROUTER_URL), &key)
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
    fn redacts_sk_or_fragments() {
        let msg = "Authorization failed for sk-or-v1-abcdef yikes";
        let red = redact_key_in_message(msg);
        assert!(!red.contains("sk-or-v1-abcdef"));
        assert!(red.contains("sk-or-v1-•••"));
    }
    #[test]
    fn no_op_when_no_key_in_message() {
        let msg = "boring error";
        assert_eq!(redact_key_in_message(msg), "boring error");
    }
    #[test]
    fn body_omits_tools_when_none() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![],
            tools: None,
            max_tokens: None,
        };
        let body = build_body(&req, true);
        assert!(body.get("tools").is_none());
        assert!(body.get("tool_choice").is_none());
        assert_eq!(body["stream"], Value::Bool(true));
    }
    #[test]
    fn body_sets_tool_choice_auto_when_tools_present() {
        let req = ChatRequest {
            model: "m".into(),
            messages: vec![],
            tools: Some(vec![serde_json::json!({"type": "function"})]),
            max_tokens: None,
        };
        let body = build_body(&req, true);
        assert_eq!(body["tool_choice"], Value::String("auto".into()));
        assert!(body["tools"].is_array());
    }
    #[test]
    fn body_omits_stream_when_false() {
        let req = ChatRequest { model: "m".into(), messages: vec![], tools: None, max_tokens: None };
        let body = build_body(&req, false);
        assert!(body.get("stream").is_none());
    }
    #[test]
    fn body_does_not_include_top_level_system() {
        let req = ChatRequest { model: "m".into(), messages: vec![], tools: None, max_tokens: None };
        let body = build_body(&req, true);
        assert!(body.get("system").is_none());
    }
}
