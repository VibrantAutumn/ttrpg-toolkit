//! Starter decks: a ready-made folder of cards (with pictures, values, notes and
//! tags), sets and a deck, added to a campaign in one all-or-nothing step.
//!
//! The app builds a "bundle" (plain data, see `Bundle`) and this module writes
//! it. Everything made carries `origin_pack_id = <bundle id>` (like items that
//! came from a content pack), which is how "already added" is known and how a
//! future "update from original" can find them. Once added they are ordinary
//! items: rename, edit, tag or delete them freely.

use super::cards::{self, CARD_TYPE, DECK_TYPE, LIBRARY, SET_TYPE};
use super::error::{clean_name, DbError};
use super::{campaigns, collections, folders, items, tags};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Every bundle id starts with this, so starters can't be mistaken for pack ids.
pub const ID_PREFIX: &str = "starter:";

pub const MAX_CARDS: usize = 300;
const MAX_SETS: usize = 40;
const MAX_TAGS: usize = 60;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    /// e.g. `starter:tarokka`.
    pub id: String,
    /// Name of the folder everything is put in.
    pub name: String,
    pub deck_name: String,
    pub tags: Vec<BundleTag>,
    pub cards: Vec<BundleCard>,
    pub sets: Vec<BundleSet>,
    /// What goes in the deck, in order: sets (by name) and loose cards (by key).
    pub deck: Vec<BundleMember>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleTag {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleCard {
    /// Unique inside the bundle; remembered as the item's `origin_item_id`.
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub notes: String,
    /// Names of tags from the bundle's `tags`.
    #[serde(default)]
    pub tags: Vec<String>,
    pub image: Option<BundleImage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleImage {
    pub mime: String,
    /// Base64 text (the Android-safe transport).
    pub image: String,
    pub thumb: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleSet {
    pub name: String,
    /// Keys of cards from the bundle, in order.
    pub cards: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "ref")]
pub enum BundleMember {
    Set(String),
    Card(String),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub folder_id: String,
    pub deck_id: String,
    pub cards: u32,
    pub sets: u32,
}

/// Which starters are already in a campaign (any live item that came from one).
pub fn installed(conn: &Connection, campaign_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT origin_pack_id FROM items
         WHERE campaign_id = ?1 AND origin_pack_id LIKE 'starter:%' AND deleted_at IS NULL
         ORDER BY origin_pack_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Checks the whole bundle before anything is written.
fn validate(bundle: &Bundle) -> Result<(), DbError> {
    if !bundle.id.starts_with(ID_PREFIX) || bundle.id.len() > 64 {
        return Err(DbError::Invalid("That isn't a starter deck."));
    }
    clean_name(&bundle.name)?;
    clean_name(&bundle.deck_name)?;
    if bundle.cards.is_empty() || bundle.cards.len() > MAX_CARDS {
        return Err(DbError::Invalid("A starter deck needs between 1 and 300 cards."));
    }
    if bundle.sets.len() > MAX_SETS || bundle.tags.len() > MAX_TAGS {
        return Err(DbError::Invalid("That starter deck is too large."));
    }

    let mut keys = HashSet::new();
    let tag_names: HashSet<&str> = bundle.tags.iter().map(|t| t.name.as_str()).collect();
    for card in &bundle.cards {
        clean_name(&card.name)?;
        if card.key.trim().is_empty() || !keys.insert(card.key.as_str()) {
            return Err(DbError::Invalid("Every starter card needs its own key."));
        }
        cards::validate_details(card.value.trim(), &card.notes)?;
        if card.tags.iter().any(|t| !tag_names.contains(t.as_str())) {
            return Err(DbError::Invalid("A starter card uses a tag the deck doesn't define."));
        }
        if let Some(image) = &card.image {
            let (full, thumb) = (cards::decode_base64(&image.image)?, cards::decode_base64(&image.thumb)?);
            cards::validate_image(&image.mime, &full, &thumb)?;
        }
    }
    let mut set_names = HashSet::new();
    for set in &bundle.sets {
        clean_name(&set.name)?;
        if !set_names.insert(set.name.as_str()) {
            return Err(DbError::Invalid("Starter sets need different names."));
        }
        if set.cards.iter().any(|k| !keys.contains(k.as_str())) {
            return Err(DbError::Invalid("A starter set holds a card that isn't in the deck."));
        }
    }
    for member in &bundle.deck {
        let known = match member {
            BundleMember::Set(name) => set_names.contains(name.as_str()),
            BundleMember::Card(key) => keys.contains(key.as_str()),
        };
        if !known {
            return Err(DbError::Invalid("The starter deck holds something that isn't in the bundle."));
        }
    }
    for tag in &bundle.tags {
        clean_name(&tag.name)?;
    }
    Ok(())
}

/// Puts the bundle into the campaign. All or nothing: a failure part-way leaves
/// the campaign exactly as it was. Refuses if this starter is already there.
pub fn install(conn: &Connection, campaign_id: &str, bundle: &Bundle, now: i64) -> Result<InstallResult, DbError> {
    campaigns::require_live(conn, campaign_id)?;
    validate(bundle)?;
    if installed(conn, campaign_id)?.contains(&bundle.id) {
        return Err(DbError::Invalid("That starter deck has already been added to this campaign."));
    }

    // The checks above run before the first write; from here on one transaction
    // makes the rest all-or-nothing.
    let tx = conn.unchecked_transaction()?;

    // Tags: reuse a top-level tag with the same name, so adding two starters
    // that both use "Hearts" doesn't make two.
    let existing = tags::list(&tx, campaign_id)?;
    let mut tag_ids: HashMap<&str, String> = HashMap::new();
    for tag in &bundle.tags {
        let found = existing
            .iter()
            .find(|t| t.parent_id.is_none() && t.name.eq_ignore_ascii_case(tag.name.trim()));
        let id = match found {
            Some(t) => t.id.clone(),
            None => tags::create(&tx, campaign_id, None, &tag.name, tag.color.as_deref(), now)?.id,
        };
        tag_ids.insert(tag.name.as_str(), id);
    }

    let folder = folders::create(&tx, campaign_id, LIBRARY, None, &bundle.name, now)?;
    let make = |item_type: &str, name: &str, origin: &str| -> Result<String, DbError> {
        let item = items::create(&tx, campaign_id, LIBRARY, item_type, name, Some(&folder.id), now)?;
        tx.execute(
            "UPDATE items SET origin_pack_id = ?2, origin_item_id = ?3 WHERE id = ?1",
            params![item.id, bundle.id, origin],
        )?;
        Ok(item.id)
    };

    let mut card_ids: HashMap<&str, String> = HashMap::new();
    for card in &bundle.cards {
        let id = make(CARD_TYPE, &card.name, &card.key)?;
        if !card.value.trim().is_empty() || !card.notes.is_empty() {
            tx.execute(
                "INSERT INTO card_details (item_id, value, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, card.value.trim(), card.notes, now],
            )?;
        }
        if let Some(image) = &card.image {
            tx.execute(
                "INSERT INTO card_images (item_id, mime, image, thumb, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![id, image.mime, cards::decode_base64(&image.image)?, cards::decode_base64(&image.thumb)?, now],
            )?;
        }
        for tag in &card.tags {
            tags::add_to_item(&tx, &id, &tag_ids[tag.as_str()], now)?;
        }
        card_ids.insert(card.key.as_str(), id);
    }

    let add_member = |collection: &str, member: &str, position: i64| -> Result<(), DbError> {
        tx.execute(
            "INSERT INTO collection_members (collection_id, member_id, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![collection, member, position, now],
        )?;
        Ok(())
    };

    let mut set_ids: HashMap<&str, String> = HashMap::new();
    for set in &bundle.sets {
        let id = make(SET_TYPE, &set.name, &format!("set:{}", set.name))?;
        for (i, key) in set.cards.iter().enumerate() {
            add_member(&id, &card_ids[key.as_str()], i as i64 + 1)?;
        }
        set_ids.insert(set.name.as_str(), id);
    }

    let deck_id = make(DECK_TYPE, &bundle.deck_name, "deck")?;
    let mut added = HashSet::new();
    for (i, member) in bundle.deck.iter().enumerate() {
        let member_id = match member {
            BundleMember::Set(name) => &set_ids[name.as_str()],
            BundleMember::Card(key) => &card_ids[key.as_str()],
        };
        if added.insert(member_id.clone()) {
            add_member(&deck_id, member_id, i as i64 + 1)?;
        }
    }
    debug_assert!(bundle.deck.iter().all(|m| match m {
        BundleMember::Set(_) => collections::may_hold(DECK_TYPE, SET_TYPE),
        BundleMember::Card(_) => collections::may_hold(DECK_TYPE, CARD_TYPE),
    }));

    tx.commit()?;
    Ok(InstallResult {
        folder_id: folder.id,
        deck_id,
        cards: bundle.cards.len() as u32,
        sets: bundle.sets.len() as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::cards::test_images;
    use crate::db::{open_in_memory, search, trash};
    use base64::{engine::general_purpose::STANDARD, Engine};

    fn b64(bytes: &[u8]) -> String {
        STANDARD.encode(bytes)
    }

    fn card(key: &str, name: &str, value: &str, notes: &str, tags: &[&str], image: bool) -> BundleCard {
        BundleCard {
            key: key.into(),
            name: name.into(),
            value: value.into(),
            notes: notes.into(),
            tags: tags.iter().map(|t| t.to_string()).collect(),
            image: image.then(|| BundleImage {
                mime: "image/png".into(),
                image: b64(&test_images::png()),
                thumb: b64(&test_images::png()[..12]),
            }),
        }
    }

    /// Two suits as sets, one loose card, two tags.
    fn bundle() -> Bundle {
        Bundle {
            id: "starter:test".into(),
            name: "Test Cards".into(),
            deck_name: "Test deck".into(),
            tags: vec![
                BundleTag { name: "Hearts".into(), color: Some("#c92a2a".into()) },
                BundleTag { name: "Spades".into(), color: None },
            ],
            cards: vec![
                card("h1", "Ace of Hearts", "A", "Low", &["Hearts"], true),
                card("h2", "Two of Hearts", "2", "", &["Hearts"], false),
                card("s1", "Ace of Spades", "A", "Death card", &["Spades"], true),
                card("j", "Joker", "", "Wild", &[], false),
            ],
            sets: vec![
                BundleSet { name: "Hearts".into(), cards: vec!["h1".into(), "h2".into()] },
                BundleSet { name: "Spades".into(), cards: vec!["s1".into()] },
            ],
            deck: vec![
                BundleMember::Set("Hearts".into()),
                BundleMember::Set("Spades".into()),
                BundleMember::Card("j".into()),
            ],
        }
    }

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn installing_makes_a_folder_with_cards_sets_a_deck_tags_and_pictures() {
        let (conn, camp) = setup();
        let result = install(&conn, &camp, &bundle(), 100).unwrap();
        assert_eq!((result.cards, result.sets), (4, 2));

        let folder = folders::get(&conn, &result.folder_id).unwrap();
        assert_eq!((folder.name.as_str(), folder.library.as_str()), ("Test Cards", "cards"));
        let in_folder = items::list(&conn, &camp, "cards", Some(&result.folder_id)).unwrap();
        let kinds = |t: &str| in_folder.iter().filter(|i| i.item_type == t).count();
        assert_eq!((kinds("card"), kinds("set"), kinds("deck")), (4, 2, 1));

        // The deck holds both sets and the loose card; it reaches all four cards.
        let deck_members: Vec<_> = collections::list_members(&conn, &result.deck_id)
            .unwrap()
            .into_iter()
            .map(|i| i.name)
            .collect();
        assert_eq!(deck_members, ["Hearts", "Spades", "Joker"]);
        let all: Vec<_> = collections::resolve_cards(&conn, &result.deck_id).unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(all, ["Ace of Hearts", "Two of Hearts", "Ace of Spades", "Joker"]);

        // Details, pictures and tags.
        let ace = in_folder.iter().find(|i| i.name == "Ace of Hearts").unwrap();
        let d = cards::get_details(&conn, &ace.id).unwrap();
        assert_eq!((d.value.as_str(), d.notes.as_str()), ("A", "Low"));
        assert!(cards::get_image(&conn, &ace.id).unwrap().is_some());
        let two = in_folder.iter().find(|i| i.name == "Two of Hearts").unwrap();
        assert!(cards::get_image(&conn, &two.id).unwrap().is_none());
        let tag_names: Vec<_> = tags::for_item(&conn, &ace.id).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(tag_names, ["Hearts"]);
        let hearts = tags::list(&conn, &camp).unwrap().into_iter().find(|t| t.name == "Hearts").unwrap();
        assert_eq!(hearts.color.as_deref(), Some("#c92a2a"));
    }

    #[test]
    fn everything_made_remembers_where_it_came_from() {
        let (conn, camp) = setup();
        install(&conn, &camp, &bundle(), 100).unwrap();
        let rows: Vec<(String, String)> = conn
            .prepare("SELECT origin_pack_id, origin_item_id FROM items WHERE campaign_id = ?1 AND item_type = 'card' ORDER BY origin_item_id")
            .unwrap()
            .query_map([&camp], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(rows.len(), 4);
        assert!(rows.iter().all(|(pack, _)| pack == "starter:test"));
        assert_eq!(rows.iter().map(|(_, k)| k.as_str()).collect::<Vec<_>>(), ["h1", "h2", "j", "s1"]);
        assert_eq!(installed(&conn, &camp).unwrap(), ["starter:test"]);
        // Nothing was marked on the (unrelated) campaign next door.
        let other = campaigns::create(&conn, "Other", 2).unwrap();
        assert!(installed(&conn, &other.id).unwrap().is_empty());
    }

    #[test]
    fn the_cards_are_searchable_by_name_note_and_tag() {
        let (conn, camp) = setup();
        install(&conn, &camp, &bundle(), 100).unwrap();
        for query in ["joker", "death", "spades"] {
            assert!(!search::search(&conn, &camp, query, Some("cards"), 10).unwrap().is_empty(), "'{query}'");
        }
    }

    #[test]
    fn adding_the_same_starter_twice_is_refused_and_changes_nothing() {
        let (conn, camp) = setup();
        install(&conn, &camp, &bundle(), 100).unwrap();
        let before = count(&conn, "items");
        let again = install(&conn, &camp, &bundle(), 200);
        assert!(matches!(again, Err(DbError::Invalid(m)) if m.contains("already")));
        assert_eq!(count(&conn, "items"), before);
        assert_eq!(count(&conn, "folders"), 1);
    }

    #[test]
    fn after_the_folder_is_deleted_the_starter_can_be_added_again() {
        let (conn, camp) = setup();
        let first = install(&conn, &camp, &bundle(), 100).unwrap();
        folders::soft_delete(&conn, &first.folder_id, 150).unwrap();
        assert!(installed(&conn, &camp).unwrap().is_empty());
        install(&conn, &camp, &bundle(), 200).unwrap();
        assert_eq!(installed(&conn, &camp).unwrap(), ["starter:test"]);
        // Restoring the old folder brings its items back beside the new ones: nothing was lost.
        trash::restore_folder(&conn, &first.folder_id, 300).unwrap();
        assert_eq!(count(&conn, "folders"), 2);
    }

    #[test]
    fn two_starters_that_share_a_tag_name_share_the_tag() {
        let (conn, camp) = setup();
        install(&conn, &camp, &bundle(), 100).unwrap();
        let mut second = bundle();
        second.id = "starter:second".into();
        install(&conn, &camp, &second, 200).unwrap();
        let hearts = tags::list(&conn, &camp).unwrap().into_iter().filter(|t| t.name == "Hearts").count();
        assert_eq!(hearts, 1);
        assert_eq!(count(&conn, "item_tags"), 6); // 3 tagged cards per install
    }

    #[test]
    fn an_existing_tag_with_the_same_name_is_used_not_duplicated() {
        let (conn, camp) = setup();
        let mine = tags::create(&conn, &camp, None, "hearts", Some("#00ff00"), 5).unwrap();
        install(&conn, &camp, &bundle(), 100).unwrap();
        let all = tags::list(&conn, &camp).unwrap();
        assert_eq!(all.iter().filter(|t| t.name.eq_ignore_ascii_case("hearts")).count(), 1);
        let linked: i64 = conn
            .query_row("SELECT COUNT(*) FROM item_tags WHERE tag_id = ?1", [&mine.id], |r| r.get(0))
            .unwrap();
        assert_eq!(linked, 2);
        assert_eq!(all.iter().find(|t| t.id == mine.id).unwrap().color.as_deref(), Some("#00ff00")); // yours is untouched
    }

    #[test]
    fn installed_cards_are_ordinary_items_that_can_be_edited_and_deleted() {
        let (conn, camp) = setup();
        let result = install(&conn, &camp, &bundle(), 100).unwrap();
        let joker = items::list(&conn, &camp, "cards", Some(&result.folder_id))
            .unwrap()
            .into_iter()
            .find(|i| i.name == "Joker")
            .unwrap();
        items::rename(&conn, &joker.id, "Wild card", 200).unwrap();
        cards::set_details(&conn, &joker.id, "W", "Changed", 201).unwrap();
        items::soft_delete(&conn, &joker.id, 202).unwrap();
        let reached = collections::resolve_cards(&conn, &result.deck_id).unwrap();
        assert_eq!(reached.len(), 3);
    }

    #[test]
    fn a_bad_bundle_is_refused_before_anything_is_written() {
        let (conn, camp) = setup();
        let cases: Vec<(&str, Box<dyn Fn(&mut Bundle)>)> = vec![
            ("id without the starter prefix", Box::new(|b| b.id = "pack:x".into())),
            ("blank folder name", Box::new(|b| b.name = "  ".into())),
            ("blank deck name", Box::new(|b| b.deck_name = "".into())),
            ("no cards", Box::new(|b| {
                b.cards.clear();
                b.sets.clear();
                b.deck.clear();
            })),
            ("duplicate key", Box::new(|b| b.cards[1].key = "h1".into())),
            ("blank key", Box::new(|b| b.cards[0].key = " ".into())),
            ("blank card name", Box::new(|b| b.cards[0].name = "".into())),
            ("unknown tag", Box::new(|b| b.cards[0].tags = vec!["Nope".into()])),
            ("set with an unknown card", Box::new(|b| b.sets[0].cards.push("zzz".into()))),
            ("duplicate set name", Box::new(|b| b.sets[1].name = "Hearts".into())),
            ("deck with an unknown set", Box::new(|b| b.deck.push(BundleMember::Set("Nope".into())))),
            ("deck with an unknown card", Box::new(|b| b.deck.push(BundleMember::Card("zzz".into())))),
            ("a value that is too long", Box::new(|b| b.cards[0].value = "v".repeat(51))),
            ("a picture of the wrong kind", Box::new(|b| {
                b.cards[0].image.as_mut().unwrap().mime = "image/jpeg".into();
            })),
            ("a picture that isn't base64", Box::new(|b| b.cards[0].image.as_mut().unwrap().image = "!!".into())),
            ("too many cards", Box::new(|b| {
                b.cards = (0..=MAX_CARDS).map(|i| card(&format!("k{i}"), "Card", "", "", &[], false)).collect();
                b.sets.clear();
                b.deck.clear();
            })),
        ];
        for (what, change) in cases {
            let mut b = bundle();
            change(&mut b);
            assert!(matches!(install(&conn, &camp, &b, 1), Err(DbError::Invalid(_)) | Err(DbError::EmptyName)), "{what}");
            assert_eq!(count(&conn, "items") + count(&conn, "folders") + count(&conn, "tags"), 0, "{what}");
        }
        assert!(matches!(install(&conn, "no-such-campaign", &bundle(), 1), Err(DbError::NotFound)));
    }

    #[test]
    fn a_failure_part_way_leaves_the_campaign_exactly_as_it_was() {
        let (conn, camp) = setup();
        // The checks pass, but a late step fails (the table for pictures is gone).
        conn.execute_batch("DROP TABLE card_images").unwrap();
        assert!(install(&conn, &camp, &bundle(), 100).is_err());
        for table in ["items", "folders", "tags", "card_details", "collection_members", "item_tags"] {
            assert_eq!(count(&conn, table), 0, "{table} should be empty after a failed install");
        }
    }

    #[test]
    fn the_same_card_listed_twice_in_a_deck_is_added_once() {
        let (conn, camp) = setup();
        let mut b = bundle();
        b.deck.push(BundleMember::Card("j".into()));
        b.deck.push(BundleMember::Set("Hearts".into()));
        let result = install(&conn, &camp, &b, 100).unwrap();
        assert_eq!(collections::list_members(&conn, &result.deck_id).unwrap().len(), 3);
    }

    #[test]
    fn a_bundle_reads_from_json_the_way_the_app_sends_it() {
        let json = r#"{
            "id": "starter:json", "name": "From JSON", "deckName": "Deck",
            "tags": [{"name": "A", "color": null}],
            "cards": [{"key": "c1", "name": "Card One", "value": "1", "notes": "n", "tags": ["A"], "image": null}],
            "sets": [{"name": "S", "cards": ["c1"]}],
            "deck": [{"kind": "set", "ref": "S"}, {"kind": "card", "ref": "c1"}]
        }"#;
        let bundle: Bundle = serde_json::from_str(json).unwrap();
        let (conn, camp) = setup();
        let r = install(&conn, &camp, &bundle, 1).unwrap();
        assert_eq!(collections::resolve_cards(&conn, &r.deck_id).unwrap().len(), 1);
    }
}
