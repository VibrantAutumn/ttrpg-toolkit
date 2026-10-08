//! Tauri commands: the thin layer React calls. Each one locks the shared
//! connection and calls a tested function in `db/`. Keep logic out of here.
//!
//! JavaScript passes arguments in camelCase (`campaignId`); Tauri maps them to
//! the snake_case names below.

use crate::db::campaigns::{self, Campaign};
use crate::db::documents;
use crate::db::error::DbError;
use crate::db::folders::{self, Folder};
use crate::db::items::{self, Item};
use crate::db::links;
use crate::db::tags::{self, Tag, TagLink};
use crate::db::trash::{self, Trash};
use crate::db::{self, search, settings};
use crate::pack::import::{ImportResult, PackPreview};
use crate::pack::{self, PackError};
use rusqlite::Connection;
use tauri::State;

type Db<'a> = State<'a, db::Db>;

/// Locks the shared connection, runs `f`, and turns errors into strings for the front end.
fn with_conn<T>(db: &db::Db, f: impl FnOnce(&Connection) -> Result<T, DbError>) -> Result<T, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    f(&conn).map_err(|e| e.to_string())
}

/// Like `with_conn`, for pack operations (their errors have their own friendly text).
fn with_conn_pack<T>(
    db: &db::Db,
    f: impl FnOnce(&Connection) -> Result<T, PackError>,
) -> Result<T, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    f(&conn).map_err(|e| e.to_string())
}

// ---- Diagnostics ----

/// Reports the database's schema version (handy for diagnostics).
#[tauri::command]
pub fn db_schema_version(db: Db) -> Result<u32, String> {
    with_conn(&db, |c| Ok(db::migrations::current_version(c)?))
}

// ---- Campaigns ----

#[tauri::command]
pub fn list_campaigns(db: Db) -> Result<Vec<Campaign>, String> {
    with_conn(&db, campaigns::list)
}

#[tauri::command]
pub fn create_campaign(db: Db, name: String) -> Result<Campaign, String> {
    with_conn(&db, |c| {
        let now = db::now_ms();
        let campaign = campaigns::create(c, &name, now)?;
        // The first campaign you make becomes the one that's open.
        settings::set_current_campaign_if_none(c, &campaign.id, now)?;
        Ok(campaign)
    })
}

#[tauri::command]
pub fn rename_campaign(db: Db, id: String, name: String) -> Result<Campaign, String> {
    with_conn(&db, |c| campaigns::rename(c, &id, &name, db::now_ms()))
}

#[tauri::command]
pub fn delete_campaign(db: Db, id: String) -> Result<(), String> {
    with_conn(&db, |c| campaigns::soft_delete(c, &id, db::now_ms()))
}

#[tauri::command]
pub fn restore_campaign(db: Db, id: String) -> Result<Campaign, String> {
    with_conn(&db, |c| campaigns::restore(c, &id, db::now_ms()))
}

/// The campaign open on this device, or none.
#[tauri::command]
pub fn get_current_campaign(db: Db) -> Result<Option<Campaign>, String> {
    with_conn(&db, settings::current_campaign)
}

#[tauri::command]
pub fn set_current_campaign(db: Db, id: String) -> Result<Campaign, String> {
    with_conn(&db, |c| settings::set_current_campaign(c, &id, db::now_ms()))
}

// ---- Content packs ----
// These are `async` so a big pack is read or written off the main thread and
// the window doesn't freeze meanwhile. Files cross to and from JavaScript as
// base64 text, never raw bytes (Android can't deliver raw request bodies; see
// `pack::encode_for_transport`).

/// The pack file for one campaign, as base64 text (JavaScript saves it where the user chooses).
#[tauri::command]
pub async fn export_campaign_pack(db: Db<'_>, campaign_id: String) -> Result<String, String> {
    let bytes = with_conn_pack(&db, |c| {
        pack::export::export_campaign(c, &campaign_id, db::now_ms())
    })?;
    Ok(pack::encode_for_transport(&bytes))
}

/// Reads a pack (sent as base64 text) and describes it, without importing anything.
#[tauri::command]
pub async fn preview_pack(data: String) -> Result<PackPreview, String> {
    let bytes = pack::decode_from_transport(&data).map_err(|e| e.to_string())?;
    let parsed = pack::import::read_pack(&bytes).map_err(|e| e.to_string())?;
    Ok(pack::import::preview(&parsed))
}

/// Imports a pack (sent as base64 text) as a new campaign.
#[tauri::command]
pub async fn import_pack(db: Db<'_>, data: String) -> Result<ImportResult, String> {
    with_conn_pack(&db, |c| {
        let bytes = pack::decode_from_transport(&data)?;
        pack::import::import_pack(c, &bytes, db::now_ms())
    })
}

// ---- Library: folders ----

#[tauri::command]
pub fn list_folders(db: Db, campaign_id: String, library: String) -> Result<Vec<Folder>, String> {
    with_conn(&db, |c| folders::list(c, &campaign_id, &library))
}

#[tauri::command]
pub fn create_folder(
    db: Db,
    campaign_id: String,
    library: String,
    parent_id: Option<String>,
    name: String,
) -> Result<Folder, String> {
    with_conn(&db, |c| {
        folders::create(c, &campaign_id, &library, parent_id.as_deref(), &name, db::now_ms())
    })
}

#[tauri::command]
pub fn rename_folder(db: Db, id: String, name: String) -> Result<Folder, String> {
    with_conn(&db, |c| folders::rename(c, &id, &name, db::now_ms()))
}

#[tauri::command]
pub fn move_folder(db: Db, id: String, parent_id: Option<String>) -> Result<Folder, String> {
    with_conn(&db, |c| folders::move_to(c, &id, parent_id.as_deref(), db::now_ms()))
}

/// Moves the folder, its subfolders and their items to the trash.
#[tauri::command]
pub fn delete_folder(db: Db, id: String) -> Result<(), String> {
    with_conn(&db, |c| folders::soft_delete(c, &id, db::now_ms()))
}

// ---- Library: items ----

#[tauri::command]
pub fn list_items(
    db: Db,
    campaign_id: String,
    library: String,
    folder_id: Option<String>,
) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| items::list(c, &campaign_id, &library, folder_id.as_deref()))
}

#[tauri::command]
pub fn create_item(
    db: Db,
    campaign_id: String,
    library: String,
    item_type: String,
    name: String,
    folder_id: Option<String>,
) -> Result<Item, String> {
    with_conn(&db, |c| {
        items::create(c, &campaign_id, &library, &item_type, &name, folder_id.as_deref(), db::now_ms())
    })
}

#[tauri::command]
pub fn rename_item(db: Db, id: String, name: String) -> Result<Item, String> {
    with_conn(&db, |c| items::rename(c, &id, &name, db::now_ms()))
}

#[tauri::command]
pub fn move_item(db: Db, id: String, folder_id: Option<String>) -> Result<Item, String> {
    with_conn(&db, |c| items::move_to(c, &id, folder_id.as_deref(), db::now_ms()))
}

#[tauri::command]
pub fn delete_item(db: Db, id: String) -> Result<(), String> {
    with_conn(&db, |c| items::soft_delete(c, &id, db::now_ms()))
}

/// One live item by id (for the item view).
#[tauri::command]
pub fn get_item(db: Db, id: String) -> Result<Item, String> {
    with_conn(&db, |c| {
        let item = items::get(c, &id)?;
        if item.deleted_at.is_some() {
            return Err(DbError::NotFound);
        }
        Ok(item)
    })
}

// ---- Documents ----

/// A document's Markdown text.
#[tauri::command]
pub fn get_document_body(db: Db, item_id: String) -> Result<String, String> {
    with_conn(&db, |c| documents::get_body(c, &item_id))
}

#[tauri::command]
pub fn set_document_body(db: Db, item_id: String, body: String) -> Result<(), String> {
    with_conn(&db, |c| documents::set_body(c, &item_id, &body, db::now_ms()))
}

// ---- Library: links ----

/// Items this item links to.
#[tauri::command]
pub fn list_links(db: Db, item_id: String) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| links::outgoing(c, &item_id))
}

/// Items that link to this item.
#[tauri::command]
pub fn list_backlinks(db: Db, item_id: String) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| links::backlinks(c, &item_id))
}

#[tauri::command]
pub fn add_link(db: Db, source_item_id: String, target_item_id: String) -> Result<(), String> {
    with_conn(&db, |c| {
        links::add(c, &source_item_id, &target_item_id, links::MANUAL, db::now_ms())
    })
}

#[tauri::command]
pub fn remove_link(db: Db, source_item_id: String, target_item_id: String) -> Result<(), String> {
    with_conn(&db, |c| {
        links::remove(c, &source_item_id, &target_item_id, links::MANUAL, db::now_ms())
    })
}

// ---- Library: trash ----

#[tauri::command]
pub fn list_trash(db: Db, campaign_id: String, library: String) -> Result<Trash, String> {
    with_conn(&db, |c| trash::list(c, &campaign_id, &library))
}

#[tauri::command]
pub fn restore_item(db: Db, id: String) -> Result<Item, String> {
    with_conn(&db, |c| trash::restore_item(c, &id, db::now_ms()))
}

#[tauri::command]
pub fn restore_folder(db: Db, id: String) -> Result<Folder, String> {
    with_conn(&db, |c| trash::restore_folder(c, &id, db::now_ms()))
}

#[tauri::command]
pub fn purge_item(db: Db, id: String) -> Result<(), String> {
    with_conn(&db, |c| trash::purge_item(c, &id))
}

#[tauri::command]
pub fn purge_folder(db: Db, id: String) -> Result<(), String> {
    with_conn(&db, |c| trash::purge_folder(c, &id))
}

/// Permanently deletes everything in a library's trash. Returns how many rows were removed.
#[tauri::command]
pub fn empty_trash(db: Db, campaign_id: String, library: String) -> Result<usize, String> {
    with_conn(&db, |c| trash::empty(c, &campaign_id, &library, None))
}

// ---- Library: tags and search ----

#[tauri::command]
pub fn list_tags(db: Db, campaign_id: String) -> Result<Vec<Tag>, String> {
    with_conn(&db, |c| tags::list(c, &campaign_id))
}

#[tauri::command]
pub fn create_tag(
    db: Db,
    campaign_id: String,
    parent_id: Option<String>,
    name: String,
    color: Option<String>,
) -> Result<Tag, String> {
    with_conn(&db, |c| {
        tags::create(c, &campaign_id, parent_id.as_deref(), &name, color.as_deref(), db::now_ms())
    })
}

/// The live tags on one item.
#[tauri::command]
pub fn list_item_tags(db: Db, item_id: String) -> Result<Vec<Tag>, String> {
    with_conn(&db, |c| tags::for_item(c, &item_id))
}

#[tauri::command]
pub fn add_tag_to_item(db: Db, item_id: String, tag_id: String) -> Result<(), String> {
    with_conn(&db, |c| tags::add_to_item(c, &item_id, &tag_id, db::now_ms()))
}

#[tauri::command]
pub fn remove_tag_from_item(db: Db, item_id: String, tag_id: String) -> Result<(), String> {
    with_conn(&db, |c| tags::remove_from_item(c, &item_id, &tag_id, db::now_ms()))
}

/// Every live tag on every live item in a library (to draw tag chips in one request).
#[tauri::command]
pub fn list_tag_links(db: Db, campaign_id: String, library: String) -> Result<Vec<TagLink>, String> {
    with_conn(&db, |c| tags::links_in_library(c, &campaign_id, &library))
}

#[tauri::command]
pub fn search_items(
    db: Db,
    campaign_id: String,
    text: String,
    library: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| {
        search::search(c, &campaign_id, &text, library.as_deref(), limit.unwrap_or(50))
    })
}
