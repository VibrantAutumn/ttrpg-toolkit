//! Card spreads: library items (library `cards`, type `spread`) that keep a
//! reading's named positions, each pointing at one set, deck or pool to draw
//! from, plus the player's notes on how to read it.
//!
//! The drawing rules live in the app's TypeScript (`src/lib/cards/spread.ts`);
//! this keeps the preset safely.

use super::cards::{DECK_TYPE, LIBRARY, MAX_NOTES_BYTES, POOL_TYPE, SET_TYPE};
use super::error::DbError;
use super::items;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const SPREAD_TYPE: &str = "spread";
pub const MIN_POSITIONS: usize = 3;
pub const MAX_POSITIONS: usize = 10;
pub const MAX_NAME_CHARS: usize = 60;
pub const MAX_MEANING_BYTES: usize = 2_000;

/// A position as it is stored and shown.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub name: String,
    /// The set, deck or pool this position draws from (None until one is chosen).
    pub source_id: Option<String>,
    /// That source's name, if it is live.
    pub source_name: Option<String>,
    /// A source was chosen but is gone (deleted or in the trash): it needs choosing again.
    pub source_missing: bool,
    pub meaning: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Spread {
    pub item_id: String,
    pub notes: String,
    pub reversals: bool,
    pub reversal_percent: i64,
    pub positions: Vec<Position>,
}

/// What the app sends when saving positions.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionInput {
    pub name: String,
    pub source_id: Option<String>,
    #[serde(default)]
    pub meaning: String,
}

/// One row of the "spreads" list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadEntry {
    pub item_id: String,
    pub name: String,
    pub positions: i64,
    /// Enough positions, and every one has a live source: it can be drawn.
    pub ready: bool,
}

/// Checks the item exists, is live, and is a spread.
fn require_live_spread(conn: &Connection, item_id: &str) -> Result<items::Item, DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != SPREAD_TYPE {
        return Err(DbError::Invalid("This item isn't a spread."));
    }
    Ok(item)
}

/// Checks a position's text (also used when importing packs).
pub fn validate_position(name: &str, meaning: &str) -> Result<(), DbError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(DbError::Invalid("Every position needs a name."));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(DbError::Invalid("A position's name is too long."));
    }
    if meaning.len() > MAX_MEANING_BYTES {
        return Err(DbError::Invalid("A position's meaning is too long."));
    }
    Ok(())
}

/// A spread's notes, reversal settings and positions (in order).
pub fn get(conn: &Connection, item_id: &str) -> Result<Spread, DbError> {
    require_live_spread(conn, item_id)?;
    let settings: Option<(String, bool, i64)> = conn
        .query_row(
            "SELECT notes, reversals, reversal_percent FROM spreads WHERE item_id = ?1",
            [item_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (notes, reversals, reversal_percent) = settings.unwrap_or((String::new(), true, 50));

    let mut stmt = conn.prepare(
        "SELECT p.name, p.source_id, s.name, s.deleted_at, s.item_type, p.meaning
         FROM spread_positions p LEFT JOIN items s ON s.id = p.source_id
         WHERE p.spread_id = ?1 ORDER BY p.position",
    )?;
    let rows = stmt.query_map([item_id], |r| {
        let source_id: Option<String> = r.get(1)?;
        let source_name: Option<String> = r.get(2)?;
        let source_deleted: Option<i64> = r.get(3)?;
        let source_type: Option<String> = r.get(4)?;
        let live = source_name.is_some()
            && source_deleted.is_none()
            && source_type.as_deref().is_some_and(|t| [SET_TYPE, DECK_TYPE, POOL_TYPE].contains(&t));
        Ok(Position {
            name: r.get(0)?,
            source_missing: source_id.is_some() && !live,
            source_name: if live { source_name } else { None },
            source_id,
            meaning: r.get(5)?,
        })
    })?;
    Ok(Spread {
        item_id: item_id.to_string(),
        notes,
        reversals,
        reversal_percent,
        positions: rows.collect::<Result<Vec<_>, _>>()?,
    })
}

/// Replaces the spread's positions (3 to 10, in order). All or nothing.
pub fn set_positions(conn: &Connection, item_id: &str, positions: &[PositionInput], now: i64) -> Result<(), DbError> {
    let spread = require_live_spread(conn, item_id)?;
    if positions.len() < MIN_POSITIONS || positions.len() > MAX_POSITIONS {
        return Err(DbError::Invalid("A spread needs between 3 and 10 positions."));
    }
    for p in positions {
        validate_position(&p.name, &p.meaning)?;
        if let Some(source) = &p.source_id {
            let source = items::get(conn, source).map_err(|e| match e {
                DbError::NotFound => DbError::Invalid("A position's source no longer exists."),
                other => other,
            })?;
            if source.deleted_at.is_some() {
                return Err(DbError::Invalid("A position's source is in the trash."));
            }
            if source.project_id != spread.project_id {
                return Err(DbError::Invalid("A position's source is in a different project."));
            }
            if source.library != LIBRARY || ![SET_TYPE, DECK_TYPE, POOL_TYPE].contains(&source.item_type.as_str()) {
                return Err(DbError::Invalid("A position can only draw from a set, deck or pool."));
            }
        }
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM spread_positions WHERE spread_id = ?1", [item_id])?;
    for (i, p) in positions.iter().enumerate() {
        tx.execute(
            "INSERT INTO spread_positions (spread_id, position, name, source_id, meaning)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![item_id, i as i64 + 1, p.name.trim(), p.source_id, p.meaning],
        )?;
    }
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Replaces the notes on how to read the spread.
pub fn set_notes(conn: &Connection, item_id: &str, notes: &str, now: i64) -> Result<(), DbError> {
    require_live_spread(conn, item_id)?;
    if notes.len() > MAX_NOTES_BYTES {
        return Err(DbError::Invalid("Those notes are too long to save."));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO spreads (item_id, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (item_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at",
        params![item_id, notes, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Sets whether cards can come up reversed in this spread, and how often (0 to 100).
pub fn set_reversals(conn: &Connection, item_id: &str, reversals: bool, percent: i64, now: i64) -> Result<(), DbError> {
    require_live_spread(conn, item_id)?;
    if !(0..=100).contains(&percent) {
        return Err(DbError::Invalid("The reversal chance must be between 0 and 100."));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO spreads (item_id, reversals, reversal_percent, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (item_id) DO UPDATE
             SET reversals = excluded.reversals, reversal_percent = excluded.reversal_percent,
                 updated_at = excluded.updated_at",
        params![item_id, reversals, percent, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Every live spread in a project (any folder), alphabetical, and whether it can be drawn.
pub fn list(conn: &Connection, project_id: &str) -> Result<Vec<SpreadEntry>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name,
                (SELECT COUNT(*) FROM spread_positions p WHERE p.spread_id = i.id),
                (SELECT COUNT(*) FROM spread_positions p JOIN items s ON s.id = p.source_id
                 WHERE p.spread_id = i.id AND s.deleted_at IS NULL
                   AND s.item_type IN ('set', 'deck', 'pool'))
         FROM items i
         WHERE i.project_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
         ORDER BY i.name COLLATE NOCASE, i.created_at",
    )?;
    let rows = stmt.query_map(params![project_id, LIBRARY, SPREAD_TYPE], |r| {
        let (total, with_source): (i64, i64) = (r.get(2)?, r.get(3)?);
        Ok(SpreadEntry {
            item_id: r.get(0)?,
            name: r.get(1)?,
            positions: total,
            ready: total >= MIN_POSITIONS as i64 && with_source == total,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{projects, folders, open_in_memory, search, tags, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn make(conn: &Connection, camp: &str, kind: &str, name: &str) -> items::Item {
        items::create(conn, camp, LIBRARY, kind, name, None, 1).unwrap()
    }

    fn input(name: &str, source: Option<&str>) -> PositionInput {
        PositionInput { name: name.into(), source_id: source.map(String::from), meaning: String::new() }
    }

    fn three(source: &str) -> Vec<PositionInput> {
        vec![input("Past", Some(source)), input("Present", Some(source)), input("Future", None)]
    }

    #[test]
    fn a_new_spread_has_no_positions_empty_notes_and_default_reversals() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        assert_eq!(
            get(&conn, &s.id).unwrap(),
            Spread { item_id: s.id.clone(), notes: String::new(), reversals: true, reversal_percent: 50, positions: vec![] }
        );
    }

    #[test]
    fn positions_round_trip_in_order_with_their_sources_and_meanings() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        let deck = make(&conn, &camp, DECK_TYPE, "Tarot");
        let pool = make(&conn, &camp, POOL_TYPE, "Omens");
        let positions = vec![
            PositionInput { name: "  Tome ".into(), source_id: Some(deck.id.clone()), meaning: "The history".into() },
            input("Icon", Some(&pool.id)),
            input("Unchosen", None),
        ];
        set_positions(&conn, &s.id, &positions, 50).unwrap();
        let got = get(&conn, &s.id).unwrap().positions;
        assert_eq!(got.len(), 3);
        assert_eq!((got[0].name.as_str(), got[0].meaning.as_str()), ("Tome", "The history")); // name trimmed
        assert_eq!((got[0].source_id.as_deref(), got[0].source_name.as_deref()), (Some(deck.id.as_str()), Some("Tarot")));
        assert!(!got[0].source_missing);
        assert_eq!(got[1].source_name.as_deref(), Some("Omens"));
        assert_eq!((got[2].source_id.clone(), got[2].source_missing), (None, false));
        assert_eq!(items::get(&conn, &s.id).unwrap().updated_at, 50);
    }

    #[test]
    fn saving_again_replaces_the_positions_entirely() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        let deck = make(&conn, &camp, DECK_TYPE, "Tarot");
        set_positions(&conn, &s.id, &three(&deck.id), 2).unwrap();
        let next = vec![input("A", None), input("B", None), input("C", None), input("D", None)];
        set_positions(&conn, &s.id, &next, 3).unwrap();
        let names: Vec<_> = get(&conn, &s.id).unwrap().positions.into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["A", "B", "C", "D"]);
    }

    #[test]
    fn three_to_ten_positions_only() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        let n = |count: usize| (0..count).map(|i| input(&format!("P{i}"), None)).collect::<Vec<_>>();
        assert!(matches!(set_positions(&conn, &s.id, &n(2), 2), Err(DbError::Invalid(_))));
        assert!(matches!(set_positions(&conn, &s.id, &n(11), 2), Err(DbError::Invalid(_))));
        set_positions(&conn, &s.id, &n(3), 2).unwrap();
        set_positions(&conn, &s.id, &n(10), 3).unwrap();
        // A refused save keeps what was there.
        assert!(set_positions(&conn, &s.id, &n(1), 4).is_err());
        assert_eq!(get(&conn, &s.id).unwrap().positions.len(), 10);
    }

    #[test]
    fn bad_positions_are_refused_and_the_old_ones_stay() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        let deck = make(&conn, &camp, DECK_TYPE, "Tarot");
        set_positions(&conn, &s.id, &three(&deck.id), 2).unwrap();
        let other = projects::create(&conn, "Other", 3).unwrap();
        let foreign = make(&conn, &other.id, DECK_TYPE, "Foreign");
        let card = make(&conn, &camp, "card", "A card");
        let trashed = make(&conn, &camp, DECK_TYPE, "Trashed");
        items::soft_delete(&conn, &trashed.id, 4).unwrap();
        let doc = items::create(&conn, &camp, "worldbuilding", SET_TYPE, "Impostor", None, 1).unwrap();

        let with = |p: PositionInput| vec![p, input("B", None), input("C", None)];
        let long_name = "n".repeat(MAX_NAME_CHARS + 1);
        let long_meaning = "m".repeat(MAX_MEANING_BYTES + 1);
        let cases: Vec<(&str, Vec<PositionInput>)> = vec![
            ("blank name", with(input("  ", None))),
            ("name too long", with(input(&long_name, None))),
            ("meaning too long", with(PositionInput { name: "A".into(), source_id: None, meaning: long_meaning })),
            ("source that doesn't exist", with(input("A", Some("nope")))),
            ("source from another project", with(input("A", Some(&foreign.id)))),
            ("a card as the source", with(input("A", Some(&card.id)))),
            ("a trashed source", with(input("A", Some(&trashed.id)))),
            ("a set from another tool's library", with(input("A", Some(&doc.id)))),
        ];
        for (what, positions) in cases {
            assert!(matches!(set_positions(&conn, &s.id, &positions, 5), Err(DbError::Invalid(_))), "{what}");
        }
        let kept: Vec<_> = get(&conn, &s.id).unwrap().positions.into_iter().map(|p| p.name).collect();
        assert_eq!(kept, ["Past", "Present", "Future"]);
    }

    #[test]
    fn a_source_that_goes_to_the_trash_is_flagged_and_comes_back_on_restore() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        let deck = make(&conn, &camp, DECK_TYPE, "Tarot");
        set_positions(&conn, &s.id, &three(&deck.id), 2).unwrap();
        items::soft_delete(&conn, &deck.id, 3).unwrap();
        let p = &get(&conn, &s.id).unwrap().positions[0];
        assert_eq!((p.source_missing, p.source_name.clone()), (true, None));
        assert_eq!(p.source_id.as_deref(), Some(deck.id.as_str())); // still remembered
        trash::restore_item(&conn, &deck.id, 4).unwrap();
        let p = &get(&conn, &s.id).unwrap().positions[0];
        assert_eq!((p.source_missing, p.source_name.clone()), (false, Some("Tarot".to_string())));
    }

    #[test]
    fn a_source_deleted_for_good_leaves_its_position_in_place_with_no_source() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        let deck = make(&conn, &camp, DECK_TYPE, "Tarot");
        set_positions(&conn, &s.id, &three(&deck.id), 2).unwrap();
        items::soft_delete(&conn, &deck.id, 3).unwrap();
        trash::purge_item(&conn, &deck.id).unwrap();
        let positions = get(&conn, &s.id).unwrap().positions;
        assert_eq!(positions.len(), 3);
        assert_eq!(positions[0].name, "Past");
        assert_eq!((positions[0].source_id.clone(), positions[0].source_missing), (None, false));
    }

    #[test]
    fn notes_and_reversal_settings_are_saved_separately_and_validated() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        set_notes(&conn, &s.id, "Read left to right — café ☀", 10).unwrap();
        set_reversals(&conn, &s.id, false, 25, 11).unwrap();
        let got = get(&conn, &s.id).unwrap();
        assert_eq!(
            (got.notes.as_str(), got.reversals, got.reversal_percent),
            ("Read left to right — café ☀", false, 25)
        );
        // Changing one leaves the other alone.
        set_notes(&conn, &s.id, "new", 12).unwrap();
        assert_eq!(get(&conn, &s.id).unwrap().reversal_percent, 25);
        set_reversals(&conn, &s.id, true, 0, 13).unwrap();
        assert_eq!(get(&conn, &s.id).unwrap().notes, "new");
        assert_eq!(items::get(&conn, &s.id).unwrap().updated_at, 13);

        assert!(matches!(set_reversals(&conn, &s.id, true, 101, 14), Err(DbError::Invalid(_))));
        assert!(matches!(set_reversals(&conn, &s.id, true, -1, 14), Err(DbError::Invalid(_))));
        let long = "x".repeat(MAX_NOTES_BYTES + 1);
        assert!(matches!(set_notes(&conn, &s.id, &long, 14), Err(DbError::Invalid(_))));
        assert_eq!(get(&conn, &s.id).unwrap().notes, "new");
    }

    #[test]
    fn only_live_spreads_can_be_read_or_changed() {
        let (conn, camp) = setup();
        let deck = make(&conn, &camp, DECK_TYPE, "Tarot");
        assert!(matches!(get(&conn, &deck.id), Err(DbError::Invalid(_))));
        assert!(matches!(set_notes(&conn, &deck.id, "x", 2), Err(DbError::Invalid(_))));
        assert!(matches!(get(&conn, "nope"), Err(DbError::NotFound)));
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        set_positions(&conn, &s.id, &three(&deck.id), 2).unwrap();
        items::soft_delete(&conn, &s.id, 3).unwrap();
        assert!(matches!(get(&conn, &s.id), Err(DbError::NotFound)));
        assert!(matches!(set_positions(&conn, &s.id, &three(&deck.id), 4), Err(DbError::NotFound)));
        trash::restore_item(&conn, &s.id, 5).unwrap();
        assert_eq!(get(&conn, &s.id).unwrap().positions.len(), 3);
    }

    #[test]
    fn list_shows_live_spreads_and_whether_they_are_ready_to_draw() {
        let (conn, camp) = setup();
        let other = projects::create(&conn, "Other", 2).unwrap();
        let deck = make(&conn, &camp, DECK_TYPE, "Tarot");
        let folder = folders::create(&conn, &camp, LIBRARY, None, "Readings", 1).unwrap();

        let ready = items::create(&conn, &camp, LIBRARY, SPREAD_TYPE, "beta ready", Some(&folder.id), 1).unwrap();
        set_positions(&conn, &ready.id, &[input("A", Some(&deck.id)), input("B", Some(&deck.id)), input("C", Some(&deck.id))], 2).unwrap();
        let unfinished = make(&conn, &camp, SPREAD_TYPE, "Alpha unfinished");
        set_positions(&conn, &unfinished.id, &three(&deck.id), 2).unwrap(); // one position has no source
        let empty = make(&conn, &camp, SPREAD_TYPE, "Gamma empty");
        let gone = make(&conn, &camp, SPREAD_TYPE, "Trashed");
        items::soft_delete(&conn, &gone.id, 3).unwrap();
        make(&conn, &other.id, SPREAD_TYPE, "Elsewhere");
        make(&conn, &camp, DECK_TYPE, "Not a spread");

        let got: Vec<_> = list(&conn, &camp).unwrap().into_iter().map(|e| (e.name, e.positions, e.ready)).collect();
        assert_eq!(
            got,
            [
                ("Alpha unfinished".to_string(), 3, false),
                ("beta ready".to_string(), 3, true),
                ("Gamma empty".to_string(), 0, false),
            ]
        );
        // Trashing a source makes the spread not ready; restoring it fixes that.
        items::soft_delete(&conn, &deck.id, 4).unwrap();
        assert!(!list(&conn, &camp).unwrap().iter().any(|e| e.ready));
        trash::restore_item(&conn, &deck.id, 5).unwrap();
        assert!(list(&conn, &camp).unwrap().iter().any(|e| e.name == "beta ready" && e.ready));
        let _ = empty;
    }

    #[test]
    fn purging_the_spread_removes_everything() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Reading");
        set_positions(&conn, &s.id, &three("nope-never-used").iter().map(|p| input(&p.name, None)).collect::<Vec<_>>(), 2).unwrap();
        set_notes(&conn, &s.id, "n", 3).unwrap();
        items::soft_delete(&conn, &s.id, 4).unwrap();
        trash::purge_item(&conn, &s.id).unwrap();
        for table in ["spreads", "spread_positions"] {
            let rows: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
            assert_eq!(rows, 0, "{table}");
        }
    }

    #[test]
    fn a_spread_is_found_by_name_tag_notes_and_position_names() {
        let (conn, camp) = setup();
        let s = make(&conn, &camp, SPREAD_TYPE, "Strahd reading");
        let tag = tags::create(&conn, &camp, None, "Project", None, 2).unwrap();
        tags::add_to_item(&conn, &s.id, &tag.id, 3).unwrap();
        set_positions(&conn, &s.id, &[input("Tome", None), input("Icon", None), input("Enemy", None)], 4).unwrap();
        set_notes(&conn, &s.id, "Read it aloud slowly", 5).unwrap();
        for q in ["strahd", "project", "tome", "enemy", "aloud"] {
            assert_eq!(search::search(&conn, &camp, q, Some("cards"), 10).unwrap().len(), 1, "'{q}'");
        }
        // Changing the positions or notes updates what search sees, in either order.
        set_positions(&conn, &s.id, &[input("Alpha", None), input("Beta", None), input("Gamma", None)], 6).unwrap();
        assert!(search::search(&conn, &camp, "tome", None, 10).unwrap().is_empty());
        assert_eq!(search::search(&conn, &camp, "beta", None, 10).unwrap().len(), 1);
        assert_eq!(search::search(&conn, &camp, "aloud", None, 10).unwrap().len(), 1, "notes survive new positions");
        set_notes(&conn, &s.id, "", 7).unwrap();
        assert!(search::search(&conn, &camp, "aloud", None, 10).unwrap().is_empty());
        assert_eq!(search::search(&conn, &camp, "gamma", None, 10).unwrap().len(), 1, "positions survive new notes");
    }
}
