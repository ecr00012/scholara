//! Backfill task for migration 0006: rewrite legacy Anthropic-shape `messages.content_legacy`
//! rows into the new OpenAI-shape payload in `messages.content`. Runs once per row at app
//! startup; idempotent via the `migrated_v6` flag.

use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::path::PathBuf;

/// Public entry point. Opens the same SQLite file `tauri-plugin-sql` uses,
/// runs the per-row backfill, and rewrites `threads.model` strings.
pub fn backfill_messages_v6(db_path: &PathBuf) -> rusqlite::Result<()> {
    let conn = Connection::open(db_path)?;

    backfill_messages(&conn)?;
    rewrite_thread_models(&conn)?;
    Ok(())
}

fn backfill_messages(conn: &Connection) -> rusqlite::Result<()> {
    // Collect the rows that still need migrating. Doing this up front avoids
    // iterator-mutation issues when split-row cases delete the source.
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, role, content_legacy, position_at_send, created_at
         FROM messages WHERE migrated_v6 = 0",
    )?;
    let rows: Vec<(i64, i64, String, Option<String>, Option<String>, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    for (id, thread_id, role, legacy, pos, created_at) in rows {
        match transform_row(&role, legacy.as_deref()) {
            // No split: 1 → 1 row. Update in place.
            TransformResult::Single { role: new_role, content } => {
                conn.execute(
                    "UPDATE messages SET role = ?, content = ?, migrated_v6 = 1 WHERE id = ?",
                    params![new_role, content, id],
                )?;
            }
            // Split: 1 source → N rows. Delete source, insert in source order.
            TransformResult::Split(rows) => {
                conn.execute("DELETE FROM messages WHERE id = ?", params![id])?;
                for (new_role, content) in rows {
                    conn.execute(
                        "INSERT INTO messages
                         (thread_id, role, content, content_legacy, position_at_send, migrated_v6, created_at)
                         VALUES (?, ?, ?, NULL, ?, 1, ?)",
                        params![thread_id, new_role, content, pos, created_at],
                    )?;
                }
            }
            // Unparseable legacy content: write empty payload, keep role, mark migrated.
            TransformResult::Empty => {
                let new_content = if role == "tool" {
                    json!({ "tool_call_id": "", "text": "" }).to_string()
                } else {
                    json!({ "text": "" }).to_string()
                };
                conn.execute(
                    "UPDATE messages SET content = ?, migrated_v6 = 1 WHERE id = ?",
                    params![new_content, id],
                )?;
            }
        }
    }

    Ok(())
}

enum TransformResult {
    Single { role: String, content: String },
    Split(Vec<(String, String)>), // (role, content) tuples in insertion order
    Empty,
}

fn transform_row(role: &str, legacy: Option<&str>) -> TransformResult {
    let Some(legacy_str) = legacy else { return TransformResult::Empty };
    let blocks: Vec<Value> = match serde_json::from_str(legacy_str) {
        Ok(Value::Array(a)) => a,
        _ => return TransformResult::Empty,
    };

    match role {
        "user" => transform_user(blocks),
        "assistant" => transform_assistant(blocks),
        _ => TransformResult::Empty,
    }
}

fn transform_user(blocks: Vec<Value>) -> TransformResult {
    // Partition blocks into text and tool_result preserving order.
    let mut text_parts: Vec<String> = Vec::new();
    let mut tool_blocks: Vec<(String /*tool_use_id*/, String /*content*/)> = Vec::new();
    for b in &blocks {
        let ty = b.get("type").and_then(Value::as_str).unwrap_or("");
        if ty == "text" {
            if let Some(t) = b.get("text").and_then(Value::as_str) {
                text_parts.push(t.to_string());
            }
        } else if ty == "tool_result" {
            let id = b.get("tool_use_id").and_then(Value::as_str).unwrap_or("").to_string();
            let content = b.get("content").and_then(Value::as_str).unwrap_or("").to_string();
            tool_blocks.push((id, content));
        }
    }

    if tool_blocks.is_empty() {
        let payload = json!({ "text": text_parts.join("") }).to_string();
        return TransformResult::Single { role: "user".into(), content: payload };
    }

    if text_parts.is_empty() && tool_blocks.len() == 1 {
        // Pure single-tool-result: rewrite role to 'tool'.
        let (id, content) = tool_blocks.into_iter().next().unwrap();
        let payload = json!({ "tool_call_id": id, "text": content }).to_string();
        return TransformResult::Single { role: "tool".into(), content: payload };
    }

    // Mixed or multi-tool case: split into rows preserving the source order.
    let mut out: Vec<(String, String)> = Vec::new();
    for b in blocks {
        let ty = b.get("type").and_then(Value::as_str).unwrap_or("");
        if ty == "text" {
            let t = b.get("text").and_then(Value::as_str).unwrap_or("");
            if !t.is_empty() {
                out.push(("user".into(), json!({ "text": t }).to_string()));
            }
        } else if ty == "tool_result" {
            let id = b.get("tool_use_id").and_then(Value::as_str).unwrap_or("");
            let c = b.get("content").and_then(Value::as_str).unwrap_or("");
            out.push(("tool".into(), json!({ "tool_call_id": id, "text": c }).to_string()));
        }
    }
    if out.is_empty() {
        TransformResult::Single {
            role: "user".into(),
            content: json!({ "text": "" }).to_string(),
        }
    } else {
        TransformResult::Split(out)
    }
}

fn transform_assistant(blocks: Vec<Value>) -> TransformResult {
    let mut text = String::new();
    let mut tool_calls: Vec<Value> = Vec::new();
    for b in &blocks {
        let ty = b.get("type").and_then(Value::as_str).unwrap_or("");
        if ty == "text" {
            if let Some(t) = b.get("text").and_then(Value::as_str) {
                text.push_str(t);
            }
        } else if ty == "tool_use" {
            let id = b.get("id").and_then(Value::as_str).unwrap_or("");
            let name = b.get("name").and_then(Value::as_str).unwrap_or("");
            let input = b.get("input").cloned().unwrap_or(json!({}));
            tool_calls.push(json!({
                "id": id,
                "type": "function",
                "function": { "name": name, "arguments": input.to_string() }
            }));
        }
    }
    let mut payload = serde_json::Map::new();
    if tool_calls.is_empty() {
        payload.insert("text".into(), Value::String(text));
    } else {
        payload.insert(
            "text".into(),
            if text.is_empty() { Value::Null } else { Value::String(text) },
        );
        payload.insert("tool_calls".into(), Value::Array(tool_calls));
    }
    TransformResult::Single {
        role: "assistant".into(),
        content: Value::Object(payload).to_string(),
    }
}

fn rewrite_thread_models(conn: &Connection) -> rusqlite::Result<()> {
    // Map legacy Anthropic short ids to OpenRouter slugs. Unknown / NULL → fall back
    // to the curated default. The default id is duplicated here from
    // `src/agent/models.ts` (keep in sync if the TS default changes).
    //
    // Note: deviates from the plan's illustrative `deepseek/deepseek-chat-v3-0324:free`
    // — that model id is no longer listed by OpenRouter as of 2026-05-09. We use
    // Llama 3.3 70B Instruct (free, tool-capable) instead.
    const DEFAULT: &str = "meta-llama/llama-3.3-70b-instruct:free";

    fn translate<'a>(model: &'a str) -> &'a str {
        match model {
            "claude-haiku-4-5" => "anthropic/claude-haiku-4.5",
            "claude-sonnet-4-6" => "anthropic/claude-sonnet-4.6",
            "claude-opus-4-7" => "anthropic/claude-opus-4.7",
            // Already-slug values (e.g., from a previous run) pass through unchanged.
            other if other.contains('/') => other,
            _ => DEFAULT,
        }
    }

    let mut stmt = conn.prepare("SELECT id, model FROM threads")?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<_, _>>()?;
    drop(stmt);

    for (id, model) in rows {
        let new_id = translate(&model).to_string();
        if new_id != model {
            conn.execute("UPDATE threads SET model = ? WHERE id = ?", params![new_id, id])?;
        }
    }
    Ok(())
}

// ---------- tests ----------
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        // Minimal schema mirroring 0005 + 0006.
        c.execute_batch(
            "CREATE TABLE threads (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               book_id INTEGER NOT NULL,
               title TEXT,
               spoiler_mode INTEGER NOT NULL DEFAULT 1,
               model TEXT NOT NULL,
               last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
               created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );
             CREATE TABLE messages (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               thread_id INTEGER NOT NULL,
               role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
               content TEXT,
               content_legacy TEXT,
               position_at_send TEXT,
               migrated_v6 INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL DEFAULT (datetime('now'))
             );",
        ).unwrap();
        c
    }

    fn insert_legacy(c: &Connection, role: &str, legacy: &str) -> i64 {
        c.execute(
            "INSERT INTO threads (book_id, model) VALUES (1, 'claude-haiku-4-5')",
            [],
        ).ok(); // idempotent across calls
        let thread_id: i64 = c
            .query_row("SELECT id FROM threads ORDER BY id ASC LIMIT 1", [], |r| r.get(0))
            .unwrap();
        c.execute(
            "INSERT INTO messages (thread_id, role, content, content_legacy, migrated_v6)
             VALUES (?, ?, NULL, ?, 0)",
            params![thread_id, role, legacy],
        ).unwrap();
        c.last_insert_rowid()
    }

    fn read_row(c: &Connection, id: i64) -> (String, String) {
        c.query_row(
            "SELECT role, content FROM messages WHERE id = ?",
            params![id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ).unwrap()
    }

    fn read_all(c: &Connection) -> Vec<(i64, String, String)> {
        let mut s = c.prepare("SELECT id, role, content FROM messages ORDER BY id ASC").unwrap();
        s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn user_text_only_is_rewritten() {
        let c = fresh_db();
        let id = insert_legacy(&c, "user", r#"[{"type":"text","text":"hello"}]"#);
        backfill_messages(&c).unwrap();
        let (role, content) = read_row(&c, id);
        assert_eq!(role, "user");
        let v: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(v["text"], "hello");
    }

    #[test]
    fn assistant_text_and_tool_use_combine_into_one_row() {
        let c = fresh_db();
        let id = insert_legacy(
            &c,
            "assistant",
            r#"[{"type":"text","text":"sure"},{"type":"tool_use","id":"tu1","name":"search_book","input":{"query":"q"}}]"#,
        );
        backfill_messages(&c).unwrap();
        let (role, content) = read_row(&c, id);
        assert_eq!(role, "assistant");
        let v: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(v["text"], "sure");
        assert_eq!(v["tool_calls"][0]["id"], "tu1");
        assert_eq!(v["tool_calls"][0]["function"]["name"], "search_book");
        assert_eq!(v["tool_calls"][0]["function"]["arguments"], r#"{"query":"q"}"#);
    }

    #[test]
    fn user_single_tool_result_becomes_tool_role() {
        let c = fresh_db();
        let id = insert_legacy(
            &c,
            "user",
            r#"[{"type":"tool_result","tool_use_id":"tu1","content":"[]"}]"#,
        );
        backfill_messages(&c).unwrap();
        let (role, content) = read_row(&c, id);
        assert_eq!(role, "tool");
        let v: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(v["tool_call_id"], "tu1");
        assert_eq!(v["text"], "[]");
    }

    #[test]
    fn user_mixed_tool_results_split_into_multiple_rows_in_order() {
        let c = fresh_db();
        let _ = insert_legacy(
            &c,
            "user",
            r#"[
              {"type":"text","text":"check this:"},
              {"type":"tool_result","tool_use_id":"tu1","content":"a"},
              {"type":"tool_result","tool_use_id":"tu2","content":"b"}
            ]"#,
        );
        backfill_messages(&c).unwrap();
        let rows = read_all(&c);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].1, "user");
        assert_eq!(rows[1].1, "tool");
        assert_eq!(rows[2].1, "tool");
    }

    #[test]
    fn backfill_is_idempotent() {
        let c = fresh_db();
        let id = insert_legacy(&c, "user", r#"[{"type":"text","text":"hi"}]"#);
        backfill_messages(&c).unwrap();
        let first = read_row(&c, id);
        backfill_messages(&c).unwrap();
        let second = read_row(&c, id);
        assert_eq!(first, second);
    }

    #[test]
    fn thread_models_translate_known_ids_and_default_unknowns() {
        let c = fresh_db();
        c.execute("INSERT INTO threads (book_id, model) VALUES (1, 'claude-haiku-4-5')", []).unwrap();
        c.execute("INSERT INTO threads (book_id, model) VALUES (1, 'something-else')", []).unwrap();
        c.execute("INSERT INTO threads (book_id, model) VALUES (1, 'anthropic/claude-haiku-4.5')", []).unwrap();
        rewrite_thread_models(&c).unwrap();
        let rows: Vec<String> = c
            .prepare("SELECT model FROM threads ORDER BY id ASC").unwrap()
            .query_map([], |r| r.get::<_, String>(0)).unwrap()
            .collect::<Result<_, _>>().unwrap();
        assert_eq!(rows[0], "anthropic/claude-haiku-4.5");
        assert_eq!(rows[1], "meta-llama/llama-3.3-70b-instruct:free");
        assert_eq!(rows[2], "anthropic/claude-haiku-4.5");
    }
}
