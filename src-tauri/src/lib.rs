mod db;

use db::campaigns::{self, Campaign};
use db::error::DbError;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

/// Locks the shared connection, runs `f`, and turns errors into strings for the front end.
fn with_conn<T>(
    db: &db::Db,
    f: impl FnOnce(&Connection) -> Result<T, DbError>,
) -> Result<T, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    f(&conn).map_err(|e| e.to_string())
}

/// Reports the database's schema version (handy for diagnostics).
#[tauri::command]
fn db_schema_version(db: tauri::State<db::Db>) -> Result<u32, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db::migrations::current_version(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_campaigns(db: tauri::State<db::Db>) -> Result<Vec<Campaign>, String> {
    with_conn(&db, campaigns::list)
}

#[tauri::command]
fn create_campaign(db: tauri::State<db::Db>, name: String) -> Result<Campaign, String> {
    with_conn(&db, |c| campaigns::create(c, &name, db::now_ms()))
}

#[tauri::command]
fn rename_campaign(db: tauri::State<db::Db>, id: String, name: String) -> Result<Campaign, String> {
    with_conn(&db, |c| campaigns::rename(c, &id, &name, db::now_ms()))
}

#[tauri::command]
fn delete_campaign(db: tauri::State<db::Db>, id: String) -> Result<(), String> {
    with_conn(&db, |c| campaigns::soft_delete(c, &id, db::now_ms()))
}

#[tauri::command]
fn restore_campaign(db: tauri::State<db::Db>, id: String) -> Result<Campaign, String> {
    with_conn(&db, |c| campaigns::restore(c, &id, db::now_ms()))
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
        .invoke_handler(tauri::generate_handler![
            db_schema_version,
            list_campaigns,
            create_campaign,
            rename_campaign,
            delete_campaign,
            restore_campaign
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
