//! Saved card draws: library items (library `cards`, type `draw`) that keep a
//! finished draw, with the player's own notes, so it can be found, tagged and
//! linked like anything else.

use super::cards::{LIBRARY, MAX_NOTES_BYTES};
use super::error::DbError;
use super::items::{self, Item};
use rusqlite::{params, Connection};
use serde::Serialize;

pub const DRAW_TYPE: &str = "draw";

/// A safety limit (in bytes) on the stored draw, so nothing can bloat the database.
pub const MAX_RESULT_BYTES: usize = 100_000;
const MAX_TEXT_BYTES: usize = 20_000;
const MAX_SOURCE_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDraw {
    pub item_id: String,
    /// The name of the set, deck or pool it was drawn from, as it was then.
    pub source_name: String,
    pub seed: i64,
    /// The readable one-line form, e.g. `Tarot → The Fool, Two of Cups (reversed)`.
    pub text: String,
    /// The finished draw as JSON, exactly as the app produced it.
    pub result_json: String,
    pub notes: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// What the caller supplies; the item itself is created here.
pub struct NewSavedDraw<'a> {
    pub campaign_id: &'a str,
    /// Item name; "<source> draw" is used if this is blank.
    pub name: &'a str,
    pub folder_id: Option<&'a str>,
    pub source_name: &'a str,
    pub seed: i64,
    pub text: &'a str,
    pub result_json: &'a str,
}

/// Checks stored draw data (also used when importing packs).
pub fn validate(source_name: &str, text: &str, result_json: &str, notes: &str) -> Result<(), DbError> {
    if text.trim().is_empty() {
        return Err(DbError::Invalid("A saved draw needs its result."));
    }
    if source_name.chars().count() > MAX_SOURCE_CHARS
        || text.len() > MAX_TEXT_BYTES
        || result_json.len() > MAX_RESULT_BYTES
    {
        return Err(DbError::Invalid("That draw is too large to save."));
    }
    if notes.len() > MAX_NOTES_BYTES {
        return Err(DbError::Invalid("Those notes are too long to save."));
    }
    match serde_json::from_str::<serde_json::Value>(result_json) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err(DbError::Invalid("The draw's details couldn't be read.")),
    }
}

/// Saves a draw as a new item in the Cards library. All or nothing.
pub fn create(conn: &Connection, new: NewSavedDraw, now: i64) -> Result<(Item, SavedDraw), DbError> {
    validate(new.source_name, new.text, new.result_json, "")?;
    let name = if !new.name.trim().is_empty() {
        new.name.to_string()
    } else if !new.source_name.trim().is_empty() {
        format!("{} draw", new.source_name.trim())
    } else {
        "Saved draw".to_string()
    };
    let tx = conn.unchecked_transaction()?;
    let item = items::create(&tx, new.campaign_id, LIBRARY, DRAW_TYPE, &name, new.folder_id, now)?;
    tx.execute(
        "INSERT INTO saved_draws (item_id, source_name, seed, text, result_json, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, '', ?6, ?6)",
        params![item.id, new.source_name, new.seed, new.text, new.result_json, now],
    )?;
    tx.commit()?;
    let draw = get(conn, &item.id)?;
    Ok((item, draw))
}

/// Checks the item exists, is live, and is a saved draw.
fn require_live_draw(conn: &Connection, item_id: &str) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != DRAW_TYPE {
        return Err(DbError::Invalid("This item isn't a saved draw."));
    }
    Ok(())
}

pub fn get(conn: &Connection, item_id: &str) -> Result<SavedDraw, DbError> {
    require_live_draw(conn, item_id)?;
    conn.query_row(
        "SELECT item_id, source_name, seed, text, result_json, notes, created_at, updated_at
         FROM saved_draws WHERE item_id = ?1",
        [item_id],
        |r| {
            Ok(SavedDraw {
                item_id: r.get(0)?,
                source_name: r.get(1)?,
                seed: r.get(2)?,
                text: r.get(3)?,
                result_json: r.get(4)?,
                notes: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

/// Replaces a saved draw's notes. Also marks the item as updated.
pub fn set_notes(conn: &Connection, item_id: &str, notes: &str, now: i64) -> Result<(), DbError> {
    require_live_draw(conn, item_id)?;
    if notes.len() > MAX_NOTES_BYTES {
        return Err(DbError::Invalid("Those notes are too long to save."));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE saved_draws SET notes = ?2, updated_at = ?3 WHERE item_id = ?1",
        params![item_id, notes, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{campaigns, folders, open_in_memory, search, tags, trash};

    const JSON: &str = r#"{"sourceId":"s1","cards":[{"id":"c1","name":"The Fool","reversed":false}]}"#;
    const TEXT: &str = "Tarot → The Fool, Two of Cups (reversed)";

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn new<'a>(campaign: &'a str, name: &'a str) -> NewSavedDraw<'a> {
        NewSavedDraw {
            campaign_id: campaign,
            name,
            folder_id: None,
            source_name: "Tarot",
            seed: 4_000_000_000,
            text: TEXT,
            result_json: JSON,
        }
    }

    #[test]
    fn saving_makes_an_item_in_the_cards_library_and_keeps_every_detail() {
        let (conn, camp) = setup();
        let (item, draw) = create(&conn, new(&camp, "Evening reading"), 50).unwrap();
        assert_eq!((item.library.as_str(), item.item_type.as_str()), ("cards", "draw"));
        assert_eq!(item.name, "Evening reading");
        assert_eq!(draw.item_id, item.id);
        assert_eq!(draw.source_name, "Tarot");
        assert_eq!(draw.seed, 4_000_000_000); // bigger than i32: stored whole
        assert_eq!((draw.text.as_str(), draw.result_json.as_str(), draw.notes.as_str()), (TEXT, JSON, ""));
        assert_eq!((draw.created_at, draw.updated_at), (50, 50));
        assert_eq!(get(&conn, &item.id).unwrap(), draw);
    }

    #[test]
    fn a_blank_name_falls_back_to_the_source_name() {
        let (conn, camp) = setup();
        assert_eq!(create(&conn, new(&camp, "  "), 1).unwrap().0.name, "Tarot draw");
        let mut n = new(&camp, "");
        n.source_name = "";
        assert_eq!(create(&conn, n, 2).unwrap().0.name, "Saved draw");
    }

    #[test]
    fn can_be_saved_into_a_cards_folder() {
        let (conn, camp) = setup();
        let f = folders::create(&conn, &camp, "cards", None, "Readings", 1).unwrap();
        let mut n = new(&camp, "Hit");
        n.folder_id = Some(&f.id);
        let (item, _) = create(&conn, n, 2).unwrap();
        assert_eq!(item.folder_id.as_deref(), Some(f.id.as_str()));
    }

    #[test]
    fn bad_input_is_refused_and_leaves_nothing_behind() {
        let (conn, camp) = setup();
        let mut n = new(&camp, "x");
        n.result_json = "not json";
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        let mut n = new(&camp, "x");
        n.result_json = "[1]";
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        let mut n = new(&camp, "x");
        n.text = "  ";
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        let huge = format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_RESULT_BYTES));
        let mut n = new(&camp, "x");
        n.result_json = &huge;
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        assert!(create(&conn, new("no-such-campaign", "x"), 1).is_err());
        let items: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 0, "a failed save must not leave a half-made item");
    }

    #[test]
    fn notes_can_be_edited_and_mark_the_item_updated() {
        let (conn, camp) = setup();
        let (item, _) = create(&conn, new(&camp, "Reading"), 10).unwrap();
        set_notes(&conn, &item.id, "The Fool means a fresh start — café ☀", 99).unwrap();
        let d = get(&conn, &item.id).unwrap();
        assert_eq!((d.notes.as_str(), d.updated_at, d.created_at), ("The Fool means a fresh start — café ☀", 99, 10));
        assert_eq!(items::get(&conn, &item.id).unwrap().updated_at, 99);
        let long = "x".repeat(MAX_NOTES_BYTES + 1);
        assert!(matches!(set_notes(&conn, &item.id, &long, 100), Err(DbError::Invalid(_))));
        assert_eq!(get(&conn, &item.id).unwrap().notes, "The Fool means a fresh start — café ☀");
        set_notes(&conn, &item.id, "", 101).unwrap();
        assert_eq!(get(&conn, &item.id).unwrap().notes, "");
    }

    #[test]
    fn only_live_saved_draws_can_be_read_or_changed() {
        let (conn, camp) = setup();
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 1).unwrap();
        assert!(matches!(get(&conn, &doc.id), Err(DbError::Invalid(_))));
        assert!(matches!(set_notes(&conn, &doc.id, "x", 2), Err(DbError::Invalid(_))));
        assert!(matches!(get(&conn, "nope"), Err(DbError::NotFound)));

        let (item, _) = create(&conn, new(&camp, "Reading"), 2).unwrap();
        set_notes(&conn, &item.id, "keep", 3).unwrap();
        items::soft_delete(&conn, &item.id, 4).unwrap();
        assert!(matches!(get(&conn, &item.id), Err(DbError::NotFound)));
        assert!(matches!(set_notes(&conn, &item.id, "new", 5), Err(DbError::NotFound)));
        trash::restore_item(&conn, &item.id, 6).unwrap();
        assert_eq!(get(&conn, &item.id).unwrap().notes, "keep");
    }

    #[test]
    fn purging_the_item_removes_the_details() {
        let (conn, camp) = setup();
        let (item, _) = create(&conn, new(&camp, "Reading"), 2).unwrap();
        items::soft_delete(&conn, &item.id, 3).unwrap();
        trash::purge_item(&conn, &item.id).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM saved_draws", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn saved_draws_are_found_by_name_tag_card_names_and_notes() {
        let (conn, camp) = setup();
        let (item, _) = create(&conn, new(&camp, "Evening reading"), 2).unwrap();
        let tag = tags::create(&conn, &camp, None, "Omen", None, 3).unwrap();
        tags::add_to_item(&conn, &item.id, &tag.id, 4).unwrap();
        set_notes(&conn, &item.id, "a hopeful journey", 5).unwrap();
        for query in ["evening", "omen", "fool", "journey"] {
            let found = search::search(&conn, &camp, query, Some("cards"), 10).unwrap();
            assert_eq!(found.len(), 1, "searching '{query}'");
            assert_eq!(found[0].id, item.id);
        }
        // Editing the notes updates what search sees.
        set_notes(&conn, &item.id, "", 6).unwrap();
        assert!(search::search(&conn, &camp, "journey", None, 10).unwrap().is_empty());
        assert_eq!(search::search(&conn, &camp, "fool", None, 10).unwrap().len(), 1);
    }
}
