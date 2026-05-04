use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "scholara";
const ACCOUNT: &str = "anthropic_api_key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Could not access keychain: {e}"))
}

#[tauri::command]
pub fn get_api_key() -> Result<Option<String>, String> {
    let e = entry()?;
    match e.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("Could not access keychain: {err}")),
    }
}

#[tauri::command]
pub fn set_api_key(key: String) -> Result<(), String> {
    let e = entry()?;
    if key.is_empty() {
        match e.delete_credential() {
            Ok(()) => Ok(()),
            Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(format!("Could not clear keychain entry: {err}")),
        }
    } else {
        e.set_password(&key)
            .map_err(|err| format!("Could not save API key: {err}"))
    }
}
