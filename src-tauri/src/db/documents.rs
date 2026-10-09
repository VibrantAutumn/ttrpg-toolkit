//! Document text: the Markdown body of items whose type is `document`.

use super::error::DbError;
use super::items;
use super::links;
use rusqlite::{params, Connection, OptionalExtension};

/// The item type this module stores text for.
pub const DOCUMENT_TYPE: &str = "document";

/// A safety limit (in bytes) so a runaway paste can't bloat the database.
pub const MAX_BODY_BYTES: usize = 2_000_000;

/// Does an item of this type hold text? Documents do, and so do templates (their text is the
/// starter text of the documents made from them).
pub fn holds_text(item_type: &str) -> bool {
    item_type == DOCUMENT_TYPE || item_type == super::templates::TEMPLATE_TYPE
}

/// Checks the item exists, is live, and holds text.
fn require_live_document(conn: &Connection, item_id: &str) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if !holds_text(&item.item_type) {
        return Err(DbError::Invalid("This item doesn't hold document text."));
    }
    Ok(())
}

/// The document's Markdown text ("" if nothing has been written yet).
pub fn get_body(conn: &Connection, item_id: &str) -> Result<String, DbError> {
    require_live_document(conn, item_id)?;
    let body: Option<String> = conn
        .query_row(
            "SELECT body FROM document_content WHERE item_id = ?1",
            [item_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(body.unwrap_or_default())
}

/// Replaces the document's text. Also marks the item as updated. (The app saves through
/// `set_body_with_links`; this plain form is what the tests use to set up a document.)
#[cfg(test)]
pub fn set_body(conn: &Connection, item_id: &str, body: &str, now: i64) -> Result<(), DbError> {
    set_body_with_links(conn, item_id, body, None, now)
}

/// Replaces the document's text and, in the same transaction, makes the links made by mentioning
/// items in the text (`source_ref` "body") exactly the ones to `mentions`. `None` leaves the
/// links as they are. Mentions of items that cannot be linked are ignored (see `links::sync_source`).
pub fn set_body_with_links(
    conn: &Connection,
    item_id: &str,
    body: &str,
    mentions: Option<&[String]>,
    now: i64,
) -> Result<(), DbError> {
    require_live_document(conn, item_id)?;
    if body.len() > MAX_BODY_BYTES {
        return Err(DbError::Invalid("That document is too long to save."));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO document_content (item_id, body, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (item_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
        params![item_id, body, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    if let Some(targets) = mentions {
        links::sync_source(&tx, item_id, links::BODY, targets, now)?;
    }
    tx.commit()?;
    Ok(())
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

    fn doc(conn: &Connection, camp: &str, name: &str) -> items::Item {
        items::create(conn, camp, "worldbuilding", DOCUMENT_TYPE, name, None, 1).unwrap()
    }

    #[test]
    fn saving_with_mentions_makes_the_links_and_saving_again_updates_them() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        let c = doc(&conn, &camp, "C");
        set_body_with_links(&conn, &a.id, "see B and C", Some(&[b.id.clone(), c.id.clone()]), 2).unwrap();
        assert_eq!(get_body(&conn, &a.id).unwrap(), "see B and C");
        let names = |v: Vec<items::Item>| v.into_iter().map(|i| i.name).collect::<Vec<_>>();
        assert_eq!(names(links::outgoing(&conn, &a.id).unwrap()), ["B", "C"]);
        assert_eq!(names(links::backlinks(&conn, &b.id).unwrap()), ["A"]);

        set_body_with_links(&conn, &a.id, "see C", Some(&[c.id.clone()]), 3).unwrap();
        assert_eq!(names(links::outgoing(&conn, &a.id).unwrap()), ["C"]);

        // None leaves the links alone; the plain save does exactly that.
        set_body(&conn, &a.id, "no mentions left", 4).unwrap();
        assert_eq!(names(links::outgoing(&conn, &a.id).unwrap()), ["C"]);
    }

    #[test]
    fn a_refused_save_makes_no_links() {
        let (conn, camp) = setup();
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        let huge = "x".repeat(MAX_BODY_BYTES + 1);
        assert!(set_body_with_links(&conn, &a.id, &huge, Some(&[b.id.clone()]), 2).is_err());
        assert!(links::outgoing(&conn, &a.id).unwrap().is_empty());
    }

    #[test]
    fn a_new_document_has_an_empty_body() {
        let (conn, camp) = setup();
        let d = doc(&conn, &camp, "Notes");
        assert_eq!(get_body(&conn, &d.id).unwrap(), "");
    }

    #[test]
    fn text_round_trips_exactly_and_can_be_replaced() {
        let (conn, camp) = setup();
        let d = doc(&conn, &camp, "Notes");
        let text = "# Waterdeep\n\n  Indented *line*\twith tab\r\nand unicode: café 🐉\n";
        set_body(&conn, &d.id, text, 10).unwrap();
        assert_eq!(get_body(&conn, &d.id).unwrap(), text);
        set_body(&conn, &d.id, "short", 20).unwrap();
        assert_eq!(get_body(&conn, &d.id).unwrap(), "short");
        set_body(&conn, &d.id, "", 30).unwrap();
        assert_eq!(get_body(&conn, &d.id).unwrap(), "");
    }

    #[test]
    fn saving_marks_the_item_as_updated() {
        let (conn, camp) = setup();
        let d = doc(&conn, &camp, "Notes");
        set_body(&conn, &d.id, "x", 500).unwrap();
        assert_eq!(items::get(&conn, &d.id).unwrap().updated_at, 500);
    }

    #[test]
    fn only_live_documents_have_text() {
        let (conn, camp) = setup();
        let map = items::create(&conn, &camp, "maps", "map", "Map", None, 1).unwrap();
        assert!(matches!(get_body(&conn, &map.id), Err(DbError::Invalid(_))));
        assert!(matches!(set_body(&conn, &map.id, "x", 2), Err(DbError::Invalid(_))));
        assert!(matches!(get_body(&conn, "nope"), Err(DbError::NotFound)));

        let d = doc(&conn, &camp, "Gone");
        set_body(&conn, &d.id, "text", 2).unwrap();
        items::soft_delete(&conn, &d.id, 3).unwrap();
        assert!(matches!(get_body(&conn, &d.id), Err(DbError::NotFound)));
        assert!(matches!(set_body(&conn, &d.id, "new", 4), Err(DbError::NotFound)));
        // The text survives in the trash and returns on restore.
        trash::restore_item(&conn, &d.id, 5).unwrap();
        assert_eq!(get_body(&conn, &d.id).unwrap(), "text");
    }

    #[test]
    fn oversized_text_is_refused_and_leaves_the_old_text() {
        let (conn, camp) = setup();
        let d = doc(&conn, &camp, "Notes");
        set_body(&conn, &d.id, "keep me", 2).unwrap();
        let huge = "a".repeat(MAX_BODY_BYTES + 1);
        assert!(matches!(set_body(&conn, &d.id, &huge, 3), Err(DbError::Invalid(_))));
        assert_eq!(get_body(&conn, &d.id).unwrap(), "keep me");
        set_body(&conn, &d.id, &"a".repeat(MAX_BODY_BYTES), 4).unwrap();
    }

    #[test]
    fn purging_the_item_removes_its_text() {
        let (conn, camp) = setup();
        let d = doc(&conn, &camp, "Notes");
        set_body(&conn, &d.id, "text", 2).unwrap();
        items::soft_delete(&conn, &d.id, 3).unwrap();
        trash::purge_item(&conn, &d.id).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM document_content", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }
}
