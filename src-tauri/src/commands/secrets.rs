use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "scholara";

fn account_for(name: &str) -> String {
    format!("{name}_api_key")
}

fn entry(name: &str) -> Result<Entry, String> {
    let account = account_for(name);
    Entry::new(SERVICE, &account).map_err(|e| format!("Could not access keychain: {e}"))
}

#[tauri::command]
pub fn get_secret(name: String) -> Result<Option<String>, String> {
    let e = entry(&name)?;
    match e.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!("Could not access keychain: {err}")),
    }
}

#[tauri::command]
pub fn set_secret(name: String, value: String) -> Result<(), String> {
    let e = entry(&name)?;
    if value.is_empty() {
        match e.delete_credential() {
            Ok(()) => Ok(()),
            Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(format!("Could not clear keychain entry: {err}")),
        }
    } else {
        e.set_password(&value)
            .map_err(|err| format!("Could not save secret: {err}"))
    }
}
