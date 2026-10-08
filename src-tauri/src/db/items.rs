//! Library items: the shared record behind documents, maps, decks and every
//! other tool's content. Type-specific data lives in separate detail tables.

use super::error::{clean_name, DbError};
use super::{campaigns, folders};
use rusqlite::{params, Connection, Row};
use serde::Serialize;
use uuid::Uuid;

pub(super) const COLUMNS: &str =
    "id, campaign_id, library, item_type, name, icon, folder_id, visibility, created_at, updated_at, deleted_at";

/// The item columns prefixed with a table alias (`i.id, i.name, ...`), for joins
/// where bare names would be ambiguous.
pub(super) fn qualified_columns(alias: &str) -> String {
    COLUMNS
        .split(", ")
        .map(|c| format!("{alias}.{c}"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub campaign_id: String,
    pub library: String,
    pub item_type: String,
    pub name: String,
    pub icon: Option<String>,
    pub folder_id: Option<String>,
    /// 'default' (follow the tool's default), 'visible' or 'secret'.
    pub visibility: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

pub(super) fn from_row(row: &Row) -> rusqlite::Result<Item> {
    Ok(Item {
        id: row.get("id")?,
        campaign_id: row.get("campaign_id")?,
        library: row.get("library")?,
        item_type: row.get("item_type")?,
        name: row.get("name")?,
        icon: row.get("icon")?,
        folder_id: row.get("folder_id")?,
        visibility: row.get("visibility")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

pub fn get(conn: &Connection, id: &str) -> Result<Item, DbError> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM items WHERE id = ?1"),
        [id],
        from_row,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

pub fn create(
    conn: &Connection,
    campaign_id: &str,
    library: &str,
    item_type: &str,
    name: &str,
    folder_id: Option<&str>,
    now: i64,
) -> Result<Item, DbError> {
    let name = clean_name(name)?;
    if library.trim().is_empty() || item_type.trim().is_empty() {
        return Err(DbError::Invalid("An item needs a library and a type."));
    }
    campaigns::require_live(conn, campaign_id)?;
    if let Some(folder) = folder_id {
        folders::require_live_in(conn, folder, campaign_id, library)?;
    }
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO items (id, campaign_id, library, item_type, name, folder_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, campaign_id, library, item_type, name, folder_id, now],
    )?;
    get(conn, &id)
}

/// Live items directly inside `folder_id` (or at the top level when `None`).
pub fn list(
    conn: &Connection,
    campaign_id: &str,
    library: &str,
    folder_id: Option<&str>,
) -> Result<Vec<Item>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM items
         WHERE campaign_id = ?1 AND library = ?2 AND folder_id IS ?3 AND deleted_at IS NULL
         ORDER BY name COLLATE NOCASE, created_at"
    ))?;
    let rows = stmt.query_map(params![campaign_id, library, folder_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn rename(conn: &Connection, id: &str, name: &str, now: i64) -> Result<Item, DbError> {
    let name = clean_name(name)?;
    let changed = conn.execute(
        "UPDATE items SET name = ?2, updated_at = ?3 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, name, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    get(conn, id)
}

/// Moves an item into a folder (or to the top level when `None`).
pub fn move_to(
    conn: &Connection,
    id: &str,
    folder_id: Option<&str>,
    now: i64,
) -> Result<Item, DbError> {
    let item = get(conn, id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if let Some(folder) = folder_id {
        folders::require_live_in(conn, folder, &item.campaign_id, &item.library)?;
    }
    conn.execute(
        "UPDATE items SET folder_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, folder_id, now],
    )?;
    get(conn, id)
}

/// Moves an item to the trash (the row is kept so it can be restored).
pub fn soft_delete(conn: &Connection, id: &str, now: i64) -> Result<(), DbError> {
    let changed = conn.execute(
        "UPDATE items SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    /// A database with one campaign; returns (connection, campaign id).
    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    #[test]
    fn create_sets_defaults() {
        let (conn, camp) = setup();
        let i = create(&conn, &camp, "worldbuilding", "document", "  Waterdeep ", None, 100).unwrap();
        assert_eq!(i.name, "Waterdeep");
        assert_eq!(i.item_type, "document");
        assert_eq!(i.visibility, "default");
        assert_eq!((i.created_at, i.updated_at, i.deleted_at), (100, 100, None));
        assert_eq!(i.folder_id, None);
        assert!(Uuid::parse_str(&i.id).is_ok());
    }

    #[test]
    fn list_shows_only_the_requested_folder_level() {
        let (conn, camp) = setup();
        let f = folders::create(&conn, &camp, "w", None, "NPCs", 1).unwrap();
        create(&conn, &camp, "w", "document", "Root note", None, 2).unwrap();
        create(&conn, &camp, "w", "document", "Bob", Some(&f.id), 3).unwrap();
        let root: Vec<_> = list(&conn, &camp, "w", None).unwrap().into_iter().map(|i| i.name).collect();
        let inside: Vec<_> = list(&conn, &camp, "w", Some(&f.id)).unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(root, ["Root note"]);
        assert_eq!(inside, ["Bob"]);
    }

    #[test]
    fn list_is_alphabetical_and_per_library() {
        let (conn, camp) = setup();
        create(&conn, &camp, "w", "document", "banana", None, 1).unwrap();
        create(&conn, &camp, "w", "document", "Apple", None, 2).unwrap();
        create(&conn, &camp, "maps", "map", "Elsewhere", None, 3).unwrap();
        let names: Vec<_> = list(&conn, &camp, "w", None).unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(names, ["Apple", "banana"]);
    }

    #[test]
    fn invalid_creates_are_rejected() {
        let (conn, camp) = setup();
        assert!(matches!(create(&conn, &camp, "w", "document", " ", None, 1), Err(DbError::EmptyName)));
        assert!(matches!(create(&conn, "nope", "w", "document", "X", None, 1), Err(DbError::NotFound)));
        assert!(matches!(create(&conn, &camp, "w", "", "X", None, 1), Err(DbError::Invalid(_))));
        assert!(matches!(create(&conn, &camp, "w", "document", "X", Some("no-folder"), 1), Err(DbError::NotFound)));
    }

    #[test]
    fn items_cannot_go_in_a_folder_from_another_library() {
        let (conn, camp) = setup();
        let f = folders::create(&conn, &camp, "maps", None, "Regions", 1).unwrap();
        assert!(matches!(
            create(&conn, &camp, "w", "document", "X", Some(&f.id), 2),
            Err(DbError::Invalid(_))
        ));
        let i = create(&conn, &camp, "w", "document", "Y", None, 2).unwrap();
        assert!(matches!(move_to(&conn, &i.id, Some(&f.id), 3), Err(DbError::Invalid(_))));
    }

    #[test]
    fn rename_and_move_update_timestamps() {
        let (conn, camp) = setup();
        let f = folders::create(&conn, &camp, "w", None, "F", 1).unwrap();
        let i = create(&conn, &camp, "w", "document", "Old", None, 10).unwrap();
        let r = rename(&conn, &i.id, "New", 20).unwrap();
        assert_eq!((r.name.as_str(), r.updated_at), ("New", 20));
        let m = move_to(&conn, &i.id, Some(&f.id), 30).unwrap();
        assert_eq!((m.folder_id.as_deref(), m.updated_at), (Some(f.id.as_str()), 30));
        let back = move_to(&conn, &i.id, None, 40).unwrap();
        assert_eq!(back.folder_id, None);
    }

    #[test]
    fn soft_delete_hides_the_item_but_keeps_the_row() {
        let (conn, camp) = setup();
        let i = create(&conn, &camp, "w", "document", "Doomed", None, 1).unwrap();
        soft_delete(&conn, &i.id, 99).unwrap();
        assert!(list(&conn, &camp, "w", None).unwrap().is_empty());
        assert_eq!(get(&conn, &i.id).unwrap().deleted_at, Some(99));
        assert!(matches!(soft_delete(&conn, &i.id, 100), Err(DbError::NotFound)));
        assert!(matches!(rename(&conn, &i.id, "X", 100), Err(DbError::NotFound)));
        assert!(matches!(move_to(&conn, &i.id, None, 100), Err(DbError::NotFound)));
    }

    #[test]
    fn deleting_a_folder_trashes_the_items_inside_it() {
        let (conn, camp) = setup();
        let top = folders::create(&conn, &camp, "w", None, "Top", 1).unwrap();
        let sub = folders::create(&conn, &camp, "w", Some(&top.id), "Sub", 1).unwrap();
        let deep = create(&conn, &camp, "w", "document", "Deep", Some(&sub.id), 2).unwrap();
        let outside = create(&conn, &camp, "w", "document", "Outside", None, 2).unwrap();
        let earlier = create(&conn, &camp, "w", "document", "Earlier", Some(&top.id), 2).unwrap();
        soft_delete(&conn, &earlier.id, 50).unwrap();

        folders::soft_delete(&conn, &top.id, 500).unwrap();

        assert_eq!(get(&conn, &deep.id).unwrap().deleted_at, Some(500));
        assert_eq!(get(&conn, &outside.id).unwrap().deleted_at, None);
        // An item deleted earlier keeps its own timestamp (so restoring the folder won't resurrect it).
        assert_eq!(get(&conn, &earlier.id).unwrap().deleted_at, Some(50));
    }

    #[test]
    fn invalid_visibility_is_rejected_by_the_database() {
        let (conn, camp) = setup();
        let i = create(&conn, &camp, "w", "document", "X", None, 1).unwrap();
        let result = conn.execute("UPDATE items SET visibility = 'bogus' WHERE id = ?1", [&i.id]);
        assert!(result.is_err());
    }
}
