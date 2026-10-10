//! Generators: library items (library `tables`, type `generator`) that remember a set of rolls which
//! fill in a new document (its name, fields and text). The definition is JSON text whose shape and
//! meaning belong to the app's TypeScript (`src/lib/generators/`); the database checks that it is a
//! JSON object of reasonable size, like a saved name setup. A generator with no saved definition yet
//! (made from the library's "New item" form) reads as an empty one.

use super::error::DbError;
use super::items;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub const GENERATOR_TYPE: &str = "generator";
pub const LIBRARY: &str = "tables";

/// Largest definition kept, in bytes.
pub const MAX_DEFINITION_BYTES: usize = 100_000;
pub const MAX_ROWS: usize = 20;

/// What a new generator starts with: no template, no rows.
pub const EMPTY_DEFINITION: &str = r#"{"version":1,"templateId":null,"rows":[]}"#;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Generator {
    pub item_id: String,
    pub definition_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Checks a stored definition (also used when importing packs).
pub fn validate(definition_json: &str) -> Result<(), DbError> {
    if definition_json.len() > MAX_DEFINITION_BYTES {
        return Err(DbError::Invalid("That generator is too large to save."));
    }
    match serde_json::from_str::<serde_json::Value>(definition_json) {
        Ok(value) if value.is_object() => {
            let rows_ok = value.get("rows").is_none_or(|r| r.as_array().is_some_and(|a| a.len() <= MAX_ROWS));
            if rows_ok {
                Ok(())
            } else {
                Err(DbError::Invalid("A generator can have at most 20 rows."))
            }
        }
        _ => Err(DbError::Invalid("That generator can't be read.")),
    }
}

fn require_live(conn: &Connection, item_id: &str) -> Result<items::Item, DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != GENERATOR_TYPE {
        return Err(DbError::Invalid("This item isn't a generator."));
    }
    Ok(item)
}

pub fn get(conn: &Connection, item_id: &str) -> Result<Generator, DbError> {
    let item = require_live(conn, item_id)?;
    let row = conn
        .query_row(
            "SELECT definition_json, created_at, updated_at FROM generators WHERE item_id = ?1",
            [item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
        )
        .optional()?;
    Ok(match row {
        Some((definition_json, created_at, updated_at)) => Generator { item_id: item.id, definition_json, created_at, updated_at },
        None => Generator { item_id: item.id, definition_json: EMPTY_DEFINITION.to_string(), created_at: item.created_at, updated_at: item.updated_at },
    })
}

/// Saves the definition (creating the row the first time). Also marks the item as updated.
pub fn set_definition(conn: &Connection, item_id: &str, definition_json: &str, now: i64) -> Result<(), DbError> {
    validate(definition_json)?;
    require_live(conn, item_id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO generators (item_id, definition_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (item_id) DO UPDATE SET definition_json = excluded.definition_json, updated_at = excluded.updated_at",
        params![item_id, definition_json, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{campaigns, open_in_memory, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn make(conn: &Connection, camp: &str, name: &str) -> String {
        items::create(conn, camp, LIBRARY, GENERATOR_TYPE, name, None, 5).unwrap().id
    }

    #[test]
    fn a_new_generator_reads_as_empty_and_saves_its_definition() {
        let (conn, camp) = setup();
        let id = make(&conn, &camp, "NPC");
        assert_eq!(get(&conn, &id).unwrap().definition_json, EMPTY_DEFINITION);
        let def = r#"{"version":1,"templateId":null,"rows":[{"id":"r1","label":"Name","target":{"kind":"name"},"source":"[Names]","fallback":""}]}"#;
        set_definition(&conn, &id, def, 50).unwrap();
        let got = get(&conn, &id).unwrap();
        assert_eq!((got.definition_json.as_str(), got.updated_at), (def, 50));
        assert_eq!(items::get(&conn, &id).unwrap().updated_at, 50);
        set_definition(&conn, &id, EMPTY_DEFINITION, 60).unwrap();
        assert_eq!(get(&conn, &id).unwrap().definition_json, EMPTY_DEFINITION);
    }

    #[test]
    fn refuses_what_it_cannot_keep_and_keeps_the_old_one() {
        let (conn, camp) = setup();
        let id = make(&conn, &camp, "NPC");
        set_definition(&conn, &id, EMPTY_DEFINITION, 10).unwrap();
        for bad in ["nope", "[1]", "5", r#"{"rows":"x"}"#] {
            assert!(set_definition(&conn, &id, bad, 20).is_err(), "{bad}");
        }
        let many = format!(r#"{{"rows":[{}]}}"#, vec!["{}"; MAX_ROWS + 1].join(","));
        assert!(set_definition(&conn, &id, &many, 20).is_err());
        assert!(set_definition(&conn, &id, &format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_DEFINITION_BYTES)), 20).is_err());
        assert_eq!(get(&conn, &id).unwrap().definition_json, EMPTY_DEFINITION);
    }

    #[test]
    fn only_works_on_live_generators() {
        let (conn, camp) = setup();
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 5).unwrap();
        assert!(get(&conn, &doc.id).is_err());
        let id = make(&conn, &camp, "G");
        items::soft_delete(&conn, &id, 20).unwrap();
        assert!(matches!(get(&conn, &id), Err(DbError::NotFound)));
        trash::restore_item(&conn, &id, 30).unwrap();
        assert!(get(&conn, &id).is_ok());
    }

    #[test]
    fn purging_the_item_removes_the_definition() {
        let (conn, camp) = setup();
        let id = make(&conn, &camp, "G");
        set_definition(&conn, &id, EMPTY_DEFINITION, 10).unwrap();
        items::soft_delete(&conn, &id, 20).unwrap();
        trash::purge_item(&conn, &id).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM generators", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }
}
