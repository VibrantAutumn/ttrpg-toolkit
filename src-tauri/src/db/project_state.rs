//! The project's shared "now": its main calendar, the in-game date and time, and the current session.
//! Calendar maths is the app's TypeScript; this keeps the numbers. A project with no row yet has the defaults
//! (day 0, midnight, nothing chosen). Pointers to items are only reported while those items are live, so a
//! trashed calendar or session reads as "not set" and comes back when restored.
//! (The party's location arrives with maps, Phase 7; the weather is per day, see `weather.rs`.)

use super::calendar_events::{MAX_DAY, MAX_MINUTE};
use super::error::DbError;
use super::{items, projects};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectState {
    pub project_id: String,
    pub main_calendar_id: Option<String>,
    pub now_day: i64,
    pub now_minute: i64,
    pub session_id: Option<String>,
    /// The table weather is rolled from (a table in the project).
    pub weather_table_id: Option<String>,
}

fn live_item_of_type(conn: &Connection, id: &Option<String>, item_type: &str) -> Option<String> {
    let id = id.as_ref()?;
    let ok: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM items WHERE id = ?1 AND item_type = ?2 AND deleted_at IS NULL",
            params![id, item_type],
            |r| r.get(0),
        )
        .optional()
        .ok()?;
    ok.map(|_| id.clone())
}

pub fn get(conn: &Connection, project_id: &str) -> Result<ProjectState, DbError> {
    projects::require_live(conn, project_id)?;
    let row: Option<(Option<String>, i64, i64, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT main_calendar_id, now_day, now_minute, session_id, weather_table_id FROM project_state WHERE project_id = ?1",
            [project_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let (cal, day, minute, session, weather) = row.unwrap_or((None, 0, 0, None, None));
    Ok(ProjectState {
        project_id: project_id.to_string(),
        main_calendar_id: live_item_of_type(conn, &cal, "calendar"),
        now_day: day,
        now_minute: minute,
        session_id: live_item_of_type(conn, &session, "session"),
        weather_table_id: live_item_of_type(conn, &weather, "table"),
    })
}

fn ensure_row(conn: &Connection, project_id: &str, now: i64) -> Result<(), DbError> {
    conn.execute(
        "INSERT OR IGNORE INTO project_state (project_id, created_at, updated_at) VALUES (?1, ?2, ?2)",
        params![project_id, now],
    )?;
    Ok(())
}

fn require_in_project(conn: &Connection, project_id: &str, id: &str, item_type: &str, message: &'static str) -> Result<(), DbError> {
    let item = items::get(conn, id)?;
    if item.deleted_at.is_some() || item.project_id != project_id || item.item_type != item_type {
        return Err(DbError::Invalid(message));
    }
    Ok(())
}

pub fn set_main_calendar(conn: &Connection, project_id: &str, calendar_id: Option<&str>, now: i64) -> Result<(), DbError> {
    projects::require_live(conn, project_id)?;
    if let Some(id) = calendar_id {
        require_in_project(conn, project_id, id, "calendar", "That isn't a calendar in this project.")?;
    }
    ensure_row(conn, project_id, now)?;
    conn.execute(
        "UPDATE project_state SET main_calendar_id = ?2, updated_at = ?3 WHERE project_id = ?1",
        params![project_id, calendar_id, now],
    )?;
    Ok(())
}

/// Sets the in-game moment. The app works out the day and minute with the calendar; this only keeps them sane.
pub fn set_now(conn: &Connection, project_id: &str, day: i64, minute: i64, now: i64) -> Result<(), DbError> {
    projects::require_live(conn, project_id)?;
    if !(-MAX_DAY..=MAX_DAY).contains(&day) {
        return Err(DbError::Invalid("That date is out of range."));
    }
    if !(0..=MAX_MINUTE).contains(&minute) {
        return Err(DbError::Invalid("That time is out of range."));
    }
    ensure_row(conn, project_id, now)?;
    conn.execute(
        "UPDATE project_state SET now_day = ?2, now_minute = ?3, updated_at = ?4 WHERE project_id = ?1",
        params![project_id, day, minute, now],
    )?;
    Ok(())
}

pub fn set_session(conn: &Connection, project_id: &str, session_id: Option<&str>, now: i64) -> Result<(), DbError> {
    projects::require_live(conn, project_id)?;
    if let Some(id) = session_id {
        require_in_project(conn, project_id, id, "session", "That isn't a session in this project.")?;
    }
    ensure_row(conn, project_id, now)?;
    conn.execute(
        "UPDATE project_state SET session_id = ?2, updated_at = ?3 WHERE project_id = ?1",
        params![project_id, session_id, now],
    )?;
    Ok(())
}

pub fn set_weather_table(conn: &Connection, project_id: &str, table_id: Option<&str>, now: i64) -> Result<(), DbError> {
    projects::require_live(conn, project_id)?;
    if let Some(id) = table_id {
        require_in_project(conn, project_id, id, "table", "That isn't a table in this project.")?;
    }
    ensure_row(conn, project_id, now)?;
    conn.execute(
        "UPDATE project_state SET weather_table_id = ?2, updated_at = ?3 WHERE project_id = ?1",
        params![project_id, table_id, now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let p = projects::create(&conn, "Test", 1).unwrap();
        (conn, p.id)
    }

    #[test]
    fn a_new_project_has_the_defaults() {
        let (conn, p) = setup();
        let s = get(&conn, &p).unwrap();
        assert_eq!((s.main_calendar_id, s.now_day, s.now_minute, s.session_id, s.weather_table_id), (None, 0, 0, None, None));
    }

    #[test]
    fn keeps_the_moment_and_refuses_nonsense() {
        let (conn, p) = setup();
        set_now(&conn, &p, 730119, 90, 10).unwrap();
        let s = get(&conn, &p).unwrap();
        assert_eq!((s.now_day, s.now_minute), (730119, 90));
        assert!(set_now(&conn, &p, MAX_DAY + 1, 0, 20).is_err());
        assert!(set_now(&conn, &p, 5, -1, 20).is_err());
        assert!(set_now(&conn, &p, 5, MAX_MINUTE + 1, 20).is_err());
        assert_eq!(get(&conn, &p).unwrap().now_day, 730119);
    }

    #[test]
    fn the_main_calendar_must_be_a_live_calendar_of_this_project() {
        let (conn, p) = setup();
        let other = projects::create(&conn, "Other", 2).unwrap().id;
        let cal = items::create(&conn, &p, "calendar", "calendar", "Cal", None, 5).unwrap().id;
        let foreign = items::create(&conn, &other, "calendar", "calendar", "Theirs", None, 5).unwrap().id;
        let doc = items::create(&conn, &p, "worldbuilding", "document", "Doc", None, 5).unwrap().id;
        assert!(set_main_calendar(&conn, &p, Some(&foreign), 10).is_err());
        assert!(set_main_calendar(&conn, &p, Some(&doc), 10).is_err());
        set_main_calendar(&conn, &p, Some(&cal), 10).unwrap();
        assert_eq!(get(&conn, &p).unwrap().main_calendar_id.as_deref(), Some(cal.as_str()));
        set_main_calendar(&conn, &p, None, 20).unwrap();
        assert_eq!(get(&conn, &p).unwrap().main_calendar_id, None);
    }

    #[test]
    fn a_trashed_calendar_reads_as_not_set_and_returns_on_restore() {
        let (conn, p) = setup();
        let cal = items::create(&conn, &p, "calendar", "calendar", "Cal", None, 5).unwrap().id;
        set_main_calendar(&conn, &p, Some(&cal), 10).unwrap();
        items::soft_delete(&conn, &cal, 20).unwrap();
        assert_eq!(get(&conn, &p).unwrap().main_calendar_id, None);
        trash::restore_item(&conn, &cal, 30).unwrap();
        assert_eq!(get(&conn, &p).unwrap().main_calendar_id.as_deref(), Some(cal.as_str()));
    }

    #[test]
    fn purging_the_calendar_clears_the_pointer_without_breaking_the_state() {
        let (conn, p) = setup();
        let cal = items::create(&conn, &p, "calendar", "calendar", "Cal", None, 5).unwrap().id;
        set_main_calendar(&conn, &p, Some(&cal), 10).unwrap();
        set_now(&conn, &p, 40, 5, 11).unwrap();
        items::soft_delete(&conn, &cal, 20).unwrap();
        trash::purge_item(&conn, &cal).unwrap();
        let s = get(&conn, &p).unwrap();
        assert_eq!((s.main_calendar_id, s.now_day, s.now_minute), (None, 40, 5));
    }

    #[test]
    fn the_weather_table_must_be_a_table_of_this_project() {
        let (conn, p) = setup();
        let t = items::create(&conn, &p, "tables", "table", "Temperate weather", None, 5).unwrap().id;
        let doc = items::create(&conn, &p, "worldbuilding", "document", "Doc", None, 5).unwrap().id;
        assert!(set_weather_table(&conn, &p, Some(&doc), 10).is_err());
        set_weather_table(&conn, &p, Some(&t), 10).unwrap();
        assert_eq!(get(&conn, &p).unwrap().weather_table_id.as_deref(), Some(t.as_str()));
        items::soft_delete(&conn, &t, 20).unwrap();
        assert_eq!(get(&conn, &p).unwrap().weather_table_id, None);
    }

    #[test]
    fn the_session_must_be_a_live_session() {
        let (conn, p) = setup();
        let s = items::create(&conn, &p, "worldbuilding", "session", "Session 1", None, 5).unwrap().id;
        let doc = items::create(&conn, &p, "worldbuilding", "document", "Doc", None, 5).unwrap().id;
        assert!(set_session(&conn, &p, Some(&doc), 10).is_err());
        set_session(&conn, &p, Some(&s), 10).unwrap();
        assert_eq!(get(&conn, &p).unwrap().session_id.as_deref(), Some(s.as_str()));
        set_session(&conn, &p, None, 20).unwrap();
        assert_eq!(get(&conn, &p).unwrap().session_id, None);
    }
}
