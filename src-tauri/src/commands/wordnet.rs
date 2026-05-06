use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct WordnetState(pub Mutex<Option<Connection>>);

#[derive(Debug, Serialize, Deserialize)]
pub struct WordnetSense {
    pub pos: String,
    pub gloss: String,
}

fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = app
        .path()
        .resolve("resources/wordnet.sqlite", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Could not locate wordnet resource: {e}"))?;
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Could not open wordnet db at {}: {e}", path.display()))
}

#[tauri::command]
pub fn lookup_wordnet(
    app: AppHandle,
    state: tauri::State<'_, WordnetState>,
    word: String,
) -> Result<Option<Vec<WordnetSense>>, String> {
    let key = word.trim().to_lowercase().replace(' ', "_");
    if key.is_empty() {
        return Ok(None);
    }

    let mut guard = state.0.lock().map_err(|e| format!("wordnet state poisoned: {e}"))?;
    if guard.is_none() {
        *guard = Some(open_db(&app)?);
    }
    let conn = guard.as_ref().expect("wordnet connection initialized above");

    let payload: Option<String> = conn
        .query_row(
            "SELECT payload FROM entries WHERE word = ?1",
            [&key],
            |row| row.get(0),
        )
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Ok(None::<String>),
            other => Err(other),
        })
        .map_err(|e| format!("wordnet query failed: {e}"))?;

    let Some(json) = payload else { return Ok(None) };
    let senses: Vec<WordnetSense> =
        serde_json::from_str(&json).map_err(|e| format!("wordnet payload corrupted: {e}"))?;
    if senses.is_empty() { Ok(None) } else { Ok(Some(senses)) }
}
