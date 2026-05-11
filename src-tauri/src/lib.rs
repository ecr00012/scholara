mod commands;
mod migrate_v6;

use commands::books::{
    app_data_dir_path, copy_uploaded_file, delete_book_files, read_book_bytes,
    reveal_in_file_manager, save_cover_bytes,
};
use commands::gutenberg::download_gutenberg_epub;
use commands::gutendex::fetch_gutendex_page;
use commands::openrouter::{chat_oneshot, chat_stream};
use commands::secrets::{diagnose_secret, get_secret, set_secret};
use commands::wordnet::{lookup_wordnet, WordnetState};
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "init schema",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "phase 2: epub_locations",
            sql: include_str!("../migrations/0002_phase2.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "vocabulary unique per book",
            sql: include_str!("../migrations/0003_vocab_unique.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "phase 4a: gutenberg panel state",
            sql: include_str!("../migrations/0004_gutenberg.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "ai chat: threads, messages, chunks, preferences, profile",
            sql: include_str!("../migrations/0005_ai_chat.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "openrouter: rebuild messages table for tool role + new payload shape",
            sql: include_str!("../migrations/0006_openrouter_message_shape.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .manage(WordnetState::default())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:scholara.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // After tauri-plugin-sql has applied migrations, run the v6 backfill on
            // the same db file. Failure is logged but non-fatal — startup still proceeds.
            let app_data = app.path().app_data_dir().ok();
            if let Some(mut dir) = app_data {
                dir.push("scholara.db");
                if let Err(e) = migrate_v6::backfill_messages_v6(&dir) {
                    eprintln!("backfill_messages_v6 failed: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            copy_uploaded_file,
            app_data_dir_path,
            reveal_in_file_manager,
            read_book_bytes,
            save_cover_bytes,
            delete_book_files,
            get_secret,
            set_secret,
            diagnose_secret,
            download_gutenberg_epub,
            fetch_gutendex_page,
            lookup_wordnet,
            chat_stream,
            chat_oneshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
