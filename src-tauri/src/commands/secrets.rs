use keyring::{Entry, Error as KeyringError};
use serde::Serialize;
use uuid::Uuid;

const SERVICE: &str = "scholara";

fn account_for(name: &str) -> String {
    format!("{name}_api_key")
}

fn entry_for_account(account: &str, name: &str, operation: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| {
        format!(
            "Could not {operation} secret name={name} service={SERVICE} account={account}: {e}"
        )
    })
}

fn entry(name: &str, operation: &str) -> Result<(String, Entry), String> {
    let account = account_for(name);
    let e = entry_for_account(&account, name, operation)?;
    Ok((account, e))
}

#[derive(Serialize)]
pub struct SecretDiagnostic {
    pub service: String,
    pub account: String,
    pub diagnostic_account: String,
    pub existing_entry: bool,
    pub status: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_secret(name: String) -> Result<Option<String>, String> {
    let (account, e) = entry(&name, "load")?;
    match e.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!(
            "Could not load secret name={name} service={SERVICE} account={account}: {err}"
        )),
    }
}

#[tauri::command]
pub fn set_secret(name: String, value: String) -> Result<(), String> {
    let (account, e) = entry(&name, "save")?;
    if value.is_empty() {
        match e.delete_credential() {
            Ok(()) => Ok(()),
            Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(format!(
                "Could not clear secret name={name} service={SERVICE} account={account}: {err}"
            )),
        }
    } else {
        e.set_password(&value).map_err(|err| {
            format!("Could not save secret name={name} service={SERVICE} account={account}: {err}")
        })
    }
}

#[tauri::command]
pub fn diagnose_secret(name: String) -> SecretDiagnostic {
    let account = account_for(&name);
    let diagnostic_account = format!("{name}_diagnostic_api_key");
    let mut existing_entry = false;

    let real_entry = match entry_for_account(&account, &name, "diagnose") {
        Ok(entry) => entry,
        Err(error) => {
            return SecretDiagnostic {
                service: SERVICE.into(),
                account,
                diagnostic_account,
                existing_entry,
                status: "entry_failed".into(),
                error: Some(error),
            };
        }
    };

    match real_entry.get_password() {
        Ok(_) => existing_entry = true,
        Err(KeyringError::NoEntry) => {}
        Err(error) => {
            let message = format!(
                "Could not inspect secret name={name} service={SERVICE} account={account}: {error}"
            );
            return SecretDiagnostic {
                service: SERVICE.into(),
                account,
                diagnostic_account,
                existing_entry,
                status: "real_load_failed".into(),
                error: Some(message),
            };
        }
    }

    let diagnostic_entry =
        match entry_for_account(&diagnostic_account, &name, "diagnose round-trip") {
            Ok(entry) => entry,
            Err(error) => {
                return SecretDiagnostic {
                    service: SERVICE.into(),
                    account,
                    diagnostic_account,
                    existing_entry,
                    status: "diagnostic_entry_failed".into(),
                    error: Some(error),
                };
            }
        };

    let probe = format!("scholara-diagnostic-{}", Uuid::new_v4());
    if let Err(error) = diagnostic_entry.set_password(&probe) {
        let message = format!(
            "Could not save diagnostic secret name={name} service={SERVICE} account={diagnostic_account}: {error}"
        );
        return SecretDiagnostic {
            service: SERVICE.into(),
            account,
            diagnostic_account,
            existing_entry,
            status: "diagnostic_save_failed".into(),
            error: Some(message),
        };
    }

    let loaded = match diagnostic_entry.get_password() {
        Ok(value) => value,
        Err(error) => {
            let _ = diagnostic_entry.delete_credential();
            let message = format!(
                "Could not load diagnostic secret name={name} service={SERVICE} account={diagnostic_account}: {error}"
            );
            return SecretDiagnostic {
                service: SERVICE.into(),
                account,
                diagnostic_account,
                existing_entry,
                status: "diagnostic_load_failed".into(),
                error: Some(message),
            };
        }
    };

    let delete_error = match diagnostic_entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => None,
        Err(error) => Some(format!(
            "Diagnostic secret round-trip passed, but cleanup failed service={SERVICE} account={diagnostic_account}: {error}"
        )),
    };

    if loaded != probe {
        return SecretDiagnostic {
            service: SERVICE.into(),
            account,
            diagnostic_account,
            existing_entry,
            status: "diagnostic_mismatch".into(),
            error: Some("Diagnostic secret did not match after loading.".into()),
        };
    }

    SecretDiagnostic {
        service: SERVICE.into(),
        account,
        diagnostic_account,
        existing_entry,
        status: if delete_error.is_some() {
            "cleanup_failed".into()
        } else {
            "ok".into()
        },
        error: delete_error,
    }
}
