//! Weather per day: rolled once from the weather tables and kept, so a day's weather doesn't change when the
//! project is reopened. A day is an absolute day number (see `calendar_events.rs`). What is inside a weather
//! record (the text, the season and climate it came from, the rolled parts) is the app's TypeScript
//! (`src/lib/calendar/weather.ts`); this keeps it as a small JSON object.

use super::calendar_events::MAX_DAY;
use super::error::DbError;
use super::projects;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub const MAX_BYTES: usize = 5_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherDay {
    pub day: i64,
    pub weather_json: String,
    pub updated_at: i64,
}

/// Checks a weather record (also used when importing packs).
pub fn validate(day: i64, weather_json: &str) -> Result<(), DbError> {
    if !(-MAX_DAY..=MAX_DAY).contains(&day) {
        return Err(DbError::Invalid("That date is out of range."));
    }
    if weather_json.len() > MAX_BYTES {
        return Err(DbError::Invalid("That weather is too large to save."));
    }
    match serde_json::from_str::<serde_json::Value>(weather_json) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err(DbError::Invalid("The weather couldn't be read.")),
    }
}

pub fn get(conn: &Connection, project_id: &str, day: i64) -> Result<Option<WeatherDay>, DbError> {
    projects::require_live(conn, project_id)?;
    Ok(conn
        .query_row(
            "SELECT day, weather_json, updated_at FROM weather_days WHERE project_id = ?1 AND day = ?2",
            params![project_id, day],
            |r| Ok(WeatherDay { day: r.get(0)?, weather_json: r.get(1)?, updated_at: r.get(2)? }),
        )
        .optional()?)
}

/// Keeps the weather for a day, replacing what was there.
pub fn set(conn: &Connection, project_id: &str, day: i64, weather_json: &str, now: i64) -> Result<(), DbError> {
    projects::require_live(conn, project_id)?;
    validate(day, weather_json)?;
    conn.execute(
        "INSERT INTO weather_days (project_id, day, weather_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (project_id, day) DO UPDATE SET weather_json = excluded.weather_json, updated_at = excluded.updated_at",
        params![project_id, day, weather_json, now],
    )?;
    Ok(())
}

/// Forgets a day's weather (it can be rolled again).
pub fn clear(conn: &Connection, project_id: &str, day: i64) -> Result<(), DbError> {
    projects::require_live(conn, project_id)?;
    conn.execute("DELETE FROM weather_days WHERE project_id = ?1 AND day = ?2", params![project_id, day])?;
    Ok(())
}

/// The kept weather for `from_day..=to_day`, by day (for the month view).
pub fn list_range(conn: &Connection, project_id: &str, from_day: i64, to_day: i64) -> Result<Vec<WeatherDay>, DbError> {
    projects::require_live(conn, project_id)?;
    let mut stmt = conn.prepare(
        "SELECT day, weather_json, updated_at FROM weather_days WHERE project_id = ?1 AND day BETWEEN ?2 AND ?3 ORDER BY day",
    )?;
    let rows = stmt.query_map(params![project_id, from_day, to_day], |r| {
        Ok(WeatherDay { day: r.get(0)?, weather_json: r.get(1)?, updated_at: r.get(2)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let p = projects::create(&conn, "Test", 1).unwrap();
        (conn, p.id)
    }

    #[test]
    fn keeps_a_days_weather_and_replaces_it_when_rolled_again() {
        let (conn, p) = setup();
        assert_eq!(get(&conn, &p, 5).unwrap(), None);
        set(&conn, &p, 5, r#"{"text":"Rain"}"#, 10).unwrap();
        assert_eq!(get(&conn, &p, 5).unwrap().unwrap().weather_json, r#"{"text":"Rain"}"#);
        set(&conn, &p, 5, r#"{"text":"Fog"}"#, 20).unwrap();
        assert_eq!(get(&conn, &p, 5).unwrap().unwrap().weather_json, r#"{"text":"Fog"}"#);
        clear(&conn, &p, 5).unwrap();
        assert_eq!(get(&conn, &p, 5).unwrap(), None);
    }

    #[test]
    fn refuses_what_it_cannot_keep() {
        let (conn, p) = setup();
        for bad in ["nope", "[]", "3"] {
            assert!(set(&conn, &p, 1, bad, 10).is_err(), "{bad}");
        }
        assert!(set(&conn, &p, MAX_DAY + 1, "{}", 10).is_err());
        assert!(set(&conn, &p, 1, &format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_BYTES)), 10).is_err());
        assert_eq!(get(&conn, &p, 1).unwrap(), None);
    }

    #[test]
    fn lists_a_range_in_order_and_keeps_projects_apart() {
        let (conn, p) = setup();
        let other = projects::create(&conn, "Other", 2).unwrap().id;
        for d in [9, 3, 6, 20] {
            set(&conn, &p, d, "{}", 10).unwrap();
        }
        set(&conn, &other, 6, "{}", 10).unwrap();
        let days: Vec<_> = list_range(&conn, &p, 3, 9).unwrap().into_iter().map(|w| w.day).collect();
        assert_eq!(days, [3, 6, 9]);
    }
}
