//! Folders: nested groups inside one tool's library.

use super::campaigns;
use super::error::{clean_name, DbError};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use uuid::Uuid;

pub(super) const COLUMNS: &str = "id, campaign_id, library, parent_id, name, created_at, updated_at, deleted_at";

/// The folder plus everything below it (so deleting one takes its contents along).
pub(super) const SUBTREE: &str = "WITH RECURSIVE tree(id) AS (
        SELECT ?1
        UNION ALL
        SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.id
    )
    SELECT id FROM tree";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub campaign_id: String,
    pub library: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

pub(super) fn from_row(row: &Row) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get("id")?,
        campaign_id: row.get("campaign_id")?,
        library: row.get("library")?,
        parent_id: row.get("parent_id")?,
        name: row.get("name")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

pub fn get(conn: &Connection, id: &str) -> Result<Folder, DbError> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM folders WHERE id = ?1"),
        [id],
        from_row,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

/// Succeeds only if the folder is live and belongs to this campaign's library.
pub fn require_live_in(
    conn: &Connection,
    folder_id: &str,
    campaign_id: &str,
    library: &str,
) -> Result<(), DbError> {
    let found: Option<(String, String)> = conn
        .query_row(
            "SELECT campaign_id, library FROM folders WHERE id = ?1 AND deleted_at IS NULL",
            [folder_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match found {
        None => Err(DbError::NotFound),
        Some((c, l)) if c == campaign_id && l == library => Ok(()),
        Some(_) => Err(DbError::Invalid("That folder belongs to a different library.")),
    }
}

pub fn create(
    conn: &Connection,
    campaign_id: &str,
    library: &str,
    parent_id: Option<&str>,
    name: &str,
    now: i64,
) -> Result<Folder, DbError> {
    let name = clean_name(name)?;
    if library.trim().is_empty() {
        return Err(DbError::Invalid("A library is required."));
    }
    campaigns::require_live(conn, campaign_id)?;
    if let Some(parent) = parent_id {
        require_live_in(conn, parent, campaign_id, library)?;
    }
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO folders (id, campaign_id, library, parent_id, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, campaign_id, library, parent_id, name, now],
    )?;
    get(conn, &id)
}

/// Every live folder in a library (the front end builds the tree from `parent_id`).
pub fn list(conn: &Connection, campaign_id: &str, library: &str) -> Result<Vec<Folder>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM folders
         WHERE campaign_id = ?1 AND library = ?2 AND deleted_at IS NULL
         ORDER BY name COLLATE NOCASE, created_at"
    ))?;
    let rows = stmt.query_map(params![campaign_id, library], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn rename(conn: &Connection, id: &str, name: &str, now: i64) -> Result<Folder, DbError> {
    let name = clean_name(name)?;
    let changed = conn.execute(
        "UPDATE folders SET name = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, name, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    get(conn, id)
}

/// Moves a folder under `new_parent` (or to the top level when `None`).
pub fn move_to(
    conn: &Connection,
    id: &str,
    new_parent: Option<&str>,
    now: i64,
) -> Result<Folder, DbError> {
    let folder = get(conn, id)?;
    if folder.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if let Some(parent) = new_parent {
        require_live_in(conn, parent, &folder.campaign_id, &folder.library)?;
        // Walk up from the new parent; if we meet the folder being moved, it would become its own ancestor.
        let loops: i64 = conn.query_row(
            "WITH RECURSIVE up(id, parent_id) AS (
                 SELECT id, parent_id FROM folders WHERE id = ?1
                 UNION ALL
                 SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id
             )
             SELECT COUNT(*) FROM up WHERE id = ?2",
            params![parent, id],
            |row| row.get(0),
        )?;
        if loops > 0 {
            return Err(DbError::Invalid(
                "A folder can't be moved into itself or its own subfolders.",
            ));
        }
    }
    conn.execute(
        "UPDATE folders SET parent_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, new_parent, now],
    )?;
    get(conn, id)
}

/// Moves the folder, its subfolders and all items inside them to the trash,
/// stamping them all with the same `now` so they can be restored as a group.
pub fn soft_delete(conn: &Connection, id: &str, now: i64) -> Result<(), DbError> {
    let tx = conn.unchecked_transaction()?;
    let live: i64 = tx.query_row(
        "SELECT COUNT(*) FROM folders WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |row| row.get(0),
    )?;
    if live == 0 {
        return Err(DbError::NotFound);
    }
    tx.execute(
        &format!(
            "UPDATE items SET deleted_at = ?2, updated_at = ?2
             WHERE deleted_at IS NULL AND folder_id IN ({SUBTREE})"
        ),
        params![id, now],
    )?;
    tx.execute(
        &format!(
            "UPDATE folders SET deleted_at = ?2, updated_at = ?2
             WHERE deleted_at IS NULL AND id IN ({SUBTREE})"
        ),
        params![id, now],
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::campaigns;
    use crate::db::open_in_memory;

    /// A database with one campaign; returns (connection, campaign id).
    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    #[test]
    fn create_nested_folders_and_list_them() {
        let (conn, camp) = setup();
        let top = create(&conn, &camp, "worldbuilding", None, "NPCs", 10).unwrap();
        let sub = create(&conn, &camp, "worldbuilding", Some(&top.id), "Villains", 11).unwrap();
        assert_eq!(sub.parent_id.as_deref(), Some(top.id.as_str()));
        let names: Vec<_> = list(&conn, &camp, "worldbuilding")
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect();
        assert_eq!(names, ["NPCs", "Villains"]);
    }

    #[test]
    fn libraries_are_separate() {
        let (conn, camp) = setup();
        create(&conn, &camp, "worldbuilding", None, "Docs", 1).unwrap();
        assert!(list(&conn, &camp, "maps").unwrap().is_empty());
        let docs = list(&conn, &camp, "worldbuilding").unwrap();
        // A parent from another library is refused.
        assert!(matches!(
            create(&conn, &camp, "maps", Some(&docs[0].id), "Nope", 2),
            Err(DbError::Invalid(_))
        ));
    }

    #[test]
    fn blank_names_and_missing_campaigns_are_rejected() {
        let (conn, camp) = setup();
        assert!(matches!(create(&conn, &camp, "w", None, "  ", 1), Err(DbError::EmptyName)));
        assert!(matches!(create(&conn, "no-such", "w", None, "X", 1), Err(DbError::NotFound)));
        assert!(matches!(create(&conn, &camp, " ", None, "X", 1), Err(DbError::Invalid(_))));
    }

    #[test]
    fn rename_works_and_keeps_created_at() {
        let (conn, camp) = setup();
        let f = create(&conn, &camp, "w", None, "Old", 10).unwrap();
        let r = rename(&conn, &f.id, " New ", 20).unwrap();
        assert_eq!((r.name.as_str(), r.created_at, r.updated_at), ("New", 10, 20));
    }

    #[test]
    fn move_to_reparents_and_to_top_level() {
        let (conn, camp) = setup();
        let a = create(&conn, &camp, "w", None, "A", 1).unwrap();
        let b = create(&conn, &camp, "w", None, "B", 1).unwrap();
        let moved = move_to(&conn, &b.id, Some(&a.id), 2).unwrap();
        assert_eq!(moved.parent_id.as_deref(), Some(a.id.as_str()));
        let top = move_to(&conn, &b.id, None, 3).unwrap();
        assert_eq!(top.parent_id, None);
    }

    #[test]
    fn a_folder_cannot_move_into_itself_or_its_descendants() {
        let (conn, camp) = setup();
        let a = create(&conn, &camp, "w", None, "A", 1).unwrap();
        let b = create(&conn, &camp, "w", Some(&a.id), "B", 1).unwrap();
        let c = create(&conn, &camp, "w", Some(&b.id), "C", 1).unwrap();
        assert!(matches!(move_to(&conn, &a.id, Some(&a.id), 2), Err(DbError::Invalid(_))));
        assert!(matches!(move_to(&conn, &a.id, Some(&c.id), 2), Err(DbError::Invalid(_))));
        // Nothing changed.
        assert_eq!(get(&conn, &a.id).unwrap().parent_id, None);
    }

    #[test]
    fn deleting_a_folder_trashes_its_subtree_with_one_timestamp() {
        let (conn, camp) = setup();
        let a = create(&conn, &camp, "w", None, "A", 1).unwrap();
        let b = create(&conn, &camp, "w", Some(&a.id), "B", 1).unwrap();
        let other = create(&conn, &camp, "w", None, "Other", 1).unwrap();
        soft_delete(&conn, &a.id, 500).unwrap();
        assert_eq!(get(&conn, &a.id).unwrap().deleted_at, Some(500));
        assert_eq!(get(&conn, &b.id).unwrap().deleted_at, Some(500));
        assert_eq!(get(&conn, &other.id).unwrap().deleted_at, None);
        let names: Vec<_> = list(&conn, &camp, "w").unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(names, ["Other"]);
    }

    #[test]
    fn deleted_folders_cannot_be_used() {
        let (conn, camp) = setup();
        let a = create(&conn, &camp, "w", None, "A", 1).unwrap();
        soft_delete(&conn, &a.id, 2).unwrap();
        assert!(matches!(rename(&conn, &a.id, "X", 3), Err(DbError::NotFound)));
        assert!(matches!(soft_delete(&conn, &a.id, 3), Err(DbError::NotFound)));
        assert!(matches!(
            create(&conn, &camp, "w", Some(&a.id), "Child", 3),
            Err(DbError::NotFound)
        ));
    }
}
