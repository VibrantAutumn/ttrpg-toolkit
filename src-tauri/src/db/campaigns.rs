//! Campaign storage. Functions take a plain connection and the current time,
//! so tests can run on an in-memory database with a fake clock.

use rusqlite::{params, Connection, Row};
use serde::Serialize;
use super::error::{clean_name, DbError};
use uuid::Uuid;

const COLUMNS: &str = "id, name, created_at, updated_at, deleted_at";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Campaign {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

fn from_row(row: &Row) -> rusqlite::Result<Campaign> {
    Ok(Campaign {
        id: row.get("id")?,
        name: row.get("name")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

fn get(conn: &Connection, id: &str) -> Result<Campaign, DbError> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM campaigns WHERE id = ?1"),
        [id],
        from_row,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

/// Succeeds only if the campaign exists and is not in the trash.
pub fn require_live(conn: &Connection, id: &str) -> Result<(), DbError> {
    let live: i64 = conn.query_row(
        "SELECT COUNT(*) FROM campaigns WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |row| row.get(0),
    )?;
    if live == 0 {
        Err(DbError::NotFound)
    } else {
        Ok(())
    }
}

pub fn create(conn: &Connection, name: &str, now: i64) -> Result<Campaign, DbError> {
    let name = clean_name(name)?;
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO campaigns (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![id, name, now],
    )?;
    get(conn, &id)
}

/// Live (not deleted) campaigns, alphabetical.
pub fn list(conn: &Connection) -> Result<Vec<Campaign>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM campaigns WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, created_at"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn rename(conn: &Connection, id: &str, name: &str, now: i64) -> Result<Campaign, DbError> {
    let name = clean_name(name)?;
    let changed = conn.execute(
        "UPDATE campaigns SET name = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, name, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    get(conn, id)
}

/// Moves a campaign to the trash. The row is kept so it can be restored.
pub fn soft_delete(conn: &Connection, id: &str, now: i64) -> Result<(), DbError> {
    let changed = conn.execute(
        "UPDATE campaigns SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    Ok(())
}

pub fn restore(conn: &Connection, id: &str, now: i64) -> Result<Campaign, DbError> {
    let changed = conn.execute(
        "UPDATE campaigns SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    get(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory as test_db;

    #[test]
    fn create_sets_uuid_timestamps_and_trims_name() {
        let conn = test_db();
        let c = create(&conn, "  Curse of Strahd  ", 1000).unwrap();
        assert_eq!(c.name, "Curse of Strahd");
        assert_eq!(c.created_at, 1000);
        assert_eq!(c.updated_at, 1000);
        assert_eq!(c.deleted_at, None);
        assert!(Uuid::parse_str(&c.id).is_ok(), "id should be a UUID");
    }

    #[test]
    fn blank_names_are_rejected() {
        let conn = test_db();
        assert!(matches!(create(&conn, "   ", 1), Err(DbError::EmptyName)));
        let c = create(&conn, "Real", 1).unwrap();
        assert!(matches!(rename(&conn, &c.id, "", 2), Err(DbError::EmptyName)));
    }

    #[test]
    fn list_is_alphabetical_ignoring_case() {
        let conn = test_db();
        create(&conn, "banana", 1).unwrap();
        create(&conn, "Apple", 2).unwrap();
        create(&conn, "cherry", 3).unwrap();
        let names: Vec<_> = list(&conn).unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(names, ["Apple", "banana", "cherry"]);
    }

    #[test]
    fn rename_changes_name_and_updated_at_only() {
        let conn = test_db();
        let c = create(&conn, "Old", 1000).unwrap();
        let r = rename(&conn, &c.id, "New", 2000).unwrap();
        assert_eq!(r.name, "New");
        assert_eq!(r.created_at, 1000);
        assert_eq!(r.updated_at, 2000);
    }

    #[test]
    fn soft_delete_hides_from_list_but_keeps_the_row() {
        let conn = test_db();
        let c = create(&conn, "Doomed", 1).unwrap();
        soft_delete(&conn, &c.id, 5000).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        let row = get(&conn, &c.id).unwrap();
        assert_eq!(row.deleted_at, Some(5000));
    }

    #[test]
    fn restore_brings_a_deleted_campaign_back() {
        let conn = test_db();
        let c = create(&conn, "Phoenix", 1).unwrap();
        soft_delete(&conn, &c.id, 2).unwrap();
        let back = restore(&conn, &c.id, 3).unwrap();
        assert_eq!(back.deleted_at, None);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn deleted_or_unknown_campaigns_cannot_be_renamed_or_deleted_again() {
        let conn = test_db();
        let c = create(&conn, "Gone", 1).unwrap();
        soft_delete(&conn, &c.id, 2).unwrap();
        assert!(matches!(rename(&conn, &c.id, "X", 3), Err(DbError::NotFound)));
        assert!(matches!(soft_delete(&conn, &c.id, 3), Err(DbError::NotFound)));
        assert!(matches!(soft_delete(&conn, "nope", 3), Err(DbError::NotFound)));
    }

    #[test]
    fn restoring_a_live_campaign_is_not_found() {
        let conn = test_db();
        let c = create(&conn, "Alive", 1).unwrap();
        assert!(matches!(restore(&conn, &c.id, 2), Err(DbError::NotFound)));
    }
}
