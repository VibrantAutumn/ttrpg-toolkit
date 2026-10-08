//! Search over item names, their tags' names and document text, using the FTS5
//! index that database triggers keep up to date (migrations 0004 and 0007).

use super::error::DbError;
use super::items::{self, Item};
use rusqlite::{params, Connection};

/// Turns what the user typed into an FTS5 query: every word becomes a quoted
/// prefix term (`wat dee` -> `"wat"* "dee"*`), all of which must match.
/// Punctuation is dropped so input can never be read as search syntax.
/// Returns `None` when there is nothing to search for.
fn fts_query(text: &str) -> Option<String> {
    let terms: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{word}\"*"))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

/// Live items in a campaign whose name, tag names or document text match `text`,
/// best matches first (name matches outrank tag matches, which outrank text). Optionally limited to one
/// library. Blank or punctuation-only input finds nothing.
pub fn search(
    conn: &Connection,
    campaign_id: &str,
    text: &str,
    library: Option<&str>,
    limit: u32,
) -> Result<Vec<Item>, DbError> {
    let Some(query) = fts_query(text) else {
        return Ok(Vec::new());
    };
    let columns = items::qualified_columns("i");
    let mut stmt = conn.prepare(&format!(
        "SELECT {columns} FROM search_index
         JOIN items i ON i.id = search_index.item_id
         WHERE search_index MATCH ?1
           AND i.campaign_id = ?2 AND i.deleted_at IS NULL
           AND (?3 IS NULL OR i.library = ?3)
         ORDER BY bm25(search_index, 0.0, 10.0, 2.0, 1.0), i.name COLLATE NOCASE
         LIMIT ?4"
    ))?;
    let rows = stmt.query_map(
        params![query, campaign_id, library, limit.clamp(1, 200)],
        items::from_row,
    )?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{migrate, MIGRATIONS};
    use crate::db::{campaigns, documents, folders, open_in_memory, tags, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn new_item(conn: &Connection, camp: &str, library: &str, name: &str) -> Item {
        items::create(conn, camp, library, "document", name, None, 1).unwrap()
    }

    fn find(conn: &Connection, camp: &str, text: &str) -> Vec<String> {
        search(conn, camp, text, None, 50)
            .unwrap()
            .into_iter()
            .map(|i| i.name)
            .collect()
    }

    #[test]
    fn query_building() {
        assert_eq!(fts_query("wat dee").unwrap(), r#""wat"* "dee"*"#);
        assert_eq!(fts_query("  Wáter-deep!  ").unwrap(), r#""Wáter"* "deep"*"#);
        assert_eq!(fts_query(r#"he said "hi" AND NEAR("#).unwrap(), r#""he"* "said"* "hi"* "AND"* "NEAR"*"#);
        assert_eq!(fts_query("   "), None);
        assert_eq!(fts_query("\"*()-"), None);
        assert_eq!(fts_query(""), None);
    }

    #[test]
    fn finds_by_name_prefix_ignoring_case_and_accents() {
        let (conn, camp) = setup();
        new_item(&conn, &camp, "w", "Waterdeep");
        new_item(&conn, &camp, "w", "Café Noir");
        new_item(&conn, &camp, "w", "Baldur's Gate");
        assert_eq!(find(&conn, &camp, "wat"), ["Waterdeep"]);
        assert_eq!(find(&conn, &camp, "WATERDEEP"), ["Waterdeep"]);
        assert_eq!(find(&conn, &camp, "cafe"), ["Café Noir"]);
        assert_eq!(find(&conn, &camp, "baldur"), ["Baldur's Gate"]);
        assert!(find(&conn, &camp, "zzz").is_empty());
    }

    #[test]
    fn all_words_must_match() {
        let (conn, camp) = setup();
        new_item(&conn, &camp, "w", "Red Dragon");
        new_item(&conn, &camp, "w", "Red Wizard");
        assert_eq!(find(&conn, &camp, "red dra"), ["Red Dragon"]);
        assert_eq!(find(&conn, &camp, "dragon red"), ["Red Dragon"]);
        assert_eq!(find(&conn, &camp, "red").len(), 2);
    }

    #[test]
    fn odd_input_never_errors() {
        let (conn, camp) = setup();
        new_item(&conn, &camp, "w", "Anything");
        for text in ["", "   ", "\"", "*", "AND", "OR NOT", "NEAR(", "a\"b", "name:x", "(((", "--"] {
            assert!(search(&conn, &camp, text, None, 10).is_ok(), "{text:?} should not error");
        }
        assert!(find(&conn, &camp, "").is_empty());
    }

    #[test]
    fn renaming_an_item_updates_the_index() {
        let (conn, camp) = setup();
        let i = new_item(&conn, &camp, "w", "Old Name");
        items::rename(&conn, &i.id, "Fresh Title", 2).unwrap();
        assert!(find(&conn, &camp, "old").is_empty());
        assert_eq!(find(&conn, &camp, "fresh"), ["Fresh Title"]);
    }

    #[test]
    fn trashed_items_are_hidden_and_return_on_restore() {
        let (conn, camp) = setup();
        let i = new_item(&conn, &camp, "w", "Ghost");
        items::soft_delete(&conn, &i.id, 2).unwrap();
        assert!(find(&conn, &camp, "ghost").is_empty());
        trash::restore_item(&conn, &i.id, 3).unwrap();
        assert_eq!(find(&conn, &camp, "ghost"), ["Ghost"]);
    }

    #[test]
    fn items_in_a_trashed_folder_are_hidden() {
        let (conn, camp) = setup();
        let f = folders::create(&conn, &camp, "w", None, "F", 1).unwrap();
        items::create(&conn, &camp, "w", "document", "Inside", Some(&f.id), 1).unwrap();
        folders::soft_delete(&conn, &f.id, 2).unwrap();
        assert!(find(&conn, &camp, "inside").is_empty());
        trash::restore_folder(&conn, &f.id, 3).unwrap();
        assert_eq!(find(&conn, &camp, "inside"), ["Inside"]);
    }

    #[test]
    fn purging_removes_the_index_row() {
        let (conn, camp) = setup();
        let i = new_item(&conn, &camp, "w", "Doomed");
        items::soft_delete(&conn, &i.id, 2).unwrap();
        trash::purge_item(&conn, &i.id).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM search_index", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn finds_items_by_their_tag_names_and_follows_tag_changes() {
        let (conn, camp) = setup();
        let item = new_item(&conn, &camp, "w", "Bob");
        let other = new_item(&conn, &camp, "w", "Alice");
        let t = tags::create(&conn, &camp, None, "Smuggler", None, 1).unwrap();
        assert!(find(&conn, &camp, "smug").is_empty());

        tags::add_to_item(&conn, &item.id, &t.id, 2).unwrap();
        assert_eq!(find(&conn, &camp, "smug"), ["Bob"]);

        tags::rename(&conn, &t.id, "Pirate", 3).unwrap();
        assert!(find(&conn, &camp, "smug").is_empty());
        assert_eq!(find(&conn, &camp, "pirate"), ["Bob"]);

        tags::soft_delete(&conn, &t.id, 4).unwrap();
        assert!(find(&conn, &camp, "pirate").is_empty());
        tags::restore(&conn, &t.id, 5).unwrap();
        assert_eq!(find(&conn, &camp, "pirate"), ["Bob"]);

        tags::remove_from_item(&conn, &item.id, &t.id, 6).unwrap();
        assert!(find(&conn, &camp, "pirate").is_empty());
        tags::add_to_item(&conn, &item.id, &t.id, 7).unwrap();
        assert_eq!(find(&conn, &camp, "pirate"), ["Bob"]);
        assert!(!find(&conn, &camp, "pirate").contains(&other.name));
    }

    #[test]
    fn name_and_tag_words_can_be_combined() {
        let (conn, camp) = setup();
        let bob = new_item(&conn, &camp, "w", "Bob");
        new_item(&conn, &camp, "w", "Bobby");
        let t = tags::create(&conn, &camp, None, "Smuggler", None, 1).unwrap();
        tags::add_to_item(&conn, &bob.id, &t.id, 2).unwrap();
        assert_eq!(find(&conn, &camp, "bob smug"), ["Bob"]);
    }

    #[test]
    fn name_matches_rank_above_tag_only_matches() {
        let (conn, camp) = setup();
        let tagged = new_item(&conn, &camp, "w", "Aardvark"); // alphabetically first
        new_item(&conn, &camp, "w", "Dragon Lair");
        let t = tags::create(&conn, &camp, None, "Dragon", None, 1).unwrap();
        tags::add_to_item(&conn, &tagged.id, &t.id, 2).unwrap();
        assert_eq!(find(&conn, &camp, "dragon"), ["Dragon Lair", "Aardvark"]);
    }

    #[test]
    fn results_respect_campaign_library_and_limit() {
        let (conn, camp) = setup();
        let other = campaigns::create(&conn, "Other", 1).unwrap();
        new_item(&conn, &camp, "w", "Dragon One");
        new_item(&conn, &camp, "maps", "Dragon Map");
        new_item(&conn, &other.id, "w", "Dragon Elsewhere");
        assert_eq!(find(&conn, &camp, "dragon").len(), 2);
        let only_maps = search(&conn, &camp, "dragon", Some("maps"), 50).unwrap();
        assert_eq!(only_maps.len(), 1);
        assert_eq!(only_maps[0].name, "Dragon Map");
        assert_eq!(search(&conn, &camp, "dragon", None, 1).unwrap().len(), 1);
    }

    fn new_doc(conn: &Connection, camp: &str, name: &str, body: &str) -> Item {
        let d = items::create(conn, camp, "w", documents::DOCUMENT_TYPE, name, None, 1).unwrap();
        documents::set_body(conn, &d.id, body, 2).unwrap();
        d
    }

    #[test]
    fn finds_words_inside_document_text_and_follows_edits() {
        let (conn, camp) = setup();
        let d = new_doc(&conn, &camp, "Lair", "The dragon sleeps beneath Mount Doom.");
        assert_eq!(find(&conn, &camp, "doom"), ["Lair"]);
        assert_eq!(find(&conn, &camp, "slee beneath"), ["Lair"]);

        documents::set_body(&conn, &d.id, "Now it is a quiet tavern.", 3).unwrap();
        assert!(find(&conn, &camp, "doom").is_empty());
        assert_eq!(find(&conn, &camp, "tavern"), ["Lair"]);

        documents::set_body(&conn, &d.id, "", 4).unwrap();
        assert!(find(&conn, &camp, "tavern").is_empty());
    }

    #[test]
    fn document_text_of_trashed_items_is_hidden_until_restored() {
        let (conn, camp) = setup();
        let d = new_doc(&conn, &camp, "Secret", "buried treasure");
        items::soft_delete(&conn, &d.id, 3).unwrap();
        assert!(find(&conn, &camp, "treasure").is_empty());
        trash::restore_item(&conn, &d.id, 4).unwrap();
        assert_eq!(find(&conn, &camp, "treasure"), ["Secret"]);
    }

    #[test]
    fn name_matches_outrank_tag_matches_which_outrank_text_matches() {
        let (conn, camp) = setup();
        new_doc(&conn, &camp, "Dragon Lair", "A cave.");
        new_doc(&conn, &camp, "Aardvark", "Once there was a dragon, long ago, in a land far away.");
        let tagged = new_doc(&conn, &camp, "Zebra", "Stripes.");
        let t = tags::create(&conn, &camp, None, "Dragon", None, 1).unwrap();
        tags::add_to_item(&conn, &tagged.id, &t.id, 2).unwrap();
        assert_eq!(find(&conn, &camp, "dragon"), ["Dragon Lair", "Zebra", "Aardvark"]);
    }

    #[test]
    fn upgrading_keeps_names_and_tags_searchable_and_adds_text_search() {
        // A database at schema version 6 (before document text existed).
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        migrate(&mut conn, &MIGRATIONS[..6]).unwrap();
        let camp = campaigns::create(&conn, "Old", 1).unwrap();
        let item = items::create(&conn, &camp.id, "w", "document", "Ancient Scroll", None, 1).unwrap();
        let t = tags::create(&conn, &camp.id, None, "Relic", None, 1).unwrap();
        tags::add_to_item(&conn, &item.id, &t.id, 2).unwrap();

        migrate(&mut conn, MIGRATIONS).unwrap();

        assert_eq!(find(&conn, &camp.id, "scroll"), ["Ancient Scroll"]);
        assert_eq!(find(&conn, &camp.id, "relic"), ["Ancient Scroll"]);
        documents::set_body(&conn, &item.id, "Written in elvish.", 3).unwrap();
        assert_eq!(find(&conn, &camp.id, "elvish"), ["Ancient Scroll"]);
        // New items still get indexed by the original triggers.
        let fresh = new_item(&conn, &camp.id, "w", "Fresh");
        assert_eq!(find(&conn, &camp.id, "fresh"), [fresh.name]);
    }

    #[test]
    fn upgrading_an_existing_database_indexes_what_is_already_there() {
        // Build a database at schema version 3 (before search existed) with data in it.
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        migrate(&mut conn, &MIGRATIONS[..3]).unwrap();
        let camp = campaigns::create(&conn, "Old", 1).unwrap();
        let item = new_item(&conn, &camp.id, "w", "Legacy Item");
        let t = tags::create(&conn, &camp.id, None, "Heirloom", None, 1).unwrap();
        tags::add_to_item(&conn, &item.id, &t.id, 2).unwrap();

        migrate(&mut conn, MIGRATIONS).unwrap();

        assert_eq!(find(&conn, &camp.id, "legacy"), ["Legacy Item"]);
        assert_eq!(find(&conn, &camp.id, "heirloom"), ["Legacy Item"]);
    }
}
