//! Library items whose whole data is one JSON document kept in a detail row: calendars and timelines.
//! The shape and every rule are the app's TypeScript (`src/lib/calendar/`, `src/lib/timelines/`); this only
//! keeps the text safely: it must be a JSON object of reasonable size. An item with no row yet is a new one,
//! which the app fills in the first time it is opened.

use super::error::DbError;
use super::items;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// A safety limit (in bytes) on one document, so nothing can bloat the database.
pub const MAX_BYTES: usize = 200_000;

/// Which table and item type a kind of item uses. Only the constants below exist, so the names put into SQL
/// never come from outside.
pub struct Kind {
    pub table: &'static str,
    pub column: &'static str,
    pub library: &'static str,
    pub item_type: &'static str,
    pub too_large: &'static str,
    pub unreadable: &'static str,
    pub wrong_type: &'static str,
}

pub const CALENDAR: Kind = Kind {
    table: "calendars",
    column: "calendar_json",
    library: "calendar",
    item_type: "calendar",
    too_large: "That calendar is too large to save.",
    unreadable: "The calendar couldn't be read.",
    wrong_type: "This item isn't a calendar.",
};

pub const TIMELINE: Kind = Kind {
    table: "timelines",
    column: "config_json",
    library: "calendar",
    item_type: "timeline",
    too_large: "That timeline is too large to save.",
    unreadable: "The timeline's settings couldn't be read.",
    wrong_type: "This item isn't a timeline.",
};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRecord {
    pub item_id: String,
    pub json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonEntry {
    pub item_id: String,
    pub name: String,
    pub updated_at: i64,
}

/// Checks stored text (also used when importing packs).
pub fn validate(kind: &Kind, json: &str) -> Result<(), DbError> {
    if json.len() > MAX_BYTES {
        return Err(DbError::Invalid(kind.too_large));
    }
    match serde_json::from_str::<serde_json::Value>(json) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err(DbError::Invalid(kind.unreadable)),
    }
}

fn require_live(conn: &Connection, kind: &Kind, item_id: &str) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != kind.item_type {
        return Err(DbError::Invalid(kind.wrong_type));
    }
    Ok(())
}

/// The saved document, or `None` for an item that has none yet.
pub fn get(conn: &Connection, kind: &Kind, item_id: &str) -> Result<Option<JsonRecord>, DbError> {
    require_live(conn, kind, item_id)?;
    Ok(conn
        .query_row(
            &format!("SELECT item_id, {}, created_at, updated_at FROM {} WHERE item_id = ?1", kind.column, kind.table),
            [item_id],
            |r| Ok(JsonRecord { item_id: r.get(0)?, json: r.get(1)?, created_at: r.get(2)?, updated_at: r.get(3)? }),
        )
        .optional()?)
}

/// Saves the document (creating it the first time). Also marks the item as updated.
pub fn set(conn: &Connection, kind: &Kind, item_id: &str, json: &str, now: i64) -> Result<(), DbError> {
    require_live(conn, kind, item_id)?;
    validate(kind, json)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        &format!(
            "INSERT INTO {t} (item_id, {c}, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT (item_id) DO UPDATE SET {c} = excluded.{c}, updated_at = excluded.updated_at",
            t = kind.table,
            c = kind.column
        ),
        params![item_id, json, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Every live item of this kind in a project (any folder), by name.
pub fn list(conn: &Connection, kind: &Kind, project_id: &str) -> Result<Vec<JsonEntry>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, updated_at FROM items
         WHERE project_id = ?1 AND library = ?2 AND item_type = ?3 AND deleted_at IS NULL
         ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![project_id, kind.library, kind.item_type], |r| {
        Ok(JsonEntry { item_id: r.get(0)?, name: r.get(1)?, updated_at: r.get(2)? })
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

    fn make(conn: &Connection, project: &str, kind: &Kind, name: &str) -> String {
        items::create(conn, project, kind.library, kind.item_type, name, None, 5).unwrap().id
    }

    #[test]
    fn a_new_item_has_nothing_until_saved() {
        let (conn, p) = setup();
        let id = make(&conn, &p, &CALENDAR, "Harptos");
        assert_eq!(get(&conn, &CALENDAR, &id).unwrap(), None);
        set(&conn, &CALENDAR, &id, r#"{"version":1}"#, 50).unwrap();
        let got = get(&conn, &CALENDAR, &id).unwrap().unwrap();
        assert_eq!((got.json.as_str(), got.updated_at), (r#"{"version":1}"#, 50));
        assert_eq!(items::get(&conn, &id).unwrap().updated_at, 50);
        set(&conn, &CALENDAR, &id, r#"{"version":2}"#, 60).unwrap();
        assert_eq!(get(&conn, &CALENDAR, &id).unwrap().unwrap().json, r#"{"version":2}"#);
    }

    #[test]
    fn refuses_what_it_cannot_keep_and_keeps_the_old_text() {
        let (conn, p) = setup();
        let id = make(&conn, &p, &TIMELINE, "History");
        set(&conn, &TIMELINE, &id, "{}", 10).unwrap();
        for bad in ["nope", "[1]", "5", "null"] {
            assert!(set(&conn, &TIMELINE, &id, bad, 20).is_err(), "{bad}");
        }
        let huge = format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_BYTES));
        assert!(set(&conn, &TIMELINE, &id, &huge, 20).is_err());
        assert_eq!(get(&conn, &TIMELINE, &id).unwrap().unwrap().json, "{}");
    }

    #[test]
    fn only_works_on_the_right_kind_of_live_item() {
        let (conn, p) = setup();
        let cal = make(&conn, &p, &CALENDAR, "Cal");
        let other = items::create(&conn, &p, "worldbuilding", "document", "Doc", None, 5).unwrap().id;
        assert!(get(&conn, &CALENDAR, &other).is_err());
        assert!(set(&conn, &TIMELINE, &cal, "{}", 10).is_err());
        items::soft_delete(&conn, &cal, 20).unwrap();
        assert!(get(&conn, &CALENDAR, &cal).is_err());
    }

    #[test]
    fn lists_live_items_of_the_kind_by_name_and_follows_the_trash() {
        let (conn, p) = setup();
        let b = make(&conn, &p, &CALENDAR, "Beta");
        make(&conn, &p, &CALENDAR, "alpha");
        make(&conn, &p, &TIMELINE, "Not a calendar");
        let names: Vec<_> = list(&conn, &CALENDAR, &p).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["alpha", "Beta"]);
        items::soft_delete(&conn, &b, 30).unwrap();
        assert_eq!(list(&conn, &CALENDAR, &p).unwrap().len(), 1);
        trash::restore_item(&conn, &b, 40).unwrap();
        assert_eq!(list(&conn, &CALENDAR, &p).unwrap().len(), 2);
    }

    #[test]
    fn purging_the_item_removes_the_row() {
        let (conn, p) = setup();
        let id = make(&conn, &p, &CALENDAR, "Gone");
        set(&conn, &CALENDAR, &id, "{}", 10).unwrap();
        items::soft_delete(&conn, &id, 20).unwrap();
        trash::purge_item(&conn, &id).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM calendars", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
