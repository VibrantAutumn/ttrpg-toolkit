//! Per-device settings (not synced), including which campaign is open.

use super::campaigns::{self, Campaign};
use super::error::DbError;
use rusqlite::{params, Connection, OptionalExtension};

const CURRENT_CAMPAIGN: &str = "current_campaign_id";

pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, DbError> {
    Ok(conn
        .query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |row| row.get(0))
        .optional()?)
}

pub fn set(conn: &Connection, key: &str, value: &str, now: i64) -> Result<(), DbError> {
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now],
    )?;
    Ok(())
}

/// The campaign that is open on this device. `None` if none was chosen, or if the
/// chosen one is gone or in the trash (it becomes current again if restored).
pub fn current_campaign(conn: &Connection) -> Result<Option<Campaign>, DbError> {
    let Some(id) = get(conn, CURRENT_CAMPAIGN)? else {
        return Ok(None);
    };
    match campaigns::get_live(conn, &id) {
        Ok(campaign) => Ok(Some(campaign)),
        Err(DbError::NotFound) => Ok(None),
        Err(other) => Err(other),
    }
}

pub fn set_current_campaign(conn: &Connection, id: &str, now: i64) -> Result<Campaign, DbError> {
    let campaign = campaigns::get_live(conn, id)?;
    set(conn, CURRENT_CAMPAIGN, &campaign.id, now)?;
    Ok(campaign)
}

/// Makes `id` current only if no campaign is open yet (used when the first one is created).
pub fn set_current_campaign_if_none(conn: &Connection, id: &str, now: i64) -> Result<(), DbError> {
    if current_campaign(conn)?.is_none() {
        set_current_campaign(conn, id, now)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn settings_round_trip_and_overwrite() {
        let conn = open_in_memory();
        assert_eq!(get(&conn, "k").unwrap(), None);
        set(&conn, "k", "one", 1).unwrap();
        set(&conn, "k", "two", 2).unwrap();
        assert_eq!(get(&conn, "k").unwrap().as_deref(), Some("two"));
    }

    #[test]
    fn no_current_campaign_until_one_is_chosen() {
        let conn = open_in_memory();
        campaigns::create(&conn, "A", 1).unwrap();
        assert!(current_campaign(&conn).unwrap().is_none());
    }

    #[test]
    fn choosing_a_campaign_makes_it_current() {
        let conn = open_in_memory();
        let a = campaigns::create(&conn, "A", 1).unwrap();
        let b = campaigns::create(&conn, "B", 1).unwrap();
        set_current_campaign(&conn, &a.id, 2).unwrap();
        assert_eq!(current_campaign(&conn).unwrap().unwrap().id, a.id);
        set_current_campaign(&conn, &b.id, 3).unwrap();
        assert_eq!(current_campaign(&conn).unwrap().unwrap().name, "B");
    }

    #[test]
    fn only_live_campaigns_can_be_chosen() {
        let conn = open_in_memory();
        let a = campaigns::create(&conn, "A", 1).unwrap();
        campaigns::soft_delete(&conn, &a.id, 2).unwrap();
        assert!(matches!(set_current_campaign(&conn, &a.id, 3), Err(DbError::NotFound)));
        assert!(matches!(set_current_campaign(&conn, "nope", 3), Err(DbError::NotFound)));
    }

    #[test]
    fn deleting_the_current_campaign_clears_it_and_undo_brings_it_back() {
        let conn = open_in_memory();
        let a = campaigns::create(&conn, "A", 1).unwrap();
        set_current_campaign(&conn, &a.id, 2).unwrap();
        campaigns::soft_delete(&conn, &a.id, 3).unwrap();
        assert!(current_campaign(&conn).unwrap().is_none());
        campaigns::restore(&conn, &a.id, 4).unwrap();
        assert_eq!(current_campaign(&conn).unwrap().unwrap().id, a.id);
    }

    #[test]
    fn a_pointer_to_a_missing_campaign_is_treated_as_none() {
        let conn = open_in_memory();
        set(&conn, CURRENT_CAMPAIGN, "no-such-campaign", 1).unwrap();
        assert!(current_campaign(&conn).unwrap().is_none());
    }

    #[test]
    fn if_none_only_fills_an_empty_slot() {
        let conn = open_in_memory();
        let a = campaigns::create(&conn, "A", 1).unwrap();
        let b = campaigns::create(&conn, "B", 1).unwrap();
        set_current_campaign_if_none(&conn, &a.id, 2).unwrap();
        set_current_campaign_if_none(&conn, &b.id, 3).unwrap();
        assert_eq!(current_campaign(&conn).unwrap().unwrap().id, a.id);
        // If the current one is trashed, the slot counts as empty again.
        campaigns::soft_delete(&conn, &a.id, 4).unwrap();
        set_current_campaign_if_none(&conn, &b.id, 5).unwrap();
        assert_eq!(current_campaign(&conn).unwrap().unwrap().id, b.id);
    }
}
