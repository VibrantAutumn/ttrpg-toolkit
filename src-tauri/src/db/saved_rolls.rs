//! Saved dice rolls: library items (library `dice`, type `saved_roll`) that keep
//! a finished roll so it can be found, tagged and linked like anything else.

use super::error::DbError;
use super::items::{self, Item};
use rusqlite::{params, Connection};
use serde::Serialize;

pub const SAVED_ROLL_TYPE: &str = "saved_roll";
/// The library saved rolls live in (the Dice tool's).
pub const LIBRARY: &str = "dice";

/// A safety limit (in bytes) on the stored roll, so nothing can bloat the database.
pub const MAX_RESULT_BYTES: usize = 200_000;
const MAX_TEXT_BYTES: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRoll {
    pub item_id: String,
    pub notation: String,
    pub seed: i64,
    /// The readable one-line form, e.g. `2d6+3 → [4, 5] + 3 = 12`.
    pub text: String,
    /// The finished roll as JSON, exactly as the app produced it.
    pub result_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// What the caller supplies; the item itself is created here.
pub struct NewSavedRoll<'a> {
    pub project_id: &'a str,
    /// Item name; the notation is used if this is blank.
    pub name: &'a str,
    pub folder_id: Option<&'a str>,
    pub notation: &'a str,
    pub seed: i64,
    pub text: &'a str,
    pub result_json: &'a str,
}

/// Checks that stored roll data is acceptable (also used when importing packs).
pub fn validate(notation: &str, text: &str, result_json: &str) -> Result<(), DbError> {
    if notation.trim().is_empty() || text.trim().is_empty() {
        return Err(DbError::Invalid("A saved roll needs its notation and result."));
    }
    if text.len() > MAX_TEXT_BYTES || result_json.len() > MAX_RESULT_BYTES {
        return Err(DbError::Invalid("That roll is too large to save."));
    }
    match serde_json::from_str::<serde_json::Value>(result_json) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err(DbError::Invalid("The roll's details couldn't be read.")),
    }
}

/// Saves a roll as a new item in the Dice library. All or nothing.
pub fn create(conn: &Connection, new: NewSavedRoll, now: i64) -> Result<(Item, SavedRoll), DbError> {
    validate(new.notation, new.text, new.result_json)?;
    let name = if new.name.trim().is_empty() { new.notation } else { new.name };
    let tx = conn.unchecked_transaction()?;
    let item = items::create(&tx, new.project_id, LIBRARY, SAVED_ROLL_TYPE, name, new.folder_id, now)?;
    tx.execute(
        "INSERT INTO saved_rolls (item_id, notation, seed, text, result_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![item.id, new.notation, new.seed, new.text, new.result_json, now],
    )?;
    tx.commit()?;
    let roll = get(conn, &item.id)?;
    Ok((item, roll))
}

/// A saved roll's details. Only live saved-roll items have any.
pub fn get(conn: &Connection, item_id: &str) -> Result<SavedRoll, DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != SAVED_ROLL_TYPE {
        return Err(DbError::Invalid("This item isn't a saved roll."));
    }
    conn.query_row(
        "SELECT item_id, notation, seed, text, result_json, created_at, updated_at
         FROM saved_rolls WHERE item_id = ?1",
        [item_id],
        |r| {
            Ok(SavedRoll {
                item_id: r.get(0)?,
                notation: r.get(1)?,
                seed: r.get(2)?,
                text: r.get(3)?,
                result_json: r.get(4)?,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{projects, folders, open_in_memory, search, tags, trash};

    const JSON: &str = r#"{"notation":"2d6+3","total":12,"terms":[]}"#;
    const TEXT: &str = "2d6+3 → [4, 5] + 3 = 12";

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn new<'a>(project: &'a str, name: &'a str) -> NewSavedRoll<'a> {
        NewSavedRoll {
            project_id: project,
            name,
            folder_id: None,
            notation: "2d6+3",
            seed: 4_000_000_000,
            text: TEXT,
            result_json: JSON,
        }
    }

    #[test]
    fn saving_makes_an_item_in_the_dice_library_and_keeps_every_detail() {
        let (conn, camp) = setup();
        let (item, roll) = create(&conn, new(&camp, "Attack roll"), 50).unwrap();
        assert_eq!((item.library.as_str(), item.item_type.as_str()), ("dice", "saved_roll"));
        assert_eq!(item.name, "Attack roll");
        assert_eq!(roll.item_id, item.id);
        assert_eq!(roll.notation, "2d6+3");
        assert_eq!(roll.seed, 4_000_000_000); // bigger than i32: stored whole
        assert_eq!(roll.text, TEXT);
        assert_eq!(roll.result_json, JSON);
        assert_eq!((roll.created_at, roll.updated_at), (50, 50));
        assert_eq!(get(&conn, &item.id).unwrap(), roll);
        assert_eq!(items::list(&conn, &camp, "dice", None).unwrap().len(), 1);
    }

    #[test]
    fn a_blank_name_falls_back_to_the_notation() {
        let (conn, camp) = setup();
        let (item, _) = create(&conn, new(&camp, "   "), 1).unwrap();
        assert_eq!(item.name, "2d6+3");
    }

    #[test]
    fn can_be_saved_into_a_folder_of_the_dice_library() {
        let (conn, camp) = setup();
        let f = folders::create(&conn, &camp, "dice", None, "Combat", 1).unwrap();
        let mut n = new(&camp, "Hit");
        n.folder_id = Some(&f.id);
        let (item, _) = create(&conn, n, 2).unwrap();
        assert_eq!(item.folder_id.as_deref(), Some(f.id.as_str()));
    }

    #[test]
    fn bad_input_is_refused_and_nothing_is_left_behind() {
        let (conn, camp) = setup();
        let mut n = new(&camp, "x");
        n.result_json = "not json";
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        let mut n = new(&camp, "x");
        n.result_json = "[1,2]"; // valid JSON but not an object
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        let mut n = new(&camp, "x");
        n.notation = " ";
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        let mut n = new(&camp, "x");
        n.text = "";
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        let huge = format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_RESULT_BYTES));
        let mut n = new(&camp, "x");
        n.result_json = &huge;
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));

        let missing = new("no-such-project", "x");
        assert!(create(&conn, missing, 1).is_err());
        let items: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 0, "a failed save must not leave a half-made item");
    }

    #[test]
    fn only_live_saved_rolls_have_details() {
        let (conn, camp) = setup();
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 1).unwrap();
        assert!(matches!(get(&conn, &doc.id), Err(DbError::Invalid(_))));
        assert!(matches!(get(&conn, "nope"), Err(DbError::NotFound)));

        let (item, _) = create(&conn, new(&camp, "Roll"), 2).unwrap();
        items::soft_delete(&conn, &item.id, 3).unwrap();
        assert!(matches!(get(&conn, &item.id), Err(DbError::NotFound)));
        trash::restore_item(&conn, &item.id, 4).unwrap();
        assert_eq!(get(&conn, &item.id).unwrap().text, TEXT);
    }

    #[test]
    fn purging_the_item_removes_the_details() {
        let (conn, camp) = setup();
        let (item, _) = create(&conn, new(&camp, "Roll"), 2).unwrap();
        items::soft_delete(&conn, &item.id, 3).unwrap();
        trash::purge_item(&conn, &item.id).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM saved_rolls", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn saved_rolls_are_found_by_name_by_tag_and_by_their_text() {
        let (conn, camp) = setup();
        let (item, _) = create(&conn, new(&camp, "Dragon attack"), 2).unwrap();
        let tag = tags::create(&conn, &camp, None, "Boss", None, 3).unwrap();
        tags::add_to_item(&conn, &item.id, &tag.id, 4).unwrap();

        for query in ["dragon", "boss", "2d6"] {
            let found = search::search(&conn, &camp, query, None, 10).unwrap();
            assert_eq!(found.len(), 1, "searching '{query}'");
            assert_eq!(found[0].id, item.id);
        }
        // Scoped to the Dice library too.
        assert_eq!(search::search(&conn, &camp, "dragon", Some("dice"), 10).unwrap().len(), 1);
        assert!(search::search(&conn, &camp, "dragon", Some("worldbuilding"), 10).unwrap().is_empty());
    }
}
