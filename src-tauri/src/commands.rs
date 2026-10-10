//! Tauri commands: the thin layer React calls. Each one locks the shared
//! connection and calls a tested function in `db/`. Keep logic out of here.
//!
//! JavaScript passes arguments in camelCase (`projectId`); Tauri maps them to
//! the snake_case names below.

use crate::db::projects::{self, Project};
use crate::db::cards::{self, CardDetails, ImageData};
use crate::db::collections;
use crate::db::documents;
use crate::db::error::DbError;
use crate::db::fields::{self, FieldDefinition, FieldSet, FieldValue, IndexUpdate, ItemFields, ValueIndex};
use crate::db::folders::{self, Folder};
use crate::db::items::{self, Item};
use crate::db::formulas::{self, Formula, FormulaEntry};
use crate::db::links;
use crate::db::name_presets::{self, NamePreset, PresetEntry};
use crate::db::generators::{self, Generator};
use crate::db::query::{self, QueryResult};
use crate::db::smart_collections::{self, SmartCollection};
use crate::db::spreads::{self, PositionInput, Spread, SpreadEntry};
use crate::db::starters::{self, InstallResult};
use crate::db::table_starters::{self, TableInstallResult};
use crate::db::tables::{self, Entry, EntryInput, EntryRef, EntryTextUpdate, Pick, RollableTable, TableDetail, TableSummary};
use crate::db::play_decks::{self, NewPlayDeck, PlayDeck, PlayDeckEntry};
use crate::db::saved_draws::{self, NewSavedDraw, SavedDraw};
use crate::db::saved_rolls::{self, NewSavedRoll, SavedRoll};
use crate::db::tags::{self, Tag, TagLink};
use crate::db::trash::{self, Trash};
use crate::db::template_starters::{self, TemplateInstallResult};
use crate::db::tabs::{self, Family, Tab};
use crate::db::templates;
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

// ---- Projects ----

#[tauri::command]
pub fn list_projects(db: Db) -> Result<Vec<Project>, String> {
    with_conn(&db, projects::list)
}

#[tauri::command]
pub fn create_project(db: Db, name: String) -> Result<Project, String> {
    with_conn(&db, |c| {
        let now = db::now_ms();
        let project = projects::create(c, &name, now)?;
        // The first project you make becomes the one that's open.
        settings::set_current_project_if_none(c, &project.id, now)?;
        Ok(project)
    })
}

#[tauri::command]
pub fn rename_project(db: Db, id: String, name: String) -> Result<Project, String> {
    with_conn(&db, |c| projects::rename(c, &id, &name, db::now_ms()))
}

#[tauri::command]
pub fn delete_project(db: Db, id: String) -> Result<(), String> {
    with_conn(&db, |c| projects::soft_delete(c, &id, db::now_ms()))
}

#[tauri::command]
pub fn restore_project(db: Db, id: String) -> Result<Project, String> {
    with_conn(&db, |c| projects::restore(c, &id, db::now_ms()))
}

/// The project open on this device, or none.
#[tauri::command]
pub fn get_current_project(db: Db) -> Result<Option<Project>, String> {
    with_conn(&db, settings::current_project)
}

#[tauri::command]
pub fn set_current_project(db: Db, id: String) -> Result<Project, String> {
    with_conn(&db, |c| settings::set_current_project(c, &id, db::now_ms()))
}

// ---- Saved dice rolls ----

/// Saves a finished roll as a new item in the Dice library.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn save_roll(
    db: Db,
    project_id: String,
    name: String,
    folder_id: Option<String>,
    notation: String,
    seed: i64,
    text: String,
    result_json: String,
) -> Result<Item, String> {
    with_conn(&db, |c| {
        let new = NewSavedRoll {
            project_id: &project_id,
            name: &name,
            folder_id: folder_id.as_deref(),
            notation: &notation,
            seed,
            text: &text,
            result_json: &result_json,
        };
        saved_rolls::create(c, new, db::now_ms()).map(|(item, _)| item)
    })
}

/// A saved roll's details (notation, seed, readable text and the full result).
#[tauri::command]
pub fn get_saved_roll(db: Db, item_id: String) -> Result<SavedRoll, String> {
    with_conn(&db, |c| saved_rolls::get(c, &item_id))
}

// ---- Saved dice formulas ----

/// Saves a formula as a new item in the Dice library. (The app's dice parser
/// has already checked the notation; the database only keeps it.)
#[tauri::command]
pub fn create_formula(
    db: Db,
    project_id: String,
    name: String,
    folder_id: Option<String>,
    notation: String,
) -> Result<Item, String> {
    with_conn(&db, |c| {
        formulas::create(c, &project_id, &name, folder_id.as_deref(), &notation, db::now_ms())
    })
}

#[tauri::command]
pub fn get_formula(db: Db, item_id: String) -> Result<Formula, String> {
    with_conn(&db, |c| formulas::get(c, &item_id))
}

#[tauri::command]
pub fn set_formula_notation(db: Db, item_id: String, notation: String) -> Result<(), String> {
    with_conn(&db, |c| formulas::set_notation(c, &item_id, &notation, db::now_ms()))
}

/// Every live formula in the project, for the roller's list.
#[tauri::command]
pub fn list_formulas(db: Db, project_id: String) -> Result<Vec<FormulaEntry>, String> {
    with_conn(&db, |c| formulas::list(c, &project_id))
}

// ---- Cards, sets, decks and pools ----

#[tauri::command]
pub fn get_card_details(db: Db, item_id: String) -> Result<CardDetails, String> {
    with_conn(&db, |c| cards::get_details(c, &item_id))
}

#[tauri::command]
pub fn set_card_details(db: Db, item_id: String, value: String, notes: String) -> Result<(), String> {
    with_conn(&db, |c| cards::set_details(c, &item_id, &value, &notes, db::now_ms()))
}

/// Sets a card's picture. The pictures arrive as base64 text (never raw bytes:
/// Android can't deliver them), already shrunk by the app.
#[tauri::command]
pub fn set_card_image(
    db: Db,
    item_id: String,
    mime: String,
    image: String,
    thumb: String,
) -> Result<(), String> {
    with_conn(&db, |c| {
        let image = cards::decode_base64(&image)?;
        let thumb = cards::decode_base64(&thumb)?;
        cards::set_image(c, &item_id, &mime, &image, &thumb, db::now_ms())
    })
}

#[tauri::command]
pub fn remove_card_image(db: Db, item_id: String) -> Result<(), String> {
    with_conn(&db, |c| cards::remove_image(c, &item_id, db::now_ms()))
}

/// A card's full-size picture, if it has one.
#[tauri::command]
pub fn get_card_image(db: Db, item_id: String) -> Result<Option<ImageData>, String> {
    with_conn(&db, |c| cards::get_image(c, &item_id))
}

/// Thumbnails for several cards at once (cards without a picture are left out).
#[tauri::command]
pub fn get_card_thumbs(db: Db, item_ids: Vec<String>) -> Result<Vec<ImageData>, String> {
    with_conn(&db, |c| cards::get_thumbs(c, &item_ids))
}

#[tauri::command]
pub fn add_to_collection(db: Db, collection_id: String, member_id: String) -> Result<(), String> {
    with_conn(&db, |c| collections::add_member(c, &collection_id, &member_id, db::now_ms()))
}

#[tauri::command]
pub fn remove_from_collection(db: Db, collection_id: String, member_id: String) -> Result<(), String> {
    with_conn(&db, |c| collections::remove_member(c, &collection_id, &member_id, db::now_ms()))
}

/// What is directly inside a set, deck or pool, in order.
#[tauri::command]
pub fn list_collection_members(db: Db, collection_id: String) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| collections::list_members(c, &collection_id))
}

/// The sets, decks and pools that directly hold an item.
#[tauri::command]
pub fn list_containers(db: Db, item_id: String) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| collections::containers_of(c, &item_id))
}

/// Every distinct card a set, deck or pool reaches.
#[tauri::command]
pub fn resolve_collection_cards(db: Db, collection_id: String) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| collections::resolve_cards(c, &collection_id))
}

/// What could still be added to a set, deck or pool.
#[tauri::command]
pub fn list_collection_candidates(db: Db, collection_id: String) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| collections::candidates(c, &collection_id))
}

// ---- Saved card draws ----

/// Saves a finished draw as a new item in the Cards library.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn save_draw(
    db: Db,
    project_id: String,
    name: String,
    folder_id: Option<String>,
    source_name: String,
    seed: i64,
    text: String,
    result_json: String,
) -> Result<Item, String> {
    with_conn(&db, |c| {
        let new = NewSavedDraw {
            project_id: &project_id,
            name: &name,
            folder_id: folder_id.as_deref(),
            source_name: &source_name,
            seed,
            text: &text,
            result_json: &result_json,
        };
        saved_draws::create(c, new, db::now_ms()).map(|(item, _)| item)
    })
}

#[tauri::command]
pub fn get_saved_draw(db: Db, item_id: String) -> Result<SavedDraw, String> {
    with_conn(&db, |c| saved_draws::get(c, &item_id))
}

#[tauri::command]
pub fn set_saved_draw_notes(db: Db, item_id: String, notes: String) -> Result<(), String> {
    with_conn(&db, |c| saved_draws::set_notes(c, &item_id, &notes, db::now_ms()))
}

/// Every set, deck and pool in the project (what can be drawn from).
#[tauri::command]
pub fn list_collections(db: Db, project_id: String) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| collections::list_all(c, &project_id))
}

// ---- Decks in play ----

/// Starts a deck in play. The app has already shuffled a copy of the cards and
/// made the state (see `src/lib/cards/play.ts`); the database only keeps it.
#[tauri::command]
pub fn create_play_deck(
    db: Db,
    project_id: String,
    name: String,
    folder_id: Option<String>,
    source_id: Option<String>,
    source_name: String,
    state_json: String,
) -> Result<Item, String> {
    with_conn(&db, |c| {
        let new = NewPlayDeck {
            project_id: &project_id,
            name: &name,
            folder_id: folder_id.as_deref(),
            source_id: source_id.as_deref(),
            source_name: &source_name,
            state_json: &state_json,
        };
        play_decks::create(c, new, db::now_ms()).map(|(item, _)| item)
    })
}

#[tauri::command]
pub fn get_play_deck(db: Db, item_id: String) -> Result<PlayDeck, String> {
    with_conn(&db, |c| play_decks::get(c, &item_id))
}

#[tauri::command]
pub fn set_play_deck_state(db: Db, item_id: String, state_json: String) -> Result<(), String> {
    with_conn(&db, |c| play_decks::set_state(c, &item_id, &state_json, db::now_ms()))
}

/// Every deck in play in the project, with how many cards are left.
#[tauri::command]
pub fn list_play_decks(db: Db, project_id: String) -> Result<Vec<PlayDeckEntry>, String> {
    with_conn(&db, |c| play_decks::list(c, &project_id))
}

// ---- Starter decks ----

/// Adds a starter deck (sent as JSON text, pictures as base64) to a project in
/// one all-or-nothing step. `async` so a big deck is written off the main thread.
#[tauri::command]
pub async fn install_card_bundle(
    db: Db<'_>,
    project_id: String,
    bundle_json: String,
) -> Result<InstallResult, String> {
    let bundle: starters::Bundle = serde_json::from_str(&bundle_json)
        .map_err(|_| "The starter deck's data couldn't be read.".to_string())?;
    with_conn(&db, |c| starters::install(c, &project_id, &bundle, db::now_ms()))
}

/// Adds a starter set of tables (and name setups using them) to a project in one
/// all-or-nothing step, sent as JSON text.
#[tauri::command]
pub async fn install_table_bundle(
    db: Db<'_>,
    project_id: String,
    bundle_json: String,
) -> Result<TableInstallResult, String> {
    let bundle: table_starters::TableBundle = serde_json::from_str(&bundle_json)
        .map_err(|_| "The starter's data couldn't be read.".to_string())?;
    with_conn(&db, |c| table_starters::install(c, &project_id, &bundle, db::now_ms()))
}

/// Which starter decks this project already has (their ids, like `starter:tarokka`).
#[tauri::command]
pub fn list_installed_starters(db: Db, project_id: String) -> Result<Vec<String>, String> {
    with_conn(&db, |c| starters::installed(c, &project_id))
}

// ---- Spreads ----

#[tauri::command]
pub fn get_spread(db: Db, item_id: String) -> Result<Spread, String> {
    with_conn(&db, |c| spreads::get(c, &item_id))
}

/// Replaces a spread's positions (3 to 10, each with one source to draw from).
#[tauri::command]
pub fn set_spread_positions(db: Db, item_id: String, positions: Vec<PositionInput>) -> Result<(), String> {
    with_conn(&db, |c| spreads::set_positions(c, &item_id, &positions, db::now_ms()))
}

#[tauri::command]
pub fn set_spread_notes(db: Db, item_id: String, notes: String) -> Result<(), String> {
    with_conn(&db, |c| spreads::set_notes(c, &item_id, &notes, db::now_ms()))
}

#[tauri::command]
pub fn set_spread_reversals(db: Db, item_id: String, reversals: bool, percent: i64) -> Result<(), String> {
    with_conn(&db, |c| spreads::set_reversals(c, &item_id, reversals, percent, db::now_ms()))
}

/// Every spread in the project, and whether it is ready to draw.
#[tauri::command]
pub fn list_spreads(db: Db, project_id: String) -> Result<Vec<SpreadEntry>, String> {
    with_conn(&db, |c| spreads::list(c, &project_id))
}

// ---- Random tables ----

#[tauri::command]
pub fn get_table(db: Db, item_id: String) -> Result<TableDetail, String> {
    with_conn(&db, |c| tables::get(c, &item_id))
}

#[tauri::command]
pub fn set_table_notes(db: Db, item_id: String, notes: String) -> Result<(), String> {
    with_conn(&db, |c| tables::set_notes(c, &item_id, &notes, db::now_ms()))
}

/// Sets the optional die size and how many recent entries to skip.
#[tauri::command]
pub fn set_table_options(db: Db, item_id: String, die_size: Option<i64>, avoid_recent: i64) -> Result<(), String> {
    with_conn(&db, |c| tables::set_options(c, &item_id, die_size, avoid_recent, db::now_ms()))
}

/// Adds entries at the end of a table (all or nothing).
#[tauri::command]
pub fn add_table_entries(db: Db, table_id: String, entries: Vec<EntryInput>) -> Result<Vec<Entry>, String> {
    with_conn(&db, |c| tables::add_entries(c, &table_id, &entries, db::now_ms()))
}

#[tauri::command]
pub fn update_table_entry(db: Db, entry_id: String, text: String, weight: i64) -> Result<(), String> {
    with_conn(&db, |c| tables::update_entry(c, &entry_id, &text, weight, db::now_ms()))
}

/// Rewrites the text of several entries together (all or nothing).
#[tauri::command]
pub fn set_table_entry_texts(db: Db, updates: Vec<EntryTextUpdate>) -> Result<(), String> {
    with_conn(&db, |c| tables::set_entry_texts(c, &updates, db::now_ms()))
}

#[tauri::command]
pub fn delete_table_entry(db: Db, entry_id: String) -> Result<(), String> {
    with_conn(&db, |c| tables::delete_entry(c, &entry_id, db::now_ms()))
}

#[tauri::command]
pub fn restore_table_entry(db: Db, entry_id: String) -> Result<(), String> {
    with_conn(&db, |c| tables::restore_entry(c, &entry_id, db::now_ms()))
}

#[tauri::command]
pub fn move_table_entry(db: Db, entry_id: String, to_index: usize) -> Result<(), String> {
    with_conn(&db, |c| tables::move_entry(c, &entry_id, to_index, db::now_ms()))
}

#[tauri::command]
pub fn add_table_entry_tag(db: Db, entry_id: String, tag_id: String) -> Result<(), String> {
    with_conn(&db, |c| tables::add_entry_tag(c, &entry_id, &tag_id, db::now_ms()))
}

#[tauri::command]
pub fn remove_table_entry_tag(db: Db, entry_id: String, tag_id: String) -> Result<(), String> {
    with_conn(&db, |c| tables::remove_entry_tag(c, &entry_id, &tag_id, db::now_ms()))
}

/// Every table in the project, with its entry count and whether its name is shared.
#[tauri::command]
pub fn list_tables(db: Db, project_id: String) -> Result<Vec<TableSummary>, String> {
    with_conn(&db, |c| tables::list(c, &project_id))
}

/// Every table with its entries and recent picks, ready to roll without more lookups.
#[tauri::command]
pub fn load_rollable_tables(db: Db, project_id: String) -> Result<Vec<RollableTable>, String> {
    with_conn(&db, |c| tables::load_rollable(c, &project_id))
}

/// Entries whose text contains a name (candidates for rewriting slots after a rename).
#[tauri::command]
pub fn find_entries_mentioning(db: Db, project_id: String, needle: String) -> Result<Vec<EntryRef>, String> {
    with_conn(&db, |c| tables::entries_mentioning(c, &project_id, &needle))
}

/// Remembers the entries a roll picked, for "avoid recent".
#[tauri::command]
pub fn record_table_recent(db: Db, picks: Vec<Pick>) -> Result<(), String> {
    with_conn(&db, |c| tables::record_recent(c, &picks, db::now_ms()))
}

#[tauri::command]
pub fn clear_table_recent(db: Db, table_id: String) -> Result<(), String> {
    with_conn(&db, |c| tables::clear_recent(c, &table_id))
}

// ---- Name generator presets ----

/// Saves a name setup as a new item in the Tables library. (The app has checked
/// the setup's shape; the database only keeps it.)
#[tauri::command]
pub fn create_name_preset(
    db: Db,
    project_id: String,
    name: String,
    folder_id: Option<String>,
    setup_json: String,
) -> Result<Item, String> {
    with_conn(&db, |c| {
        name_presets::create(c, &project_id, &name, folder_id.as_deref(), &setup_json, db::now_ms())
    })
}

#[tauri::command]
pub fn get_name_preset(db: Db, item_id: String) -> Result<NamePreset, String> {
    with_conn(&db, |c| name_presets::get(c, &item_id))
}

#[tauri::command]
pub fn set_name_preset_setup(db: Db, item_id: String, setup_json: String) -> Result<(), String> {
    with_conn(&db, |c| name_presets::set_setup(c, &item_id, &setup_json, db::now_ms()))
}

/// Every name preset in the project, for the Names tab's list.
#[tauri::command]
pub fn list_name_presets(db: Db, project_id: String) -> Result<Vec<PresetEntry>, String> {
    with_conn(&db, |c| name_presets::list(c, &project_id))
}

// ---- Queries and smart collections ----

/// Runs a query (JSON text, read and checked by the engine) against a project. `only_type` keeps
/// one kind of item. Used for the builder's live preview of a query that isn't saved yet.
#[tauri::command]
pub fn run_query(db: Db, project_id: String, query_json: String, only_type: Option<String>) -> Result<QueryResult, String> {
    with_conn(&db, |c| query::run_json(c, &project_id, &query_json, db::now_ms(), only_type.as_deref()))
}

/// A smart collection's saved query (the empty query if none is saved yet).
#[tauri::command]
pub fn get_smart_collection(db: Db, item_id: String) -> Result<SmartCollection, String> {
    with_conn(&db, |c| smart_collections::get(c, &item_id))
}

#[tauri::command]
pub fn set_smart_collection_query(db: Db, item_id: String, query_json: String) -> Result<(), String> {
    with_conn(&db, |c| smart_collections::set_query(c, &item_id, &query_json, db::now_ms()))
}

/// What a smart collection finds right now.
#[tauri::command]
pub fn run_smart_collection(db: Db, item_id: String, only_type: Option<String>) -> Result<QueryResult, String> {
    with_conn(&db, |c| smart_collections::run(c, &item_id, db::now_ms(), only_type.as_deref()))
}

// ---- Generators ----

/// A generator's saved definition (JSON text; an empty one if none is saved yet).
#[tauri::command]
pub fn get_generator(db: Db, item_id: String) -> Result<Generator, String> {
    with_conn(&db, |c| generators::get(c, &item_id))
}

#[tauri::command]
pub fn set_generator_definition(db: Db, item_id: String, definition_json: String) -> Result<(), String> {
    with_conn(&db, |c| generators::set_definition(c, &item_id, &definition_json, db::now_ms()))
}

// ---- Content packs ----
// These are `async` so a big pack is read or written off the main thread and
// the window doesn't freeze meanwhile. Files cross to and from JavaScript as
// base64 text, never raw bytes (Android can't deliver raw request bodies; see
// `pack::encode_for_transport`).

/// The pack file for one project, as base64 text (JavaScript saves it where the user chooses).
#[tauri::command]
pub async fn export_project_pack(db: Db<'_>, project_id: String) -> Result<String, String> {
    let bytes = with_conn_pack(&db, |c| {
        pack::export::export_project(c, &project_id, db::now_ms())
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

/// Imports a pack (sent as base64 text) as a new project.
#[tauri::command]
pub async fn import_pack(db: Db<'_>, data: String) -> Result<ImportResult, String> {
    with_conn_pack(&db, |c| {
        let bytes = pack::decode_from_transport(&data)?;
        pack::import::import_pack(c, &bytes, db::now_ms())
    })
}

// ---- Library: folders ----

#[tauri::command]
pub fn list_folders(db: Db, project_id: String, library: String) -> Result<Vec<Folder>, String> {
    with_conn(&db, |c| folders::list(c, &project_id, &library))
}

#[tauri::command]
pub fn create_folder(
    db: Db,
    project_id: String,
    library: String,
    parent_id: Option<String>,
    name: String,
) -> Result<Folder, String> {
    with_conn(&db, |c| {
        folders::create(c, &project_id, &library, parent_id.as_deref(), &name, db::now_ms())
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
    project_id: String,
    library: String,
    folder_id: Option<String>,
) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| items::list(c, &project_id, &library, folder_id.as_deref()))
}

#[tauri::command]
pub fn create_item(
    db: Db,
    project_id: String,
    library: String,
    item_type: String,
    name: String,
    folder_id: Option<String>,
) -> Result<Item, String> {
    with_conn(&db, |c| {
        items::create(c, &project_id, &library, &item_type, &name, folder_id.as_deref(), db::now_ms())
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

/// Saves a document's text. `mentions` is the ids of the items its text mentions; when given, the
/// document's mention links are made to match them in the same transaction.
#[tauri::command]
pub fn set_document_body(
    db: Db,
    item_id: String,
    body: String,
    mentions: Option<Vec<String>>,
) -> Result<(), String> {
    with_conn(&db, |c| documents::set_body_with_links(c, &item_id, &body, mentions.as_deref(), db::now_ms()))
}

/// Items this item links to by hand (not by mentioning them in its text).
#[tauri::command]
pub fn list_manual_link_ids(db: Db, item_id: String) -> Result<Vec<String>, String> {
    with_conn(&db, |c| links::manual_target_ids(c, &item_id))
}

/// Several items at once, in the trash or not (an id that no longer exists is left out).
#[tauri::command]
pub fn get_items(db: Db, ids: Vec<String>) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| {
        Ok(ids.iter().filter_map(|id| items::get(c, id).ok()).collect())
    })
}

// ---- Tabs ----

/// The tabs of a page, in order.
#[tauri::command]
pub fn list_tabs(db: Db, parent_id: String) -> Result<Vec<Tab>, String> {
    with_conn(&db, |c| tabs::list_tabs(c, &parent_id))
}

/// The page an item is a document tab of, if it is one.
#[tauri::command]
pub fn get_tab_family(db: Db, item_id: String) -> Result<Option<Family>, String> {
    with_conn(&db, |c| tabs::family_of(c, &item_id))
}

#[tauri::command]
pub fn add_document_tab(db: Db, parent_id: String, name: String) -> Result<Tab, String> {
    with_conn(&db, |c| tabs::add_document_tab(c, &parent_id, &name, db::now_ms()))
}

#[tauri::command]
pub fn add_embed_tab(db: Db, parent_id: String, title: String, target_id: Option<String>) -> Result<Tab, String> {
    with_conn(&db, |c| tabs::add_embed_tab(c, &parent_id, &title, target_id.as_deref(), db::now_ms()))
}

#[tauri::command]
pub fn update_embed_tab(db: Db, tab_id: String, title: String, target_id: Option<String>) -> Result<Tab, String> {
    with_conn(&db, |c| tabs::update_embed_tab(c, &tab_id, &title, target_id.as_deref(), db::now_ms()))
}

#[tauri::command]
pub fn remove_tab(db: Db, tab_id: String) -> Result<(), String> {
    with_conn(&db, |c| tabs::remove_tab(c, &tab_id, db::now_ms()))
}

#[tauri::command]
pub fn move_tab(db: Db, tab_id: String, delta: i64) -> Result<(), String> {
    with_conn(&db, |c| tabs::move_tab(c, &tab_id, delta, db::now_ms()))
}

// ---- Templates ----

/// Adds the starter templates (with the fields and field sets they use) to a project in one
/// all-or-nothing step, sent as JSON text.
#[tauri::command]
pub async fn install_template_bundle(db: Db<'_>, project_id: String, bundle_json: String) -> Result<TemplateInstallResult, String> {
    let bundle: template_starters::TemplateBundle = serde_json::from_str(&bundle_json)
        .map_err(|_| "The starter's data couldn't be read.".to_string())?;
    with_conn(&db, |c| template_starters::install(c, &project_id, &bundle, db::now_ms()))
}

/// Every live item of one type in a library, from every folder.
#[tauri::command]
pub fn list_items_of_type(db: Db, project_id: String, library: String, item_type: String) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| items::list_of_type(c, &project_id, &library, &item_type))
}

/// Makes a new document from a template (its text, tags, field sets and default values).
#[tauri::command]
pub fn create_from_template(db: Db, template_id: String, name: String, folder_id: Option<String>) -> Result<Item, String> {
    with_conn(&db, |c| templates::create_from(c, &template_id, &name, folder_id.as_deref(), db::now_ms()))
}

// ---- Fields ----

#[tauri::command]
pub fn list_field_definitions(db: Db, project_id: String) -> Result<Vec<FieldDefinition>, String> {
    with_conn(&db, |c| fields::list_definitions(c, &project_id))
}

#[tauri::command]
pub fn list_deleted_field_definitions(db: Db, project_id: String) -> Result<Vec<FieldDefinition>, String> {
    with_conn(&db, |c| fields::list_deleted_definitions(c, &project_id))
}

#[tauri::command]
pub fn create_field_definition(
    db: Db,
    project_id: String,
    name: String,
    kind: String,
    description: String,
    config_json: String,
) -> Result<FieldDefinition, String> {
    with_conn(&db, |c| fields::create_definition(c, &project_id, &name, &kind, &description, &config_json, db::now_ms()))
}

#[tauri::command]
pub fn update_field_definition(
    db: Db,
    id: String,
    name: String,
    description: String,
    config_json: String,
) -> Result<FieldDefinition, String> {
    with_conn(&db, |c| fields::update_definition(c, &id, &name, &description, &config_json, db::now_ms()))
}

#[tauri::command]
pub fn delete_field_definition(db: Db, id: String) -> Result<(), String> {
    with_conn(&db, |c| fields::delete_definition(c, &id, db::now_ms()))
}

#[tauri::command]
pub fn restore_field_definition(db: Db, id: String) -> Result<FieldDefinition, String> {
    with_conn(&db, |c| fields::restore_definition(c, &id, db::now_ms()))
}

#[tauri::command]
pub fn list_field_sets(db: Db, project_id: String) -> Result<Vec<FieldSet>, String> {
    with_conn(&db, |c| fields::list_sets(c, &project_id))
}

#[tauri::command]
pub fn list_deleted_field_sets(db: Db, project_id: String) -> Result<Vec<FieldSet>, String> {
    with_conn(&db, |c| fields::list_deleted_sets(c, &project_id))
}

#[tauri::command]
pub fn create_field_set(db: Db, project_id: String, name: String, description: String) -> Result<FieldSet, String> {
    with_conn(&db, |c| fields::create_set(c, &project_id, &name, &description, db::now_ms()))
}

#[tauri::command]
pub fn update_field_set(db: Db, id: String, name: String, description: String) -> Result<FieldSet, String> {
    with_conn(&db, |c| fields::update_set(c, &id, &name, &description, db::now_ms()))
}

#[tauri::command]
pub fn set_field_set_fields(db: Db, set_id: String, field_ids: Vec<String>) -> Result<FieldSet, String> {
    with_conn(&db, |c| fields::set_set_fields(c, &set_id, &field_ids, db::now_ms()))
}

#[tauri::command]
pub fn delete_field_set(db: Db, id: String) -> Result<(), String> {
    with_conn(&db, |c| fields::delete_set(c, &id, db::now_ms()))
}

#[tauri::command]
pub fn restore_field_set(db: Db, id: String) -> Result<FieldSet, String> {
    with_conn(&db, |c| fields::restore_set(c, &id, db::now_ms()))
}

#[tauri::command]
pub fn apply_field_set(db: Db, item_id: String, set_id: String) -> Result<(), String> {
    with_conn(&db, |c| fields::apply_set(c, &item_id, &set_id, db::now_ms()))
}

#[tauri::command]
pub fn unapply_field_set(db: Db, item_id: String, set_id: String) -> Result<(), String> {
    with_conn(&db, |c| fields::unapply_set(c, &item_id, &set_id, db::now_ms()))
}

/// The field sets applied to an item and the values it holds.
#[tauri::command]
pub fn get_item_fields(db: Db, item_id: String) -> Result<ItemFields, String> {
    with_conn(&db, |c| fields::get_item_fields(c, &item_id))
}

#[tauri::command]
pub fn set_field_value(
    db: Db,
    item_id: String,
    field_id: String,
    value_json: String,
    index: ValueIndex,
    secret: bool,
) -> Result<(), String> {
    with_conn(&db, |c| fields::set_value(c, &item_id, &field_id, &value_json, &index, secret, db::now_ms()))
}

#[tauri::command]
pub fn clear_field_value(db: Db, item_id: String, field_id: String) -> Result<(), String> {
    with_conn(&db, |c| fields::clear_value(c, &item_id, &field_id, db::now_ms()))
}

#[tauri::command]
pub fn set_field_secret(db: Db, item_id: String, field_id: String, secret: bool) -> Result<(), String> {
    with_conn(&db, |c| fields::set_secret(c, &item_id, &field_id, secret, db::now_ms()))
}

/// Every live value of one field (for re-working how they sort and search).
#[tauri::command]
pub fn list_field_values(db: Db, field_id: String) -> Result<Vec<FieldValue>, String> {
    with_conn(&db, |c| fields::list_values_for_field(c, &field_id))
}

#[tauri::command]
pub fn update_field_indexes(db: Db, field_id: String, updates: Vec<IndexUpdate>) -> Result<(), String> {
    with_conn(&db, |c| fields::update_indexes(c, &field_id, &updates, db::now_ms()))
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
pub fn list_trash(db: Db, project_id: String, library: String) -> Result<Trash, String> {
    with_conn(&db, |c| trash::list(c, &project_id, &library))
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
pub fn empty_trash(db: Db, project_id: String, library: String) -> Result<usize, String> {
    with_conn(&db, |c| trash::empty(c, &project_id, &library, None))
}

// ---- Library: tags and search ----

#[tauri::command]
pub fn list_tags(db: Db, project_id: String) -> Result<Vec<Tag>, String> {
    with_conn(&db, |c| tags::list(c, &project_id))
}

#[tauri::command]
pub fn create_tag(
    db: Db,
    project_id: String,
    parent_id: Option<String>,
    name: String,
    color: Option<String>,
) -> Result<Tag, String> {
    with_conn(&db, |c| {
        tags::create(c, &project_id, parent_id.as_deref(), &name, color.as_deref(), db::now_ms())
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
pub fn list_tag_links(db: Db, project_id: String, library: String) -> Result<Vec<TagLink>, String> {
    with_conn(&db, |c| tags::links_in_library(c, &project_id, &library))
}

#[tauri::command]
pub fn search_items(
    db: Db,
    project_id: String,
    text: String,
    library: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<Item>, String> {
    with_conn(&db, |c| {
        search::search(c, &project_id, &text, library.as_deref(), limit.unwrap_or(50))
    })
}
