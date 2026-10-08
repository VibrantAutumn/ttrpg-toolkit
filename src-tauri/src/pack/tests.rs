use super::export::export_campaign;
use super::format::*;
use super::import::{import_pack, import_parsed, parent_first, read_pack, read_pack_with, Limits};
use super::PackError;
use crate::db::cards::{self, test_images};
use crate::db::collections;
use crate::db::formulas;
use crate::db::spreads::{self, PositionInput};
use crate::db::tables::{self, EntryInput, Pick};
use crate::db::play_decks::{self, NewPlayDeck};
use crate::db::saved_draws::{self, NewSavedDraw};
use crate::db::saved_rolls::{self, NewSavedRoll};
use crate::db::{campaigns, documents, folders, items, links, open_in_memory, search, settings, tags};
use rusqlite::types::Value;
use rusqlite::Connection;
use serde_json::json;
use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, ZipWriter};

/// A campaign exercising everything a pack carries, with fixed timestamps:
/// nested folders, items in and out of folders, a map, document text, nested and
/// coloured tags, attached and removed tags, links (one removed), and trash
/// (a deleted item, a deleted folder with a deleted item inside, a deleted tag),
/// two saved dice rolls (one in the trash), two formulas (one in the trash), and cards: a card with a picture, a set, a deck and a pool holding each other,
/// a removed member and a trashed card.
fn populate(conn: &Connection) -> String {
    let camp = campaigns::create(conn, "Strahd", 1000).unwrap();
    let c = camp.id.as_str();

    let npcs = folders::create(conn, c, "worldbuilding", None, "NPCs", 1100).unwrap();
    let villains = folders::create(conn, c, "worldbuilding", Some(&npcs.id), "Villains", 1200).unwrap();
    let scrapped = folders::create(conn, c, "worldbuilding", None, "Scrapped", 1250).unwrap();

    let doc = |name: &str, folder: Option<&str>, at: i64, body: &str| {
        let item = items::create(conn, c, "worldbuilding", "document", name, folder, at).unwrap();
        if !body.is_empty() {
            documents::set_body(conn, &item.id, body, at + 10).unwrap();
        }
        item
    };
    let strahd = doc("Strahd", Some(&villains.id), 1300, "# Strahd\nVampire lord of Barovia.");
    let ireena = doc("Ireena", Some(&npcs.id), 1400, "Ireena Kolyana");
    let barovia = doc("Barovia", None, 1500, "A land wrapped in mist.");
    items::create(conn, c, "maps", "map", "Barovia Map", None, 1600).unwrap();
    let old = doc("Old Note", None, 1700, "obsolete");
    doc("Scrap", Some(&scrapped.id), 1750, "");
    items::soft_delete(conn, &old.id, 1800).unwrap();
    folders::soft_delete(conn, &scrapped.id, 1900).unwrap();

    let region = tags::create(conn, c, None, "Region", Some("#112233"), 2000).unwrap();
    let mist = tags::create(conn, c, Some(&region.id), "Mist", None, 2010).unwrap();
    let faction = tags::create(conn, c, None, "Faction", None, 2020).unwrap();
    let gone = tags::create(conn, c, None, "Gone", None, 2030).unwrap();
    tags::add_to_item(conn, &strahd.id, &faction.id, 2200).unwrap();
    tags::add_to_item(conn, &barovia.id, &mist.id, 2210).unwrap();
    tags::add_to_item(conn, &strahd.id, &gone.id, 2220).unwrap();
    tags::add_to_item(conn, &ireena.id, &faction.id, 2230).unwrap();
    tags::remove_from_item(conn, &ireena.id, &faction.id, 2300).unwrap();
    tags::soft_delete(conn, &gone.id, 2100).unwrap();

    links::add(conn, &strahd.id, &barovia.id, links::MANUAL, 2400).unwrap();
    links::add(conn, &ireena.id, &strahd.id, links::MANUAL, 2410).unwrap();
    links::add(conn, &barovia.id, &ireena.id, links::MANUAL, 2420).unwrap();
    links::remove(conn, &barovia.id, &ireena.id, links::MANUAL, 2500).unwrap();

    let roll = |name: &str, seed: i64, at: i64| {
        let new = NewSavedRoll {
            campaign_id: c,
            name,
            folder_id: None,
            notation: "2d6+3",
            seed,
            text: "2d6+3 → [4, 5] + 3 = 12",
            result_json: r#"{"notation":"2d6+3","total":12,"terms":[],"capped":false}"#,
        };
        saved_rolls::create(conn, new, at).unwrap().0
    };
    roll("Sneak attack", 4_000_000_000, 2600);
    let old_roll = roll("Old roll", 7, 2650);
    items::soft_delete(conn, &old_roll.id, 2700).unwrap();

    formulas::create(conn, c, "Attack", None, "1d20+5", 2800).unwrap();
    let old_formula = formulas::create(conn, c, "Old formula", None, "1d4", 2850).unwrap();
    items::soft_delete(conn, &old_formula.id, 2900).unwrap();

    let card = |name: &str, at: i64| items::create(conn, c, "cards", "card", name, None, at).unwrap();
    let fool = card("The Fool", 3000);
    cards::set_details(conn, &fool.id, "0", "Beginnings", 3010).unwrap();
    cards::set_image(conn, &fool.id, "image/png", &test_images::png(), &test_images::png()[..12], 3020).unwrap();
    let cups = card("Two of Cups", 3100);
    let lost = card("Lost card", 3200);
    cards::set_details(conn, &lost.id, "99", "", 3210).unwrap();
    let major = items::create(conn, c, "cards", "set", "Major Arcana", None, 3300).unwrap();
    let tarot = items::create(conn, c, "cards", "deck", "Tarot", None, 3400).unwrap();
    let omens = items::create(conn, c, "cards", "pool", "Omens", None, 3500).unwrap();
    collections::add_member(conn, &major.id, &fool.id, 3600).unwrap();
    collections::add_member(conn, &major.id, &lost.id, 3610).unwrap();
    collections::add_member(conn, &tarot.id, &major.id, 3620).unwrap();
    collections::add_member(conn, &tarot.id, &cups.id, 3630).unwrap();
    collections::add_member(conn, &tarot.id, &fool.id, 3640).unwrap();
    collections::remove_member(conn, &tarot.id, &fool.id, 3650).unwrap();
    collections::add_member(conn, &omens.id, &tarot.id, 3660).unwrap();
    collections::add_member(conn, &omens.id, &fool.id, 3670).unwrap();
    items::soft_delete(conn, &lost.id, 3700).unwrap();

    let reading = NewSavedDraw {
        campaign_id: c,
        name: "Evening reading",
        folder_id: None,
        source_name: "Omens",
        seed: 4_000_000_000,
        text: "Omens → The Fool, Two of Cups (reversed)",
        result_json: r#"{"sourceId":"x","cards":[{"id":"y","name":"The Fool","reversed":false}]}"#,
    };
    let (reading, _) = saved_draws::create(conn, reading, 3800).unwrap();
    saved_draws::set_notes(conn, &reading.id, "A fresh start", 3810).unwrap();

    let game = NewPlayDeck {
        campaign_id: c,
        name: "Harrow game",
        folder_id: None,
        source_id: Some("not-a-real-id"),
        source_name: "Omens",
        state_json: r#"{"version":1,"deck":[{"id":"p","name":"P"}],"drawn":[{"id":"q","name":"Q","reversed":true}]}"#,
    };
    play_decks::create(conn, game, 3900).unwrap();

    let reading = items::create(conn, c, "cards", "spread", "Strahd reading", None, 4000).unwrap();
    let position = |name: &str, source: Option<&str>, meaning: &str| PositionInput {
        name: name.into(),
        source_id: source.map(String::from),
        meaning: meaning.into(),
    };
    spreads::set_positions(
        conn,
        &reading.id,
        &[
            position("Tome", Some(&tarot.id), "The history"),
            position("Icon", Some(&omens.id), ""),
            position("Unchosen", None, "Pick a source"),
        ],
        4010,
    )
    .unwrap();
    spreads::set_notes(conn, &reading.id, "Read it aloud", 4020).unwrap();
    spreads::set_reversals(conn, &reading.id, false, 10, 4030).unwrap();

    // Random tables: settings, ordered weighted entries (one deleted), entry tags (one removed),
    // and a recent pick, which must NOT travel in a pack.
    let rumors = items::create(conn, c, "tables", "table", "Rumors", None, 4100).unwrap();
    tables::set_notes(conn, &rumors.id, "Heard in taverns", 4110).unwrap();
    tables::set_options(conn, &rumors.id, Some(100), 2, 4120).unwrap();
    let entries = tables::add_entries(
        conn,
        &rumors.id,
        &[
            EntryInput { text: "A dragon sleeps under [Mill] (see [draw 1 from Tarot])".into(), weight: 3 },
            EntryInput { text: "Bandits on the road: [2d4]
mind the [Rumors]".into(), weight: 1 },
            EntryInput { text: "An old rumor".into(), weight: 0 },
        ],
        4130,
    )
    .unwrap();
    tables::delete_entry(conn, &entries[2].id, 4140).unwrap();
    tables::add_entry_tag(conn, &entries[0].id, &faction.id, 4150).unwrap();
    tables::add_entry_tag(conn, &entries[1].id, &mist.id, 4155).unwrap();
    tables::remove_entry_tag(conn, &entries[1].id, &mist.id, 4160).unwrap();
    tables::record_recent(conn, &[Pick { table_id: rumors.id.clone(), entry_id: entries[0].id.clone() }], 4170).unwrap();
    let hooks = items::create(conn, c, "tables", "table", "Hooks", None, 4200).unwrap();
    tables::add_entry(conn, &hooks.id, "[3 unique Rumors] and [table:Rumors as R] [R]", 1, 4210).unwrap();

    camp.id
}

/// Runs a query and renders each row as text, so two campaigns can be compared
/// by content (names, dates, relationships) while their ids differ.
fn lines(conn: &Connection, sql: &str, campaign_id: &str) -> Vec<String> {
    let mut stmt = conn.prepare(sql).unwrap();
    let columns = stmt.column_count();
    let mut rows: Vec<String> = stmt
        .query_map([campaign_id], |r| {
            let mut values = Vec::new();
            for i in 0..columns {
                values.push(r.get::<_, Value>(i)?);
            }
            Ok(format!("{values:?}"))
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    rows.sort();
    rows
}

#[derive(Debug, PartialEq)]
struct Snapshot {
    folders: Vec<String>,
    items: Vec<String>,
    tags: Vec<String>,
    item_tags: Vec<String>,
    links: Vec<String>,
    documents: Vec<String>,
    saved_rolls: Vec<String>,
    formulas: Vec<String>,
    card_details: Vec<String>,
    card_images: Vec<String>,
    collection_members: Vec<String>,
    saved_draws: Vec<String>,
    play_decks: Vec<String>,
    spreads: Vec<String>,
    spread_positions: Vec<String>,
    random_tables: Vec<String>,
    table_entries: Vec<String>,
    table_entry_tags: Vec<String>,
}

fn snapshot(conn: &Connection, campaign_id: &str) -> Snapshot {
    Snapshot {
        folders: lines(conn,
            "SELECT f.library, f.name, p.name, f.created_at, f.updated_at, f.deleted_at
             FROM folders f LEFT JOIN folders p ON p.id = f.parent_id WHERE f.campaign_id = ?1", campaign_id),
        items: lines(conn,
            "SELECT i.library, i.item_type, i.name, f.name, i.visibility, i.created_at, i.updated_at, i.deleted_at
             FROM items i LEFT JOIN folders f ON f.id = i.folder_id WHERE i.campaign_id = ?1", campaign_id),
        tags: lines(conn,
            "SELECT t.name, p.name, t.color, t.created_at, t.updated_at, t.deleted_at
             FROM tags t LEFT JOIN tags p ON p.id = t.parent_id WHERE t.campaign_id = ?1", campaign_id),
        item_tags: lines(conn,
            "SELECT i.name, t.name, it.created_at, it.updated_at, it.deleted_at
             FROM item_tags it JOIN items i ON i.id = it.item_id JOIN tags t ON t.id = it.tag_id
             WHERE i.campaign_id = ?1", campaign_id),
        links: lines(conn,
            "SELECT s.name, t.name, l.source_ref, l.created_at, l.updated_at, l.deleted_at
             FROM links l JOIN items s ON s.id = l.source_item_id JOIN items t ON t.id = l.target_item_id
             WHERE s.campaign_id = ?1", campaign_id),
        documents: lines(conn,
            "SELECT i.name, d.body, d.created_at, d.updated_at
             FROM document_content d JOIN items i ON i.id = d.item_id WHERE i.campaign_id = ?1", campaign_id),
        saved_rolls: lines(conn,
            "SELECT i.name, i.library, s.notation, s.seed, s.text, s.result_json, s.created_at, s.updated_at, i.deleted_at
             FROM saved_rolls s JOIN items i ON i.id = s.item_id WHERE i.campaign_id = ?1", campaign_id),
        formulas: lines(conn,
            "SELECT i.name, i.library, f.notation, f.created_at, f.updated_at, i.deleted_at
             FROM formulas f JOIN items i ON i.id = f.item_id WHERE i.campaign_id = ?1", campaign_id),
        card_details: lines(conn,
            "SELECT i.name, d.value, d.notes, d.created_at, d.updated_at, i.deleted_at
             FROM card_details d JOIN items i ON i.id = d.item_id WHERE i.campaign_id = ?1", campaign_id),
        card_images: lines(conn,
            "SELECT i.name, c.mime, c.image, c.thumb, c.created_at, c.updated_at
             FROM card_images c JOIN items i ON i.id = c.item_id WHERE i.campaign_id = ?1", campaign_id),
        collection_members: lines(conn,
            "SELECT h.name, m.name, k.position, k.created_at, k.updated_at, k.deleted_at
             FROM collection_members k JOIN items h ON h.id = k.collection_id JOIN items m ON m.id = k.member_id
             WHERE h.campaign_id = ?1", campaign_id),
        saved_draws: lines(conn,
            "SELECT i.name, i.library, s.source_name, s.seed, s.text, s.result_json, s.notes, s.created_at, s.updated_at, i.deleted_at
             FROM saved_draws s JOIN items i ON i.id = s.item_id WHERE i.campaign_id = ?1", campaign_id),
        play_decks: lines(conn,
            "SELECT i.name, i.library, p.source_name, p.state_json, p.created_at, p.updated_at, i.deleted_at
             FROM play_decks p JOIN items i ON i.id = p.item_id WHERE i.campaign_id = ?1", campaign_id),
        spreads: lines(conn,
            "SELECT i.name, s.notes, s.reversals, s.reversal_percent, s.created_at, s.updated_at, i.deleted_at
             FROM spreads s JOIN items i ON i.id = s.item_id WHERE i.campaign_id = ?1", campaign_id),
        spread_positions: lines(conn,
            "SELECT i.name, p.position, p.name, src.name, p.meaning
             FROM spread_positions p JOIN items i ON i.id = p.spread_id LEFT JOIN items src ON src.id = p.source_id
             WHERE i.campaign_id = ?1", campaign_id),
        random_tables: lines(conn,
            "SELECT i.name, i.library, t.notes, t.die_size, t.avoid_recent, t.created_at, t.updated_at, i.deleted_at
             FROM random_tables t JOIN items i ON i.id = t.item_id WHERE i.campaign_id = ?1", campaign_id),
        table_entries: lines(conn,
            "SELECT i.name, e.position, e.text, e.weight, e.created_at, e.updated_at, e.deleted_at
             FROM table_entries e JOIN items i ON i.id = e.table_id WHERE i.campaign_id = ?1", campaign_id),
        table_entry_tags: lines(conn,
            "SELECT i.name, e.text, t.name, l.created_at, l.updated_at, l.deleted_at
             FROM table_entry_tags l JOIN table_entries e ON e.id = l.entry_id
             JOIN items i ON i.id = e.table_id JOIN tags t ON t.id = l.tag_id WHERE i.campaign_id = ?1", campaign_id),
    }
}

fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        zip.start_file(*name, SimpleFileOptions::default()).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

fn manifest_json(version: u32) -> String {
    json!({
        "format": FORMAT, "formatVersion": version, "packId": "pack-1", "appVersion": "9.9.9",
        "schemaVersion": 8, "createdAt": 5, "campaign": { "name": "Test" }, "counts": {}
    })
    .to_string()
}

/// A pack with a valid manifest and the given data files.
fn pack_with(files: &[(&str, serde_json::Value)]) -> Vec<u8> {
    let manifest = manifest_json(1);
    let rendered: Vec<(String, String)> =
        files.iter().map(|(n, v)| (n.to_string(), v.to_string())).collect();
    let mut entries: Vec<(&str, &[u8])> = vec![(MANIFEST_FILE, manifest.as_bytes())];
    for (name, body) in &rendered {
        entries.push((name.as_str(), body.as_bytes()));
    }
    make_zip(&entries)
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
}

// ------------------------------------------------------------ round trips

#[test]
fn the_manifest_describes_the_pack() {
    let conn = open_in_memory();
    let camp = populate(&conn);
    let pack = read_pack(&export_campaign(&conn, &camp, 5000).unwrap()).unwrap();
    let m = &pack.manifest;
    assert_eq!((m.format.as_str(), m.format_version), (FORMAT, FORMAT_VERSION));
    assert_eq!((m.campaign.name.as_str(), m.created_at), ("Strahd", 5000));
    assert!(!m.pack_id.is_empty() && !m.app_version.is_empty());
    assert_eq!(
        m.counts,
        // 4 documents have text: Strahd, Ireena, Barovia and Old Note ("Scrap" and the map have none).
        // The saved rolls, formulas and cards are items too (21 items: 5 documents, a map, 2 rolls,
        // 2 formulas, 3 cards, a set, a deck, a pool, a saved draw, a deck in play, a spread and 2 tables). 2 cards have details, 1 a picture, 7 membership rows.
        // 1 table has settings; the 2 tables have 4 entries in all (one deleted) and 2 entry tags (one removed).
        Counts {
            folders: 3, items: 21, tags: 4, item_tags: 4, links: 3, documents: 4, saved_rolls: 2, formulas: 2,
            card_details: 2, collection_members: 7, card_images: 1, saved_draws: 1, play_decks: 1, spreads: 1, spread_positions: 3,
            random_tables: 1, table_entries: 4, table_entry_tags: 2,
        }
    );
    assert_eq!(pack.counts(), m.counts);
    assert!(pack.warnings.is_empty(), "a normal export needs no repairs: {:?}", pack.warnings);
}

#[test]
fn a_round_trip_into_the_same_database_makes_an_identical_independent_copy() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let before = snapshot(&conn, &original);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();

    let result = import_pack(&conn, &bytes, 6000).unwrap();
    assert_eq!(result.campaign.name, "Strahd (imported)");
    assert!(result.warnings.is_empty());

    assert_eq!(snapshot(&conn, &result.campaign.id), before);
    // The original is untouched.
    assert_eq!(snapshot(&conn, &original), before);
    // And nothing is shared: every id is new.
    let shared: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM items a JOIN items b ON a.id = b.id AND a.campaign_id <> b.campaign_id",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(shared, 0);
    assert_eq!(count(&conn, "items"), 42);
}

#[test]
fn a_round_trip_into_a_fresh_database_gives_the_same_content() {
    let source = open_in_memory();
    let original = populate(&source);
    let bytes = export_campaign(&source, &original, 5000).unwrap();

    let target = open_in_memory();
    let result = import_pack(&target, &bytes, 6000).unwrap();
    assert_eq!(snapshot(&target, &result.campaign.id), snapshot(&source, &original));
}

#[test]
fn the_trash_comes_back_as_trash_and_can_be_restored() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let trash = crate::db::trash::list(&conn, &imported, "worldbuilding").unwrap();
    let folders: Vec<_> = trash.folders.iter().map(|f| f.name.as_str()).collect();
    let items: Vec<_> = trash.items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(folders, ["Scrapped"]);
    assert_eq!(items, ["Old Note"]);
    // Restoring the folder brings back the item that was deleted with it.
    crate::db::trash::restore_folder(&conn, &trash.folders[0].id, 7000).unwrap();
    assert!(search::search(&conn, &imported, "scrap", None, 10).unwrap().len() == 1);
}

#[test]
fn imported_items_remember_where_they_came_from() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let pack_id = read_pack(&bytes).unwrap().manifest.pack_id;
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let rows: Vec<(String, Option<String>, Option<String>)> = {
        let mut stmt = conn
            .prepare("SELECT name, origin_pack_id, origin_item_id FROM items WHERE campaign_id = ?1")
            .unwrap();
        stmt.query_map([&imported], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };
    assert_eq!(rows.len(), 21);
    for (name, origin_pack, origin_item) in rows {
        assert_eq!(origin_pack.as_deref(), Some(pack_id.as_str()), "{name}");
        // The origin id is the item's id in the ORIGINAL campaign.
        let original_id: String = conn
            .query_row(
                "SELECT id FROM items WHERE campaign_id = ?1 AND name = ?2",
                [&original, &name],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin_item, Some(original_id), "{name}");
    }
    // Items made here have no origin.
    let local: i64 = conn
        .query_row("SELECT COUNT(*) FROM items WHERE campaign_id = ?1 AND origin_pack_id IS NOT NULL", [&original], |r| r.get(0))
        .unwrap();
    assert_eq!(local, 0);
}

#[test]
fn the_imported_campaign_is_searchable_and_linked() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let find = |text: &str| -> Vec<String> {
        search::search(&conn, &imported, text, None, 10).unwrap().into_iter().map(|i| i.name).collect()
    };
    assert_eq!(find("vampire"), ["Strahd"]); // document text
    assert_eq!(find("mist"), ["Barovia"]); // text and tag
    let strahd = search::search(&conn, &imported, "strahd", None, 10).unwrap().remove(0);
    let linked: Vec<_> = links::outgoing(&conn, &strahd.id).unwrap().into_iter().map(|i| i.name).collect();
    assert_eq!(linked, ["Barovia"]);
    let tagged: Vec<_> = tags::for_item(&conn, &strahd.id).unwrap().into_iter().map(|t| t.name).collect();
    assert_eq!(tagged, ["Faction"]); // the trashed tag "Gone" stays hidden
}

#[test]
fn importing_twice_makes_two_separate_copies() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let a = import_pack(&conn, &bytes, 6000).unwrap().campaign;
    let b = import_pack(&conn, &bytes, 6001).unwrap().campaign;
    assert_ne!(a.id, b.id);
    assert_eq!(snapshot(&conn, &a.id), snapshot(&conn, &b.id));
    assert_eq!(count(&conn, "campaigns"), 3);
}

#[test]
fn the_first_import_becomes_the_open_campaign_but_later_ones_do_not_take_over() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    assert!(settings::current_campaign(&conn).unwrap().is_none());
    let first = import_pack(&conn, &bytes, 6000).unwrap().campaign;
    assert_eq!(settings::current_campaign(&conn).unwrap().unwrap().id, first.id);
    import_pack(&conn, &bytes, 6001).unwrap();
    assert_eq!(settings::current_campaign(&conn).unwrap().unwrap().id, first.id);
}

#[test]
fn only_live_campaigns_can_be_exported() {
    let conn = open_in_memory();
    let camp = populate(&conn);
    campaigns::soft_delete(&conn, &camp, 9000).unwrap();
    assert!(export_campaign(&conn, &camp, 9001).is_err());
    assert!(export_campaign(&conn, "nope", 9001).is_err());
}

// --------------------------------------------------------------- transport

#[test]
fn a_pack_survives_the_text_transport_used_between_javascript_and_rust() {
    use super::{decode_from_transport, encode_for_transport};
    let conn = open_in_memory();
    let camp = populate(&conn);
    let bytes = export_campaign(&conn, &camp, 5000).unwrap();
    let text = encode_for_transport(&bytes);
    assert!(text.is_ascii(), "it has to be safe to send as text");
    assert_eq!(decode_from_transport(&text).unwrap(), bytes);
    // Whitespace around the text (e.g. a trailing newline) is tolerated.
    assert_eq!(decode_from_transport(&format!("  {text}\n")).unwrap(), bytes);
    // And every byte value (not just text) round-trips.
    let all: Vec<u8> = (0..=255).collect();
    assert_eq!(decode_from_transport(&encode_for_transport(&all)).unwrap(), all);
    assert!(decode_from_transport(&encode_for_transport(&[])).unwrap().is_empty());
}

#[test]
fn text_that_is_not_valid_transport_data_is_refused() {
    use super::decode_from_transport;
    for bad in ["not base64 !!!", "ab=cd", "\u{201C}quoted\u{201D}"] {
        assert!(
            matches!(decode_from_transport(bad), Err(PackError::NotAPack(_))),
            "{bad:?}"
        );
    }
}

// -------------------------------------------------------------- rejection

#[test]
fn files_that_are_not_packs_are_refused_with_a_clear_reason() {
    let conn = open_in_memory();
    let bad_manifest = make_zip(&[(MANIFEST_FILE, b"not json")]);
    let other_kind = make_zip(&[(MANIFEST_FILE, br#"{"format":"something-else","formatVersion":1}"#)]);
    let no_manifest = make_zip(&[("readme.txt", b"hi")]);
    for (label, bytes) in [
        ("plain text", b"hello world".to_vec()),
        ("empty file", Vec::new()),
        ("zip without a manifest", no_manifest),
        ("manifest that isn't json", bad_manifest),
        ("some other kind of zip", other_kind),
    ] {
        match import_pack(&conn, &bytes, 1) {
            Err(PackError::NotAPack(_)) => {}
            other => panic!("{label}: expected NotAPack, got {other:?}"),
        }
    }
    assert_eq!(count(&conn, "campaigns"), 0);
}

#[test]
fn a_pack_from_a_newer_app_is_refused_and_says_so() {
    let conn = open_in_memory();
    let bytes = make_zip(&[(MANIFEST_FILE, manifest_json(2).as_bytes())]);
    match import_pack(&conn, &bytes, 1) {
        Err(PackError::TooNew { found: 2, supported }) => assert_eq!(supported, FORMAT_VERSION),
        other => panic!("expected TooNew, got {other:?}"),
    }
    let message = import_pack(&conn, &bytes, 1).unwrap_err().to_string();
    assert!(message.contains("newer version"), "{message}");
}

#[test]
fn a_manifest_without_a_usable_version_is_damaged() {
    let conn = open_in_memory();
    for manifest in [
        json!({ "format": FORMAT }),
        json!({ "format": FORMAT, "formatVersion": 0 }),
        json!({ "format": FORMAT, "formatVersion": "one" }),
    ] {
        let bytes = make_zip(&[(MANIFEST_FILE, manifest.to_string().as_bytes())]);
        assert!(matches!(import_pack(&conn, &bytes, 1), Err(PackError::Corrupt(_))), "{manifest}");
    }
}

#[test]
fn truncated_or_garbled_packs_are_refused_without_touching_the_database() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();

    let conn = open_in_memory();
    assert!(import_pack(&conn, &bytes[..bytes.len() / 2], 1).is_err());
    let garbled = pack_with(&[(ITEMS_FILE, json!("this is not a list"))]);
    assert!(matches!(import_pack(&conn, &garbled, 1), Err(PackError::Corrupt(_))));
    let broken_json = make_zip(&[
        (MANIFEST_FILE, manifest_json(1).as_bytes()),
        (ITEMS_FILE, b"{ not json"),
    ]);
    assert!(matches!(import_pack(&conn, &broken_json, 1), Err(PackError::Corrupt(_))));
    assert_eq!(count(&conn, "campaigns"), 0);
}

#[test]
fn oversized_packs_are_refused() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();
    let defaults = Limits::default();
    for limits in [
        Limits { max_entries: 3, ..defaults.clone() },
        Limits { max_entry_bytes: 50, ..defaults.clone() },
        Limits { max_total_bytes: 200, ..defaults.clone() },
    ] {
        assert!(matches!(read_pack_with(&bytes, &limits), Err(PackError::TooLarge)), "{limits:?}");
    }
    assert!(read_pack_with(&bytes, &defaults).is_ok());
}

// ------------------------------------------------------ forward compatibility

#[test]
fn unknown_files_and_unknown_fields_are_ignored() {
    let manifest = manifest_json(1);
    let items = json!([{
        "id": "i1", "library": "w", "itemType": "document", "name": "Kept", "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null,
        "someFutureField": { "nested": true }
    }])
    .to_string();
    let bytes = make_zip(&[
        (MANIFEST_FILE, manifest.as_bytes()),
        (ITEMS_FILE, items.as_bytes()),
        ("data/future_things.json", b"[1,2,3]"),
        ("assets/map.png", b"\x89PNG"),
    ]);
    let conn = open_in_memory();
    let result = import_pack(&conn, &bytes, 10).unwrap();
    assert_eq!(result.counts.items, 1);
    assert!(result.warnings.is_empty());
}

#[test]
fn a_pack_with_no_data_files_imports_as_an_empty_campaign() {
    let conn = open_in_memory();
    let bytes = make_zip(&[(MANIFEST_FILE, manifest_json(1).as_bytes())]);
    let result = import_pack(&conn, &bytes, 10).unwrap();
    assert_eq!(result.campaign.name, "Test (imported)");
    assert_eq!(result.counts, Counts::default());
}

// -------------------------------------------------------- repairing data

fn record(kind: &str, id: &str, extra: serde_json::Value) -> serde_json::Value {
    let mut base = match kind {
        "item" => json!({ "id": id, "library": "w", "itemType": "document", "name": id, "icon": null,
            "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null }),
        "folder" => json!({ "id": id, "library": "w", "parentId": null, "name": id,
            "createdAt": 1, "updatedAt": 1, "deletedAt": null }),
        "tag" => json!({ "id": id, "parentId": null, "name": id, "color": null,
            "createdAt": 1, "updatedAt": 1, "deletedAt": null }),
        other => panic!("unknown kind {other}"),
    };
    for (k, v) in extra.as_object().unwrap() {
        base[k] = v.clone();
    }
    base
}

#[test]
fn inconsistent_data_is_repaired_and_reported_not_fatal() {
    let bytes = pack_with(&[
        (ITEMS_FILE, json!([
            record("item", "i1", json!({ "name": "   ", "folderId": "missing", "visibility": "weird" })),
            record("item", "i1", json!({ "name": "duplicate id" })),
            record("item", "i2", json!({ "itemType": "map", "visibility": "secret" })),
            record("item", "", json!({})),
        ])),
        (TAGS_FILE, json!([
            record("tag", "t1", json!({ "name": "Dup", "color": "red" })),
            record("tag", "t2", json!({ "name": "dup" })),
            record("tag", "t3", json!({ "name": "Orphan", "parentId": "nope" })),
            record("tag", "t4", json!({ "name": "   " })),
        ])),
        (ITEM_TAGS_FILE, json!([
            { "itemId": "i1", "tagId": "t1", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "itemId": "i1", "tagId": "t1", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "itemId": "ghost", "tagId": "t1", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "itemId": "i1", "tagId": "ghost", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
        ])),
        (LINKS_FILE, json!([
            { "sourceItemId": "i1", "targetItemId": "i1", "sourceRef": "manual", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "sourceItemId": "i1", "targetItemId": "i2", "sourceRef": "", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "sourceItemId": "i1", "targetItemId": "ghost", "sourceRef": "manual", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
        ])),
        (DOCUMENTS_FILE, json!([
            { "itemId": "i1", "body": "hello", "createdAt": 1, "updatedAt": 1 },
            { "itemId": "i2", "body": "documents can't live on a map", "createdAt": 1, "updatedAt": 1 },
            { "itemId": "ghost", "body": "nobody's", "createdAt": 1, "updatedAt": 1 },
        ])),
    ]);

    let pack = read_pack(&bytes).unwrap();
    assert!(pack.warnings.len() >= 6, "{:?}", pack.warnings);
    assert!(pack.warnings.iter().all(|w| w.chars().next().unwrap().is_ascii_digit()));
    assert_eq!(
        pack.counts(),
        Counts { folders: 0, items: 2, tags: 3, item_tags: 1, links: 1, documents: 1, saved_rolls: 0, formulas: 0, card_details: 0, collection_members: 0, card_images: 0, saved_draws: 0, play_decks: 0, spreads: 0, spread_positions: 0, random_tables: 0, table_entries: 0, table_entry_tags: 0 }
    );

    let conn = open_in_memory();
    let result = import_parsed(&conn, &pack, 10).unwrap();
    let camp = result.campaign.id;
    let names = |sql: &str| -> Vec<String> { lines(&conn, sql, &camp) };
    // Blank name, unknown visibility and missing folder are fixed on the first item.
    let first = names("SELECT name, visibility, folder_id FROM items WHERE origin_item_id = 'i1' AND campaign_id = ?1");
    assert_eq!(first, [r#"[Text("Untitled"), Text("default"), Null]"#]);
    // The invalid colour is dropped, the clashing name renamed, the orphan moved up.
    let tag_names = names("SELECT name, parent_id IS NULL, color FROM tags WHERE campaign_id = ?1");
    assert_eq!(
        tag_names,
        [
            r#"[Text("Dup"), Integer(1), Null]"#,
            r#"[Text("Orphan"), Integer(1), Null]"#,
            r#"[Text("dup (2)"), Integer(1), Null]"#,
        ]
    );
    // The link with a blank source_ref became a normal manual link.
    let link_refs = names("SELECT l.source_ref FROM links l JOIN items s ON s.id = l.source_item_id WHERE s.campaign_id = ?1");
    assert_eq!(link_refs, [r#"[Text("manual")]"#]);
}

#[test]
fn parent_loops_in_folders_and_tags_are_broken() {
    let bytes = pack_with(&[
        (FOLDERS_FILE, json!([
            record("folder", "a", json!({ "parentId": "b" })),
            record("folder", "b", json!({ "parentId": "a" })),
            record("folder", "self", json!({ "parentId": "self" })),
        ])),
        (TAGS_FILE, json!([
            record("tag", "x", json!({ "parentId": "y" })),
            record("tag", "y", json!({ "parentId": "x" })),
        ])),
    ]);
    let conn = open_in_memory();
    let result = import_pack(&conn, &bytes, 10).unwrap();
    assert_eq!(result.counts.folders, 3);
    assert_eq!(result.counts.tags, 2);
    assert!(result.warnings.iter().any(|w| w.contains("loop")), "{:?}", result.warnings);
    let camp = result.campaign.id;
    // A loop of two is cut in exactly one place; a self-parent becomes top level.
    let roots: i64 = conn
        .query_row("SELECT COUNT(*) FROM folders WHERE campaign_id = ?1 AND parent_id IS NULL", [&camp], |r| r.get(0))
        .unwrap();
    assert_eq!(roots, 2);
    let tag_roots: i64 = conn
        .query_row("SELECT COUNT(*) FROM tags WHERE campaign_id = ?1 AND parent_id IS NULL", [&camp], |r| r.get(0))
        .unwrap();
    assert_eq!(tag_roots, 1);
}

#[test]
fn parent_first_puts_parents_before_children_whatever_the_input_order() {
    // (id, parent)
    let records = vec![("c", Some("b")), ("a", None), ("b", Some("a")), ("d", Some("b"))];
    let (ordered, broken) = parent_first(
        records,
        |r| r.0.to_string(),
        |r| r.1.map(String::from),
        |r| r.1 = None,
    );
    assert_eq!(broken, 0);
    let position = |id: &str| ordered.iter().position(|r| r.0 == id).unwrap();
    assert_eq!(ordered.len(), 4);
    assert!(position("a") < position("b"));
    assert!(position("b") < position("c"));
    assert!(position("b") < position("d"));
}

#[test]
fn parent_first_breaks_loops_and_keeps_every_record() {
    let records = vec![("a", Some("b")), ("b", Some("a")), ("s", Some("s")), ("ok", None)];
    let (ordered, broken) = parent_first(
        records,
        |r| r.0.to_string(),
        |r| r.1.map(String::from),
        |r| r.1 = None,
    );
    assert_eq!(broken, 2);
    assert_eq!(ordered.len(), 4);
    assert_eq!(ordered.iter().filter(|r| r.1.is_none()).count(), 3);
}

// ------------------------------------------------------------ golden file

const GOLDEN_PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/pack_v1.ttrpgpack");

/// Writes the version 1 golden pack. This is meant to run ONCE, when format
/// version 1 is first released, and the result is committed. NEVER regenerate it
/// to make a failing golden test pass: the file is the promise that old packs
/// keep importing. When the format changes, ADD a new golden file (pack_v2...).
///   cargo test regenerate_golden_pack -- --ignored
#[test]
#[ignore]
fn regenerate_golden_pack() {
    let conn = open_in_memory();
    let camp = populate(&conn);
    let bytes = export_campaign(&conn, &camp, 5000).unwrap();
    std::fs::create_dir_all(std::path::Path::new(GOLDEN_PATH).parent().unwrap()).unwrap();
    std::fs::write(GOLDEN_PATH, bytes).unwrap();
}

/// The committed version 1 pack must import in every future version of the app.
/// If this fails after a change, the change broke old packs: fix the importer,
/// never the file.
#[test]
fn the_committed_version_1_pack_still_imports() {
    let bytes = include_bytes!("../../tests/fixtures/pack_v1.ttrpgpack");
    let pack = read_pack(bytes).unwrap();
    assert_eq!(pack.manifest.format_version, 1);
    assert!(pack.warnings.is_empty(), "{:?}", pack.warnings);

    let conn = open_in_memory();
    let result = import_parsed(&conn, &pack, 9000).unwrap();
    assert_eq!(result.campaign.name, "Strahd (imported)");
    assert_eq!(
        result.counts,
        Counts { folders: 3, items: 6, tags: 4, item_tags: 4, links: 3, documents: 4, saved_rolls: 0, formulas: 0, card_details: 0, collection_members: 0, card_images: 0, saved_draws: 0, play_decks: 0, spreads: 0, spread_positions: 0, random_tables: 0, table_entries: 0, table_entry_tags: 0 }
    );
    let camp = result.campaign.id;

    // Document text, search, tags, links and the nested folder all came through.
    let found = search::search(&conn, &camp, "vampire", None, 10).unwrap();
    assert_eq!(found.len(), 1);
    let strahd = &found[0];
    assert_eq!(strahd.name, "Strahd");
    assert_eq!(documents::get_body(&conn, &strahd.id).unwrap(), "# Strahd\nVampire lord of Barovia.");
    let folder = folders::get(&conn, strahd.folder_id.as_deref().unwrap()).unwrap();
    assert_eq!(folder.name, "Villains");
    let parent = folders::get(&conn, folder.parent_id.as_deref().unwrap()).unwrap();
    assert_eq!(parent.name, "NPCs");
    let linked: Vec<_> = links::outgoing(&conn, &strahd.id).unwrap().into_iter().map(|i| i.name).collect();
    assert_eq!(linked, ["Barovia"]);
    let tagged: Vec<_> = tags::for_item(&conn, &strahd.id).unwrap().into_iter().map(|t| t.name).collect();
    assert_eq!(tagged, ["Faction"]);
    let all_tags = tags::list(&conn, &camp).unwrap();
    let region = all_tags.iter().find(|t| t.name == "Region").unwrap();
    assert_eq!(region.color.as_deref(), Some("#112233"));
    assert!(all_tags.iter().any(|t| t.name == "Mist" && t.parent_id.as_deref() == Some(region.id.as_str())));

    // The trash survived too.
    let trash = crate::db::trash::list(&conn, &camp, "worldbuilding").unwrap();
    assert_eq!(trash.folders.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["Scrapped"]);
    assert_eq!(trash.items.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["Old Note"]);
}

// ----------------------------------------------------- all-or-nothing

#[test]
fn a_failed_import_leaves_the_database_exactly_as_it_was() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();

    // Sabotage the target so the import fails PART WAY (after the campaign,
    // folders, tags, items, tag links and links were already written).
    let target = open_in_memory();
    target.execute_batch("DROP TABLE document_content").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["campaigns", "folders", "items", "tags", "item_tags", "links", "app_settings"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn bad_files_never_create_a_campaign() {
    let conn = open_in_memory();
    let before = count(&conn, "campaigns");
    let _ = import_pack(&conn, b"garbage", 1);
    let _ = import_pack(&conn, &make_zip(&[(MANIFEST_FILE, manifest_json(2).as_bytes())]), 1);
    assert_eq!(count(&conn, "campaigns"), before);
}

#[test]
fn a_failed_import_also_rolls_back_saved_rolls() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();

    // Break only the LAST thing the importer writes.
    let target = open_in_memory();
    target.execute_batch("DROP TABLE saved_rolls").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["campaigns", "folders", "items", "tags", "document_content"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn saved_rolls_keep_their_trash_state_and_stay_in_the_dice_library() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let live = items::list(&conn, &imported, "dice", None).unwrap();
    assert_eq!(live.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["Attack", "Sneak attack"]);
    let roll = saved_rolls::get(&conn, &live[1].id).unwrap();
    assert_eq!(roll.seed, 4_000_000_000);
    assert_eq!(roll.text, "2d6+3 → [4, 5] + 3 = 12");

    let trash = crate::db::trash::list(&conn, &imported, "dice").unwrap();
    let mut trashed: Vec<_> = trash.items.iter().map(|i| i.name.as_str()).collect();
    trashed.sort();
    assert_eq!(trashed, ["Old formula", "Old roll"]);
    // And the roll's text is searchable after import.
    assert_eq!(search::search(&conn, &imported, "sneak", Some("dice"), 10).unwrap().len(), 1);
}

#[test]
fn unreadable_or_orphaned_saved_rolls_are_skipped_with_a_warning() {
    let good = r#"{"notation":"1d6","total":3}"#;
    let bytes = pack_with(&[
        (ITEMS_FILE, json!([
            { "id": "r1", "library": "dice", "itemType": "saved_roll", "name": "Good", "icon": null,
              "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "id": "r2", "library": "dice", "itemType": "saved_roll", "name": "Broken", "icon": null,
              "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "id": "d1", "library": "worldbuilding", "itemType": "document", "name": "Doc", "icon": null,
              "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
        ])),
        (SAVED_ROLLS_FILE, json!([
            { "itemId": "r1", "notation": "1d6", "seed": 1, "text": "1d6 → [3] = 3", "resultJson": good, "createdAt": 1, "updatedAt": 1 },
            { "itemId": "r2", "notation": "1d6", "seed": 1, "text": "1d6 → [3] = 3", "resultJson": "not json", "createdAt": 1, "updatedAt": 1 },
            { "itemId": "d1", "notation": "1d6", "seed": 1, "text": "x", "resultJson": good, "createdAt": 1, "updatedAt": 1 },
            { "itemId": "ghost", "notation": "1d6", "seed": 1, "text": "x", "resultJson": good, "createdAt": 1, "updatedAt": 1 },
            { "itemId": "r1", "notation": "1d6", "seed": 2, "text": "dupe", "resultJson": good, "createdAt": 1, "updatedAt": 1 },
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.saved_rolls.len(), 1);
    assert_eq!(pack.warnings.len(), 1);
    assert!(pack.warnings[0].starts_with("4 saved roll(s)"), "{:?}", pack.warnings);

    // The item whose details were dropped still imports (as an item without details).
    let conn = open_in_memory();
    let camp = import_parsed(&conn, &pack, 10).unwrap().campaign.id;
    assert_eq!(items::list(&conn, &camp, "dice", None).unwrap().len(), 2);
    assert_eq!(count(&conn, "saved_rolls"), 1);
}

#[test]
fn formulas_round_trip_with_their_trash_state() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let list = formulas::list(&conn, &imported).unwrap();
    assert_eq!(list.len(), 1, "the trashed formula is not in the live list");
    assert_eq!((list[0].name.as_str(), list[0].notation.as_str()), ("Attack", "1d20+5"));
    // The trashed one came back as trash, with its notation, and can be restored.
    let trash = crate::db::trash::list(&conn, &imported, "dice").unwrap();
    let old = trash.items.iter().find(|i| i.name == "Old formula").unwrap();
    crate::db::trash::restore_item(&conn, &old.id, 7000).unwrap();
    assert_eq!(formulas::get(&conn, &old.id).unwrap().notation, "1d4");
    // Formula notation is searchable after import.
    assert_eq!(search::search(&conn, &imported, "1d20", Some("dice"), 10).unwrap().len(), 1);
}

#[test]
fn unreadable_or_orphaned_formulas_are_skipped_with_a_warning() {
    let item = |id: &str, kind: &str| json!({
        "id": id, "library": "dice", "itemType": kind, "name": id, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let bytes = pack_with(&[
        (ITEMS_FILE, json!([item("f1", "formula"), item("f2", "formula"), item("r1", "saved_roll")])),
        (FORMULAS_FILE, json!([
            { "itemId": "f1", "notation": "1d20+5", "createdAt": 1, "updatedAt": 1 },
            { "itemId": "f2", "notation": "   ", "createdAt": 1, "updatedAt": 1 },
            { "itemId": "r1", "notation": "1d6", "createdAt": 1, "updatedAt": 1 },
            { "itemId": "ghost", "notation": "1d6", "createdAt": 1, "updatedAt": 1 },
            { "itemId": "f1", "notation": "dupe", "createdAt": 1, "updatedAt": 1 },
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.formulas.len(), 1);
    assert_eq!(pack.warnings.len(), 1);
    assert!(pack.warnings[0].starts_with("4 formula(s)"), "{:?}", pack.warnings);
    let conn = open_in_memory();
    import_parsed(&conn, &pack, 10).unwrap();
    assert_eq!(count(&conn, "formulas"), 1);
}

#[test]
fn a_failed_import_also_rolls_back_formulas() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE formulas").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["campaigns", "items", "saved_rolls", "document_content"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

// ------------------------------------------------------------------ cards

fn pool_cards(conn: &Connection, campaign: &str) -> Vec<String> {
    let pool = items::list(conn, campaign, "cards", None)
        .unwrap()
        .into_iter()
        .find(|i| i.name == "Omens")
        .unwrap();
    collections::resolve_cards(conn, &pool.id).unwrap().into_iter().map(|c| c.name).collect()
}

#[test]
fn cards_pictures_and_membership_survive_a_round_trip() {
    let conn = open_in_memory();
    let original = populate(&conn);
    // The pool reaches the Fool (via the set, and directly) and Two of Cups once each;
    // the trashed card and the removed member do not count.
    assert_eq!(pool_cards(&conn, &original), ["The Fool", "Two of Cups"]);

    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;
    assert_eq!(pool_cards(&conn, &imported), ["The Fool", "Two of Cups"]);

    let fool = items::list(&conn, &imported, "cards", None).unwrap().into_iter().find(|i| i.name == "The Fool").unwrap();
    let details = cards::get_details(&conn, &fool.id).unwrap();
    assert_eq!((details.value.as_str(), details.notes.as_str()), ("0", "Beginnings"));
    let image = cards::get_image(&conn, &fool.id).unwrap().unwrap();
    assert_eq!(image.mime, "image/png");
    assert_eq!(cards::decode_base64(&image.data).unwrap(), test_images::png());
    let containers: Vec<_> = collections::containers_of(&conn, &fool.id).unwrap().into_iter().map(|i| i.name).collect();
    assert_eq!(containers, ["Omens", "Major Arcana"]);
    // Search finds the card by its notes.
    assert_eq!(search::search(&conn, &imported, "beginnings", Some("cards"), 10).unwrap().len(), 1);

    // The trashed card came back as trash, and restoring it puts it back in its set.
    let trash = crate::db::trash::list(&conn, &imported, "cards").unwrap();
    assert_eq!(trash.items.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["Lost card"]);
    crate::db::trash::restore_item(&conn, &trash.items[0].id, 7000).unwrap();
    assert_eq!(pool_cards(&conn, &imported), ["The Fool", "Lost card", "Two of Cups"]);
}

#[test]
fn pictures_are_separate_files_and_many_cards_do_not_hit_the_entry_limit() {
    let conn = open_in_memory();
    let camp = campaigns::create(&conn, "Big deck", 1).unwrap().id;
    let png = test_images::png();
    for n in 0..150 {
        let card = items::create(&conn, &camp, "cards", "card", &format!("Card {n}"), None, 10).unwrap();
        cards::set_image(&conn, &card.id, "image/png", &png, &png[..12], 11).unwrap();
    }
    let bytes = export_campaign(&conn, &camp, 5000).unwrap();

    let names: Vec<String> = {
        let mut archive = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
        (0..archive.len()).map(|i| archive.by_index(i).unwrap().name().to_string()).collect()
    };
    // 150 pictures + 150 thumbnails as their own files, far past the old limit of 100 entries.
    assert_eq!(names.iter().filter(|n| n.starts_with("assets/cards/")).count(), 300);
    assert!(names.iter().any(|n| n.ends_with(".thumb.png")));

    let pack = read_pack(&bytes).unwrap();
    assert!(pack.warnings.is_empty(), "{:?}", pack.warnings);
    assert_eq!(pack.counts().card_images, 150);
    let imported = import_parsed(&open_in_memory(), &pack, 6000).unwrap();
    assert_eq!(imported.counts.card_images, 150);
}

#[test]
fn bad_card_data_in_a_pack_is_skipped_with_warnings() {
    let item = |id: &str, library: &str, kind: &str| json!({
        "id": id, "library": library, "itemType": kind, "name": id, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let png = test_images::png();
    let jpeg = test_images::jpeg();
    let member = |c: &str, m: &str| json!({
        "collectionId": c, "memberId": m, "position": 1, "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let image = |id: &str, mime: &str, img: &str, thumb: &str| json!({
        "itemId": id, "mime": mime, "imageFile": img, "thumbFile": thumb, "createdAt": 1, "updatedAt": 1
    });
    let manifest = manifest_json(1);
    let items_json = json!([
        item("card1", "cards", "card"), item("card2", "cards", "card"), item("card3", "cards", "card"),
        item("set1", "cards", "set"), item("deck1", "cards", "deck"), item("doc1", "worldbuilding", "document"),
    ])
    .to_string();
    let details = json!([
        { "itemId": "card1", "value": "7", "notes": "fine", "createdAt": 1, "updatedAt": 1 },
        { "itemId": "doc1", "value": "x", "notes": "not a card", "createdAt": 1, "updatedAt": 1 },
        { "itemId": "card1", "value": "dupe", "notes": "", "createdAt": 1, "updatedAt": 1 },
        { "itemId": "ghost", "value": "x", "notes": "", "createdAt": 1, "updatedAt": 1 },
    ])
    .to_string();
    let members = json!([
        member("set1", "card1"),   // fine
        member("set1", "deck1"),   // a set can't hold a deck
        member("deck1", "set1"),   // fine
        member("deck1", "deck1"),  // itself
        member("set1", "ghost"),   // missing
        member("set1", "card1"),   // duplicate
        member("card1", "card2"),  // a card holds nothing
    ])
    .to_string();
    let images = json!([
        image("card1", "image/png", "assets/cards/card1.png", "assets/cards/card1.thumb.png"), // fine
        image("card2", "image/png", "assets/cards/card2.png", "assets/cards/card2.thumb.png"), // image file missing
        image("card3", "image/png", "assets/cards/card3.png", "assets/cards/card3.thumb.png"), // really a JPEG
        image("doc1", "image/png", "assets/cards/card1.png", "assets/cards/card1.thumb.png"),  // not a card
        image("card1", "image/png", "assets/cards/card1.png", "assets/cards/card1.thumb.png"), // duplicate
        image("card3", "image/gif", "assets/cards/card3.png", "assets/cards/card3.thumb.png"), // unknown type
        image("card2", "image/png", "elsewhere/card1.png", "elsewhere/card1.thumb.png"),       // outside assets/cards/
    ])
    .to_string();
    let bytes = make_zip(&[
        (MANIFEST_FILE, manifest.as_bytes()),
        (ITEMS_FILE, items_json.as_bytes()),
        (CARD_DETAILS_FILE, details.as_bytes()),
        (COLLECTION_MEMBERS_FILE, members.as_bytes()),
        (CARD_IMAGES_FILE, images.as_bytes()),
        ("assets/cards/card1.png", &png),
        ("assets/cards/card1.thumb.png", &png[..12]),
        ("assets/cards/card3.png", &jpeg),
        ("assets/cards/card3.thumb.png", &jpeg),
    ]);

    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.card_details.len(), 1);
    assert_eq!(pack.collection_members.len(), 2);
    assert_eq!(pack.card_images.len(), 1);
    assert_eq!(pack.warnings.len(), 3, "{:?}", pack.warnings);
    assert!(pack.warnings.iter().any(|w| w.starts_with("3 card value/notes")), "{:?}", pack.warnings);
    assert!(pack.warnings.iter().any(|w| w.starts_with("5 set/deck/pool")), "{:?}", pack.warnings);
    assert!(pack.warnings.iter().any(|w| w.starts_with("6 card picture")), "{:?}", pack.warnings);

    // What was kept imports; the cards whose pictures were dropped still exist.
    let conn = open_in_memory();
    let camp = import_parsed(&conn, &pack, 10).unwrap().campaign.id;
    assert_eq!(items::list(&conn, &camp, "cards", None).unwrap().len(), 5);
    assert_eq!(count(&conn, "card_images"), 1);
    assert_eq!(count(&conn, "collection_members"), 2);
}

#[test]
fn a_failed_import_also_rolls_back_cards() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();
    // Break only the LAST thing the importer writes.
    let target = open_in_memory();
    target.execute_batch("DROP TABLE collection_members").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["campaigns", "items", "card_details", "card_images", "formulas"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn the_committed_version_1_pack_has_no_cards_and_still_imports() {
    // The golden pack predates cards: the missing card files count as empty.
    let bytes = include_bytes!("../../tests/fixtures/pack_v1.ttrpgpack");
    let pack = read_pack(bytes).unwrap();
    assert!(pack.card_details.is_empty() && pack.collection_members.is_empty() && pack.card_images.is_empty());
    assert!(pack.warnings.is_empty());
}

#[test]
fn saved_draws_keep_their_notes_and_trash_state_through_a_round_trip() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let reading = items::list(&conn, &imported, "cards", None)
        .unwrap()
        .into_iter()
        .find(|i| i.item_type == "draw")
        .unwrap();
    assert_eq!(reading.name, "Evening reading");
    let draw = saved_draws::get(&conn, &reading.id).unwrap();
    assert_eq!((draw.source_name.as_str(), draw.notes.as_str()), ("Omens", "A fresh start"));
    assert_eq!(draw.seed, 4_000_000_000);
    // Searchable by its notes and by the card names after import.
    assert_eq!(search::search(&conn, &imported, "fresh", Some("cards"), 10).unwrap().len(), 1);
    assert_eq!(search::search(&conn, &imported, "reversed", Some("cards"), 10).unwrap().len(), 1);
}

#[test]
fn unreadable_or_orphaned_saved_draws_are_skipped_with_a_warning() {
    let item = |id: &str, kind: &str| json!({
        "id": id, "library": "cards", "itemType": kind, "name": id, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let record = |id: &str, result: &str| json!({
        "itemId": id, "sourceName": "Tarot", "seed": 1, "text": "Tarot → The Fool", "resultJson": result,
        "notes": "", "createdAt": 1, "updatedAt": 1
    });
    let good = r#"{"cards":[]}"#;
    let bytes = pack_with(&[
        (ITEMS_FILE, json!([item("d1", "draw"), item("d2", "draw"), item("c1", "card")])),
        (SAVED_DRAWS_FILE, json!([
            record("d1", good),
            record("d2", "not json"),
            record("c1", good),
            record("ghost", good),
            record("d1", good),
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.saved_draws.len(), 1);
    assert_eq!(pack.warnings.len(), 1);
    assert!(pack.warnings[0].starts_with("4 saved draw(s)"), "{:?}", pack.warnings);
    let conn = open_in_memory();
    import_parsed(&conn, &pack, 10).unwrap();
    assert_eq!(count(&conn, "saved_draws"), 1);
}

#[test]
fn a_failed_import_also_rolls_back_saved_draws() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE saved_draws").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["campaigns", "items", "card_details", "collection_members", "formulas"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn decks_in_play_round_trip_with_their_trash_state() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let list = play_decks::list(&conn, &imported).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!((list[0].name.as_str(), list[0].source_name.as_str()), ("Harrow game", "Omens"));
    assert_eq!((list[0].remaining, list[0].drawn), (1, 1));
    // A source that wasn't in the pack can't be pointed at, so it is cleared.
    assert_eq!(play_decks::get(&conn, &list[0].item_id).unwrap().source_id, None);
    assert_eq!(search::search(&conn, &imported, "harrow", Some("cards"), 10).unwrap().len(), 1);
}

#[test]
fn saved_draws_and_games_follow_their_cards_to_the_new_ids() {
    use serde_json::Value;
    let conn = open_in_memory();
    let camp = campaigns::create(&conn, "Readings", 1).unwrap().id;
    let fool = items::create(&conn, &camp, "cards", "card", "The Fool", None, 10).unwrap();
    let cups = items::create(&conn, &camp, "cards", "card", "Two of Cups", None, 11).unwrap();
    let deck = items::create(&conn, &camp, "cards", "deck", "Tarot", None, 12).unwrap();
    collections::add_member(&conn, &deck.id, &fool.id, 13).unwrap();
    collections::add_member(&conn, &deck.id, &cups.id, 14).unwrap();

    let draw_json = format!(
        r#"{{"sourceId":"{}","options":{{"count":2}},"cards":[{{"id":"{}","name":"The Fool","reversed":false}},{{"id":"{}","name":"Two of Cups","reversed":true}},{{"id":"gone-card","name":"Deleted card","reversed":false}}]}}"#,
        deck.id, fool.id, cups.id
    );
    let new_draw = NewSavedDraw {
        campaign_id: &camp, name: "Reading", folder_id: None, source_name: "Tarot", seed: 1,
        text: "Tarot -> The Fool", result_json: &draw_json,
    };
    saved_draws::create(&conn, new_draw, 20).unwrap();
    let state_json = format!(
        r#"{{"version":1,"seed":5,"deck":[{{"id":"{}","name":"The Fool"}}],"drawn":[{{"id":"{}","name":"Two of Cups","reversed":true}}]}}"#,
        fool.id, cups.id
    );
    let game = NewPlayDeck {
        campaign_id: &camp, name: "Game", folder_id: None, source_id: Some(&deck.id),
        source_name: "Tarot", state_json: &state_json,
    };
    play_decks::create(&conn, game, 21).unwrap();

    let bytes = export_campaign(&conn, &camp, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let find = |name: &str| {
        items::list(&conn, &imported, "cards", None).unwrap().into_iter().find(|i| i.name == name).unwrap()
    };
    let (new_fool, new_cups, new_deck) = (find("The Fool"), find("Two of Cups"), find("Tarot"));
    assert_ne!(new_fool.id, fool.id);

    // Saved draw: the cards and the source now point at the imported items;
    // an id that matched nothing in the pack is left alone.
    let reading = find("Reading");
    let json: Value = serde_json::from_str(&saved_draws::get(&conn, &reading.id).unwrap().result_json).unwrap();
    assert_eq!(json["sourceId"], new_deck.id.as_str());
    assert_eq!(json["cards"][0]["id"], new_fool.id.as_str());
    assert_eq!(json["cards"][1]["id"], new_cups.id.as_str());
    assert_eq!(json["cards"][1]["reversed"], true);
    assert_eq!(json["cards"][2]["id"], "gone-card");
    assert_eq!(json["cards"][2]["name"], "Deleted card");

    // Deck in play: same for the cards in the deck and the discard pile, and its source.
    let game = find("Game");
    let play = play_decks::get(&conn, &game.id).unwrap();
    assert_eq!(play.source_id.as_deref(), Some(new_deck.id.as_str()));
    let state: Value = serde_json::from_str(&play.state_json).unwrap();
    assert_eq!(state["deck"][0]["id"], new_fool.id.as_str());
    assert_eq!(state["drawn"][0]["id"], new_cups.id.as_str());
    assert_eq!(state["seed"], 5);
    // The original campaign is untouched.
    let before: Value = serde_json::from_str(&saved_draws::get(&conn, &find_in(&conn, &camp, "Reading")).unwrap().result_json).unwrap();
    assert_eq!(before["cards"][0]["id"], fool.id.as_str());
}

fn find_in(conn: &Connection, campaign: &str, name: &str) -> String {
    items::list(conn, campaign, "cards", None).unwrap().into_iter().find(|i| i.name == name).unwrap().id
}

#[test]
fn unreadable_or_orphaned_games_are_skipped_with_a_warning() {
    let item = |id: &str, kind: &str| json!({
        "id": id, "library": "cards", "itemType": kind, "name": id, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let record = |id: &str, state: &str| json!({
        "itemId": id, "sourceId": null, "sourceName": "Tarot", "stateJson": state, "createdAt": 1, "updatedAt": 1
    });
    let good = r#"{"version":1,"deck":[],"drawn":[]}"#;
    let bytes = pack_with(&[
        (ITEMS_FILE, json!([item("g1", "play"), item("g2", "play"), item("c1", "card")])),
        (PLAY_DECKS_FILE, json!([
            record("g1", good),
            record("g2", "not json"),
            record("c1", good),
            record("ghost", good),
            record("g1", good),
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.play_decks.len(), 1);
    assert_eq!(pack.warnings.len(), 1);
    assert!(pack.warnings[0].starts_with("4 deck(s) in play"), "{:?}", pack.warnings);
    let conn = open_in_memory();
    import_parsed(&conn, &pack, 10).unwrap();
    assert_eq!(count(&conn, "play_decks"), 1);
}

#[test]
fn a_failed_import_also_rolls_back_decks_in_play() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE play_decks").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["campaigns", "items", "saved_draws", "collection_members", "formulas"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn spreads_round_trip_and_their_positions_point_at_the_imported_sources() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let find = |campaign: &str, name: &str| {
        items::list(&conn, campaign, "cards", None).unwrap().into_iter().find(|i| i.name == name).unwrap()
    };
    let reading = find(&imported, "Strahd reading");
    let spread = spreads::get(&conn, &reading.id).unwrap();
    assert_eq!((spread.notes.as_str(), spread.reversals, spread.reversal_percent), ("Read it aloud", false, 10));
    let summary: Vec<_> = spread
        .positions
        .iter()
        .map(|p| (p.name.as_str(), p.source_name.as_deref(), p.meaning.as_str()))
        .collect();
    assert_eq!(
        summary,
        [("Tome", Some("Tarot"), "The history"), ("Icon", Some("Omens"), ""), ("Unchosen", None, "Pick a source")]
    );
    // The sources are the imported copies, not the original campaign's items.
    assert_eq!(spread.positions[0].source_id.as_deref(), Some(find(&imported, "Tarot").id.as_str()));
    assert_ne!(spread.positions[0].source_id.as_deref(), Some(find(&original, "Tarot").id.as_str()));
    assert!(spread.positions.iter().all(|p| !p.source_missing));
    // The original is untouched, and the imported spread is searchable.
    let old = spreads::get(&conn, &find(&original, "Strahd reading").id).unwrap();
    assert_eq!(old.positions[0].source_id.as_deref(), Some(find(&original, "Tarot").id.as_str()));
    assert_eq!(search::search(&conn, &imported, "tome", Some("cards"), 10).unwrap().len(), 1);
    assert!(spreads::list(&conn, &imported).unwrap().iter().all(|e| !e.ready), "one position has no source yet");
}

#[test]
fn bad_spread_data_in_a_pack_is_repaired_or_skipped_with_warnings() {
    let item = |id: &str, kind: &str| json!({
        "id": id, "library": "cards", "itemType": kind, "name": id, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let pos = |spread: &str, n: i64, name: &str, source: Option<&str>| json!({
        "spreadId": spread, "position": n, "name": name, "sourceId": source, "meaning": ""
    });
    let mut positions = vec![
        pos("sp", 1, "Past", Some("deck")),    // fine
        pos("sp", 2, "Present", Some("card")), // a card can't be a source: left unchosen
        pos("sp", 3, "Future", Some("ghost")), // missing source: left unchosen
        pos("sp", 3, "Duplicate place", None), // same place twice
        pos("sp", 4, "  ", None),              // blank name
        pos("doc", 1, "Not a spread", None),   // belongs to a document
    ];
    for n in 5..=14 {
        positions.push(pos("sp", n, &format!("Extra {n}"), None)); // only 10 fit in all
    }
    let bytes = pack_with(&[
        (ITEMS_FILE, json!([item("sp", "spread"), item("deck", "deck"), item("card", "card"), item("doc", "document")])),
        (SPREADS_FILE, json!([
            { "itemId": "sp", "notes": "ok", "reversals": true, "reversalPercent": 50, "createdAt": 1, "updatedAt": 1 },
            { "itemId": "sp", "notes": "duplicate", "reversals": true, "reversalPercent": 50, "createdAt": 1, "updatedAt": 1 },
            { "itemId": "deck", "notes": "not a spread", "reversals": true, "reversalPercent": 50, "createdAt": 1, "updatedAt": 1 },
        ])),
        (SPREAD_POSITIONS_FILE, json!(positions)),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.spreads.len(), 1);
    assert_eq!(pack.spread_positions.len(), 10, "no more than 10 positions per spread");
    assert!(pack.warnings.iter().any(|w| w.starts_with("2 spread setting")), "{:?}", pack.warnings);
    assert!(pack.warnings.iter().any(|w| w.contains("spread position(s) belonged")), "{:?}", pack.warnings);
    assert!(pack.warnings.iter().any(|w| w.starts_with("2 spread position(s) pointed at a missing source")), "{:?}", pack.warnings);

    let conn = open_in_memory();
    let camp = import_parsed(&conn, &pack, 10).unwrap().campaign.id;
    let sp = items::list(&conn, &camp, "cards", None).unwrap().into_iter().find(|i| i.item_type == "spread").unwrap();
    let got = spreads::get(&conn, &sp.id).unwrap();
    assert_eq!(got.positions.len(), 10);
    assert_eq!(got.positions[0].source_name.as_deref(), Some("deck"));
    assert_eq!((got.positions[1].source_id.clone(), got.positions[2].source_id.clone()), (None, None));
}

#[test]
fn a_failed_import_also_rolls_back_spreads() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE spread_positions").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["campaigns", "items", "spreads", "play_decks", "saved_draws"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

// ------------------------------------------------------------ random tables

fn find_table(conn: &Connection, campaign: &str, name: &str) -> items::Item {
    items::list(conn, campaign, "tables", None).unwrap().into_iter().find(|i| i.name == name).unwrap()
}

#[test]
fn tables_keep_their_settings_entries_order_weights_and_tags_through_a_round_trip() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;

    let rumors_item = find_table(&conn, &imported, "Rumors");
    let rumors = tables::get(&conn, &rumors_item.id).unwrap();
    assert_eq!((rumors.notes.as_str(), rumors.die_size, rumors.avoid_recent), ("Heard in taverns", Some(100), 2));
    let got: Vec<_> = rumors.entries.iter().map(|e| (e.text.as_str(), e.weight)).collect();
    assert_eq!(
        got,
        [
            ("A dragon sleeps under [Mill] (see [draw 1 from Tarot])", 3),
            ("Bandits on the road: [2d4]\nmind the [Rumors]", 1),
        ],
        "the deleted entry stays deleted"
    );
    // Entry tags point at the imported campaign's own tags; the removed tag stays removed.
    let tag = tags::get(&conn, &rumors.entries[0].tag_ids[0]).unwrap();
    assert_eq!((tag.name.as_str(), tag.campaign_id == imported), ("Faction", true));
    assert_eq!(rumors.entries[0].tag_ids.len(), 1);
    assert!(rumors.entries[1].tag_ids.is_empty());

    // The deleted entry came back as deleted, and can be restored.
    let deleted: String = conn
        .query_row(
            "SELECT id FROM table_entries WHERE table_id = ?1 AND deleted_at IS NOT NULL",
            [&rumors_item.id],
            |r| r.get(0),
        )
        .unwrap();
    tables::restore_entry(&conn, &deleted, 7000).unwrap();
    assert_eq!(tables::get(&conn, &rumors_item.id).unwrap().entries.len(), 3);

    // The original is untouched, and the imported text is searchable.
    let old = tables::get(&conn, &find_table(&conn, &original, "Rumors").id).unwrap();
    assert_eq!(old.entries.len(), 2);
    assert_eq!(search::search(&conn, &imported, "dragon", Some("tables"), 10).unwrap().len(), 1);
    assert_eq!(search::search(&conn, &imported, "taverns", Some("tables"), 10).unwrap().len(), 1);
}

#[test]
fn what_was_recently_rolled_stays_on_the_device() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let recent_rows = |conn: &Connection| -> i64 {
        conn.query_row("SELECT COUNT(*) FROM table_recent", [], |r| r.get(0)).unwrap()
    };
    assert_eq!(recent_rows(&conn), 1, "the sample campaign has one recent pick");
    let bytes = export_campaign(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().campaign.id;
    assert_eq!(recent_rows(&conn), 1, "importing adds no recent picks");
    let loaded = tables::load_rollable(&conn, &imported).unwrap();
    assert!(loaded.iter().all(|t| t.recent.is_empty()));
}

fn table_item(id: &str, name: &str, created: i64, deleted: Option<i64>) -> serde_json::Value {
    json!({
        "id": id, "library": "tables", "itemType": "table", "name": name, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": created, "updatedAt": created, "deletedAt": deleted
    })
}

#[test]
fn tables_with_the_same_name_are_renamed_on_import_with_a_warning() {
    let bytes = pack_with(&[(
        ITEMS_FILE,
        json!([
            table_item("late", "Rumors", 30, None),
            table_item("early", "rumors", 10, None),
            table_item("middle", "RUMORS", 20, None),
            table_item("trashed", "Rumors", 5, Some(99)), // in the trash: doesn't count
            table_item("other", "Names", 1, None),
        ]),
    )]);
    let pack = read_pack(&bytes).unwrap();
    assert!(pack.warnings.iter().any(|w| w.starts_with("2 table(s) had the same name")), "{:?}", pack.warnings);

    let conn = open_in_memory();
    let camp = import_parsed(&conn, &pack, 10).unwrap().campaign.id;
    // The oldest keeps its name; the later ones get numbers in order of age.
    assert_eq!(
        lines(&conn, "SELECT name, origin_item_id FROM items WHERE campaign_id = ?1 AND deleted_at IS NULL", &camp),
        [
            r#"[Text("Names"), Text("other")]"#,
            r#"[Text("RUMORS (2)"), Text("middle")]"#,
            r#"[Text("Rumors (3)"), Text("late")]"#,
            r#"[Text("rumors"), Text("early")]"#,
        ]
    );
    // So the imported campaign follows the one-name-per-table rule.
    assert!(tables::list(&conn, &camp).unwrap().iter().all(|t| !t.duplicate_name));
}

#[test]
fn bad_table_data_in_a_pack_is_skipped_with_warnings() {
    let item = |id: &str, kind: &str| json!({
        "id": id, "library": "tables", "itemType": kind, "name": id, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let settings = |id: &str, die: Option<i64>, avoid: i64| json!({
        "itemId": id, "notes": "n", "dieSize": die, "avoidRecent": avoid, "createdAt": 1, "updatedAt": 1
    });
    let entry = |id: &str, table: &str, pos: i64, text: &str, weight: i64| json!({
        "id": id, "tableId": table, "position": pos, "text": text, "weight": weight,
        "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let link = |entry: &str, tag: &str| json!({
        "entryId": entry, "tagId": tag, "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let long = "x".repeat(tables::MAX_ENTRY_BYTES + 1);
    let mut entries = vec![
        entry("ok", "t", 1, "fine [2d4]", 2),
        entry("ok", "t", 2, "duplicate id", 1),
        entry("blank", "t", 3, "   ", 1),
        entry("heavy", "t", 4, "weight too big", tables::MAX_WEIGHT + 1),
        entry("negative", "t", 5, "negative weight", -1),
        entry("toolong", "t", 6, &long, 1),
        entry("orphan", "ghost", 7, "no such table", 1),
        entry("notatable", "doc", 8, "belongs to a document", 1),
        entry("", "t", 9, "no id", 1),
    ];
    for n in 0..tables::MAX_ENTRIES {
        entries.push(entry(&format!("bulk{n}"), "big", n as i64, "x", 1));
    }
    entries.push(entry("over", "big", tables::MAX_ENTRIES as i64 + 1, "one too many", 1));

    let bytes = pack_with(&[
        (ITEMS_FILE, json!([item("t", "table"), item("big", "table"), item("doc", "document")])),
        (TAGS_FILE, json!([record("tag", "tag", json!({}))])),
        (RANDOM_TABLES_FILE, json!([
            settings("t", Some(20), 3),
            settings("t", None, 0),      // twice
            settings("big", Some(1), 0), // a die with one side
            settings("doc", None, 0),    // not a table
            settings("ghost", None, 0),  // nothing there
            settings("big", None, 99),   // avoids more than allowed
        ])),
        (TABLE_ENTRIES_FILE, json!(entries)),
        (TABLE_ENTRY_TAGS_FILE, json!([
            link("ok", "tag"),
            link("ok", "tag"),    // twice
            link("ok", "ghost"),  // missing tag
            link("blank", "tag"), // its entry was skipped
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.random_tables.len(), 1, "only the first good setting for a real table");
    assert_eq!(pack.table_entries.len(), 1 + tables::MAX_ENTRIES, "good entries only, 5,000 live per table at most");
    assert_eq!(pack.table_entry_tags.len(), 1);
    let said = |start: &str| pack.warnings.iter().any(|w| w.starts_with(start));
    assert!(said("5 table setting"), "{:?}", pack.warnings);
    assert!(said("9 table entry(ies)"), "{:?}", pack.warnings);
    assert!(said("3 tag(s) on table entries"), "{:?}", pack.warnings);

    let conn = open_in_memory();
    let camp = import_parsed(&conn, &pack, 10).unwrap().campaign.id;
    let t = tables::get(&conn, &find_table(&conn, &camp, "t").id).unwrap();
    assert_eq!((t.die_size, t.avoid_recent), (Some(20), 3));
    assert_eq!(t.entries.len(), 1);
    assert_eq!((t.entries[0].text.as_str(), t.entries[0].weight, t.entries[0].tag_ids.len()), ("fine [2d4]", 2, 1));
    assert_eq!(tables::get(&conn, &find_table(&conn, &camp, "big").id).unwrap().entries.len(), tables::MAX_ENTRIES);
}

#[test]
fn a_pack_without_table_files_imports_with_no_tables() {
    let pack = read_pack(&pack_with(&[])).unwrap();
    assert_eq!((pack.random_tables.len(), pack.table_entries.len(), pack.table_entry_tags.len()), (0, 0, 0));
    assert!(pack.warnings.is_empty());
}

#[test]
fn a_failed_import_also_rolls_back_tables() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_campaign(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE table_entry_tags").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["campaigns", "items", "random_tables", "table_entries", "table_recent"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}
