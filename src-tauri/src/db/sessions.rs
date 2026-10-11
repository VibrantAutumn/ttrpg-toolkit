//! Sessions: pages (library `worldbuilding`, type `session`) with a real-world date, an in-game start and end
//! and a status. A session is an ordinary page (text, properties, tags, tabs, one of which is its log); this
//! holds the dates and whether it is planned, running or ended. **At most one session is the project's current
//! one** (`project_state.session_id`): starting a session ends the one that was running, at the in-game moment
//! of the start. The in-game moment is the project's "now" (see `project_state.rs`).

use super::calendar_events::{MAX_DAY, MAX_MINUTE};
use super::error::DbError;
use super::{items, project_state};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const LIBRARY: &str = "worldbuilding";
pub const SESSION_TYPE: &str = "session";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub item_id: String,
    /// The real-world day it was played, `YYYY-MM-DD`.
    pub real_date: Option<String>,
    pub start_day: Option<i64>,
    pub start_minute: Option<i64>,
    pub end_day: Option<i64>,
    pub end_minute: Option<i64>,
    /// `planned`, `running` or `ended`.
    pub status: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub real_date: Option<String>,
    pub start_day: Option<i64>,
    pub start_minute: Option<i64>,
    pub end_day: Option<i64>,
    pub end_minute: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntry {
    pub item_id: String,
    pub name: String,
    pub status: String,
    pub real_date: Option<String>,
    pub start_day: Option<i64>,
    pub end_day: Option<i64>,
    pub updated_at: i64,
}

fn valid_real_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let num = |r: std::ops::Range<usize>| s[r].parse::<u32>().ok();
    match (num(0..4), num(5..7), num(8..10)) {
        (Some(_), Some(m), Some(d)) => (1..=12).contains(&m) && (1..=31).contains(&d),
        _ => false,
    }
}

/// Checks a session's dates (also used when importing packs).
pub fn validate(input: &SessionInput) -> Result<(), DbError> {
    if !matches!(input.status.as_str(), "planned" | "running" | "ended") {
        return Err(DbError::Invalid("A session is planned, running or ended."));
    }
    if input.real_date.as_deref().is_some_and(|d| !d.is_ascii() || !valid_real_date(d)) {
        return Err(DbError::Invalid("The session's real-world date should look like 2026-10-10."));
    }
    let day_ok = |d: Option<i64>| d.map_or(true, |d| (-MAX_DAY..=MAX_DAY).contains(&d));
    let minute_ok = |m: Option<i64>| m.map_or(true, |m| (0..=MAX_MINUTE).contains(&m));
    if !day_ok(input.start_day) || !day_ok(input.end_day) {
        return Err(DbError::Invalid("That date is out of range."));
    }
    if !minute_ok(input.start_minute) || !minute_ok(input.end_minute) {
        return Err(DbError::Invalid("That time is out of range."));
    }
    if let (Some(s), Some(e)) = (input.start_day, input.end_day) {
        let before = e < s || (e == s && matches!((input.start_minute, input.end_minute), (Some(a), Some(b)) if b < a));
        if before {
            return Err(DbError::Invalid("A session can't end before it starts."));
        }
    }
    Ok(())
}

fn require_live(conn: &Connection, item_id: &str) -> Result<items::Item, DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != SESSION_TYPE {
        return Err(DbError::Invalid("This item isn't a session."));
    }
    Ok(item)
}

fn read(conn: &Connection, item_id: &str) -> Result<Option<Session>, DbError> {
    Ok(conn
        .query_row(
            "SELECT item_id, real_date, start_day, start_minute, end_day, end_minute, status, updated_at
             FROM sessions WHERE item_id = ?1",
            [item_id],
            |r| {
                Ok(Session {
                    item_id: r.get(0)?,
                    real_date: r.get(1)?,
                    start_day: r.get(2)?,
                    start_minute: r.get(3)?,
                    end_day: r.get(4)?,
                    end_minute: r.get(5)?,
                    status: r.get(6)?,
                    updated_at: r.get(7)?,
                })
            },
        )
        .optional()?)
}

/// A session's dates. A session made from the generic "New item" form reads as planned with no dates.
pub fn get(conn: &Connection, item_id: &str) -> Result<Session, DbError> {
    let item = require_live(conn, item_id)?;
    Ok(read(conn, item_id)?.unwrap_or(Session {
        item_id: item_id.to_string(),
        real_date: None,
        start_day: None,
        start_minute: None,
        end_day: None,
        end_minute: None,
        status: "planned".into(),
        updated_at: item.updated_at,
    }))
}

fn write(conn: &Connection, item_id: &str, input: &SessionInput, now: i64) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO sessions (item_id, real_date, start_day, start_minute, end_day, end_minute, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT (item_id) DO UPDATE SET
            real_date = excluded.real_date, start_day = excluded.start_day, start_minute = excluded.start_minute,
            end_day = excluded.end_day, end_minute = excluded.end_minute, status = excluded.status,
            updated_at = excluded.updated_at",
        params![item_id, input.real_date, input.start_day, input.start_minute, input.end_day, input.end_minute, input.status, now],
    )?;
    conn.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    Ok(())
}

/// Saves a session's dates and status by hand. Setting a session to `running` here does not make it current;
/// use `start` for that.
pub fn set(conn: &Connection, item_id: &str, input: &SessionInput, now: i64) -> Result<(), DbError> {
    require_live(conn, item_id)?;
    validate(input)?;
    let tx = conn.unchecked_transaction()?;
    write(&tx, item_id, input, now)?;
    tx.commit()?;
    Ok(())
}

fn as_input(s: &Session) -> SessionInput {
    SessionInput {
        real_date: s.real_date.clone(),
        start_day: s.start_day,
        start_minute: s.start_minute,
        end_day: s.end_day,
        end_minute: s.end_minute,
        status: s.status.clone(),
    }
}

/// Ends a session at the project's current in-game moment (all in the caller's transaction).
fn end_at_now(conn: &Connection, item: &items::Item, now: i64) -> Result<(), DbError> {
    let state = project_state::get(conn, &item.project_id)?;
    let mut input = as_input(&get(conn, &item.id)?);
    input.status = "ended".into();
    // The end can't come before the start, even if the clock was set back.
    let (day, minute) = match (input.start_day, input.start_minute) {
        (Some(d), m) if (state.now_day, state.now_minute) < (d, m.unwrap_or(0)) => (d, m.unwrap_or(0)),
        _ => (state.now_day, state.now_minute),
    };
    input.end_day = Some(day);
    input.end_minute = Some(minute);
    write(conn, &item.id, &input, now)
}

/// Starts a session: it becomes the project's current one and is running from the in-game "now". A session that
/// was running is ended at the same moment. `real_date` (today, `YYYY-MM-DD`) is filled in if the session has none.
pub fn start(conn: &Connection, item_id: &str, real_date: Option<&str>, now: i64) -> Result<Session, DbError> {
    let item = require_live(conn, item_id)?;
    let tx = conn.unchecked_transaction()?;
    let state = project_state::get(&tx, &item.project_id)?;
    if let Some(current) = &state.session_id {
        if current != item_id {
            let other = items::get(&tx, current)?;
            if get(&tx, current)?.status == "running" {
                end_at_now(&tx, &other, now)?;
            }
        }
    }
    let mut input = as_input(&get(&tx, item_id)?);
    if input.real_date.is_none() {
        input.real_date = real_date.map(|d| d.to_string());
    }
    input.status = "running".into();
    input.start_day = Some(state.now_day);
    input.start_minute = Some(state.now_minute);
    input.end_day = None;
    input.end_minute = None;
    validate(&input)?;
    write(&tx, item_id, &input, now)?;
    project_state::set_session(&tx, &item.project_id, Some(item_id), now)?;
    tx.commit()?;
    get(conn, item_id)
}

/// Ends a session at the in-game "now". If it was the current session, the project has none afterwards.
pub fn end(conn: &Connection, item_id: &str, now: i64) -> Result<Session, DbError> {
    let item = require_live(conn, item_id)?;
    let tx = conn.unchecked_transaction()?;
    end_at_now(&tx, &item, now)?;
    if project_state::get(&tx, &item.project_id)?.session_id.as_deref() == Some(item_id) {
        project_state::set_session(&tx, &item.project_id, None, now)?;
    }
    tx.commit()?;
    get(conn, item_id)
}

/// Every live session of a project, most recent real-world date first (those without one last).
pub fn list(conn: &Connection, project_id: &str) -> Result<Vec<SessionEntry>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, COALESCE(s.status, 'planned'), s.real_date, s.start_day, s.end_day, i.updated_at
         FROM items i LEFT JOIN sessions s ON s.item_id = i.id
         WHERE i.project_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
         ORDER BY s.real_date IS NULL, s.real_date DESC, i.updated_at DESC",
    )?;
    let rows = stmt.query_map(params![project_id, LIBRARY, SESSION_TYPE], |r| {
        Ok(SessionEntry {
            item_id: r.get(0)?,
            name: r.get(1)?,
            status: r.get(2)?,
            real_date: r.get(3)?,
            start_day: r.get(4)?,
            end_day: r.get(5)?,
            updated_at: r.get(6)?,
        })
    })?;
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

    fn make(conn: &Connection, project: &str, name: &str) -> String {
        items::create(conn, project, LIBRARY, SESSION_TYPE, name, None, 5).unwrap().id
    }

    #[test]
    fn a_new_session_is_planned_with_no_dates() {
        let (conn, p) = setup();
        let id = make(&conn, &p, "Session 1");
        let s = get(&conn, &id).unwrap();
        assert_eq!((s.status.as_str(), s.real_date, s.start_day, s.end_day), ("planned", None, None, None));
    }

    #[test]
    fn saves_dates_and_refuses_bad_ones() {
        let (conn, p) = setup();
        let id = make(&conn, &p, "S");
        let ok = SessionInput { real_date: Some("2026-10-10".into()), start_day: Some(100), start_minute: Some(0), end_day: Some(103), end_minute: None, status: "ended".into() };
        set(&conn, &id, &ok, 10).unwrap();
        assert_eq!(get(&conn, &id).unwrap().end_day, Some(103));
        for bad in [
            SessionInput { real_date: Some("10/10/2026".into()), ..ok.clone() },
            SessionInput { real_date: Some("2026-13-01".into()), ..ok.clone() },
            SessionInput { status: "later".into(), ..ok.clone() },
            SessionInput { end_day: Some(50), ..ok.clone() },
            SessionInput { start_day: Some(MAX_DAY + 1), ..ok.clone() },
            SessionInput { end_day: Some(100), start_minute: Some(500), end_minute: Some(400), ..ok.clone() },
        ] {
            assert!(set(&conn, &id, &bad, 20).is_err(), "{bad:?}");
        }
        assert_eq!(get(&conn, &id).unwrap().real_date.as_deref(), Some("2026-10-10"));
    }

    #[test]
    fn starting_makes_it_current_from_the_in_game_now() {
        let (conn, p) = setup();
        project_state::set_now(&conn, &p, 500, 60, 5).unwrap();
        let id = make(&conn, &p, "S");
        let s = start(&conn, &id, Some("2026-10-10"), 10).unwrap();
        assert_eq!((s.status.as_str(), s.start_day, s.start_minute, s.real_date.as_deref()), ("running", Some(500), Some(60), Some("2026-10-10")));
        assert_eq!(project_state::get(&conn, &p).unwrap().session_id.as_deref(), Some(id.as_str()));
    }

    #[test]
    fn starting_another_ends_the_running_one_at_that_moment() {
        let (conn, p) = setup();
        project_state::set_now(&conn, &p, 500, 0, 5).unwrap();
        let a = make(&conn, &p, "A");
        let b = make(&conn, &p, "B");
        start(&conn, &a, Some("2026-10-01"), 10).unwrap();
        project_state::set_now(&conn, &p, 507, 120, 11).unwrap();
        start(&conn, &b, Some("2026-10-08"), 12).unwrap();
        let a = get(&conn, &a).unwrap();
        assert_eq!((a.status.as_str(), a.end_day, a.end_minute), ("ended", Some(507), Some(120)));
        assert_eq!(get(&conn, &b).unwrap().start_day, Some(507));
        assert_eq!(project_state::get(&conn, &p).unwrap().session_id.as_deref(), Some(b.as_str()));
    }

    #[test]
    fn ending_clears_the_current_session_and_never_ends_before_it_started() {
        let (conn, p) = setup();
        project_state::set_now(&conn, &p, 500, 0, 5).unwrap();
        let id = make(&conn, &p, "S");
        start(&conn, &id, None, 10).unwrap();
        project_state::set_now(&conn, &p, 400, 0, 11).unwrap(); // the clock was set back
        let s = end(&conn, &id, 20).unwrap();
        assert_eq!((s.status.as_str(), s.end_day), ("ended", Some(500)));
        assert_eq!(project_state::get(&conn, &p).unwrap().session_id, None);
    }

    #[test]
    fn starting_the_same_session_again_just_restarts_it() {
        let (conn, p) = setup();
        let id = make(&conn, &p, "S");
        start(&conn, &id, None, 10).unwrap();
        project_state::set_now(&conn, &p, 9, 0, 11).unwrap();
        let s = start(&conn, &id, None, 12).unwrap();
        assert_eq!((s.status.as_str(), s.start_day, s.end_day), ("running", Some(9), None));
    }

    #[test]
    fn lists_newest_real_date_first_with_undated_last() {
        let (conn, p) = setup();
        let a = make(&conn, &p, "A");
        let b = make(&conn, &p, "B");
        make(&conn, &p, "C");
        let input = |d: &str| SessionInput { real_date: Some(d.into()), start_day: None, start_minute: None, end_day: None, end_minute: None, status: "ended".into() };
        set(&conn, &a, &input("2026-01-01"), 10).unwrap();
        set(&conn, &b, &input("2026-06-01"), 10).unwrap();
        let names: Vec<_> = list(&conn, &p).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["B", "A", "C"]);
    }

    #[test]
    fn a_session_is_a_page_with_text_and_a_log_tab() {
        let (conn, p) = setup();
        let id = make(&conn, &p, "S");
        crate::db::documents::set_body(&conn, &id, "Notes", 10).unwrap();
        assert_eq!(crate::db::documents::get_body(&conn, &id).unwrap(), "Notes");
        let tab = crate::db::tabs::add_document_tab(&conn, &id, "Log", 20).unwrap();
        assert_eq!(tab.item.as_ref().unwrap().name, "Log");
        crate::db::documents::set_body(&conn, &tab.item.unwrap().id, "Entry", 30).unwrap();
    }

    #[test]
    fn only_works_on_live_sessions() {
        let (conn, p) = setup();
        let doc = items::create(&conn, &p, LIBRARY, "document", "Doc", None, 5).unwrap().id;
        assert!(start(&conn, &doc, None, 10).is_err());
        let id = make(&conn, &p, "S");
        items::soft_delete(&conn, &id, 20).unwrap();
        assert!(get(&conn, &id).is_err());
    }
}
