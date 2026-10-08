//! The trash: list, restore and permanently delete soft-deleted folders and items.
//!
//! Deleting a folder stamps it and everything inside with the same `deleted_at`.
//! Restoring a folder restores only rows carrying that stamp, so things trashed
//! earlier stay in the trash.

use super::error::DbError;
use super::folders::{self, Folder};
use super::items::{self, Item};
use rusqlite::{params, Connection};
use serde::Serialize;

/// What the trash screen shows: one entry per "root of deletion".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trash {
    pub folders: Vec<Folder>,
    pub items: Vec<Item>,
}

/// Trashed folders and items for one library, newest first. A folder deleted
/// together with its contents appears once; its contents are not listed separately.
pub fn list(conn: &Connection, campaign_id: &str, library: &str) -> Result<Trash, DbError> {
    let folder_sql = format!(
        "SELECT {} FROM folders f
         WHERE campaign_id = ?1 AND library = ?2 AND deleted_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM folders p WHERE p.id = f.parent_id AND p.deleted_at = f.deleted_at)
         ORDER BY deleted_at DESC, name COLLATE NOCASE",
        folders::COLUMNS
    );
    let item_sql = format!(
        "SELECT {} FROM items i
         WHERE campaign_id = ?1 AND library = ?2 AND deleted_at IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM folders p WHERE p.id = i.folder_id AND p.deleted_at = i.deleted_at)
         ORDER BY deleted_at DESC, name COLLATE NOCASE",
        items::COLUMNS
    );
    let mut stmt = conn.prepare(&folder_sql)?;
    let folders = stmt
        .query_map(params![campaign_id, library], folders::from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(&item_sql)?;
    let items = stmt
        .query_map(params![campaign_id, library], items::from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Trash { folders, items })
}

/// The message for a restore that would make two tables (or two name generators) share a name.
fn name_clash_on_restore(e: DbError, item_type: &str) -> DbError {
    match e {
        DbError::Invalid(_) if item_type == "name_generator" => DbError::Invalid(
            "A name generator with the same name exists now, so this can't be restored yet. Rename the other name generator first.",
        ),
        DbError::Invalid(_) => DbError::Invalid(
            "A table with the same name exists now, so this can't be restored yet. Rename the other table first.",
        ),
        other => other,
    }
}

/// Brings an item back. If its folder is still in the trash it returns to the top level.
pub fn restore_item(conn: &Connection, id: &str, now: i64) -> Result<Item, DbError> {
    let item = items::get(conn, id)?;
    if item.deleted_at.is_some() {
        // Kinds that need unique names (tables) can't come back beside a live item with the same name.
        items::check_name_free(conn, &item.campaign_id, &item.library, &item.item_type, &item.name, Some(id))
            .map_err(|e| name_clash_on_restore(e, &item.item_type))?;
    }
    let changed = conn.execute(
        "UPDATE items
         SET deleted_at = NULL, updated_at = ?2,
             folder_id = CASE
                 WHEN folder_id IN (SELECT id FROM folders WHERE deleted_at IS NOT NULL) THEN NULL
                 ELSE folder_id
             END
         WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    items::get(conn, id)
}

/// Brings a folder back along with everything that was trashed together with it.
/// If its parent is still in the trash it returns to the top level.
pub fn restore_folder(conn: &Connection, id: &str, now: i64) -> Result<Folder, DbError> {
    let folder = folders::get(conn, id)?;
    let stamp = folder.deleted_at.ok_or(DbError::NotFound)?;
    // Tables in the folder can't come back beside a live table with the same name.
    let coming_back: Vec<(String, String, String, String, String)> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT id, campaign_id, library, item_type, name FROM items
             WHERE deleted_at = ?2 AND folder_id IN ({})",
            folders::SUBTREE
        ))?;
        let rows = stmt.query_map(params![id, stamp], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (item_id, campaign_id, library, item_type, name) in &coming_back {
        items::check_name_free(conn, campaign_id, library, item_type, name, Some(item_id))
            .map_err(|e| name_clash_on_restore(e, item_type))?;
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE folders SET parent_id = NULL
         WHERE id = ?1 AND parent_id IN (SELECT id FROM folders WHERE deleted_at IS NOT NULL)",
        [id],
    )?;
    tx.execute(
        &format!(
            "UPDATE items SET deleted_at = NULL, updated_at = ?3
             WHERE deleted_at = ?2 AND folder_id IN ({})",
            folders::SUBTREE
        ),
        params![id, stamp, now],
    )?;
    tx.execute(
        &format!(
            "UPDATE folders SET deleted_at = NULL, updated_at = ?3
             WHERE deleted_at = ?2 AND id IN ({})",
            folders::SUBTREE
        ),
        params![id, stamp, now],
    )?;
    tx.commit()?;
    folders::get(conn, id)
}

/// Permanently deletes an item. Only items already in the trash can be purged.
pub fn purge_item(conn: &Connection, id: &str) -> Result<(), DbError> {
    let removed = conn.execute(
        "DELETE FROM items WHERE id = ?1 AND deleted_at IS NOT NULL",
        [id],
    )?;
    if removed == 0 {
        return Err(DbError::NotFound);
    }
    Ok(())
}

/// Permanently deletes a trashed folder together with everything inside it.
pub fn purge_folder(conn: &Connection, id: &str) -> Result<(), DbError> {
    let folder = folders::get(conn, id)?;
    if folder.deleted_at.is_none() {
        return Err(DbError::NotFound);
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        &format!(
            "DELETE FROM items WHERE deleted_at IS NOT NULL AND folder_id IN ({})",
            folders::SUBTREE
        ),
        [id],
    )?;
    tx.execute(
        &format!(
            "DELETE FROM folders WHERE deleted_at IS NOT NULL AND id IN ({})",
            folders::SUBTREE
        ),
        [id],
    )?;
    tx.commit()?;
    Ok(())
}

/// Permanently deletes trashed things in a library. With `deleted_before`, only
/// those trashed before that time (for "empty after N days"). Returns how many
/// rows were removed.
pub fn empty(
    conn: &Connection,
    campaign_id: &str,
    library: &str,
    deleted_before: Option<i64>,
) -> Result<usize, DbError> {
    let tx = conn.unchecked_transaction()?;
    // Items first: they point at folders. Anything in a folder was trashed no later
    // than the folder, so a folder old enough to purge never holds a newer item.
    let items = tx.execute(
        "DELETE FROM items
         WHERE campaign_id = ?1 AND library = ?2 AND deleted_at IS NOT NULL
           AND (?3 IS NULL OR deleted_at < ?3)",
        params![campaign_id, library, deleted_before],
    )?;
    let folders = tx.execute(
        "DELETE FROM folders
         WHERE campaign_id = ?1 AND library = ?2 AND deleted_at IS NOT NULL
           AND (?3 IS NULL OR deleted_at < ?3)",
        params![campaign_id, library, deleted_before],
    )?;
    tx.commit()?;
    Ok(items + folders)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{campaigns, open_in_memory};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn names(trash: &Trash) -> (Vec<String>, Vec<String>) {
        (
            trash.folders.iter().map(|f| f.name.clone()).collect(),
            trash.items.iter().map(|i| i.name.clone()).collect(),
        )
    }

    /// Folder "Top" > "Sub", with items: Old (deleted early, in Top), Inner (in Sub), Loose (top level).
    struct Scene {
        top: Folder,
        sub: Folder,
        old: Item,
        inner: Item,
        loose: Item,
    }

    fn scene(conn: &Connection, camp: &str) -> Scene {
        let top = folders::create(conn, camp, "w", None, "Top", 1).unwrap();
        let sub = folders::create(conn, camp, "w", Some(&top.id), "Sub", 1).unwrap();
        let old = items::create(conn, camp, "w", "document", "Old", Some(&top.id), 1).unwrap();
        let inner = items::create(conn, camp, "w", "document", "Inner", Some(&sub.id), 1).unwrap();
        let loose = items::create(conn, camp, "w", "document", "Loose", None, 1).unwrap();
        items::soft_delete(conn, &old.id, 50).unwrap();
        folders::soft_delete(conn, &top.id, 100).unwrap();
        Scene { top, sub, old, inner, loose }
    }

    #[test]
    fn list_shows_roots_of_deletion_only() {
        let (conn, camp) = setup();
        let s = scene(&conn, &camp);
        items::soft_delete(&conn, &s.loose.id, 200).unwrap();
        let (f, i) = names(&list(&conn, &camp, "w").unwrap());
        // Top is listed once (not Sub); Inner is hidden inside it; Old (trashed earlier) and Loose have their own entries.
        assert_eq!(f, ["Top"]);
        assert_eq!(i, ["Loose", "Old"]);
    }

    #[test]
    fn list_is_per_library_and_empty_when_nothing_is_trashed() {
        let (conn, camp) = setup();
        scene(&conn, &camp);
        let other = list(&conn, &camp, "maps").unwrap();
        assert!(other.folders.is_empty() && other.items.is_empty());
        let (conn2, camp2) = setup();
        assert!(list(&conn2, &camp2, "w").unwrap().items.is_empty());
    }

    #[test]
    fn restoring_a_folder_restores_its_group_but_not_earlier_deletions() {
        let (conn, camp) = setup();
        let s = scene(&conn, &camp);
        let restored = restore_folder(&conn, &s.top.id, 300).unwrap();
        assert_eq!(restored.deleted_at, None);
        assert_eq!(restored.updated_at, 300);
        assert_eq!(folders::get(&conn, &s.sub.id).unwrap().deleted_at, None);
        assert_eq!(items::get(&conn, &s.inner.id).unwrap().deleted_at, None);
        // "Old" was trashed before the folder, so it stays in the trash.
        assert_eq!(items::get(&conn, &s.old.id).unwrap().deleted_at, Some(50));
        let (_, i) = names(&list(&conn, &camp, "w").unwrap());
        assert_eq!(i, ["Old"]);
    }

    #[test]
    fn restoring_an_item_whose_folder_is_trashed_puts_it_at_the_top_level() {
        let (conn, camp) = setup();
        let s = scene(&conn, &camp);
        let back = restore_item(&conn, &s.old.id, 300).unwrap();
        assert_eq!(back.deleted_at, None);
        assert_eq!(back.folder_id, None);
    }

    #[test]
    fn restoring_an_item_keeps_its_folder_when_the_folder_is_live() {
        let (conn, camp) = setup();
        let f = folders::create(&conn, &camp, "w", None, "F", 1).unwrap();
        let i = items::create(&conn, &camp, "w", "document", "I", Some(&f.id), 1).unwrap();
        items::soft_delete(&conn, &i.id, 2).unwrap();
        let back = restore_item(&conn, &i.id, 3).unwrap();
        assert_eq!(back.folder_id.as_deref(), Some(f.id.as_str()));
    }

    #[test]
    fn restoring_a_subfolder_whose_parent_is_trashed_moves_it_to_the_top_level() {
        let (conn, camp) = setup();
        let s = scene(&conn, &camp);
        let back = restore_folder(&conn, &s.sub.id, 300).unwrap();
        assert_eq!(back.parent_id, None);
        assert_eq!(back.deleted_at, None);
        assert_eq!(items::get(&conn, &s.inner.id).unwrap().deleted_at, None);
        // The parent stays trashed.
        assert_eq!(folders::get(&conn, &s.top.id).unwrap().deleted_at, Some(100));
    }

    #[test]
    fn restoring_something_that_is_not_in_the_trash_is_not_found() {
        let (conn, camp) = setup();
        let i = items::create(&conn, &camp, "w", "document", "Live", None, 1).unwrap();
        let f = folders::create(&conn, &camp, "w", None, "Live", 1).unwrap();
        assert!(matches!(restore_item(&conn, &i.id, 2), Err(DbError::NotFound)));
        assert!(matches!(restore_folder(&conn, &f.id, 2), Err(DbError::NotFound)));
    }

    #[test]
    fn purging_requires_the_trash_and_removes_the_rows() {
        let (conn, camp) = setup();
        let live = items::create(&conn, &camp, "w", "document", "Live", None, 1).unwrap();
        assert!(matches!(purge_item(&conn, &live.id), Err(DbError::NotFound)));
        items::soft_delete(&conn, &live.id, 2).unwrap();
        purge_item(&conn, &live.id).unwrap();
        assert!(matches!(items::get(&conn, &live.id), Err(DbError::NotFound)));

        let f = folders::create(&conn, &camp, "w", None, "F", 1).unwrap();
        assert!(matches!(purge_folder(&conn, &f.id), Err(DbError::NotFound)));
    }

    #[test]
    fn purging_a_folder_removes_its_whole_subtree_and_nothing_else() {
        let (conn, camp) = setup();
        let s = scene(&conn, &camp);
        purge_folder(&conn, &s.top.id).unwrap();
        for id in [&s.top.id, &s.sub.id] {
            assert!(matches!(folders::get(&conn, id), Err(DbError::NotFound)));
        }
        for id in [&s.old.id, &s.inner.id] {
            assert!(matches!(items::get(&conn, id), Err(DbError::NotFound)));
        }
        assert!(items::get(&conn, &s.loose.id).is_ok());
    }

    #[test]
    fn empty_removes_everything_trashed_or_only_older_things() {
        let (conn, camp) = setup();
        let s = scene(&conn, &camp); // Old@50, Top/Sub/Inner@100
        let live = items::create(&conn, &camp, "w", "document", "Live", None, 1).unwrap();
        let recent = items::create(&conn, &camp, "w", "document", "Recent", None, 1).unwrap();
        items::soft_delete(&conn, &recent.id, 400).unwrap();

        // Cutoff 150: removes Old and the Top group, keeps Recent.
        let removed = empty(&conn, &camp, "w", Some(150)).unwrap();
        assert_eq!(removed, 4); // Old, Inner, Top, Sub
        assert!(matches!(items::get(&conn, &s.old.id), Err(DbError::NotFound)));
        assert!(items::get(&conn, &recent.id).is_ok());

        // No cutoff: removes the rest of the trash, never live things.
        assert_eq!(empty(&conn, &camp, "w", None).unwrap(), 1);
        assert!(items::get(&conn, &live.id).is_ok());
        assert!(items::get(&conn, &s.loose.id).is_ok());
        assert_eq!(empty(&conn, &camp, "w", None).unwrap(), 0);
    }
}
