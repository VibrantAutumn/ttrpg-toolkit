//! What is inside sets, decks and pools.
//!
//! One table (`collection_members`) serves all three. The kinds form a strict
//! ladder, so a collection can never end up inside itself:
//!   set  holds cards
//!   deck holds cards and sets
//!   pool holds cards, sets, decks and smart collections (a saved query: the cards it finds)
//! A card can be in any number of sets, decks and pools. Removal is soft (the row
//! is kept with `deleted_at`, so it can sync later) and adding again revives it.

use super::cards::{CARD_TYPE, DECK_TYPE, LIBRARY, POOL_TYPE, SET_TYPE};
use super::smart_collections::{self, SMART_TYPE};
use super::error::DbError;
use super::items::{self, Item};
use rusqlite::{params, Connection};
use std::collections::HashSet;

/// What a collection of this type may hold (empty for types that hold nothing).
pub fn allowed_members(collection_type: &str) -> &'static [&'static str] {
    match collection_type {
        SET_TYPE => &[CARD_TYPE],
        DECK_TYPE => &[CARD_TYPE, SET_TYPE],
        POOL_TYPE => &[CARD_TYPE, SET_TYPE, DECK_TYPE, SMART_TYPE],
        _ => &[],
    }
}

/// Whether a member of this type may go inside a collection of that type.
pub fn may_hold(collection_type: &str, member_type: &str) -> bool {
    allowed_members(collection_type).contains(&member_type)
}

fn require_live(conn: &Connection, id: &str) -> Result<Item, DbError> {
    let item = items::get(conn, id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    Ok(item)
}

/// A live set, deck or pool.
fn require_collection(conn: &Connection, id: &str) -> Result<Item, DbError> {
    let item = require_live(conn, id)?;
    if allowed_members(&item.item_type).is_empty() {
        return Err(DbError::Invalid("Only sets, decks and pools can hold cards."));
    }
    Ok(item)
}

/// Puts `member_id` inside `collection_id`. Adding something already inside is fine.
pub fn add_member(conn: &Connection, collection_id: &str, member_id: &str, now: i64) -> Result<(), DbError> {
    let collection = require_collection(conn, collection_id)?;
    let member = require_live(conn, member_id)?;
    if collection.id == member.id {
        return Err(DbError::Invalid("Nothing can be put inside itself."));
    }
    if collection.project_id != member.project_id {
        return Err(DbError::Invalid("Both must be in the same project."));
    }
    if !may_hold(&collection.item_type, &member.item_type) {
        return Err(DbError::Invalid(match collection.item_type.as_str() {
            SET_TYPE => "A set can only hold cards.",
            DECK_TYPE => "A deck can only hold cards and sets.",
            _ => "A pool can only hold cards, sets, decks and filter sets.",
        }));
    }

    let tx = conn.unchecked_transaction()?;
    let existing: Option<Option<i64>> = tx
        .query_row(
            "SELECT deleted_at FROM collection_members WHERE collection_id = ?1 AND member_id = ?2",
            [collection_id, member_id],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;
    if existing == Some(None) {
        return Ok(()); // already inside
    }
    let position: i64 = tx.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM collection_members WHERE collection_id = ?1",
        [collection_id],
        |r| r.get(0),
    )?;
    if existing.is_some() {
        tx.execute(
            "UPDATE collection_members SET deleted_at = NULL, updated_at = ?3, position = ?4
             WHERE collection_id = ?1 AND member_id = ?2",
            params![collection_id, member_id, now, position],
        )?;
    } else {
        tx.execute(
            "INSERT INTO collection_members (collection_id, member_id, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![collection_id, member_id, position, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Takes `member_id` out of `collection_id` (the item itself is untouched).
pub fn remove_member(conn: &Connection, collection_id: &str, member_id: &str, now: i64) -> Result<(), DbError> {
    let changed = conn.execute(
        "UPDATE collection_members SET deleted_at = ?3, updated_at = ?3
         WHERE collection_id = ?1 AND member_id = ?2 AND deleted_at IS NULL",
        params![collection_id, member_id, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    Ok(())
}

fn query_items(conn: &Connection, sql: &str, args: impl rusqlite::Params) -> Result<Vec<Item>, DbError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(args, items::from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The live items directly inside a collection, in order.
pub fn list_members(conn: &Connection, collection_id: &str) -> Result<Vec<Item>, DbError> {
    require_collection(conn, collection_id)?;
    members_of(conn, collection_id)
}

fn members_of(conn: &Connection, collection_id: &str) -> Result<Vec<Item>, DbError> {
    query_items(
        conn,
        &format!(
            "SELECT {} FROM collection_members m JOIN items i ON i.id = m.member_id
             WHERE m.collection_id = ?1 AND m.deleted_at IS NULL AND i.deleted_at IS NULL
             ORDER BY m.position, m.created_at",
            items::qualified_columns("i")
        ),
        [collection_id],
    )
}

/// The live sets, decks and pools that directly hold an item, by type then name.
pub fn containers_of(conn: &Connection, member_id: &str) -> Result<Vec<Item>, DbError> {
    query_items(
        conn,
        &format!(
            "SELECT {} FROM collection_members m JOIN items i ON i.id = m.collection_id
             WHERE m.member_id = ?1 AND m.deleted_at IS NULL AND i.deleted_at IS NULL
             ORDER BY i.item_type, i.name COLLATE NOCASE, i.created_at",
            items::qualified_columns("i")
        ),
        [member_id],
    )
}

/// Every distinct live card a collection reaches, however deep (a pool's decks'
/// sets' cards). A card reached twice counts once. Order follows the members'
/// order, depth first, each card at its first appearance.
pub fn resolve_cards(conn: &Connection, collection_id: &str) -> Result<Vec<Item>, DbError> {
    require_collection(conn, collection_id)?;
    let mut cards = Vec::new();
    let mut seen_cards = HashSet::new();
    let mut seen_collections = HashSet::new();
    collect_cards(conn, collection_id, &mut seen_collections, &mut seen_cards, &mut cards)?;
    Ok(cards)
}

fn collect_cards(
    conn: &Connection,
    collection_id: &str,
    seen_collections: &mut HashSet<String>,
    seen_cards: &mut HashSet<String>,
    cards: &mut Vec<Item>,
) -> Result<(), DbError> {
    if !seen_collections.insert(collection_id.to_string()) {
        return Ok(()); // a set or deck reached twice only needs walking once
    }
    for member in members_of(conn, collection_id)? {
        if member.item_type == CARD_TYPE {
            if seen_cards.insert(member.id.clone()) {
                cards.push(member);
            }
        } else if member.item_type == SMART_TYPE {
            // The cards its query finds right now, in the query's own order.
            for card in smart_collections::run(conn, &member.id, super::now_ms(), Some(CARD_TYPE))?.items {
                if seen_cards.insert(card.id.clone()) {
                    cards.push(card);
                }
            }
        } else {
            collect_cards(conn, &member.id, seen_collections, seen_cards, cards)?;
        }
    }
    Ok(())
}

/// Every live set, deck and pool in a project's cards library, for choosing
/// something to draw from. Pools first, then decks, then sets; by name within each.
pub fn list_all(conn: &Connection, project_id: &str) -> Result<Vec<Item>, DbError> {
    query_items(
        conn,
        &format!(
            "SELECT {} FROM items i
             WHERE i.project_id = ?1 AND i.library = ?2 AND i.deleted_at IS NULL
               AND i.item_type IN ('set', 'deck', 'pool')
             ORDER BY CASE i.item_type WHEN 'pool' THEN 0 WHEN 'deck' THEN 1 ELSE 2 END,
                      i.name COLLATE NOCASE, i.created_at",
            items::qualified_columns("i")
        ),
        params![project_id, LIBRARY],
    )
}

/// What could still be added to a collection: live items of an allowed kind,
/// from the same project, not already inside. Types in ladder order, then name.
pub fn candidates(conn: &Connection, collection_id: &str) -> Result<Vec<Item>, DbError> {
    let collection = require_collection(conn, collection_id)?;
    let allowed = allowed_members(&collection.item_type);
    let placeholders = vec!["?"; allowed.len()].join(", ");
    let sql = format!(
        "SELECT {} FROM items i
         WHERE i.project_id = ? AND (i.library = ? OR i.item_type = 'smart_collection') AND i.deleted_at IS NULL AND i.id <> ?
           AND i.item_type IN ({placeholders})
           AND NOT EXISTS (SELECT 1 FROM collection_members m
                           WHERE m.collection_id = ? AND m.member_id = i.id AND m.deleted_at IS NULL)
         ORDER BY CASE i.item_type WHEN 'card' THEN 0 WHEN 'set' THEN 1 WHEN 'deck' THEN 2 ELSE 3 END,
                  i.name COLLATE NOCASE, i.created_at
         LIMIT 500",
        items::qualified_columns("i")
    );
    let mut args: Vec<&dyn rusqlite::ToSql> = vec![&collection.project_id, &LIBRARY, &collection.id];
    for t in allowed {
        args.push(t);
    }
    args.push(&collection.id);
    query_items(conn, &sql, args.as_slice())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{projects, folders, open_in_memory, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn make(conn: &Connection, camp: &str, kind: &str, name: &str) -> Item {
        items::create(conn, camp, LIBRARY, kind, name, None, 1).unwrap()
    }

    fn names(list: &[Item]) -> Vec<&str> {
        list.iter().map(|i| i.name.as_str()).collect()
    }

    #[test]
    fn the_ladder_of_what_may_hold_what() {
        let (conn, camp) = setup();
        let kinds = [CARD_TYPE, SET_TYPE, DECK_TYPE, POOL_TYPE];
        let allowed = |holder: &str, member: &str| -> bool {
            matches!(
                (holder, member),
                ("set", "card") | ("deck", "card") | ("deck", "set") | ("pool", "card") | ("pool", "set") | ("pool", "deck")
            )
        };
        for holder in kinds {
            for member in kinds {
                let h = make(&conn, &camp, holder, "holder");
                let m = make(&conn, &camp, member, "member");
                let result = add_member(&conn, &h.id, &m.id, 2);
                if allowed(holder, member) {
                    result.unwrap_or_else(|e| panic!("{holder} should hold {member}: {e}"));
                } else {
                    assert!(
                        matches!(result, Err(DbError::Invalid(_))),
                        "{holder} must not hold {member}"
                    );
                }
            }
        }
    }

    #[test]
    fn nothing_goes_inside_itself_and_only_live_items_can_be_used() {
        let (conn, camp) = setup();
        let deck = make(&conn, &camp, DECK_TYPE, "Deck");
        assert!(matches!(add_member(&conn, &deck.id, &deck.id, 2), Err(DbError::Invalid(_))));
        assert!(matches!(add_member(&conn, &deck.id, "nope", 2), Err(DbError::NotFound)));
        assert!(matches!(add_member(&conn, "nope", &deck.id, 2), Err(DbError::NotFound)));
        let card = make(&conn, &camp, CARD_TYPE, "Card");
        items::soft_delete(&conn, &card.id, 3).unwrap();
        assert!(matches!(add_member(&conn, &deck.id, &card.id, 4), Err(DbError::NotFound)));
    }

    #[test]
    fn both_must_be_in_the_same_project() {
        let (conn, camp) = setup();
        let other = projects::create(&conn, "Other", 2).unwrap();
        let deck = make(&conn, &camp, DECK_TYPE, "Deck");
        let foreign = make(&conn, &other.id, CARD_TYPE, "Foreign");
        assert!(matches!(add_member(&conn, &deck.id, &foreign.id, 3), Err(DbError::Invalid(_))));
        assert!(list_members(&conn, &deck.id).unwrap().is_empty());
    }

    #[test]
    fn members_keep_the_order_they_were_added_in() {
        let (conn, camp) = setup();
        let deck = make(&conn, &camp, DECK_TYPE, "Deck");
        for (i, name) in ["Zebra", "Apple", "Mango"].iter().enumerate() {
            let c = make(&conn, &camp, CARD_TYPE, name);
            add_member(&conn, &deck.id, &c.id, 10 + i as i64).unwrap();
        }
        assert_eq!(names(&list_members(&conn, &deck.id).unwrap()), ["Zebra", "Apple", "Mango"]);
    }

    #[test]
    fn adding_twice_is_harmless_and_removing_then_re_adding_revives() {
        let (conn, camp) = setup();
        let deck = make(&conn, &camp, DECK_TYPE, "Deck");
        let a = make(&conn, &camp, CARD_TYPE, "A");
        let b = make(&conn, &camp, CARD_TYPE, "B");
        add_member(&conn, &deck.id, &a.id, 2).unwrap();
        add_member(&conn, &deck.id, &a.id, 3).unwrap();
        add_member(&conn, &deck.id, &b.id, 4).unwrap();
        assert_eq!(names(&list_members(&conn, &deck.id).unwrap()), ["A", "B"]);

        remove_member(&conn, &deck.id, &a.id, 5).unwrap();
        assert_eq!(names(&list_members(&conn, &deck.id).unwrap()), ["B"]);
        assert!(matches!(remove_member(&conn, &deck.id, &a.id, 6), Err(DbError::NotFound)));
        // The item itself is untouched, and the removed link row is kept.
        assert!(items::get(&conn, &a.id).unwrap().deleted_at.is_none());
        let kept: i64 = conn.query_row("SELECT COUNT(*) FROM collection_members", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 2);

        add_member(&conn, &deck.id, &a.id, 7).unwrap(); // revived, now last
        assert_eq!(names(&list_members(&conn, &deck.id).unwrap()), ["B", "A"]);
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM collection_members", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 2, "revived, not duplicated");
    }

    #[test]
    fn a_card_can_be_in_many_collections_and_containers_of_finds_them() {
        let (conn, camp) = setup();
        let card = make(&conn, &camp, CARD_TYPE, "Ace");
        let set = make(&conn, &camp, SET_TYPE, "Hearts");
        let deck = make(&conn, &camp, DECK_TYPE, "Standard");
        let pool = make(&conn, &camp, POOL_TYPE, "Luck");
        for holder in [&set, &deck, &pool] {
            add_member(&conn, &holder.id, &card.id, 2).unwrap();
        }
        let found = containers_of(&conn, &card.id).unwrap();
        assert_eq!(names(&found), ["Standard", "Luck", "Hearts"]); // by type: deck, pool, set
        remove_member(&conn, &deck.id, &card.id, 3).unwrap();
        assert_eq!(names(&containers_of(&conn, &card.id).unwrap()), ["Luck", "Hearts"]);
        // A trashed container is not listed, and comes back on restore.
        items::soft_delete(&conn, &pool.id, 4).unwrap();
        assert_eq!(names(&containers_of(&conn, &card.id).unwrap()), ["Hearts"]);
        trash::restore_item(&conn, &pool.id, 5).unwrap();
        assert_eq!(names(&containers_of(&conn, &card.id).unwrap()), ["Luck", "Hearts"]);
    }

    #[test]
    fn resolve_counts_a_card_reached_by_several_routes_once() {
        let (conn, camp) = setup();
        let c1 = make(&conn, &camp, CARD_TYPE, "One");
        let c2 = make(&conn, &camp, CARD_TYPE, "Two");
        let c3 = make(&conn, &camp, CARD_TYPE, "Three");
        let loose = make(&conn, &camp, CARD_TYPE, "Loose");
        let set = make(&conn, &camp, SET_TYPE, "Set");
        let deck = make(&conn, &camp, DECK_TYPE, "Deck");
        let pool = make(&conn, &camp, POOL_TYPE, "Pool");
        add_member(&conn, &set.id, &c1.id, 2).unwrap();
        add_member(&conn, &set.id, &c2.id, 2).unwrap();
        add_member(&conn, &deck.id, &set.id, 2).unwrap(); // One, Two via the set
        add_member(&conn, &deck.id, &c2.id, 2).unwrap(); // Two again, directly
        add_member(&conn, &deck.id, &c3.id, 2).unwrap();
        add_member(&conn, &pool.id, &deck.id, 2).unwrap();
        add_member(&conn, &pool.id, &set.id, 2).unwrap(); // the same set again, via the pool
        add_member(&conn, &pool.id, &loose.id, 2).unwrap();
        add_member(&conn, &pool.id, &c1.id, 2).unwrap(); // One a third way

        assert_eq!(names(&resolve_cards(&conn, &set.id).unwrap()), ["One", "Two"]);
        assert_eq!(names(&resolve_cards(&conn, &deck.id).unwrap()), ["One", "Two", "Three"]);
        let in_pool = resolve_cards(&conn, &pool.id).unwrap();
        assert_eq!(names(&in_pool), ["One", "Two", "Three", "Loose"]);
        let ids: HashSet<_> = in_pool.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids.len(), in_pool.len());
    }

    #[test]
    fn resolve_skips_trashed_cards_and_sets_and_restores_them_with_the_item() {
        let (conn, camp) = setup();
        let keep = make(&conn, &camp, CARD_TYPE, "Keep");
        let gone = make(&conn, &camp, CARD_TYPE, "Gone");
        let in_set = make(&conn, &camp, CARD_TYPE, "InSet");
        let set = make(&conn, &camp, SET_TYPE, "Set");
        let deck = make(&conn, &camp, DECK_TYPE, "Deck");
        add_member(&conn, &set.id, &in_set.id, 2).unwrap();
        for m in [&keep, &gone, &set] {
            add_member(&conn, &deck.id, &m.id, 2).unwrap();
        }
        assert_eq!(names(&resolve_cards(&conn, &deck.id).unwrap()), ["Keep", "Gone", "InSet"]);

        items::soft_delete(&conn, &gone.id, 3).unwrap();
        items::soft_delete(&conn, &set.id, 3).unwrap();
        assert_eq!(names(&resolve_cards(&conn, &deck.id).unwrap()), ["Keep"]);
        assert_eq!(names(&list_members(&conn, &deck.id).unwrap()), ["Keep"]);

        trash::restore_item(&conn, &gone.id, 4).unwrap();
        trash::restore_item(&conn, &set.id, 4).unwrap();
        assert_eq!(names(&resolve_cards(&conn, &deck.id).unwrap()), ["Keep", "Gone", "InSet"]);
    }

    #[test]
    fn a_trashed_collection_cannot_be_read_but_keeps_its_members() {
        let (conn, camp) = setup();
        let deck = make(&conn, &camp, DECK_TYPE, "Deck");
        let card = make(&conn, &camp, CARD_TYPE, "Card");
        add_member(&conn, &deck.id, &card.id, 2).unwrap();
        items::soft_delete(&conn, &deck.id, 3).unwrap();
        assert!(matches!(list_members(&conn, &deck.id), Err(DbError::NotFound)));
        assert!(matches!(resolve_cards(&conn, &deck.id), Err(DbError::NotFound)));
        assert!(matches!(add_member(&conn, &deck.id, &card.id, 4), Err(DbError::NotFound)));
        trash::restore_item(&conn, &deck.id, 5).unwrap();
        assert_eq!(names(&list_members(&conn, &deck.id).unwrap()), ["Card"]);
    }

    #[test]
    fn a_card_is_not_a_collection() {
        let (conn, camp) = setup();
        let card = make(&conn, &camp, CARD_TYPE, "Card");
        assert!(matches!(list_members(&conn, &card.id), Err(DbError::Invalid(_))));
        assert!(matches!(resolve_cards(&conn, &card.id), Err(DbError::Invalid(_))));
        assert!(matches!(candidates(&conn, &card.id), Err(DbError::Invalid(_))));
    }

    #[test]
    fn purging_an_item_removes_its_membership_rows() {
        let (conn, camp) = setup();
        let deck = make(&conn, &camp, DECK_TYPE, "Deck");
        let card = make(&conn, &camp, CARD_TYPE, "Card");
        add_member(&conn, &deck.id, &card.id, 2).unwrap();
        items::soft_delete(&conn, &card.id, 3).unwrap();
        trash::purge_item(&conn, &card.id).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM collection_members", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
        assert!(list_members(&conn, &deck.id).unwrap().is_empty());
    }

    #[test]
    fn candidates_are_eligible_items_not_already_inside_in_ladder_order() {
        let (conn, camp) = setup();
        let other = projects::create(&conn, "Other", 2).unwrap();
        let pool = make(&conn, &camp, POOL_TYPE, "Pool");
        let inside = make(&conn, &camp, CARD_TYPE, "Inside");
        make(&conn, &camp, CARD_TYPE, "zeta card");
        make(&conn, &camp, CARD_TYPE, "Alpha card");
        make(&conn, &camp, SET_TYPE, "A set");
        make(&conn, &camp, DECK_TYPE, "A deck");
        make(&conn, &camp, POOL_TYPE, "Another pool"); // pools can't hold pools
        make(&conn, &camp, "document", "A document"); // wrong kind of item
        make(&conn, &other.id, CARD_TYPE, "Foreign"); // other project
        let trashed = make(&conn, &camp, CARD_TYPE, "Trashed");
        items::soft_delete(&conn, &trashed.id, 3).unwrap();
        add_member(&conn, &pool.id, &inside.id, 4).unwrap();

        let got = candidates(&conn, &pool.id).unwrap();
        assert_eq!(names(&got), ["Alpha card", "zeta card", "A set", "A deck"]);
        // A set only offers cards.
        let set = make(&conn, &camp, SET_TYPE, "My set");
        assert!(candidates(&conn, &set.id).unwrap().iter().all(|i| i.item_type == CARD_TYPE));
        // Removing a member makes it a candidate again.
        remove_member(&conn, &pool.id, &inside.id, 5).unwrap();
        assert!(names(&candidates(&conn, &pool.id).unwrap()).contains(&"Inside"));
    }

    #[test]
    fn list_all_gives_every_live_set_deck_and_pool_of_the_project() {
        let (conn, camp) = setup();
        let other = projects::create(&conn, "Other", 2).unwrap();
        make(&conn, &camp, SET_TYPE, "b set");
        make(&conn, &camp, DECK_TYPE, "Zed deck");
        make(&conn, &camp, POOL_TYPE, "A pool");
        make(&conn, &camp, DECK_TYPE, "alpha deck");
        make(&conn, &camp, CARD_TYPE, "A card"); // not a collection
        items::create(&conn, &camp, "worldbuilding", SET_TYPE, "Impostor", None, 1).unwrap();
        make(&conn, &other.id, DECK_TYPE, "Foreign deck");
        let gone = make(&conn, &camp, POOL_TYPE, "Trashed pool");
        items::soft_delete(&conn, &gone.id, 3).unwrap();
        assert_eq!(
            names(&list_all(&conn, &camp).unwrap()),
            ["A pool", "alpha deck", "Zed deck", "b set"]
        );
    }

    #[test]
    fn candidates_only_come_from_the_cards_library() {
        let (conn, camp) = setup();
        let deck = make(&conn, &camp, DECK_TYPE, "Deck");
        // A "card" in some other tool's library is not offered.
        items::create(&conn, &camp, "worldbuilding", CARD_TYPE, "Impostor", None, 1).unwrap();
        let folder = folders::create(&conn, &camp, LIBRARY, None, "Folder", 1).unwrap();
        items::create(&conn, &camp, LIBRARY, CARD_TYPE, "In a folder", Some(&folder.id), 1).unwrap();
        // Items in folders are still candidates (folders are only for tidiness).
        assert_eq!(names(&candidates(&conn, &deck.id).unwrap()), ["In a folder"]);
    }
}
