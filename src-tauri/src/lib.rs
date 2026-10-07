mod commands;
mod db;

use std::sync::Mutex;
use tauri::Manager;

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
            commands::db_schema_version,
            commands::list_campaigns,
            commands::create_campaign,
            commands::rename_campaign,
            commands::delete_campaign,
            commands::restore_campaign,
            commands::get_current_campaign,
            commands::set_current_campaign,
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::move_folder,
            commands::delete_folder,
            commands::list_items,
            commands::create_item,
            commands::rename_item,
            commands::move_item,
            commands::delete_item,
            commands::list_trash,
            commands::restore_item,
            commands::restore_folder,
            commands::purge_item,
            commands::purge_folder,
            commands::empty_trash,
            commands::list_tags,
            commands::create_tag,
            commands::add_tag_to_item,
            commands::remove_tag_from_item,
            commands::list_tag_links,
            commands::search_items,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
