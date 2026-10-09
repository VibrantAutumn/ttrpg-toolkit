//! Links between items. A link points from a source item to a target item;
//! "backlinks" are the items that point at a given item.

use super::error::DbError;
use super::items::{self, Item};
use rusqlite::{params, Connection};

/// `source_ref` for links made from an item's Links list.
pub const MANUAL: &str = "manual";

/// `source_ref` for links made by mentioning an item in a document's text.
pub const BODY: &str = "body";

fn get_live(conn: &Connection, id: &str) -> Result<Item, DbError> {
    let item = items::get(conn, id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    Ok(item)
}

/// Links `source` to `target`. Doing it twice is harmless; a link that was
/// removed earlier comes back. Both items must be live and in the same campaign.
pub fn add(
    conn: &Connection,
    source_id: &str,
    target_id: &str,
    source_ref: &str,
    now: i64,
) -> Result<(), DbError> {
    if source_id == target_id {
        return Err(DbError::Invalid("An item can't link to itself."));
    }
    let source = get_live(conn, source_id)?;
    let target = get_live(conn, target_id)?;
    if source.campaign_id != target.campaign_id {
        return Err(DbError::Invalid("Items in different campaigns can't be linked."));
    }
    conn.execute(
        "INSERT INTO links (source_item_id, target_item_id, source_ref, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (source_item_id, target_item_id, source_ref)
         DO UPDATE SET deleted_at = NULL, updated_at = ?4
         WHERE links.deleted_at IS NOT NULL",
        params![source_id, target_id, source_ref, now],
    )?;
    Ok(())
}

/// Removes a link. Harmless if it doesn't exist.
pub fn remove(
    conn: &Connection,
    source_id: &str,
    target_id: &str,
    source_ref: &str,
    now: i64,
) -> Result<(), DbError> {
    conn.execute(
        "UPDATE links SET deleted_at = ?4, updated_at = ?4
         WHERE source_item_id = ?1 AND target_item_id = ?2 AND source_ref = ?3
           AND deleted_at IS NULL",
        params![source_id, target_id, source_ref, now],
    )?;
    Ok(())
}

/// Makes the live links from `source_id` with this `source_ref` exactly the ones to `targets`: links to
/// anything not listed are removed, new ones are added (a removed link that is listed again comes
/// back). A target that cannot be linked (gone, in the trash, in another campaign, or the source
/// itself) is skipped, never an error: a document may mention an item that has since been deleted.
/// Links with other `source_ref`s are left alone. Call it inside a transaction.
pub fn sync_source(
    conn: &Connection,
    source_id: &str,
    source_ref: &str,
    targets: &[String],
    now: i64,
) -> Result<(), DbError> {
    let wanted: std::collections::HashSet<&str> = targets.iter().map(String::as_str).filter(|t| *t != source_id).collect();
    let current: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT target_item_id FROM links
             WHERE source_item_id = ?1 AND source_ref = ?2 AND deleted_at IS NULL",
        )?;
        let rows = stmt.query_map(params![source_id, source_ref], |r| r.get(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for target in &current {
        if !wanted.contains(target.as_str()) {
            remove(conn, source_id, target, source_ref, now)?;
        }
    }
    for target in &wanted {
        match add(conn, source_id, target, source_ref, now) {
            Ok(()) | Err(DbError::NotFound) | Err(DbError::Invalid(_)) => {}
            Err(other) => return Err(other),
        }
    }
    Ok(())
}

/// The items this item links to by hand (from its Links list), as opposed to by mentioning them.
pub fn manual_target_ids(conn: &Connection, item_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT target_item_id FROM links
         WHERE source_item_id = ?1 AND source_ref = ?2 AND deleted_at IS NULL",
    )?;
    let rows = stmt.query_map(params![item_id, MANUAL], |r| r.get(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn query_items(conn: &Connection, sql: &str, item_id: &str) -> Result<Vec<Item>, DbError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([item_id], items::from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Live items this item links to, alphabetical (each once, however many places link there).
pub fn outgoing(conn: &Connection, item_id: &str) -> Result<Vec<Item>, DbError> {
    query_items(
        conn,
        &format!(
            "SELECT DISTINCT {} FROM links l JOIN items i ON i.id = l.target_item_id
             WHERE l.source_item_id = ?1 AND l.deleted_at IS NULL AND i.deleted_at IS NULL
             ORDER BY i.name COLLATE NOCASE, i.created_at",
            items::qualified_columns("i")
        ),
        item_id,
    )
}

/// Live items that link to this item, alphabetical.
pub fn backlinks(conn: &Connection, item_id: &str) -> Result<Vec<Item>, DbError> {
    query_items(
        conn,
        &format!(
            "SELECT DISTINCT {} FROM links l JOIN items i ON i.id = l.source_item_id
             WHERE l.target_item_id = ?1 AND l.deleted_at IS NULL AND i.deleted_at IS NULL
             ORDER BY i.name COLLATE NOCASE, i.created_at",
            items::qualified_columns("i")
        ),
        item_id,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{campaigns, open_in_memory, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn doc(conn: &Connection, camp: &str, name: &str) -> Item {
        items::create(conn, camp, "worldbuilding", "document", name, None, 1).unwrap()
    }

    fn names(items: Vec<Item>) -> Vec<String> {
        items.into_iter().map(|i| i.name).collect()
    }

    fn link_rows(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM links", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_link_shows_as_outgoing_on_the_source_and_a_backlink_on_the_target() {
        let (conn, camp) = setup();
        let bob = doc(&conn, &camp, "Bob");
        let city = doc(&conn, &camp, "Waterdeep");
        add(&conn, &bob.id, &city.id, MANUAL, 2).unwrap();
        assert_eq!(names(outgoing(&conn, &bob.id).unwrap()), ["Waterdeep"]);
        assert_eq!(names(backlinks(&conn, &city.id).unwrap()), ["Bob"]);
        // Links point one way: nothing comes back the other direction.
        assert!(outgoing(&conn, &city.id).unwrap().is_empty());
        assert!(backlinks(&conn, &bob.id).unwrap().is_empty());
    }

    #[test]
    fn lists_are_alphabetical() {
        let (conn, camp) = setup();
        let hub = doc(&conn, &camp, "Hub");
        for name in ["charlie", "Alpha", "bravo"] {
            let other = doc(&conn, &camp, name);
            add(&conn, &hub.id, &other.id, MANUAL, 2).unwrap();
            add(&conn, &other.id, &hub.id, MANUAL, 2).unwrap();
        }
        let expected = ["Alpha", "bravo", "charlie"];
        assert_eq!(names(outgoing(&conn, &hub.id).unwrap()), expected);
        assert_eq!(names(backlinks(&conn, &hub.id).unwrap()), expected);
    }

    #[test]
    fn items_in_different_tools_can_be_linked() {
        let (conn, camp) = setup();
        let note = doc(&conn, &camp, "Note");
        let map = items::create(&conn, &camp, "maps", "map", "World Map", None, 1).unwrap();
        add(&conn, &note.id, &map.id, MANUAL, 2).unwrap();
        assert_eq!(names(outgoing(&conn, &note.id).unwrap()), ["World Map"]);
    }

    #[test]
    fn adding_twice_is_harmless_and_removing_then_re_adding_revives_the_link() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        add(&conn, &a.id, &b.id, MANUAL, 2).unwrap();
        add(&conn, &a.id, &b.id, MANUAL, 3).unwrap();
        assert_eq!(link_rows(&conn), 1);

        remove(&conn, &a.id, &b.id, MANUAL, 4).unwrap();
        remove(&conn, &a.id, &b.id, MANUAL, 5).unwrap(); // harmless too
        assert!(outgoing(&conn, &a.id).unwrap().is_empty());
        assert!(backlinks(&conn, &b.id).unwrap().is_empty());
        assert_eq!(link_rows(&conn), 1); // kept as a soft-removed row

        add(&conn, &a.id, &b.id, MANUAL, 6).unwrap();
        assert_eq!(names(outgoing(&conn, &a.id).unwrap()), ["B"]);
    }

    #[test]
    fn the_same_pair_linked_from_two_places_is_listed_once() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        add(&conn, &a.id, &b.id, MANUAL, 2).unwrap();
        add(&conn, &a.id, &b.id, "body", 2).unwrap();
        assert_eq!(names(outgoing(&conn, &a.id).unwrap()), ["B"]);
        assert_eq!(names(backlinks(&conn, &b.id).unwrap()), ["A"]);
        // Removing one source leaves the other in place.
        remove(&conn, &a.id, &b.id, MANUAL, 3).unwrap();
        assert_eq!(names(backlinks(&conn, &b.id).unwrap()), ["A"]);
        remove(&conn, &a.id, &b.id, "body", 4).unwrap();
        assert!(backlinks(&conn, &b.id).unwrap().is_empty());
    }

    fn ids(items: &[Item]) -> Vec<String> {
        items.iter().map(|i| i.id.clone()).collect()
    }

    #[test]
    fn syncing_makes_the_links_exactly_the_listed_ones() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        let c = doc(&conn, &camp, "C");
        sync_source(&conn, &a.id, BODY, &[b.id.clone(), c.id.clone()], 2).unwrap();
        assert_eq!(names(outgoing(&conn, &a.id).unwrap()), ["B", "C"]);

        sync_source(&conn, &a.id, BODY, &[c.id.clone()], 3).unwrap();
        assert_eq!(names(outgoing(&conn, &a.id).unwrap()), ["C"]);
        assert!(backlinks(&conn, &b.id).unwrap().is_empty());

        // A link taken away comes back when listed again, as the same row.
        sync_source(&conn, &a.id, BODY, &[b.id.clone(), c.id.clone()], 4).unwrap();
        assert_eq!(names(outgoing(&conn, &a.id).unwrap()), ["B", "C"]);
        assert_eq!(link_rows(&conn), 2);

        sync_source(&conn, &a.id, BODY, &[], 5).unwrap();
        assert!(outgoing(&conn, &a.id).unwrap().is_empty());
    }

    #[test]
    fn syncing_leaves_other_kinds_of_link_alone() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        let c = doc(&conn, &camp, "C");
        add(&conn, &a.id, &b.id, MANUAL, 2).unwrap();
        sync_source(&conn, &a.id, BODY, &[c.id.clone()], 3).unwrap();
        sync_source(&conn, &a.id, BODY, &[], 4).unwrap();
        assert_eq!(names(outgoing(&conn, &a.id).unwrap()), ["B"]);
        assert_eq!(manual_target_ids(&conn, &a.id).unwrap(), vec![b.id.clone()]);

        // A mention of an item that is also linked by hand keeps the hand link when the mention goes.
        sync_source(&conn, &a.id, BODY, &[b.id.clone()], 5).unwrap();
        sync_source(&conn, &a.id, BODY, &[], 6).unwrap();
        assert_eq!(ids(&outgoing(&conn, &a.id).unwrap()), vec![b.id.clone()]);
    }

    #[test]
    fn syncing_skips_what_cannot_be_linked_instead_of_failing() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let good = doc(&conn, &camp, "Good");
        let trashed = doc(&conn, &camp, "Trashed");
        items::soft_delete(&conn, &trashed.id, 2).unwrap();
        let other = campaigns::create(&conn, "Other", 1).unwrap();
        let foreign = doc(&conn, &other.id, "Foreign");
        let targets = vec![
            a.id.clone(),
            "no-such-item".to_string(),
            trashed.id.clone(),
            foreign.id.clone(),
            good.id.clone(),
            good.id.clone(),
        ];
        sync_source(&conn, &a.id, BODY, &targets, 3).unwrap();
        assert_eq!(names(outgoing(&conn, &a.id).unwrap()), ["Good"]);
        assert_eq!(link_rows(&conn), 1);
    }

    #[test]
    fn invalid_links_are_rejected() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        let other = campaigns::create(&conn, "Other", 1).unwrap();
        let foreign = doc(&conn, &other.id, "Foreign");
        assert!(matches!(add(&conn, &a.id, &a.id, MANUAL, 2), Err(DbError::Invalid(_))));
        assert!(matches!(add(&conn, &a.id, &foreign.id, MANUAL, 2), Err(DbError::Invalid(_))));
        assert!(matches!(add(&conn, &a.id, "nope", MANUAL, 2), Err(DbError::NotFound)));
        assert!(matches!(add(&conn, "nope", &a.id, MANUAL, 2), Err(DbError::NotFound)));
        items::soft_delete(&conn, &b.id, 3).unwrap();
        assert!(matches!(add(&conn, &a.id, &b.id, MANUAL, 4), Err(DbError::NotFound)));
        assert!(matches!(add(&conn, &b.id, &a.id, MANUAL, 4), Err(DbError::NotFound)));
        assert_eq!(link_rows(&conn), 0);
    }

    #[test]
    fn trashing_an_item_hides_its_links_and_restoring_brings_them_back() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        add(&conn, &a.id, &b.id, MANUAL, 2).unwrap();

        items::soft_delete(&conn, &b.id, 3).unwrap();
        assert!(outgoing(&conn, &a.id).unwrap().is_empty());
        trash::restore_item(&conn, &b.id, 4).unwrap();
        assert_eq!(names(outgoing(&conn, &a.id).unwrap()), ["B"]);

        items::soft_delete(&conn, &a.id, 5).unwrap();
        assert!(backlinks(&conn, &b.id).unwrap().is_empty());
        trash::restore_item(&conn, &a.id, 6).unwrap();
        assert_eq!(names(backlinks(&conn, &b.id).unwrap()), ["A"]);
    }

    #[test]
    fn purging_either_item_removes_the_links_for_good() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        let c = doc(&conn, &camp, "C");
        add(&conn, &a.id, &b.id, MANUAL, 2).unwrap();
        add(&conn, &c.id, &a.id, MANUAL, 2).unwrap();
        items::soft_delete(&conn, &a.id, 3).unwrap();
        trash::purge_item(&conn, &a.id).unwrap();
        assert_eq!(link_rows(&conn), 0);
        assert!(items::get(&conn, &b.id).is_ok() && items::get(&conn, &c.id).is_ok());
    }
}
