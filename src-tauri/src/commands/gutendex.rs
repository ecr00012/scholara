use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize)]
struct GutendexResponse {
    results: Vec<GutendexRawBook>,
}

#[derive(Deserialize)]
struct GutendexRawAuthor {
    name: String,
}

#[derive(Deserialize)]
struct GutendexRawBook {
    id: i64,
    title: String,
    #[serde(default)]
    authors: Vec<GutendexRawAuthor>,
    #[serde(default)]
    subjects: Vec<String>,
    #[serde(default)]
    bookshelves: Vec<String>,
    #[serde(default)]
    download_count: i64,
    #[serde(default)]
    formats: HashMap<String, String>,
}

#[derive(Serialize)]
pub struct GutenbergAuthor {
    pub name: String,
}

#[derive(Serialize)]
pub struct GutenbergBook {
    pub id: i64,
    pub title: String,
    pub authors: Vec<GutenbergAuthor>,
    pub subjects: Vec<String>,
    pub bookshelves: Vec<String>,
    pub download_count: i64,
    pub cover_image: Option<String>,
    pub issued: Option<String>,
    pub reading_ease_score: Option<String>,
}

#[derive(Serialize)]
pub struct GutendexPage {
    pub books: Vec<GutenbergBook>,
}

fn cover_from_formats(id: i64, formats: &HashMap<String, String>) -> Option<String> {
    if let Some(url) = formats.get("image/jpeg") {
        return Some(url.clone());
    }

    Some(format!(
        "https://www.gutenberg.org/cache/epub/{id}/pg{id}.cover.medium.jpg"
    ))
}

fn err<E: std::fmt::Display>(prefix: &str) -> impl Fn(E) -> String + '_ {
    move |e| format!("{prefix}: {e}")
}

#[tauri::command]
pub async fn fetch_gutendex_page(page: u32) -> Result<GutendexPage, String> {
    if page == 0 {
        return Err("client: page must be >= 1".into());
    }

    let client = reqwest::Client::builder()
        .user_agent("Scholara/0.1 (+https://gutenberg.org)")
        .build()
        .map_err(err("network"))?;

    let url = format!("https://gutendex.com/books?sort=popular&page={page}");
    let resp = client.get(&url).send().await.map_err(err("network"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("server: HTTP {}", status.as_u16()));
    }

    let parsed: GutendexResponse = resp.json().await.map_err(err("decode"))?;
    let books = parsed
        .results
        .into_iter()
        .map(|book| GutenbergBook {
            id: book.id,
            title: book.title,
            authors: book
                .authors
                .into_iter()
                .map(|author| GutenbergAuthor { name: author.name })
                .collect(),
            subjects: book.subjects,
            bookshelves: book.bookshelves,
            download_count: book.download_count,
            cover_image: cover_from_formats(book.id, &book.formats),
            issued: None,
            reading_ease_score: None,
        })
        .collect();

    Ok(GutendexPage { books })
}
