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

fn assert_within_books_dir(app: &AppHandle, path: &Path) -> Result<(), String> {
    let books_dir = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?
        .join("books");
    let canonical = path
        .canonicalize()
        .map_err(err("Could not canonicalize path"))?;
    let canonical_books = books_dir
        .canonicalize()
        .map_err(err("Could not canonicalize books dir"))?;
    if !canonical.starts_with(&canonical_books) {
        return Err("Path is outside the books directory".into());
    }
    Ok(())
}

#[tauri::command]
pub fn read_book_bytes(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    let p = PathBuf::from(&path);
    assert_within_books_dir(&app, &p)?;
    std::fs::read(&p).map_err(err("Could not read book"))
}

#[tauri::command]
pub fn save_cover_bytes(
    app: AppHandle,
    book_id: i64,
    bytes: Vec<u8>,
    ext: String,
) -> Result<String, String> {
    let ext_lc = ext.to_lowercase();
    if !matches!(ext_lc.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return Err(format!("Unsupported cover extension: {ext}"));
    }
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?;
    let covers_dir = app_data.join("covers");
    std::fs::create_dir_all(&covers_dir).map_err(err("Could not create covers dir"))?;

    let dest = covers_dir.join(format!("{book_id}.{ext_lc}"));
    std::fs::write(&dest, &bytes).map_err(err("Could not write cover"))?;

    dest.to_str()
        .ok_or_else(|| "Cover path is not valid UTF-8".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
pub fn delete_book_files(
    app: AppHandle,
    book_id: i64,
    file_path: String,
) -> Result<(), String> {
    // Idempotent: ignore NotFound errors.
    let _ = std::fs::remove_file(Path::new(&file_path));

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(err("Could not resolve app data dir"))?;
    let covers_dir = app_data.join("covers");
    if covers_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&covers_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                let prefix = format!("{book_id}.");
                if name_str.starts_with(&prefix) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
    Ok(())
}
