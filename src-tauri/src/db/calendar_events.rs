//! Quick events and dated DM notes: library items (library `calendar`, types `event` and `note`) with a
//! date (a day number and optional minute), an optional end for a range, and optionally a repeat rule.
//! What a rule means (every N days, the first Monday...) is the app's TypeScript (`src/lib/calendar/recurrence.ts`);
//! this keeps it as JSON and answers "what could be on these days" for the month view and timelines, which
//! then expand the repeating ones. A note is an event whose item is usually marked secret (GM only).

use super::error::DbError;
use super::items;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const LIBRARY: &str = "calendar";
pub const EVENT_TYPE: &str = "event";
pub const NOTE_TYPE: &str = "note";

pub const MAX_BODY_BYTES: usize = 20_000;
pub const MAX_RECURRENCE_BYTES: usize = 2_000;
/// Day numbers beyond this are nonsense (a billion days is millions of years).
pub const MAX_DAY: i64 = 1_000_000_000;
pub const MAX_MINUTE: i64 = 100_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub item_id: String,
    pub name: String,
    /// `event` or `note`.
    pub item_type: String,
    /// The item's `default`, `visible` or `secret`.
    pub visibility: String,
    pub start_day: i64,
    pub start_minute: Option<i64>,
    pub end_day: Option<i64>,
    pub end_minute: Option<i64>,
    pub recurrence_json: Option<String>,
    pub until_day: Option<i64>,
    pub body: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub start_day: i64,
    pub start_minute: Option<i64>,
    pub end_day: Option<i64>,
    pub end_minute: Option<i64>,
    pub recurrence_json: Option<String>,
    pub until_day: Option<i64>,
    pub body: String,
}

/// Checks an event's dates and text (also used when importing packs).
pub fn validate(input: &EventInput) -> Result<(), DbError> {
    let day_ok = |d: i64| (-MAX_DAY..=MAX_DAY).contains(&d);
    let minute_ok = |m: i64| (0..=MAX_MINUTE).contains(&m);
    if !day_ok(input.start_day) || input.end_day.is_some_and(|d| !day_ok(d)) || input.until_day.is_some_and(|d| !day_ok(d)) {
        return Err(DbError::Invalid("That date is out of range."));
    }
    if input.start_minute.is_some_and(|m| !minute_ok(m)) || input.end_minute.is_some_and(|m| !minute_ok(m)) {
        return Err(DbError::Invalid("That time is out of range."));
    }
    if input.end_day.is_some_and(|d| d < input.start_day) {
        return Err(DbError::Invalid("An event can't end before it starts."));
    }
    if input.end_day == Some(input.start_day) {
        if let (Some(s), Some(e)) = (input.start_minute, input.end_minute) {
            if e < s {
                return Err(DbError::Invalid("An event can't end before it starts."));
            }
        }
    }
    if input.end_minute.is_some() && input.end_day.is_none() {
        return Err(DbError::Invalid("An end time needs an end date."));
    }
    if input.until_day.is_some_and(|d| d < input.start_day) {
        return Err(DbError::Invalid("A repeating event can't stop before it starts."));
    }
    if input.body.len() > MAX_BODY_BYTES {
        return Err(DbError::Invalid("That text is too long to save."));
    }
    if let Some(rule) = &input.recurrence_json {
        if rule.len() > MAX_RECURRENCE_BYTES {
            return Err(DbError::Invalid("That repeat rule is too large."));
        }
        if !matches!(serde_json::from_str::<serde_json::Value>(rule), Ok(serde_json::Value::Object(_))) {
            return Err(DbError::Invalid("That repeat rule couldn't be read."));
        }
    }
    Ok(())
}

fn require_live(conn: &Connection, item_id: &str) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.library != LIBRARY || (item.item_type != EVENT_TYPE && item.item_type != NOTE_TYPE) {
        return Err(DbError::Invalid("This item isn't an event or a note."));
    }
    Ok(())
}

const SELECT: &str = "SELECT i.id, i.name, i.item_type, i.visibility, e.start_day, e.start_minute, e.end_day, e.end_minute,
        e.recurrence_json, e.until_day, e.body, i.updated_at
     FROM items i JOIN calendar_events e ON e.item_id = i.id";

fn from_row(r: &rusqlite::Row) -> rusqlite::Result<CalendarEvent> {
    Ok(CalendarEvent {
        item_id: r.get(0)?,
        name: r.get(1)?,
        item_type: r.get(2)?,
        visibility: r.get(3)?,
        start_day: r.get(4)?,
        start_minute: r.get(5)?,
        end_day: r.get(6)?,
        end_minute: r.get(7)?,
        recurrence_json: r.get(8)?,
        until_day: r.get(9)?,
        body: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

/// An event's details, or `None` for one made from the generic "New item" form that has none yet.
pub fn get(conn: &Connection, item_id: &str) -> Result<Option<CalendarEvent>, DbError> {
    require_live(conn, item_id)?;
    Ok(conn.query_row(&format!("{SELECT} WHERE i.id = ?1"), [item_id], from_row).optional()?)
}

/// Saves an event's date and text (creating the details the first time). Also marks the item as updated.
pub fn set(conn: &Connection, item_id: &str, input: &EventInput, now: i64) -> Result<(), DbError> {
    require_live(conn, item_id)?;
    validate(input)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO calendar_events
            (item_id, start_day, start_minute, end_day, end_minute, recurrence_json, until_day, body, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ON CONFLICT (item_id) DO UPDATE SET
            start_day = excluded.start_day, start_minute = excluded.start_minute, end_day = excluded.end_day,
            end_minute = excluded.end_minute, recurrence_json = excluded.recurrence_json,
            until_day = excluded.until_day, body = excluded.body, updated_at = excluded.updated_at",
        params![
            item_id,
            input.start_day,
            input.start_minute,
            input.end_day,
            input.end_minute,
            input.recurrence_json,
            input.until_day,
            input.body,
            now
        ],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Every live event and note of a project that could fall on `from_day..=to_day`: one-off ones that overlap the
/// window, and every repeating one that starts by the end of the window and hasn't stopped before its start
/// (the app works out which days they land on). Oldest first.
pub fn list_in_range(conn: &Connection, project_id: &str, from_day: i64, to_day: i64) -> Result<Vec<CalendarEvent>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT}
         WHERE i.project_id = ?1 AND i.library = ?2 AND i.deleted_at IS NULL
           AND e.start_day <= ?4
           AND ((e.recurrence_json IS NOT NULL AND (e.until_day IS NULL OR e.until_day >= ?3))
                OR (e.recurrence_json IS NULL AND COALESCE(e.end_day, e.start_day) >= ?3))
         ORDER BY e.start_day, COALESCE(e.start_minute, 0), i.name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map(params![project_id, LIBRARY, from_day, to_day], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The event list (every live event and note, newest first), for the library's own list.
pub fn list_all(conn: &Connection, project_id: &str) -> Result<Vec<CalendarEvent>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE i.project_id = ?1 AND i.library = ?2 AND i.deleted_at IS NULL
         ORDER BY e.start_day DESC, i.name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map(params![project_id, LIBRARY], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, projects};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let p = projects::create(&conn, "Test", 1).unwrap();
        (conn, p.id)
    }

    fn make(conn: &Connection, project: &str, kind: &str, name: &str) -> String {
        items::create(conn, project, LIBRARY, kind, name, None, 5).unwrap().id
    }

    fn input(start: i64) -> EventInput {
        EventInput { start_day: start, start_minute: None, end_day: None, end_minute: None, recurrence_json: None, until_day: None, body: String::new() }
    }

    #[test]
    fn saves_and_reads_an_event() {
        let (conn, p) = setup();
        let id = make(&conn, &p, EVENT_TYPE, "Harvest feast");
        assert_eq!(get(&conn, &id).unwrap(), None);
        let mut e = input(100);
        e.start_minute = Some(600);
        e.end_day = Some(102);
        e.body = "Bring bread.".into();
        set(&conn, &id, &e, 50).unwrap();
        let got = get(&conn, &id).unwrap().unwrap();
        assert_eq!((got.name.as_str(), got.start_day, got.start_minute, got.end_day, got.body.as_str()), ("Harvest feast", 100, Some(600), Some(102), "Bring bread."));
        assert_eq!(items::get(&conn, &id).unwrap().updated_at, 50);
        e.start_day = 200;
        e.end_day = None;
        set(&conn, &id, &e, 60).unwrap();
        assert_eq!(get(&conn, &id).unwrap().unwrap().start_day, 200);
    }

    #[test]
    fn refuses_dates_that_make_no_sense_and_keeps_the_old_ones() {
        let (conn, p) = setup();
        let id = make(&conn, &p, NOTE_TYPE, "Plot");
        set(&conn, &id, &input(10), 10).unwrap();
        let mut bad = input(10);
        bad.end_day = Some(9);
        assert!(set(&conn, &id, &bad, 20).is_err());
        let mut bad = input(10);
        bad.end_day = Some(10);
        bad.start_minute = Some(500);
        bad.end_minute = Some(400);
        assert!(set(&conn, &id, &bad, 20).is_err());
        let mut bad = input(10);
        bad.end_minute = Some(5);
        assert!(set(&conn, &id, &bad, 20).is_err());
        let mut bad = input(10);
        bad.until_day = Some(3);
        assert!(set(&conn, &id, &bad, 20).is_err());
        let mut bad = input(MAX_DAY + 1);
        assert!(set(&conn, &id, &bad, 20).is_err());
        bad = input(1);
        bad.recurrence_json = Some("[1]".into());
        assert!(set(&conn, &id, &bad, 20).is_err());
        bad.recurrence_json = Some(r#"{"kind":"days","interval":2}"#.into());
        bad.body = "x".repeat(MAX_BODY_BYTES + 1);
        assert!(set(&conn, &id, &bad, 20).is_err());
        assert_eq!(get(&conn, &id).unwrap().unwrap().start_day, 10);
    }

    #[test]
    fn works_only_on_live_events_and_notes() {
        let (conn, p) = setup();
        let doc = items::create(&conn, &p, "worldbuilding", "document", "Doc", None, 5).unwrap().id;
        assert!(set(&conn, &doc, &input(1), 10).is_err());
        let ev = make(&conn, &p, EVENT_TYPE, "E");
        items::soft_delete(&conn, &ev, 20).unwrap();
        assert!(get(&conn, &ev).is_err());
    }

    #[test]
    fn range_listing_finds_overlaps_and_every_repeating_event_that_could_land() {
        let (conn, p) = setup();
        let one = |name: &str, start: i64, end: Option<i64>| {
            let id = make(&conn, &p, EVENT_TYPE, name);
            let mut e = input(start);
            e.end_day = end;
            set(&conn, &id, &e, 10).unwrap();
            id
        };
        one("before", 1, Some(9));
        one("overlaps start", 5, Some(12));
        one("inside", 15, None);
        one("overlaps end", 19, Some(30));
        one("after", 21, None);
        let rep = |name: &str, start: i64, until: Option<i64>| {
            let id = make(&conn, &p, NOTE_TYPE, name);
            let mut e = input(start);
            e.recurrence_json = Some(r#"{"kind":"days","interval":7}"#.into());
            e.until_day = until;
            set(&conn, &id, &e, 10).unwrap();
        };
        rep("old repeating", 0, None);
        rep("stopped", 0, Some(5));
        rep("not started", 25, None);
        let names: Vec<_> = list_in_range(&conn, &p, 10, 20).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["old repeating", "overlaps start", "inside", "overlaps end"]);
        assert_eq!(list_all(&conn, &p).unwrap().len(), 8);
    }

    #[test]
    fn trashed_events_are_not_listed_and_come_back_on_restore() {
        let (conn, p) = setup();
        let id = make(&conn, &p, EVENT_TYPE, "E");
        set(&conn, &id, &input(5), 10).unwrap();
        items::soft_delete(&conn, &id, 20).unwrap();
        assert!(list_in_range(&conn, &p, 0, 10).unwrap().is_empty());
        crate::db::trash::restore_item(&conn, &id, 30).unwrap();
        assert_eq!(list_in_range(&conn, &p, 0, 10).unwrap().len(), 1);
    }
}
