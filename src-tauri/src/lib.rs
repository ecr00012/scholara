mod commands;

use commands::books::{
    app_data_dir_path, copy_uploaded_file, delete_book_files, read_book_bytes,
    reveal_in_file_manager, save_cover_bytes,
};
use commands::secrets::{get_api_key, set_api_key};
use commands::wordnet::{lookup_wordnet, WordnetState};
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
        .invoke_handler(tauri::generate_handler![
            copy_uploaded_file,
            app_data_dir_path,
            reveal_in_file_manager,
            read_book_bytes,
            save_cover_bytes,
            delete_book_files,
            get_api_key,
            set_api_key,
            lookup_wordnet,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
