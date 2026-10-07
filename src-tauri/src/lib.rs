mod db;

use std::sync::Mutex;
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Reports the database's schema version (temporary check that the whole chain works).
#[tauri::command]
fn db_schema_version(db: tauri::State<db::Db>) -> Result<u32, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::migrations::current_version(&conn).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The per-app data folder is private to the app on both Windows and Android.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("toolkit.db"))?;
            app.manage(db::Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, db_schema_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
