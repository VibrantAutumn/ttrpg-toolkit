//! Decks in play: library items (library `cards`, type `play`) that keep a
//! running game: cards left in a shuffled copy of a deck, and a discard pile.
//! The rules live in the app's TypeScript (`src/lib/cards/play.ts`); this keeps
//! the game's state safely, as JSON.

use super::cards::LIBRARY;
use super::error::DbError;
use super::items::{self, Item};
use rusqlite::{params, Connection};
use serde::Serialize;

pub const PLAY_TYPE: &str = "play";

/// A safety limit (in bytes) on one game's state, so nothing can bloat the database.
pub const MAX_STATE_BYTES: usize = 500_000;
const MAX_SOURCE_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayDeck {
    pub item_id: String,
    /// The set, deck or pool the cards were copied from (it may be gone now).
    pub source_id: Option<String>,
    pub source_name: String,
    pub state_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One row of the "decks in play" list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayDeckEntry {
    pub item_id: String,
    pub name: String,
    pub source_name: String,
    /// Cards still in the deck, and cards in the discard pile (0 if the state can't be read).
    pub remaining: i64,
    pub drawn: i64,
}

/// What the caller supplies; the item itself is created here.
pub struct NewPlayDeck<'a> {
    pub project_id: &'a str,
    /// Item name; "<source> in play" is used if this is blank.
    pub name: &'a str,
    pub folder_id: Option<&'a str>,
    pub source_id: Option<&'a str>,
    pub source_name: &'a str,
    pub state_json: &'a str,
}

/// Checks stored game data (also used when importing packs).
pub fn validate(source_name: &str, state_json: &str) -> Result<(), DbError> {
    if source_name.chars().count() > MAX_SOURCE_CHARS || state_json.len() > MAX_STATE_BYTES {
        return Err(DbError::Invalid("That game is too large to save."));
    }
    match serde_json::from_str::<serde_json::Value>(state_json) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err(DbError::Invalid("The game's state couldn't be read.")),
    }
}

/// How many cards are in the deck and in the discard pile, from the state's JSON.
fn counts(state_json: &str) -> (i64, i64) {
    let value: serde_json::Value = serde_json::from_str(state_json).unwrap_or(serde_json::Value::Null);
    let len = |key: &str| value.get(key).and_then(|v| v.as_array()).map_or(0, |a| a.len() as i64);
    (len("deck"), len("drawn"))
}

/// Starts a new deck in play as an item in the Cards library. All or nothing.
pub fn create(conn: &Connection, new: NewPlayDeck, now: i64) -> Result<(Item, PlayDeck), DbError> {
    validate(new.source_name, new.state_json)?;
    let name = if !new.name.trim().is_empty() {
        new.name.to_string()
    } else if !new.source_name.trim().is_empty() {
        format!("{} in play", new.source_name.trim())
    } else {
        "Deck in play".to_string()
    };
    let tx = conn.unchecked_transaction()?;
    let item = items::create(&tx, new.project_id, LIBRARY, PLAY_TYPE, &name, new.folder_id, now)?;
    tx.execute(
        "INSERT INTO play_decks (item_id, source_id, source_name, state_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![item.id, new.source_id, new.source_name, new.state_json, now],
    )?;
    tx.commit()?;
    let deck = get(conn, &item.id)?;
    Ok((item, deck))
}

/// Checks the item exists, is live, and is a deck in play.
fn require_live_play(conn: &Connection, item_id: &str) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != PLAY_TYPE {
        return Err(DbError::Invalid("This item isn't a deck in play."));
    }
    Ok(())
}

pub fn get(conn: &Connection, item_id: &str) -> Result<PlayDeck, DbError> {
    require_live_play(conn, item_id)?;
    conn.query_row(
        "SELECT item_id, source_id, source_name, state_json, created_at, updated_at
         FROM play_decks WHERE item_id = ?1",
        [item_id],
        |r| {
            Ok(PlayDeck {
                item_id: r.get(0)?,
                source_id: r.get(1)?,
                source_name: r.get(2)?,
                state_json: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

/// Replaces the game's state (after a draw, a reshuffle...). Also marks the item as updated.
pub fn set_state(conn: &Connection, item_id: &str, state_json: &str, now: i64) -> Result<(), DbError> {
    require_live_play(conn, item_id)?;
    validate("", state_json)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE play_decks SET state_json = ?2, updated_at = ?3 WHERE item_id = ?1",
        params![item_id, state_json, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Every live deck in play in a project, most recently played first.
pub fn list(conn: &Connection, project_id: &str) -> Result<Vec<PlayDeckEntry>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, p.source_name, p.state_json
         FROM play_decks p JOIN items i ON i.id = p.item_id
         WHERE i.project_id = ?1 AND i.deleted_at IS NULL
         ORDER BY p.updated_at DESC, i.name COLLATE NOCASE, i.created_at",
    )?;
    let rows = stmt.query_map([project_id], |r| {
        let state: String = r.get(3)?;
        let (remaining, drawn) = counts(&state);
        Ok(PlayDeckEntry {
            item_id: r.get(0)?,
            name: r.get(1)?,
            source_name: r.get(2)?,
            remaining,
            drawn,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{projects, folders, open_in_memory, search, tags, trash};

    const STATE: &str = r#"{"version":1,"deck":[{"id":"a","name":"A"},{"id":"b","name":"B"}],"drawn":[{"id":"c","name":"C","reversed":true}]}"#;

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn new<'a>(project: &'a str, name: &'a str) -> NewPlayDeck<'a> {
        NewPlayDeck {
            project_id: project,
            name,
            folder_id: None,
            source_id: Some("source-1"),
            source_name: "Tarot",
            state_json: STATE,
        }
    }

    #[test]
    fn starting_makes_an_item_in_the_cards_library_and_keeps_the_state() {
        let (conn, camp) = setup();
        let (item, deck) = create(&conn, new(&camp, "Harrow deck"), 50).unwrap();
        assert_eq!((item.library.as_str(), item.item_type.as_str()), ("cards", "play"));
        assert_eq!(item.name, "Harrow deck");
        assert_eq!(deck.item_id, item.id);
        assert_eq!(deck.source_id.as_deref(), Some("source-1"));
        assert_eq!((deck.source_name.as_str(), deck.state_json.as_str()), ("Tarot", STATE));
        assert_eq!((deck.created_at, deck.updated_at), (50, 50));
        assert_eq!(get(&conn, &item.id).unwrap(), deck);
    }

    #[test]
    fn a_blank_name_falls_back_and_a_game_may_have_no_source() {
        let (conn, camp) = setup();
        assert_eq!(create(&conn, new(&camp, " "), 1).unwrap().0.name, "Tarot in play");
        let mut n = new(&camp, "");
        n.source_name = "";
        n.source_id = None;
        let (item, deck) = create(&conn, n, 2).unwrap();
        assert_eq!(item.name, "Deck in play");
        assert_eq!(deck.source_id, None);
    }

    #[test]
    fn can_be_started_in_a_cards_folder() {
        let (conn, camp) = setup();
        let f = folders::create(&conn, &camp, "cards", None, "Games", 1).unwrap();
        let mut n = new(&camp, "Game");
        n.folder_id = Some(&f.id);
        assert_eq!(create(&conn, n, 2).unwrap().0.folder_id.as_deref(), Some(f.id.as_str()));
    }

    #[test]
    fn bad_state_is_refused_and_leaves_nothing_behind() {
        let (conn, camp) = setup();
        for bad in ["not json", "[1,2]", "42", ""] {
            let mut n = new(&camp, "x");
            n.state_json = bad;
            assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))), "{bad:?}");
        }
        let huge = format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_STATE_BYTES));
        let mut n = new(&camp, "x");
        n.state_json = &huge;
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        let mut n = new(&camp, "x");
        let long_name = "n".repeat(MAX_SOURCE_CHARS + 1);
        n.source_name = &long_name;
        assert!(matches!(create(&conn, n, 1), Err(DbError::Invalid(_))));
        assert!(create(&conn, new("no-such-project", "x"), 1).is_err());
        let items: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(items, 0, "a failed start must not leave a half-made item");
    }

    #[test]
    fn the_state_can_be_replaced_and_marks_the_item_updated() {
        let (conn, camp) = setup();
        let (item, _) = create(&conn, new(&camp, "Game"), 10).unwrap();
        let next = r#"{"version":1,"deck":[],"drawn":[]}"#;
        set_state(&conn, &item.id, next, 99).unwrap();
        let d = get(&conn, &item.id).unwrap();
        assert_eq!((d.state_json.as_str(), d.updated_at, d.created_at), (next, 99, 10));
        assert_eq!(items::get(&conn, &item.id).unwrap().updated_at, 99);
        // A bad state is refused and the old one stays.
        assert!(matches!(set_state(&conn, &item.id, "oops", 100), Err(DbError::Invalid(_))));
        assert_eq!(get(&conn, &item.id).unwrap().state_json, next);
    }

    #[test]
    fn only_live_decks_in_play_can_be_read_or_changed() {
        let (conn, camp) = setup();
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 1).unwrap();
        assert!(matches!(get(&conn, &doc.id), Err(DbError::Invalid(_))));
        assert!(matches!(set_state(&conn, &doc.id, STATE, 2), Err(DbError::Invalid(_))));
        assert!(matches!(get(&conn, "nope"), Err(DbError::NotFound)));

        let (item, _) = create(&conn, new(&camp, "Game"), 2).unwrap();
        items::soft_delete(&conn, &item.id, 4).unwrap();
        assert!(matches!(get(&conn, &item.id), Err(DbError::NotFound)));
        assert!(matches!(set_state(&conn, &item.id, STATE, 5), Err(DbError::NotFound)));
        trash::restore_item(&conn, &item.id, 6).unwrap();
        assert_eq!(get(&conn, &item.id).unwrap().state_json, STATE);
    }

    #[test]
    fn list_shows_live_games_with_card_counts_most_recent_first() {
        let (conn, camp) = setup();
        let other = projects::create(&conn, "Other", 2).unwrap();
        let (a, _) = create(&conn, new(&camp, "Alpha"), 10).unwrap();
        let (b, _) = create(&conn, new(&camp, "Beta"), 20).unwrap();
        let gone = create(&conn, new(&camp, "Trashed"), 30).unwrap().0;
        items::soft_delete(&conn, &gone.id, 31).unwrap();
        create(&conn, new(&other.id, "Elsewhere"), 40).unwrap();
        items::create(&conn, &camp, "cards", "deck", "Not a game", None, 50).unwrap();
        set_state(&conn, &a.id, r#"{"version":1,"deck":[{"id":"z","name":"Z"}],"drawn":[]}"#, 60).unwrap();

        let list = list(&conn, &camp).unwrap();
        let summary: Vec<_> = list.iter().map(|e| (e.name.as_str(), e.remaining, e.drawn)).collect();
        assert_eq!(summary, [("Alpha", 1, 0), ("Beta", 2, 1)]); // Alpha was played most recently
        assert_eq!(list[1].item_id, b.id);
        assert_eq!(list[0].source_name, "Tarot");
    }

    #[test]
    fn list_copes_with_a_state_that_has_no_card_lists() {
        let (conn, camp) = setup();
        let mut n = new(&camp, "Odd");
        n.state_json = r#"{"version":1}"#;
        create(&conn, n, 1).unwrap();
        let list = list(&conn, &camp).unwrap();
        assert_eq!((list[0].remaining, list[0].drawn), (0, 0));
    }

    #[test]
    fn purging_the_item_removes_the_game() {
        let (conn, camp) = setup();
        let (item, _) = create(&conn, new(&camp, "Game"), 2).unwrap();
        items::soft_delete(&conn, &item.id, 3).unwrap();
        trash::purge_item(&conn, &item.id).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM play_decks", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn a_game_is_found_by_name_tag_and_the_name_of_its_source() {
        let (conn, camp) = setup();
        let (item, _) = create(&conn, new(&camp, "Harrow game"), 2).unwrap();
        let tag = tags::create(&conn, &camp, None, "Project", None, 3).unwrap();
        tags::add_to_item(&conn, &item.id, &tag.id, 4).unwrap();
        for query in ["harrow", "project", "tarot"] {
            let found = search::search(&conn, &camp, query, Some("cards"), 10).unwrap();
            assert_eq!(found.len(), 1, "searching '{query}'");
        }
    }
}
