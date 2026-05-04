use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

#[derive(Serialize)]
pub struct CopyResult {
    pub stored_path: String,
    pub file_type: String,
}

fn err<E: std::fmt::Display>(prefix: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{prefix}: {e}")
}

#[tauri::command]
pub fn copy_uploaded_file(
    app: AppHandle,
    source_path: String,
) -> Result<CopyResult, String> {
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Source file does not exist".into());
    }

    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or_else(|| "File has no extension".to_string())?;

    let file_type = match extension.as_str() {
        "pdf" => "pdf",
        "epub" => "epub",
        other => return Err(format!("Unsupported file type: .{other}")),
    };

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?;

    let books_dir = app_data.join("books");
    std::fs::create_dir_all(&books_dir).map_err(err("Could not create books dir"))?;

    let mut dest: PathBuf;
    loop {
        let filename = format!("{}.{}", Uuid::new_v4(), extension);
        dest = books_dir.join(&filename);
        if !dest.exists() {
            break;
        }
    }

    std::fs::copy(source, &dest).map_err(err("Could not save book"))?;

    Ok(CopyResult {
        stored_path: dest
            .to_str()
            .ok_or_else(|| "Destination path is not valid UTF-8".to_string())?
            .to_string(),
        file_type: file_type.into(),
    })
}

#[tauri::command]
pub fn app_data_dir_path(app: AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn reveal_in_file_manager(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(err("Could not reveal in file manager"))
}
