use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

#[derive(Serialize)]
pub struct DownloadResult {
    pub stored_path: String,
    pub file_type: String,
}

fn err<E: std::fmt::Display>(prefix: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{prefix}: {e}")
}

async fn try_url(client: &reqwest::Client, url: &str, dest: &Path) -> Result<bool, String> {
    let mut resp = client.get(url).send().await.map_err(err("network"))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(false);
    }
    if !resp.status().is_success() {
        return Err(format!("server: HTTP {}", resp.status().as_u16()));
    }

    let mut file = tokio::fs::File::create(dest).await.map_err(err("io"))?;
    while let Some(chunk) = resp.chunk().await.map_err(err("network"))? {
        file.write_all(&chunk).await.map_err(err("io"))?;
    }
    file.flush().await.map_err(err("io"))?;

    Ok(true)
}

#[tauri::command]
pub async fn download_gutenberg_epub(
    app: AppHandle,
    book_id: i64,
) -> Result<DownloadResult, String> {
    let client = reqwest::Client::builder()
        .user_agent("Scholara/0.1 (+https://gutenberg.org)")
        .build()
        .map_err(err("network"))?;

    let app_data = app.path().app_data_dir().map_err(err("io"))?;
    let books_dir = app_data.join("books");
    tokio::fs::create_dir_all(&books_dir)
        .await
        .map_err(err("io"))?;

    let nonce = Uuid::new_v4().simple().to_string()[..6].to_string();
    let filename = format!("gutenberg-{book_id}-{nonce}.epub");
    let dest = books_dir.join(&filename);
    let temp_dest = books_dir.join(format!("{filename}.part"));

    let primary = format!("https://www.gutenberg.org/ebooks/{book_id}.epub.images");
    let fallback = format!("https://www.gutenberg.org/ebooks/{book_id}.epub.noimages");

    let downloaded = match try_url(&client, &primary, &temp_dest).await? {
        true => true,
        false => try_url(&client, &fallback, &temp_dest).await?,
    };

    if !downloaded {
        let _ = tokio::fs::remove_file(&temp_dest).await;
        return Err("not_found: no EPUB available for this book".into());
    }

    tokio::fs::rename(&temp_dest, &dest)
        .await
        .map_err(err("io"))?;

    Ok(DownloadResult {
        stored_path: dest
            .to_str()
            .ok_or_else(|| "io: destination path is not valid UTF-8".to_string())?
            .to_string(),
        file_type: "epub".into(),
    })
}
