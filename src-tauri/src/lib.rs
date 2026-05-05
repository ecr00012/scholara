mod commands;

use commands::books::{app_data_dir_path, copy_uploaded_file, reveal_in_file_manager};
use commands::secrets::{get_api_key, set_api_key};
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
    ];

    tauri::Builder::default()
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
            get_api_key,
            set_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
