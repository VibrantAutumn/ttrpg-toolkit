//! Saved dice formulas: library items (library `dice`, type `formula`) that keep
//! a notation like `1d20+5` under a name like "Attack".

use super::error::DbError;
use super::items::{self, Item};
use rusqlite::{params, Connection};
use serde::Serialize;

pub const FORMULA_TYPE: &str = "formula";
/// The library formulas live in (the Dice tool's).
pub const LIBRARY: &str = "dice";

/// Longest notation kept (the app checks the same limit before saving).
pub const MAX_NOTATION_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Formula {
    pub item_id: String,
    pub notation: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One row of the flat "all my formulas" list the roller shows.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaEntry {
    pub item_id: String,
    pub name: String,
    pub notation: String,
    pub folder_id: Option<String>,
}

/// Checks stored formula text (also used when importing packs). Whether it is
/// valid dice notation is the app's parser's job, not the database's.
pub fn validate(notation: &str) -> Result<(), DbError> {
    if notation.trim().is_empty() {
        return Err(DbError::Invalid("A formula can't be empty."));
    }
    if notation.chars().count() > MAX_NOTATION_CHARS {
        return Err(DbError::Invalid("That formula is too long."));
    }
    Ok(())
}

/// Saves a formula as a new item in the Dice library. All or nothing.
/// A blank name falls back to the notation.
pub fn create(
    conn: &Connection,
    campaign_id: &str,
    name: &str,
    folder_id: Option<&str>,
    notation: &str,
    now: i64,
) -> Result<Item, DbError> {
    let notation = notation.trim();
    validate(notation)?;
    let name = if name.trim().is_empty() { notation } else { name };
    let tx = conn.unchecked_transaction()?;
    let item = items::create(&tx, campaign_id, LIBRARY, FORMULA_TYPE, name, folder_id, now)?;
    tx.execute(
        "INSERT INTO formulas (item_id, notation, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![item.id, notation, now],
    )?;
    tx.commit()?;
    Ok(item)
}

/// Checks the item exists, is live, and is a formula.
fn require_live_formula(conn: &Connection, item_id: &str) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != FORMULA_TYPE {
        return Err(DbError::Invalid("This item isn't a formula."));
    }
    Ok(())
}

pub fn get(conn: &Connection, item_id: &str) -> Result<Formula, DbError> {
    require_live_formula(conn, item_id)?;
    conn.query_row(
        "SELECT item_id, notation, created_at, updated_at FROM formulas WHERE item_id = ?1",
        [item_id],
        |r| {
            Ok(Formula {
                item_id: r.get(0)?,
                notation: r.get(1)?,
                created_at: r.get(2)?,
                updated_at: r.get(3)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

/// Changes a formula's notation. Also marks the item as updated.
pub fn set_notation(conn: &Connection, item_id: &str, notation: &str, now: i64) -> Result<(), DbError> {
    let notation = notation.trim();
    validate(notation)?;
    require_live_formula(conn, item_id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE formulas SET notation = ?2, updated_at = ?3 WHERE item_id = ?1",
        params![item_id, notation, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Every live formula in a campaign (any folder), alphabetical.
pub fn list(conn: &Connection, campaign_id: &str) -> Result<Vec<FormulaEntry>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, f.notation, i.folder_id
         FROM formulas f JOIN items i ON i.id = f.item_id
         WHERE i.campaign_id = ?1 AND i.deleted_at IS NULL
         ORDER BY i.name COLLATE NOCASE, i.created_at",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(FormulaEntry {
            item_id: r.get(0)?,
            name: r.get(1)?,
            notation: r.get(2)?,
            folder_id: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{campaigns, folders, open_in_memory, search, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    #[test]
    fn a_formula_is_an_item_in_the_dice_library_with_its_notation() {
        let (conn, camp) = setup();
        let item = create(&conn, &camp, "Attack", None, "  1d20+5 ", 50).unwrap();
        assert_eq!((item.library.as_str(), item.item_type.as_str()), ("dice", "formula"));
        assert_eq!(item.name, "Attack");
        let f = get(&conn, &item.id).unwrap();
        assert_eq!(f.notation, "1d20+5"); // outer spaces removed
        assert_eq!((f.created_at, f.updated_at), (50, 50));
    }

    #[test]
    fn a_blank_name_falls_back_to_the_notation() {
        let (conn, camp) = setup();
        assert_eq!(create(&conn, &camp, "  ", None, "2d6", 1).unwrap().name, "2d6");
    }

    #[test]
    fn can_be_created_in_a_dice_folder() {
        let (conn, camp) = setup();
        let folder = folders::create(&conn, &camp, "dice", None, "Combat", 1).unwrap();
        let item = create(&conn, &camp, "Hit", Some(&folder.id), "1d20", 2).unwrap();
        assert_eq!(item.folder_id.as_deref(), Some(folder.id.as_str()));
    }

    #[test]
    fn empty_or_overlong_notation_is_refused_and_leaves_nothing_behind() {
        let (conn, camp) = setup();
        assert!(matches!(create(&conn, &camp, "x", None, "   ", 1), Err(DbError::Invalid(_))));
        let long = "1".repeat(MAX_NOTATION_CHARS + 1);
        assert!(matches!(create(&conn, &camp, "x", None, &long, 1), Err(DbError::Invalid(_))));
        create(&conn, &camp, "ok", None, &"1".repeat(MAX_NOTATION_CHARS), 1).unwrap();
        assert!(create(&conn, "no-such-campaign", "x", None, "1d6", 1).is_err());
        let items: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 1, "only the one good formula exists");
    }

    #[test]
    fn the_notation_can_be_changed_and_marks_the_item_updated() {
        let (conn, camp) = setup();
        let item = create(&conn, &camp, "Attack", None, "1d20+5", 10).unwrap();
        set_notation(&conn, &item.id, " 1d20+7 ", 99).unwrap();
        let f = get(&conn, &item.id).unwrap();
        assert_eq!((f.notation.as_str(), f.updated_at, f.created_at), ("1d20+7", 99, 10));
        assert_eq!(items::get(&conn, &item.id).unwrap().updated_at, 99);
        assert!(matches!(set_notation(&conn, &item.id, "", 100), Err(DbError::Invalid(_))));
        assert_eq!(get(&conn, &item.id).unwrap().notation, "1d20+7");
    }

    #[test]
    fn only_live_formulas_can_be_read_or_changed() {
        let (conn, camp) = setup();
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 1).unwrap();
        assert!(matches!(get(&conn, &doc.id), Err(DbError::Invalid(_))));
        assert!(matches!(set_notation(&conn, &doc.id, "1d6", 2), Err(DbError::Invalid(_))));
        assert!(matches!(get(&conn, "nope"), Err(DbError::NotFound)));

        let item = create(&conn, &camp, "Gone", None, "1d6", 2).unwrap();
        items::soft_delete(&conn, &item.id, 3).unwrap();
        assert!(matches!(get(&conn, &item.id), Err(DbError::NotFound)));
        assert!(matches!(set_notation(&conn, &item.id, "1d8", 4), Err(DbError::NotFound)));
        trash::restore_item(&conn, &item.id, 5).unwrap();
        assert_eq!(get(&conn, &item.id).unwrap().notation, "1d6");
    }

    #[test]
    fn list_gives_every_live_formula_alphabetically_across_folders() {
        let (conn, camp) = setup();
        let folder = folders::create(&conn, &camp, "dice", None, "Combat", 1).unwrap();
        create(&conn, &camp, "damage", Some(&folder.id), "1d8+3", 2).unwrap();
        create(&conn, &camp, "Attack", None, "1d20+5", 3).unwrap();
        let gone = create(&conn, &camp, "Gone", None, "1d4", 4).unwrap();
        items::soft_delete(&conn, &gone.id, 5).unwrap();
        // Another campaign's formulas and other kinds of items stay out.
        let other = campaigns::create(&conn, "Other", 6).unwrap();
        create(&conn, &other.id, "Elsewhere", None, "1d6", 7).unwrap();
        items::create(&conn, &camp, "dice", "saved_roll", "Not a formula", None, 8).unwrap();

        let list = list(&conn, &camp).unwrap();
        let summary: Vec<_> = list.iter().map(|f| (f.name.as_str(), f.notation.as_str())).collect();
        assert_eq!(summary, [("Attack", "1d20+5"), ("damage", "1d8+3")]);
        assert_eq!(list[1].folder_id.as_deref(), Some(folder.id.as_str()));
    }

    #[test]
    fn purging_the_item_removes_the_notation() {
        let (conn, camp) = setup();
        let item = create(&conn, &camp, "Attack", None, "1d20", 2).unwrap();
        items::soft_delete(&conn, &item.id, 3).unwrap();
        trash::purge_item(&conn, &item.id).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM formulas", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn formulas_are_found_by_name_and_by_notation_and_follow_edits() {
        let (conn, camp) = setup();
        let item = create(&conn, &camp, "Sword attack", None, "1d20+5", 2).unwrap();
        for query in ["sword", "1d20"] {
            let found = search::search(&conn, &camp, query, Some("dice"), 10).unwrap();
            assert_eq!(found.len(), 1, "searching '{query}'");
        }
        set_notation(&conn, &item.id, "2d6+1", 3).unwrap();
        assert_eq!(search::search(&conn, &camp, "2d6", None, 10).unwrap().len(), 1);
        assert!(search::search(&conn, &camp, "1d20", None, 10).unwrap().is_empty());
    }
}
