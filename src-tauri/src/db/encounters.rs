//! Encounters: library items (library `encounters`, type `encounter`) that keep a combat (or chase, or heist)
//! in progress: who is in it, whose turn it is, health, statuses, a log and undo history. Every rule is in the
//! app's TypeScript (`src/lib/encounters/`); this keeps the state safely, as JSON. An encounter with no saved
//! state yet (made from the library's "New item" form) is a new one, which the app fills in the first time it
//! is opened.

use super::error::DbError;
use super::items;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub const ENCOUNTER_TYPE: &str = "encounter";
pub const LIBRARY: &str = "encounters";

/// A safety limit (in bytes) on one encounter's state, so nothing can bloat the database.
pub const MAX_STATE_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Encounter {
    pub item_id: String,
    pub state_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One row of the encounter list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncounterEntry {
    pub item_id: String,
    pub name: String,
    /// `setup`, `running` or `finished` (`setup` for an encounter with no state yet).
    pub phase: String,
    pub round: i64,
    pub combatants: i64,
    pub updated_at: i64,
}

/// Checks stored state (also used when importing packs).
pub fn validate(state_json: &str) -> Result<(), DbError> {
    if state_json.len() > MAX_STATE_BYTES {
        return Err(DbError::Invalid("That encounter is too large to save."));
    }
    match serde_json::from_str::<serde_json::Value>(state_json) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err(DbError::Invalid("The encounter's state couldn't be read.")),
    }
}

fn require_live(conn: &Connection, item_id: &str) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != ENCOUNTER_TYPE {
        return Err(DbError::Invalid("This item isn't an encounter."));
    }
    Ok(())
}

/// The saved state, or `None` for an encounter that has none yet.
pub fn get(conn: &Connection, item_id: &str) -> Result<Option<Encounter>, DbError> {
    require_live(conn, item_id)?;
    Ok(conn
        .query_row(
            "SELECT item_id, state_json, created_at, updated_at FROM encounters WHERE item_id = ?1",
            [item_id],
            |r| Ok(Encounter { item_id: r.get(0)?, state_json: r.get(1)?, created_at: r.get(2)?, updated_at: r.get(3)? }),
        )
        .optional()?)
}

/// Saves the encounter's state (creating it the first time). Also marks the item as updated.
pub fn set_state(conn: &Connection, item_id: &str, state_json: &str, now: i64) -> Result<(), DbError> {
    require_live(conn, item_id)?;
    validate(state_json)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO encounters (item_id, state_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (item_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
        params![item_id, state_json, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Every live encounter of a project (any folder), most recently changed first, with where it stands.
pub fn list(conn: &Connection, project_id: &str) -> Result<Vec<EncounterEntry>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, e.state_json, i.updated_at
         FROM items i LEFT JOIN encounters e ON e.item_id = i.id
         WHERE i.project_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
         ORDER BY i.updated_at DESC, i.name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![project_id, LIBRARY, ENCOUNTER_TYPE], |r| {
        let state_json: Option<String> = r.get(2)?;
        let value: serde_json::Value = state_json.as_deref().and_then(|s| serde_json::from_str(s).ok()).unwrap_or(serde_json::Value::Null);
        let phase = match value.get("phase").and_then(|v| v.as_str()) {
            Some(p @ ("running" | "finished")) => p.to_string(),
            _ => "setup".to_string(),
        };
        Ok(EncounterEntry {
            item_id: r.get(0)?,
            name: r.get(1)?,
            phase,
            round: value.get("round").and_then(|v| v.as_i64()).unwrap_or(0),
            combatants: value.get("combatants").and_then(|v| v.as_array()).map_or(0, |a| a.len() as i64),
            updated_at: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, projects, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let p = projects::create(&conn, "Test", 1).unwrap();
        (conn, p.id)
    }

    fn make(conn: &Connection, project: &str, name: &str) -> String {
        items::create(conn, project, LIBRARY, ENCOUNTER_TYPE, name, None, 5).unwrap().id
    }

    #[test]
    fn a_new_encounter_has_no_state_until_one_is_saved() {
        let (conn, p) = setup();
        let id = make(&conn, &p, "Ambush");
        assert_eq!(get(&conn, &id).unwrap(), None);
        let state = r#"{"version":1,"phase":"running","round":3,"combatants":[{},{}]}"#;
        set_state(&conn, &id, state, 50).unwrap();
        let got = get(&conn, &id).unwrap().unwrap();
        assert_eq!((got.state_json.as_str(), got.updated_at), (state, 50));
        assert_eq!(items::get(&conn, &id).unwrap().updated_at, 50);
        set_state(&conn, &id, r#"{"phase":"finished"}"#, 60).unwrap();
        assert_eq!(get(&conn, &id).unwrap().unwrap().state_json, r#"{"phase":"finished"}"#);
    }

    #[test]
    fn refuses_what_it_cannot_keep_and_keeps_the_old_state() {
        let (conn, p) = setup();
        let id = make(&conn, &p, "Ambush");
        set_state(&conn, &id, "{}", 10).unwrap();
        for bad in ["nope", "[1]", "5", "null"] {
            assert!(set_state(&conn, &id, bad, 20).is_err(), "{bad}");
        }
        assert!(set_state(&conn, &id, &format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_STATE_BYTES)), 20).is_err());
        assert_eq!(get(&conn, &id).unwrap().unwrap().state_json, "{}");
    }

    #[test]
    fn only_works_on_live_encounters() {
        let (conn, p) = setup();
        let doc = items::create(&conn, &p, "worldbuilding", "document", "Doc", None, 5).unwrap();
        assert!(get(&conn, &doc.id).is_err());
        assert!(set_state(&conn, &doc.id, "{}", 6).is_err());
        let id = make(&conn, &p, "E");
        items::soft_delete(&conn, &id, 20).unwrap();
        assert!(matches!(get(&conn, &id), Err(DbError::NotFound)));
        trash::restore_item(&conn, &id, 30).unwrap();
        assert!(get(&conn, &id).is_ok());
    }

    #[test]
    fn the_list_says_where_each_encounter_stands() {
        let (conn, p) = setup();
        let a = make(&conn, &p, "Old fight");
        let b = make(&conn, &p, "Ambush");
        make(&conn, &p, "Blank");
        set_state(&conn, &a, r#"{"phase":"finished","round":4,"combatants":[{},{},{}]}"#, 100).unwrap();
        set_state(&conn, &b, r#"{"phase":"running","round":2,"combatants":[{}]}"#, 200).unwrap();
        let list = list(&conn, &p).unwrap();
        let summary: Vec<_> = list.iter().map(|e| (e.name.as_str(), e.phase.as_str(), e.round, e.combatants)).collect();
        assert_eq!(summary, [("Ambush", "running", 2, 1), ("Old fight", "finished", 4, 3), ("Blank", "setup", 0, 0)]);
        // Trashed encounters are not listed, and a broken state reads as a new one.
        items::soft_delete(&conn, &b, 300).unwrap();
        set_state(&conn, &a, "{}", 310).unwrap();
        let names: Vec<_> = super::list(&conn, &p).unwrap().into_iter().map(|e| (e.name, e.phase)).collect();
        assert_eq!(names, [("Old fight".to_string(), "setup".to_string()), ("Blank".to_string(), "setup".to_string())]);
    }

    #[test]
    fn purging_the_item_removes_the_state() {
        let (conn, p) = setup();
        let id = make(&conn, &p, "E");
        set_state(&conn, &id, "{}", 10).unwrap();
        items::soft_delete(&conn, &id, 20).unwrap();
        trash::purge_item(&conn, &id).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM encounters", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }
}
