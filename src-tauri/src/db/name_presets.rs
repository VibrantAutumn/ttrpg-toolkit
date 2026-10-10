//! Saved name generator setups: library items (library `tables`, type
//! `name_preset`) that keep a setup like "three parts from these tables, only
//! entries tagged Elf" under a name like "Elven name".
//!
//! The setup is JSON text whose shape (and what it means) belongs to the app's
//! TypeScript (`src/lib/tables/nameSetup.ts`); the database only checks that it
//! is a JSON object of reasonable size, like a saved roll's result.

use super::error::DbError;
use super::items::{self, Item};
use rusqlite::{params, Connection};
use serde::Serialize;

pub const PRESET_TYPE: &str = "name_preset";
/// The library presets live in (the Tables tool's).
pub const LIBRARY: &str = "tables";

/// Largest setup kept, in bytes.
pub const MAX_SETUP_BYTES: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamePreset {
    pub item_id: String,
    pub setup_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One row of the flat "all my presets" list the Names tab shows.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetEntry {
    pub item_id: String,
    pub name: String,
    pub setup_json: String,
    pub folder_id: Option<String>,
}

/// Checks a stored setup (also used when importing packs).
pub fn validate(setup_json: &str) -> Result<(), DbError> {
    if setup_json.len() > MAX_SETUP_BYTES {
        return Err(DbError::Invalid("That name setup is too large to save."));
    }
    match serde_json::from_str::<serde_json::Value>(setup_json) {
        Ok(value) if value.is_object() => Ok(()),
        _ => Err(DbError::Invalid("That name setup can't be read.")),
    }
}

/// Saves a setup as a new item in the Tables library. All or nothing.
pub fn create(
    conn: &Connection,
    project_id: &str,
    name: &str,
    folder_id: Option<&str>,
    setup_json: &str,
    now: i64,
) -> Result<Item, DbError> {
    validate(setup_json)?;
    let tx = conn.unchecked_transaction()?;
    let item = items::create(&tx, project_id, LIBRARY, PRESET_TYPE, name, folder_id, now)?;
    tx.execute(
        "INSERT INTO name_presets (item_id, setup_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![item.id, setup_json, now],
    )?;
    tx.commit()?;
    Ok(item)
}

/// Checks the item exists, is live, and is a name preset.
fn require_live_preset(conn: &Connection, item_id: &str) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.library != LIBRARY || item.item_type != PRESET_TYPE {
        return Err(DbError::Invalid("This item isn't a name preset."));
    }
    Ok(())
}

pub fn get(conn: &Connection, item_id: &str) -> Result<NamePreset, DbError> {
    require_live_preset(conn, item_id)?;
    conn.query_row(
        "SELECT item_id, setup_json, created_at, updated_at FROM name_presets WHERE item_id = ?1",
        [item_id],
        |r| {
            Ok(NamePreset {
                item_id: r.get(0)?,
                setup_json: r.get(1)?,
                created_at: r.get(2)?,
                updated_at: r.get(3)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

/// Replaces a preset's setup. Also marks the item as updated.
pub fn set_setup(conn: &Connection, item_id: &str, setup_json: &str, now: i64) -> Result<(), DbError> {
    validate(setup_json)?;
    require_live_preset(conn, item_id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE name_presets SET setup_json = ?2, updated_at = ?3 WHERE item_id = ?1",
        params![item_id, setup_json, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Every live preset in a project (any folder), alphabetical.
pub fn list(conn: &Connection, project_id: &str) -> Result<Vec<PresetEntry>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, p.setup_json, i.folder_id
         FROM name_presets p JOIN items i ON i.id = p.item_id
         WHERE i.project_id = ?1 AND i.deleted_at IS NULL
         ORDER BY i.name COLLATE NOCASE, i.created_at, i.id",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        Ok(PresetEntry { item_id: r.get(0)?, name: r.get(1)?, setup_json: r.get(2)?, folder_id: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{projects, folders, open_in_memory, search, trash};

    const SETUP: &str = r#"{"version":1,"mode":"two","sources":{"first":"a","last":"b"}}"#;

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    #[test]
    fn a_preset_is_an_item_in_the_tables_library_with_its_setup() {
        let (conn, camp) = setup();
        let item = create(&conn, &camp, "Elven name", None, SETUP, 50).unwrap();
        assert_eq!((item.library.as_str(), item.item_type.as_str()), ("tables", "name_preset"));
        assert_eq!(item.name, "Elven name");
        let p = get(&conn, &item.id).unwrap();
        assert_eq!((p.setup_json.as_str(), p.created_at, p.updated_at), (SETUP, 50, 50));
    }

    #[test]
    fn can_be_created_in_a_tables_folder_and_names_may_repeat() {
        let (conn, camp) = setup();
        let folder = folders::create(&conn, &camp, "tables", None, "Names", 1).unwrap();
        let item = create(&conn, &camp, "Elven", Some(&folder.id), SETUP, 2).unwrap();
        assert_eq!(item.folder_id.as_deref(), Some(folder.id.as_str()));
        create(&conn, &camp, "Elven", None, SETUP, 3).unwrap(); // only tables need unique names
    }

    #[test]
    fn a_setup_has_to_be_a_json_object_of_reasonable_size() {
        let (conn, camp) = setup();
        let big = format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_SETUP_BYTES));
        for (what, text) in [
            ("empty", ""),
            ("not json", "mode: two"),
            ("an array", "[]"),
            ("null", "null"),
            ("a number", "3"),
            ("a string", r#""text""#),
            ("too big", big.as_str()),
        ] {
            assert!(matches!(create(&conn, &camp, "x", None, text, 1), Err(DbError::Invalid(_))), "{what}");
        }
        create(&conn, &camp, "ok", None, "{}", 1).unwrap();
        // A refused save leaves nothing behind: no item without its setup.
        let items: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 1);
        assert!(matches!(create(&conn, &camp, "  ", None, SETUP, 1), Err(DbError::EmptyName)));
        assert!(create(&conn, "no-such-project", "x", None, SETUP, 1).is_err());
    }

    #[test]
    fn the_setup_can_be_replaced_and_marks_the_item_updated() {
        let (conn, camp) = setup();
        let item = create(&conn, &camp, "Elven", None, SETUP, 10).unwrap();
        let next = r#"{"version":1,"mode":"three"}"#;
        set_setup(&conn, &item.id, next, 99).unwrap();
        let p = get(&conn, &item.id).unwrap();
        assert_eq!((p.setup_json.as_str(), p.updated_at, p.created_at), (next, 99, 10));
        assert_eq!(items::get(&conn, &item.id).unwrap().updated_at, 99);
        assert!(matches!(set_setup(&conn, &item.id, "[]", 100), Err(DbError::Invalid(_))));
        assert_eq!(get(&conn, &item.id).unwrap().setup_json, next);
    }

    #[test]
    fn only_live_presets_can_be_read_or_changed() {
        let (conn, camp) = setup();
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 1).unwrap();
        let formula = items::create(&conn, &camp, "tables", "table", "A table", None, 1).unwrap();
        for id in [&doc.id, &formula.id] {
            assert!(matches!(get(&conn, id), Err(DbError::Invalid(_))));
            assert!(matches!(set_setup(&conn, id, SETUP, 2), Err(DbError::Invalid(_))));
        }
        assert!(matches!(get(&conn, "nope"), Err(DbError::NotFound)));

        let item = create(&conn, &camp, "Gone", None, SETUP, 2).unwrap();
        items::soft_delete(&conn, &item.id, 3).unwrap();
        assert!(matches!(get(&conn, &item.id), Err(DbError::NotFound)));
        assert!(matches!(set_setup(&conn, &item.id, SETUP, 4), Err(DbError::NotFound)));
        trash::restore_item(&conn, &item.id, 5).unwrap();
        assert_eq!(get(&conn, &item.id).unwrap().setup_json, SETUP);
    }

    #[test]
    fn list_gives_every_live_preset_alphabetically_across_folders() {
        let (conn, camp) = setup();
        let folder = folders::create(&conn, &camp, "tables", None, "Names", 1).unwrap();
        create(&conn, &camp, "place name", Some(&folder.id), r#"{"a":1}"#, 2).unwrap();
        create(&conn, &camp, "Elven name", None, r#"{"a":2}"#, 3).unwrap();
        let gone = create(&conn, &camp, "Gone", None, SETUP, 4).unwrap();
        items::soft_delete(&conn, &gone.id, 5).unwrap();
        // Another project's presets and other kinds of items stay out.
        let other = projects::create(&conn, "Other", 6).unwrap();
        create(&conn, &other.id, "Elsewhere", None, SETUP, 7).unwrap();
        items::create(&conn, &camp, "tables", "table", "Not a preset", None, 8).unwrap();

        let rows = list(&conn, &camp).unwrap();
        let summary: Vec<_> = rows.iter().map(|p| (p.name.as_str(), p.setup_json.as_str())).collect();
        assert_eq!(summary, [("Elven name", r#"{"a":2}"#), ("place name", r#"{"a":1}"#)]);
        assert_eq!(rows[1].folder_id.as_deref(), Some(folder.id.as_str()));
    }

    #[test]
    fn purging_the_item_removes_the_setup_and_presets_are_found_by_name() {
        let (conn, camp) = setup();
        let item = create(&conn, &camp, "Elven name", None, SETUP, 2).unwrap();
        assert_eq!(search::search(&conn, &camp, "elven", Some("tables"), 10).unwrap().len(), 1);
        items::soft_delete(&conn, &item.id, 3).unwrap();
        trash::purge_item(&conn, &item.id).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM name_presets", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }
}
