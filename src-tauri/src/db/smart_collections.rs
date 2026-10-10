//! Smart collections: saved queries. A smart collection is a library item (library `worldbuilding`,
//! type `smart_collection`) that remembers a question about the project ("every NPC tagged Elf")
//! and answers it afresh every time it is opened, so it is never out of date.
//!
//! The query is JSON text whose shape and meaning are defined in TypeScript
//! (`src/lib/queries/query.ts`) and run by `query.rs`; this module keeps it, checks it is a query
//! the engine can read, and runs it. A collection with no saved query yet (made from the library's
//! "New item" form) reads as the empty query, which finds everything, like a card with no details.

use super::error::DbError;
use super::items;
use super::query::{self, QueryResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub const SMART_TYPE: &str = "smart_collection";
pub const LIBRARY: &str = "worldbuilding";

/// Largest query kept, in bytes.
pub const MAX_QUERY_BYTES: usize = 50_000;

/// The query a new collection starts with: no rules, sorted by name.
pub const EMPTY_QUERY: &str = r#"{"version":1,"where":{"op":"all","not":false,"rules":[]},"sort":[{"by":"name","dir":"asc"}]}"#;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartCollection {
    pub item_id: String,
    pub query_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Checks a query before it is kept (also used when importing packs).
pub fn validate(query_json: &str) -> Result<(), DbError> {
    if query_json.len() > MAX_QUERY_BYTES {
        return Err(DbError::Invalid("That query is too large to save."));
    }
    query::parse(query_json).map(|_| ())
}

/// Checks the item exists, is live, and is a smart collection.
fn require_live(conn: &Connection, item_id: &str) -> Result<items::Item, DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != SMART_TYPE {
        return Err(DbError::Invalid("This item isn't a filter set."));
    }
    Ok(item)
}

pub fn get(conn: &Connection, item_id: &str) -> Result<SmartCollection, DbError> {
    let item = require_live(conn, item_id)?;
    let row = conn
        .query_row(
            "SELECT query_json, created_at, updated_at FROM smart_collections WHERE item_id = ?1",
            [item_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
        )
        .optional()?;
    Ok(match row {
        Some((query_json, created_at, updated_at)) => SmartCollection { item_id: item.id, query_json, created_at, updated_at },
        None => SmartCollection { item_id: item.id, query_json: EMPTY_QUERY.to_string(), created_at: item.created_at, updated_at: item.updated_at },
    })
}

/// Saves the query (creating the row the first time). Also marks the item as updated.
pub fn set_query(conn: &Connection, item_id: &str, query_json: &str, now: i64) -> Result<(), DbError> {
    validate(query_json)?;
    require_live(conn, item_id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO smart_collections (item_id, query_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (item_id) DO UPDATE SET query_json = excluded.query_json, updated_at = excluded.updated_at",
        params![item_id, query_json, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Answers the collection's question now. `only_type` keeps one kind of item (a pool asks for cards).
pub fn run(conn: &Connection, item_id: &str, now: i64, only_type: Option<&str>) -> Result<QueryResult, DbError> {
    let item = require_live(conn, item_id)?;
    let saved = get(conn, item_id)?;
    query::run_json(conn, &item.project_id, &saved.query_json, now, only_type)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{projects, collections, open_in_memory, tags, trash};
    use serde_json::json;

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn smart(conn: &Connection, camp: &str, name: &str) -> String {
        items::create(conn, camp, LIBRARY, SMART_TYPE, name, None, 5).unwrap().id
    }

    fn names(result: QueryResult) -> Vec<String> {
        result.items.into_iter().map(|i| i.name).collect()
    }

    #[test]
    fn a_new_collection_has_the_empty_query_and_finds_everything() {
        let (conn, camp) = setup();
        let id = smart(&conn, &camp, "All");
        items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 6).unwrap();
        let got = get(&conn, &id).unwrap();
        assert_eq!(got.query_json, EMPTY_QUERY);
        assert!(validate(EMPTY_QUERY).is_ok());
        // it finds itself too: a collection of everything includes the collection
        assert_eq!(names(run(&conn, &id, 10, None).unwrap()), ["All", "Doc"]);
    }

    #[test]
    fn saves_a_query_and_answers_it_afresh_each_time() {
        let (conn, camp) = setup();
        let id = smart(&conn, &camp, "NPCs");
        let npc = tags::create(&conn, &camp, None, "NPC", None, 5).unwrap().id;
        let query = json!({"version": 1, "where": {"op": "all", "not": false, "rules": [{"kind": "tag", "tagId": npc, "subtags": true, "not": false}]}, "sort": [{"by": "name", "dir": "asc"}]});
        set_query(&conn, &id, &query.to_string(), 50).unwrap();
        let saved = get(&conn, &id).unwrap();
        assert_eq!(saved.updated_at, 50);
        assert_eq!(items::get(&conn, &id).unwrap().updated_at, 50);
        assert!(names(run(&conn, &id, 60, None).unwrap()).is_empty());

        let bob = items::create(&conn, &camp, "worldbuilding", "document", "Bob", None, 6).unwrap();
        tags::add_to_item(&conn, &bob.id, &npc, 7).unwrap();
        assert_eq!(names(run(&conn, &id, 60, None).unwrap()), ["Bob"]);
        // saving again replaces it
        set_query(&conn, &id, EMPTY_QUERY, 70).unwrap();
        assert_eq!(names(run(&conn, &id, 80, Some("document")).unwrap()), ["Bob"]);
    }

    #[test]
    fn refuses_a_query_it_cannot_read_and_keeps_the_old_one() {
        let (conn, camp) = setup();
        let id = smart(&conn, &camp, "C");
        set_query(&conn, &id, EMPTY_QUERY, 10).unwrap();
        assert!(set_query(&conn, &id, "nonsense", 20).is_err());
        assert!(set_query(&conn, &id, &"x".repeat(MAX_QUERY_BYTES + 1), 20).is_err());
        assert!(set_query(&conn, &id, r#"{"version":9,"where":{"op":"all","rules":[]}}"#, 20).unwrap_err().to_string().contains("newer"));
        assert_eq!(get(&conn, &id).unwrap().query_json, EMPTY_QUERY);
        assert_eq!(get(&conn, &id).unwrap().updated_at, 10);
    }

    #[test]
    fn only_works_on_live_smart_collections() {
        let (conn, camp) = setup();
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 5).unwrap();
        assert!(get(&conn, &doc.id).is_err());
        assert!(set_query(&conn, &doc.id, EMPTY_QUERY, 6).is_err());
        let id = smart(&conn, &camp, "C");
        items::soft_delete(&conn, &id, 20).unwrap();
        assert!(matches!(get(&conn, &id), Err(DbError::NotFound)));
        assert!(run(&conn, &id, 30, None).is_err());
        trash::restore_item(&conn, &id, 40).unwrap();
        assert!(get(&conn, &id).is_ok());
    }

    #[test]
    fn purging_the_item_removes_the_saved_query() {
        let (conn, camp) = setup();
        let id = smart(&conn, &camp, "C");
        set_query(&conn, &id, EMPTY_QUERY, 10).unwrap();
        items::soft_delete(&conn, &id, 20).unwrap();
        trash::purge_item(&conn, &id).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM smart_collections", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn a_pool_can_hold_a_smart_collection_and_draws_from_the_cards_it_finds() {
        let (conn, camp) = setup();
        let major = tags::create(&conn, &camp, None, "Major", None, 5).unwrap().id;
        let card = |name: &str, tagged: bool| {
            let c = items::create(&conn, &camp, "cards", "card", name, None, 6).unwrap();
            if tagged {
                tags::add_to_item(&conn, &c.id, &major, 7).unwrap();
            }
            c.id
        };
        let fool = card("The Fool", true);
        card("Two of Cups", false);
        let magician = card("The Magician", true);
        items::create(&conn, &camp, "worldbuilding", "document", "Not a card", None, 6).unwrap();
        let tagged = items::create(&conn, &camp, "cards", "card", "Tagged but separate", None, 6).unwrap();
        tags::add_to_item(&conn, &tagged.id, &major, 8).unwrap();

        let id = smart(&conn, &camp, "Major arcana");
        let query = json!({"version": 1, "where": {"op": "all", "not": false, "rules": [{"kind": "tag", "tagId": major, "subtags": true, "not": false}]}, "sort": [{"by": "name", "dir": "desc"}]});
        set_query(&conn, &id, &query.to_string(), 9).unwrap();

        let pool = items::create(&conn, &camp, "cards", "pool", "Reading", None, 6).unwrap().id;
        assert!(collections::candidates(&conn, &pool).unwrap().iter().any(|i| i.id == id), "offered in the Add picker");
        collections::add_member(&conn, &pool, &id, 10).unwrap();
        // the same card reached by hand and by the query counts once
        collections::add_member(&conn, &pool, &fool, 11).unwrap();
        let drawn: Vec<String> = collections::resolve_cards(&conn, &pool).unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(drawn, ["The Magician", "The Fool", "Tagged but separate"]);
        let _ = magician;

        // the answer follows the data: untag a card and it leaves the pool
        tags::remove_from_item(&conn, &fool, &major, 20).unwrap();
        collections::remove_member(&conn, &pool, &fool, 21).unwrap();
        let drawn: Vec<String> = collections::resolve_cards(&conn, &pool).unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(drawn, ["The Magician", "Tagged but separate"]);

        // a smart collection can't hold anything, and only pools can hold one
        assert!(collections::add_member(&conn, &id, &fool, 30).is_err());
        let set = items::create(&conn, &camp, "cards", "set", "S", None, 6).unwrap().id;
        assert!(collections::add_member(&conn, &set, &id, 31).is_err());
        let deck = items::create(&conn, &camp, "cards", "deck", "D", None, 6).unwrap().id;
        assert!(collections::add_member(&conn, &deck, &id, 32).is_err());
    }
}
