use super::export::export_project;
use super::format::*;
use super::import::{import_pack, import_parsed, parent_first, read_pack, read_pack_with, Limits};
use super::PackError;
use crate::db::cards::{self, test_images};
use crate::db::collections;
use crate::db::fields::{self, ValueIndex};
use crate::db::tabs;
use crate::db::formulas;
use crate::db::spreads::{self, PositionInput};
use crate::db::encounters;
use crate::db::generators;
use crate::db::smart_collections;
use crate::db::tables::{self, EntryInput, Pick};
use crate::db::play_decks::{self, NewPlayDeck};
use crate::db::saved_draws::{self, NewSavedDraw};
use crate::db::saved_rolls::{self, NewSavedRoll};
use crate::db::{calendar_events, json_items, project_state, sessions, weather};
use crate::db::{projects, documents, folders, items, links, open_in_memory, search, settings, tags};
use rusqlite::types::Value;
use rusqlite::Connection;
use serde_json::json;
use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, ZipWriter};

/// A project exercising everything a pack carries, with fixed timestamps:
/// nested folders, items in and out of folders, a map, document text, nested and
/// coloured tags, attached and removed tags, links (one removed), and trash
/// (a deleted item, a deleted folder with a deleted item inside, a deleted tag),
/// two saved dice rolls (one in the trash), two formulas (one in the trash), and cards: a card with a picture, a set, a deck and a pool holding each other,
/// a removed member and a trashed card.
fn populate(conn: &Connection) -> String {
    let camp = projects::create(conn, "Strahd", 1000).unwrap();
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
            project_id: c,
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
        project_id: c,
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
        project_id: c,
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

    // Fields: a text field, a link field and a dropdown, a set holding the first two (a third was
    // taken out again), a deleted field and a deleted set, values (one secret, one cleared) and
    // a link field that made links.
    let race = fields::create_definition(conn, c, "Race", "text", "Lineage", "{}", 4500).unwrap();
    let allies = fields::create_definition(conn, c, "Allies", "link", "", r#"{"many":true,"library":null,"itemTypes":[]}"#, 4510).unwrap();
    let status = fields::create_definition(conn, c, "Status", "dropdown", "", r#"{"options":[{"id":"o1","label":"Alive","color":null}]}"#, 4520).unwrap();
    let retired = fields::create_definition(conn, c, "Retired", "text", "", "{}", 4530).unwrap();
    fields::delete_definition(conn, &retired.id, 4540).unwrap();
    let npc = fields::create_set(conn, c, "NPC", "People", 4550).unwrap();
    fields::set_set_fields(conn, &npc.id, &[race.id.clone(), allies.id.clone(), status.id.clone()], 4560).unwrap();
    fields::set_set_fields(conn, &npc.id, &[race.id.clone(), allies.id.clone()], 4570).unwrap();
    let old_set = fields::create_set(conn, c, "Old set", "", 4580).unwrap();
    fields::delete_set(conn, &old_set.id, 4590).unwrap();
    fields::apply_set(conn, &strahd.id, &npc.id, 4600).unwrap();
    fields::apply_set(conn, &barovia.id, &npc.id, 4610).unwrap();
    fields::unapply_set(conn, &barovia.id, &npc.id, 4620).unwrap();
    let text_index = |t: &str| ValueIndex { sort_num: None, sort_text: Some(t.to_lowercase()), search_text: t.to_string() };
    fields::set_value(conn, &strahd.id, &race.id, r#""Vampire""#, &text_index("Vampire"), true, 4700).unwrap();
    let allies_value = serde_json::to_string(&[&barovia.id, &ireena.id]).unwrap();
    fields::set_value(conn, &strahd.id, &allies.id, &allies_value, &ValueIndex::default(), false, 4710).unwrap();
    fields::set_value(conn, &barovia.id, &status.id, r#""o1""#, &ValueIndex { sort_num: Some(0.0), sort_text: Some("alive".into()), search_text: "Alive".into() }, false, 4720).unwrap();
    fields::set_value(conn, &ireena.id, &race.id, r#""Human""#, &text_index("Human"), false, 4730).unwrap();
    fields::clear_value(conn, &ireena.id, &race.id, 4740).unwrap();

    // Tabs on Strahd's page: a nested document, an embed showing Barovia, an empty slot, and a
    // removed embed.
    let relationships = tabs::add_document_tab(conn, &strahd.id, "Relationships", 4800).unwrap();
    documents::set_body(conn, &relationships.item.as_ref().unwrap().id, "Ireena is his obsession.", 4810).unwrap();
    tabs::add_embed_tab(conn, &strahd.id, "Homeland", Some(&barovia.id), 4820).unwrap();
    tabs::add_embed_tab(conn, &strahd.id, "Crypt map", None, 4830).unwrap();
    let removed = tabs::add_embed_tab(conn, &strahd.id, "Removed", None, 4840).unwrap();
    tabs::remove_tab(conn, &removed.id, 4850).unwrap();

    // A smart collection (its query holds no ids here, so the whole project can be compared by
    // content; a test of its own checks that real ids follow the import).
    let elves = items::create(conn, c, "worldbuilding", "smart_collection", "Elves", None, 4900).unwrap();
    let query = r#"{"version":1,"where":{"op":"all","not":false,"rules":[{"kind":"name","text":"elf","not":false}]},"sort":[{"by":"name","dir":"asc"}]}"#;
    smart_collections::set_query(conn, &elves.id, query, 4910).unwrap();

    // A generator (its template and fields are made-up ids here; a test of its own checks real ones).
    let maker = items::create(conn, c, "tables", "generator", "NPC maker", None, 4920).unwrap();
    let definition = r#"{"version":1,"templateId":null,"rows":[{"id":"r1","label":"Name","target":{"kind":"name"},"source":"[Names]","fallback":""}]}"#;
    generators::set_definition(conn, &maker.id, definition, 4930).unwrap();

    // An encounter whose combatant came from Strahd's page (remembered by id), and a copy of a ruleset that knows the
    // "Race" property and the "NPC" set by key (the copy's ids point at this project's own fields).
    let fight = items::create(conn, c, "encounters", "encounter", "Crypt fight", None, 4940).unwrap();
    let state = json!({
        "version": 1, "phase": "running", "round": 2, "history": [],
        "combatants": [{ "id": "c1", "baseName": "Strahd", "itemId": strahd.id, "side": "foes" }]
    })
    .to_string();
    encounters::set_state(conn, &fight.id, &state, 4950).unwrap();
    let rules = r#"{"version":1,"fields":[],"statBlocks":[],"formulas":[],"encounter":{}}"#;
    let ids = json!({ "fields": { "race": race.id }, "sets": { "npc": npc.id } }).to_string();
    conn.execute(
        "INSERT INTO project_rulesets (id, project_id, ruleset_id, name, rules_json, ids_json, position, created_at, updated_at, deleted_at)
         VALUES ('pr-1', ?1, NULL, 'Generic d20', ?2, ?3, 0, 4960, 4970, NULL)",
        rusqlite::params![c, rules, ids],
    )
    .unwrap();

    // Time: a calendar, a timeline whose lane rule names the "Race" property by id, a repeating event, a secret dated note,
    // a running session, a day of weather, and the project's "now" pointing at the calendar and the session.
    let calendar = items::create(conn, c, "calendar", "calendar", "Harptos", None, 5000).unwrap();
    json_items::set(conn, &json_items::CALENDAR, &calendar.id, r#"{"version":1,"months":[{"name":"Hammer","days":30}]}"#, 5010).unwrap();
    let timeline = items::create(conn, c, "calendar", "timeline", "History", None, 5020).unwrap();
    let config = json!({ "version": 1, "zoom": "decade", "lanes": { "by": "field", "fieldId": race.id } }).to_string();
    json_items::set(conn, &json_items::TIMELINE, &timeline.id, &config, 5030).unwrap();
    let festival = items::create(conn, c, "calendar", "event", "Festival", None, 5040).unwrap();
    let input = |start: i64, rule: Option<&str>, body: &str| calendar_events::EventInput {
        start_day: start,
        start_minute: Some(600),
        end_day: Some(start + 2),
        end_minute: None,
        recurrence_json: rule.map(|r| r.to_string()),
        until_day: None,
        body: body.to_string(),
    };
    calendar_events::set(conn, &festival.id, &input(100, Some(r#"{"kind":"yearly","month":0,"day":1}"#), "Bring bread"), 5050).unwrap();
    let plot = items::create(conn, c, "calendar", "note", "The plot thickens", None, 5060).unwrap();
    calendar_events::set(conn, &plot.id, &input(200, None, "Strahd knows"), 5070).unwrap();
    items::set_visibility(conn, &plot.id, "secret", 5075).unwrap();
    let session = items::create(conn, c, "worldbuilding", "session", "Session 1", None, 5080).unwrap();
    project_state::set_now(conn, c, 150, 30, 5085).unwrap();
    sessions::start(conn, &session.id, Some("2026-10-10"), 5090).unwrap();
    weather::set(conn, c, 150, r#"{"text":"Light rain","table":null,"season":null,"manual":false}"#, 5100).unwrap();
    project_state::set_main_calendar(conn, c, Some(&calendar.id), 5110).unwrap();
    let weather_table = items::list_of_type(conn, c, "tables", "table").unwrap().into_iter().next().map(|t| t.id);
    project_state::set_weather_table(conn, c, weather_table.as_deref(), 5120).unwrap();

    camp.id
}

/// Runs a query and renders each row as text, so two projects can be compared
/// by content (names, dates, relationships) while their ids differ.
fn lines(conn: &Connection, sql: &str, project_id: &str) -> Vec<String> {
    let mut stmt = conn.prepare(sql).unwrap();
    let columns = stmt.column_count();
    let mut rows: Vec<String> = stmt
        .query_map([project_id], |r| {
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
    field_definitions: Vec<String>,
    field_sets: Vec<String>,
    field_set_members: Vec<String>,
    item_field_sets: Vec<String>,
    field_values: Vec<String>,
    item_tabs: Vec<String>,
    smart_collections: Vec<String>,
    generators: Vec<String>,
    encounters: Vec<String>,
    project_rulesets: Vec<String>,
    calendars: Vec<String>,
    timelines: Vec<String>,
    calendar_events: Vec<String>,
    sessions: Vec<String>,
    weather_days: Vec<String>,
    project_state: Vec<String>,
}

fn snapshot(conn: &Connection, project_id: &str) -> Snapshot {
    Snapshot {
        folders: lines(conn,
            "SELECT f.library, f.name, p.name, f.created_at, f.updated_at, f.deleted_at
             FROM folders f LEFT JOIN folders p ON p.id = f.parent_id WHERE f.project_id = ?1", project_id),
        items: lines(conn,
            "SELECT i.library, i.item_type, i.name, f.name, i.visibility, i.created_at, i.updated_at, i.deleted_at
             FROM items i LEFT JOIN folders f ON f.id = i.folder_id WHERE i.project_id = ?1", project_id),
        tags: lines(conn,
            "SELECT t.name, p.name, t.color, t.created_at, t.updated_at, t.deleted_at
             FROM tags t LEFT JOIN tags p ON p.id = t.parent_id WHERE t.project_id = ?1", project_id),
        item_tags: lines(conn,
            "SELECT i.name, t.name, it.created_at, it.updated_at, it.deleted_at
             FROM item_tags it JOIN items i ON i.id = it.item_id JOIN tags t ON t.id = it.tag_id
             WHERE i.project_id = ?1", project_id),
        links: lines(conn,
            "SELECT s.name, t.name,
                    CASE WHEN l.source_ref LIKE 'field:%'
                         THEN 'field:' || (SELECT name FROM field_definitions WHERE id = substr(l.source_ref, 7))
                         ELSE l.source_ref END,
                    l.created_at, l.updated_at, l.deleted_at
             FROM links l JOIN items s ON s.id = l.source_item_id JOIN items t ON t.id = l.target_item_id
             WHERE s.project_id = ?1", project_id),
        documents: lines(conn,
            "SELECT i.name, d.body, d.created_at, d.updated_at
             FROM document_content d JOIN items i ON i.id = d.item_id WHERE i.project_id = ?1", project_id),
        saved_rolls: lines(conn,
            "SELECT i.name, i.library, s.notation, s.seed, s.text, s.result_json, s.created_at, s.updated_at, i.deleted_at
             FROM saved_rolls s JOIN items i ON i.id = s.item_id WHERE i.project_id = ?1", project_id),
        formulas: lines(conn,
            "SELECT i.name, i.library, f.notation, f.created_at, f.updated_at, i.deleted_at
             FROM formulas f JOIN items i ON i.id = f.item_id WHERE i.project_id = ?1", project_id),
        card_details: lines(conn,
            "SELECT i.name, d.value, d.notes, d.created_at, d.updated_at, i.deleted_at
             FROM card_details d JOIN items i ON i.id = d.item_id WHERE i.project_id = ?1", project_id),
        card_images: lines(conn,
            "SELECT i.name, c.mime, c.image, c.thumb, c.created_at, c.updated_at
             FROM card_images c JOIN items i ON i.id = c.item_id WHERE i.project_id = ?1", project_id),
        collection_members: lines(conn,
            "SELECT h.name, m.name, k.position, k.created_at, k.updated_at, k.deleted_at
             FROM collection_members k JOIN items h ON h.id = k.collection_id JOIN items m ON m.id = k.member_id
             WHERE h.project_id = ?1", project_id),
        saved_draws: lines(conn,
            "SELECT i.name, i.library, s.source_name, s.seed, s.text, s.result_json, s.notes, s.created_at, s.updated_at, i.deleted_at
             FROM saved_draws s JOIN items i ON i.id = s.item_id WHERE i.project_id = ?1", project_id),
        play_decks: lines(conn,
            "SELECT i.name, i.library, p.source_name, p.state_json, p.created_at, p.updated_at, i.deleted_at
             FROM play_decks p JOIN items i ON i.id = p.item_id WHERE i.project_id = ?1", project_id),
        spreads: lines(conn,
            "SELECT i.name, s.notes, s.reversals, s.reversal_percent, s.created_at, s.updated_at, i.deleted_at
             FROM spreads s JOIN items i ON i.id = s.item_id WHERE i.project_id = ?1", project_id),
        spread_positions: lines(conn,
            "SELECT i.name, p.position, p.name, src.name, p.meaning
             FROM spread_positions p JOIN items i ON i.id = p.spread_id LEFT JOIN items src ON src.id = p.source_id
             WHERE i.project_id = ?1", project_id),
        random_tables: lines(conn,
            "SELECT i.name, i.library, t.notes, t.die_size, t.avoid_recent, t.created_at, t.updated_at, i.deleted_at
             FROM random_tables t JOIN items i ON i.id = t.item_id WHERE i.project_id = ?1", project_id),
        table_entries: lines(conn,
            "SELECT i.name, e.position, e.text, e.weight, e.created_at, e.updated_at, e.deleted_at
             FROM table_entries e JOIN items i ON i.id = e.table_id WHERE i.project_id = ?1", project_id),
        table_entry_tags: lines(conn,
            "SELECT i.name, e.text, t.name, l.created_at, l.updated_at, l.deleted_at
             FROM table_entry_tags l JOIN table_entries e ON e.id = l.entry_id
             JOIN items i ON i.id = e.table_id JOIN tags t ON t.id = l.tag_id WHERE i.project_id = ?1", project_id),
        field_definitions: lines(conn,
            "SELECT name, kind, description, config_json, created_at, updated_at, deleted_at
             FROM field_definitions WHERE project_id = ?1", project_id),
        field_sets: lines(conn,
            "SELECT name, description, created_at, updated_at, deleted_at FROM field_sets WHERE project_id = ?1", project_id),
        field_set_members: lines(conn,
            "SELECT s.name, d.name, m.position, m.created_at, m.updated_at, m.deleted_at
             FROM field_set_members m JOIN field_sets s ON s.id = m.set_id JOIN field_definitions d ON d.id = m.field_id
             WHERE s.project_id = ?1", project_id),
        item_field_sets: lines(conn,
            "SELECT i.name, s.name, a.position, a.created_at, a.updated_at, a.deleted_at
             FROM item_field_sets a JOIN items i ON i.id = a.item_id JOIN field_sets s ON s.id = a.set_id
             WHERE i.project_id = ?1", project_id),
        // A link field's value holds item ids, which differ between copies (its links are compared above).
        field_values: lines(conn,
            "SELECT i.name, d.name, CASE WHEN d.kind = 'link' THEN '' ELSE v.value_json END,
                    v.sort_num, v.sort_text, v.search_text, v.secret, v.created_at, v.updated_at, v.deleted_at
             FROM field_values v JOIN items i ON i.id = v.item_id JOIN field_definitions d ON d.id = v.field_id
             WHERE i.project_id = ?1", project_id),
        item_tabs: lines(conn,
            "SELECT p.name, t.kind, t.position, c.name, g.name, t.title, t.created_at, t.updated_at, t.deleted_at
             FROM item_tabs t JOIN items p ON p.id = t.parent_id
             LEFT JOIN items c ON c.id = t.child_id LEFT JOIN items g ON g.id = t.target_id
             WHERE p.project_id = ?1", project_id),
        smart_collections: lines(conn,
            "SELECT i.name, i.library, s.query_json, s.created_at, s.updated_at, i.deleted_at
             FROM smart_collections s JOIN items i ON i.id = s.item_id WHERE i.project_id = ?1", project_id),
        generators: lines(conn,
            "SELECT i.name, i.library, g.definition_json, g.created_at, g.updated_at, i.deleted_at
             FROM generators g JOIN items i ON i.id = g.item_id WHERE i.project_id = ?1", project_id),
        encounters: lines(conn,
            "SELECT i.name, i.library, json_extract(e.state_json, '$.phase'), json_extract(e.state_json, '$.round'),
                    (SELECT name FROM items WHERE id = json_extract(e.state_json, '$.combatants[0].itemId')),
                    e.created_at, e.updated_at, i.deleted_at
             FROM encounters e JOIN items i ON i.id = e.item_id WHERE i.project_id = ?1", project_id),
        project_rulesets: lines(conn,
            "SELECT r.name, r.position, r.rules_json, r.created_at, r.updated_at, r.deleted_at,
                    (SELECT name FROM field_definitions WHERE id = json_extract(r.ids_json, '$.fields.race')),
                    (SELECT name FROM field_sets WHERE id = json_extract(r.ids_json, '$.sets.npc'))
             FROM project_rulesets r WHERE r.project_id = ?1", project_id),
        calendars: lines(conn,
            "SELECT i.name, i.library, c.calendar_json, c.created_at, c.updated_at, i.deleted_at
             FROM calendars c JOIN items i ON i.id = c.item_id WHERE i.project_id = ?1", project_id),
        timelines: lines(conn,
            "SELECT i.name, t.created_at, t.updated_at, json_extract(t.config_json, '$.zoom'),
                    (SELECT name FROM field_definitions WHERE id = json_extract(t.config_json, '$.lanes.fieldId'))
             FROM timelines t JOIN items i ON i.id = t.item_id WHERE i.project_id = ?1", project_id),
        calendar_events: lines(conn,
            "SELECT i.name, i.item_type, i.visibility, e.start_day, e.start_minute, e.end_day, e.end_minute, e.recurrence_json,
                    e.until_day, e.body, e.created_at, e.updated_at
             FROM calendar_events e JOIN items i ON i.id = e.item_id WHERE i.project_id = ?1", project_id),
        sessions: lines(conn,
            "SELECT i.name, s.real_date, s.start_day, s.start_minute, s.end_day, s.end_minute, s.status, s.created_at, s.updated_at
             FROM sessions s JOIN items i ON i.id = s.item_id WHERE i.project_id = ?1", project_id),
        weather_days: lines(conn,
            "SELECT day, weather_json, created_at, updated_at FROM weather_days WHERE project_id = ?1", project_id),
        project_state: lines(conn,
            "SELECT (SELECT name FROM items WHERE id = s.main_calendar_id), s.now_day, s.now_minute,
                    (SELECT name FROM items WHERE id = s.session_id), (SELECT name FROM items WHERE id = s.weather_table_id),
                    s.created_at, s.updated_at
             FROM project_state s WHERE s.project_id = ?1", project_id),
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
    let pack = read_pack(&export_project(&conn, &camp, 5000).unwrap()).unwrap();
    let m = &pack.manifest;
    assert_eq!((m.format.as_str(), m.format_version), (FORMAT, FORMAT_VERSION));
    assert_eq!((m.project.name.as_str(), m.created_at), ("Strahd", 5000));
    assert!(!m.pack_id.is_empty() && !m.app_version.is_empty());
    assert_eq!(
        m.counts,
        // 4 documents have text: Strahd, Ireena, Barovia and Old Note ("Scrap" and the map have none).
        // The saved rolls, formulas and cards are items too (22 items: 5 documents, a map, 2 rolls,
        // 2 formulas, 3 cards, a set, a deck, a pool, a saved draw, a deck in play, a spread, 2 tables). 2 cards have details, 1 a picture, 7 membership rows.
        // 1 table has settings; the 2 tables have 4 entries in all (one deleted) and 2 entry tags (one removed).
        Counts {
            folders: 3, items: 30, tags: 4, item_tags: 4, links: 5, documents: 5, saved_rolls: 2, formulas: 2,
            card_details: 2, collection_members: 7, card_images: 1, saved_draws: 1, play_decks: 1, spreads: 1, spread_positions: 3,
            random_tables: 1, table_entries: 4, table_entry_tags: 2,
            // 4 fields (one deleted), 2 sets (one deleted) with 3 member rows (one removed), 2 applied sets (one taken off),
            // and 4 values (one cleared); the link field made 2 of the 5 links.
            field_definitions: 4, field_sets: 2, field_set_members: 3, item_field_sets: 2, field_values: 4,
            // Strahd's 4 tabs (one removed): a nested document, an embed, an empty slot and the removed one.
            item_tabs: 4,
            // The "Elves" smart collection.
            smart_collections: 1,
            // The "NPC maker" generator.
            generators: 1,
            // The "Crypt fight" encounter and the project's copy of a ruleset.
            encounters: 1,
            project_rulesets: 1,
            // Time: the calendar, the timeline, the festival and the note, one session, one day of weather and the project's now.
            calendars: 1, timelines: 1, calendar_events: 2, sessions: 1, weather_days: 1, project_state: 1,
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
    let bytes = export_project(&conn, &original, 5000).unwrap();

    let result = import_pack(&conn, &bytes, 6000).unwrap();
    assert_eq!(result.project.name, "Strahd (imported)");
    assert!(result.warnings.is_empty());

    assert_eq!(snapshot(&conn, &result.project.id), before);
    // The original is untouched.
    assert_eq!(snapshot(&conn, &original), before);
    // And nothing is shared: every id is new.
    let shared: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM items a JOIN items b ON a.id = b.id AND a.project_id <> b.project_id",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(shared, 0);
    assert_eq!(count(&conn, "items"), 60);
}

#[test]
fn a_round_trip_into_a_fresh_database_gives_the_same_content() {
    let source = open_in_memory();
    let original = populate(&source);
    let bytes = export_project(&source, &original, 5000).unwrap();

    let target = open_in_memory();
    let result = import_pack(&target, &bytes, 6000).unwrap();
    assert_eq!(snapshot(&target, &result.project.id), snapshot(&source, &original));
}

#[test]
fn the_trash_comes_back_as_trash_and_can_be_restored() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

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
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let pack_id = read_pack(&bytes).unwrap().manifest.pack_id;
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

    let rows: Vec<(String, Option<String>, Option<String>)> = {
        let mut stmt = conn
            .prepare("SELECT name, origin_pack_id, origin_item_id FROM items WHERE project_id = ?1")
            .unwrap();
        stmt.query_map([&imported], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };
    assert_eq!(rows.len(), 30);
    for (name, origin_pack, origin_item) in rows {
        assert_eq!(origin_pack.as_deref(), Some(pack_id.as_str()), "{name}");
        // The origin id is the item's id in the ORIGINAL project.
        let original_id: String = conn
            .query_row(
                "SELECT id FROM items WHERE project_id = ?1 AND name = ?2",
                [&original, &name],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(origin_item, Some(original_id), "{name}");
    }
    // Items made here have no origin.
    let local: i64 = conn
        .query_row("SELECT COUNT(*) FROM items WHERE project_id = ?1 AND origin_pack_id IS NOT NULL", [&original], |r| r.get(0))
        .unwrap();
    assert_eq!(local, 0);
}

#[test]
fn the_imported_project_is_searchable_and_linked() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

    let find = |text: &str| -> Vec<String> {
        search::search(&conn, &imported, text, None, 10).unwrap().into_iter().map(|i| i.name).collect()
    };
    assert_eq!(find("vampire"), ["Strahd"]); // document text
    assert_eq!(find("mist"), ["Barovia"]); // text and tag
    let strahd = search::search(&conn, &imported, "strahd", None, 10).unwrap().remove(0);
    let linked: Vec<_> = links::outgoing(&conn, &strahd.id).unwrap().into_iter().map(|i| i.name).collect();
    // Barovia by hand, and Barovia and Ireena through the "Allies" link field.
    assert_eq!(linked, ["Barovia", "Ireena"]);
    let tagged: Vec<_> = tags::for_item(&conn, &strahd.id).unwrap().into_iter().map(|t| t.name).collect();
    assert_eq!(tagged, ["Faction"]); // the trashed tag "Gone" stays hidden
}

#[test]
fn a_link_field_keeps_working_in_an_imported_project() {
    let source = open_in_memory();
    let original = populate(&source);
    let bytes = export_project(&source, &original, 5000).unwrap();
    let target = open_in_memory();
    let imported = import_pack(&target, &bytes, 6000).unwrap().project.id;

    let item = |name: &str| search::search(&target, &imported, name, None, 10).unwrap().into_iter().find(|i| i.name == name).unwrap();
    let (strahd, barovia, ireena) = (item("Strahd"), item("Barovia"), item("Ireena"));
    let allies = fields::list_definitions(&target, &imported).unwrap().into_iter().find(|d| d.name == "Allies").unwrap();

    // The value points at the imported items, and the links are labelled with the imported field.
    let value = &fields::get_item_fields(&target, &strahd.id).unwrap().values.into_iter().find(|v| v.field_id == allies.id).unwrap().value_json;
    let ids: Vec<String> = serde_json::from_str(value).unwrap();
    assert_eq!(ids, vec![barovia.id.clone(), ireena.id.clone()]);
    let refs: Vec<String> = target
        .prepare("SELECT DISTINCT source_ref FROM links WHERE source_ref LIKE 'field:%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(refs, vec![fields::link_ref(&allies.id)]);

    // Changing the value in the copy changes the copy's links, not the original's.
    fields::set_value(&target, &strahd.id, &allies.id, "[]", &ValueIndex::default(), false, 7000).unwrap();
    assert_eq!(links::outgoing(&target, &strahd.id).unwrap().into_iter().map(|i| i.name).collect::<Vec<_>>(), ["Barovia"]);
    let original_strahd = search::search(&source, &original, "strahd", None, 10).unwrap().remove(0);
    assert_eq!(links::outgoing(&source, &original_strahd.id).unwrap().len(), 2);
}

#[test]
fn the_text_of_a_text_field_is_never_rewritten_even_if_it_looks_like_an_item_id() {
    let source = open_in_memory();
    let camp = projects::create(&source, "C", 1).unwrap();
    let note = fields::create_definition(&source, &camp.id, "Note", "text", "", "{}", 2).unwrap();
    let a = items::create(&source, &camp.id, "worldbuilding", "document", "A", None, 3).unwrap();
    let value = format!("\"{}\"", a.id);
    fields::set_value(&source, &a.id, &note.id, &value, &ValueIndex::default(), false, 4).unwrap();
    let bytes = export_project(&source, &camp.id, 5000).unwrap();
    let target = open_in_memory();
    let imported = import_pack(&target, &bytes, 6000).unwrap().project.id;
    let new_a = search::search(&target, &imported, "A", None, 10).unwrap().remove(0);
    let stored = fields::get_item_fields(&target, &new_a.id).unwrap().values.remove(0).value_json;
    assert_eq!(stored, value);
}

#[test]
fn unreadable_or_orphaned_fields_are_skipped_or_renamed_with_a_warning() {
    let bytes = pack_with(&[
        ("data/items.json", json!([
            { "id": "i1", "library": "worldbuilding", "itemType": "document", "name": "Doc", "icon": null, "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null }
        ])),
        ("data/field_definitions.json", json!([
            { "id": "f1", "name": "Race", "kind": "text", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "id": "f2", "name": "race", "kind": "text", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "id": "f3", "name": "Date", "kind": "location", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "id": "f4", "name": "Faction", "kind": "link", "configJson": "{}", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "id": "f5", "name": "Bad settings", "kind": "text", "configJson": "[1]", "createdAt": 1, "updatedAt": 1, "deletedAt": null }
        ])),
        ("data/field_sets.json", json!([{ "id": "s1", "name": "NPC", "createdAt": 1, "updatedAt": 1, "deletedAt": null }])),
        ("data/field_set_members.json", json!([
            { "setId": "s1", "fieldId": "f1", "position": 0, "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "setId": "s1", "fieldId": "nope", "position": 1, "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "setId": "nope", "fieldId": "f1", "position": 2, "createdAt": 1, "updatedAt": 1, "deletedAt": null }
        ])),
        ("data/item_field_sets.json", json!([
            { "itemId": "i1", "setId": "s1", "position": 0, "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "itemId": "gone", "setId": "s1", "position": 0, "createdAt": 1, "updatedAt": 1, "deletedAt": null }
        ])),
        ("data/field_values.json", json!([
            { "itemId": "i1", "fieldId": "f1", "valueJson": "\"Elf\"", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "itemId": "i1", "fieldId": "f2", "valueJson": "not json", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "itemId": "i1", "fieldId": "f4", "valueJson": "\"not a list\"", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "itemId": "i1", "fieldId": "f3", "valueJson": "\"x\"", "createdAt": 1, "updatedAt": 1, "deletedAt": null },
            { "itemId": "gone", "fieldId": "f1", "valueJson": "\"x\"", "createdAt": 1, "updatedAt": 1, "deletedAt": null }
        ])),
        ("data/links.json", json!([
            { "sourceItemId": "i1", "targetItemId": "i1", "sourceRef": "field:f4", "createdAt": 1, "updatedAt": 1, "deletedAt": null }
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    // Race and race share a name (the second is renamed); the unknown kind and the unreadable settings are dropped.
    let mut names: Vec<_> = pack.field_definitions.iter().map(|d| d.name.as_str()).collect();
    names.sort();
    assert_eq!(names, ["Faction", "Race", "race (2)"]);
    assert_eq!(pack.field_set_members.len(), 1);
    assert_eq!(pack.item_field_sets.len(), 1);
    assert_eq!(pack.field_values.len(), 1); // only the good one
    assert!(pack.warnings.iter().any(|w| w.contains("field(s) were unreadable")));
    assert!(pack.warnings.iter().any(|w| w.contains("same name as another field")));
    assert!(pack.warnings.iter().any(|w| w.contains("field value(s)")));

    let conn = open_in_memory();
    assert!(import_parsed(&conn, &pack, 9000).is_ok());
    assert_eq!(count(&conn, "field_definitions"), 3);
}

#[test]
fn importing_twice_makes_two_separate_copies() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let a = import_pack(&conn, &bytes, 6000).unwrap().project;
    let b = import_pack(&conn, &bytes, 6001).unwrap().project;
    assert_ne!(a.id, b.id);
    assert_eq!(snapshot(&conn, &a.id), snapshot(&conn, &b.id));
    assert_eq!(count(&conn, "projects"), 3);
}

#[test]
fn the_first_import_becomes_the_open_project_but_later_ones_do_not_take_over() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_project(&conn, &original, 5000).unwrap();
    assert!(settings::current_project(&conn).unwrap().is_none());
    let first = import_pack(&conn, &bytes, 6000).unwrap().project;
    assert_eq!(settings::current_project(&conn).unwrap().unwrap().id, first.id);
    import_pack(&conn, &bytes, 6001).unwrap();
    assert_eq!(settings::current_project(&conn).unwrap().unwrap().id, first.id);
}

#[test]
fn only_live_projects_can_be_exported() {
    let conn = open_in_memory();
    let camp = populate(&conn);
    projects::soft_delete(&conn, &camp, 9000).unwrap();
    assert!(export_project(&conn, &camp, 9001).is_err());
    assert!(export_project(&conn, "nope", 9001).is_err());
}

// --------------------------------------------------------------- transport

#[test]
fn a_pack_survives_the_text_transport_used_between_javascript_and_rust() {
    use super::{decode_from_transport, encode_for_transport};
    let conn = open_in_memory();
    let camp = populate(&conn);
    let bytes = export_project(&conn, &camp, 5000).unwrap();
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
    assert_eq!(count(&conn, "projects"), 0);
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
    let bytes = export_project(&source, &camp, 5000).unwrap();

    let conn = open_in_memory();
    assert!(import_pack(&conn, &bytes[..bytes.len() / 2], 1).is_err());
    let garbled = pack_with(&[(ITEMS_FILE, json!("this is not a list"))]);
    assert!(matches!(import_pack(&conn, &garbled, 1), Err(PackError::Corrupt(_))));
    let broken_json = make_zip(&[
        (MANIFEST_FILE, manifest_json(1).as_bytes()),
        (ITEMS_FILE, b"{ not json"),
    ]);
    assert!(matches!(import_pack(&conn, &broken_json, 1), Err(PackError::Corrupt(_))));
    assert_eq!(count(&conn, "projects"), 0);
}

#[test]
fn oversized_packs_are_refused() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_project(&source, &camp, 5000).unwrap();
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
fn a_pack_with_no_data_files_imports_as_an_empty_project() {
    let conn = open_in_memory();
    let bytes = make_zip(&[(MANIFEST_FILE, manifest_json(1).as_bytes())]);
    let result = import_pack(&conn, &bytes, 10).unwrap();
    assert_eq!(result.project.name, "Test (imported)");
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
        Counts { folders: 0, items: 2, tags: 3, item_tags: 1, links: 1, documents: 1, saved_rolls: 0, formulas: 0, card_details: 0, collection_members: 0, card_images: 0, saved_draws: 0, play_decks: 0, spreads: 0, spread_positions: 0, random_tables: 0, table_entries: 0, table_entry_tags: 0, field_definitions: 0, field_sets: 0, field_set_members: 0, item_field_sets: 0, field_values: 0, item_tabs: 0, smart_collections: 0, generators: 0, encounters: 0, project_rulesets: 0, calendars: 0, timelines: 0, calendar_events: 0, sessions: 0, weather_days: 0, project_state: 0 }
    );

    let conn = open_in_memory();
    let result = import_parsed(&conn, &pack, 10).unwrap();
    let camp = result.project.id;
    let names = |sql: &str| -> Vec<String> { lines(&conn, sql, &camp) };
    // Blank name, unknown visibility and missing folder are fixed on the first item.
    let first = names("SELECT name, visibility, folder_id FROM items WHERE origin_item_id = 'i1' AND project_id = ?1");
    assert_eq!(first, [r#"[Text("Untitled"), Text("default"), Null]"#]);
    // The invalid colour is dropped, the clashing name renamed, the orphan moved up.
    let tag_names = names("SELECT name, parent_id IS NULL, color FROM tags WHERE project_id = ?1");
    assert_eq!(
        tag_names,
        [
            r#"[Text("Dup"), Integer(1), Null]"#,
            r#"[Text("Orphan"), Integer(1), Null]"#,
            r#"[Text("dup (2)"), Integer(1), Null]"#,
        ]
    );
    // The link with a blank source_ref became a normal manual link.
    let link_refs = names("SELECT l.source_ref FROM links l JOIN items s ON s.id = l.source_item_id WHERE s.project_id = ?1");
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
    let camp = result.project.id;
    // A loop of two is cut in exactly one place; a self-parent becomes top level.
    let roots: i64 = conn
        .query_row("SELECT COUNT(*) FROM folders WHERE project_id = ?1 AND parent_id IS NULL", [&camp], |r| r.get(0))
        .unwrap();
    assert_eq!(roots, 2);
    let tag_roots: i64 = conn
        .query_row("SELECT COUNT(*) FROM tags WHERE project_id = ?1 AND parent_id IS NULL", [&camp], |r| r.get(0))
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
    let bytes = export_project(&conn, &camp, 5000).unwrap();
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
    assert_eq!(result.project.name, "Strahd (imported)");
    assert_eq!(
        result.counts,
        Counts { folders: 3, items: 6, tags: 4, item_tags: 4, links: 3, documents: 4, saved_rolls: 0, formulas: 0, card_details: 0, collection_members: 0, card_images: 0, saved_draws: 0, play_decks: 0, spreads: 0, spread_positions: 0, random_tables: 0, table_entries: 0, table_entry_tags: 0, field_definitions: 0, field_sets: 0, field_set_members: 0, item_field_sets: 0, field_values: 0, item_tabs: 0, smart_collections: 0, generators: 0, encounters: 0, project_rulesets: 0, calendars: 0, timelines: 0, calendar_events: 0, sessions: 0, weather_days: 0, project_state: 0 }
    );
    let camp = result.project.id;

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
    let bytes = export_project(&source, &camp, 5000).unwrap();

    // Sabotage the target so the import fails PART WAY (after the project,
    // folders, tags, items, tag links and links were already written).
    let target = open_in_memory();
    target.execute_batch("DROP TABLE document_content").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["projects", "folders", "items", "tags", "item_tags", "links", "app_settings"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn bad_files_never_create_a_project() {
    let conn = open_in_memory();
    let before = count(&conn, "projects");
    let _ = import_pack(&conn, b"garbage", 1);
    let _ = import_pack(&conn, &make_zip(&[(MANIFEST_FILE, manifest_json(2).as_bytes())]), 1);
    assert_eq!(count(&conn, "projects"), before);
}

#[test]
fn a_failed_import_also_rolls_back_saved_rolls() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_project(&source, &camp, 5000).unwrap();

    // Break only the LAST thing the importer writes.
    let target = open_in_memory();
    target.execute_batch("DROP TABLE saved_rolls").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["projects", "folders", "items", "tags", "document_content"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn saved_rolls_keep_their_trash_state_and_stay_in_the_dice_library() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

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
    let camp = import_parsed(&conn, &pack, 10).unwrap().project.id;
    assert_eq!(items::list(&conn, &camp, "dice", None).unwrap().len(), 2);
    assert_eq!(count(&conn, "saved_rolls"), 1);
}

#[test]
fn formulas_round_trip_with_their_trash_state() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

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
    let bytes = export_project(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE formulas").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["projects", "items", "saved_rolls", "document_content"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

// ------------------------------------------------------------------ cards

fn pool_cards(conn: &Connection, project: &str) -> Vec<String> {
    let pool = items::list(conn, project, "cards", None)
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

    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;
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
    let camp = projects::create(&conn, "Big deck", 1).unwrap().id;
    let png = test_images::png();
    for n in 0..150 {
        let card = items::create(&conn, &camp, "cards", "card", &format!("Card {n}"), None, 10).unwrap();
        cards::set_image(&conn, &card.id, "image/png", &png, &png[..12], 11).unwrap();
    }
    let bytes = export_project(&conn, &camp, 5000).unwrap();

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
    let camp = import_parsed(&conn, &pack, 10).unwrap().project.id;
    assert_eq!(items::list(&conn, &camp, "cards", None).unwrap().len(), 5);
    assert_eq!(count(&conn, "card_images"), 1);
    assert_eq!(count(&conn, "collection_members"), 2);
}

#[test]
fn a_failed_import_also_rolls_back_cards() {
    let source = open_in_memory();
    let camp = populate(&source);
    let bytes = export_project(&source, &camp, 5000).unwrap();
    // Break only the LAST thing the importer writes.
    let target = open_in_memory();
    target.execute_batch("DROP TABLE collection_members").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["projects", "items", "card_details", "card_images", "formulas"] {
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
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

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
    let bytes = export_project(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE saved_draws").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["projects", "items", "card_details", "collection_members", "formulas"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn decks_in_play_round_trip_with_their_trash_state() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

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
    let camp = projects::create(&conn, "Readings", 1).unwrap().id;
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
        project_id: &camp, name: "Reading", folder_id: None, source_name: "Tarot", seed: 1,
        text: "Tarot -> The Fool", result_json: &draw_json,
    };
    saved_draws::create(&conn, new_draw, 20).unwrap();
    let state_json = format!(
        r#"{{"version":1,"seed":5,"deck":[{{"id":"{}","name":"The Fool"}}],"drawn":[{{"id":"{}","name":"Two of Cups","reversed":true}}]}}"#,
        fool.id, cups.id
    );
    let game = NewPlayDeck {
        project_id: &camp, name: "Game", folder_id: None, source_id: Some(&deck.id),
        source_name: "Tarot", state_json: &state_json,
    };
    play_decks::create(&conn, game, 21).unwrap();

    let bytes = export_project(&conn, &camp, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

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
    // The original project is untouched.
    let before: Value = serde_json::from_str(&saved_draws::get(&conn, &find_in(&conn, &camp, "Reading")).unwrap().result_json).unwrap();
    assert_eq!(before["cards"][0]["id"], fool.id.as_str());
}

fn find_in(conn: &Connection, project: &str, name: &str) -> String {
    items::list(conn, project, "cards", None).unwrap().into_iter().find(|i| i.name == name).unwrap().id
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
    let bytes = export_project(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE play_decks").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["projects", "items", "saved_draws", "collection_members", "formulas"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn spreads_round_trip_and_their_positions_point_at_the_imported_sources() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

    let find = |project: &str, name: &str| {
        items::list(&conn, project, "cards", None).unwrap().into_iter().find(|i| i.name == name).unwrap()
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
    // The sources are the imported copies, not the original project's items.
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
    let camp = import_parsed(&conn, &pack, 10).unwrap().project.id;
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
    let bytes = export_project(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE spread_positions").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["projects", "items", "spreads", "play_decks", "saved_draws"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

// ------------------------------------------------------------ random tables

fn find_table(conn: &Connection, project: &str, name: &str) -> items::Item {
    items::list(conn, project, "tables", None).unwrap().into_iter().find(|i| i.name == name).unwrap()
}

#[test]
fn tables_keep_their_settings_entries_order_weights_and_tags_through_a_round_trip() {
    let conn = open_in_memory();
    let original = populate(&conn);
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;

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
    // Entry tags point at the imported project's own tags; the removed tag stays removed.
    let tag = tags::get(&conn, &rumors.entries[0].tag_ids[0]).unwrap();
    assert_eq!((tag.name.as_str(), tag.project_id == imported), ("Faction", true));
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
    assert_eq!(recent_rows(&conn), 1, "the sample project has one recent pick");
    let bytes = export_project(&conn, &original, 5000).unwrap();
    let imported = import_pack(&conn, &bytes, 6000).unwrap().project.id;
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
    let camp = import_parsed(&conn, &pack, 10).unwrap().project.id;
    // The oldest keeps its name; the later ones get numbers in order of age.
    assert_eq!(
        lines(&conn, "SELECT name, origin_item_id FROM items WHERE project_id = ?1 AND deleted_at IS NULL", &camp),
        [
            r#"[Text("Names"), Text("other")]"#,
            r#"[Text("RUMORS (2)"), Text("middle")]"#,
            r#"[Text("Rumors (3)"), Text("late")]"#,
            r#"[Text("rumors"), Text("early")]"#,
        ]
    );
    // So the imported project follows the one-name-per-table rule.
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
    let camp = import_parsed(&conn, &pack, 10).unwrap().project.id;
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
    let bytes = export_project(&source, &camp, 5000).unwrap();
    let target = open_in_memory();
    target.execute_batch("DROP TABLE table_entry_tags").unwrap();
    assert!(import_pack(&target, &bytes, 6000).is_err());
    for table in ["projects", "items", "random_tables", "table_entries", "table_recent"] {
        assert_eq!(count(&target, table), 0, "{table} should be empty after a failed import");
    }
}

#[test]
fn a_smart_collections_query_follows_its_tags_folders_fields_and_items_to_the_imported_copies() {
    let conn = open_in_memory();
    let camp = projects::create(&conn, "Queries", 1).unwrap().id;
    let people = folders::create(&conn, &camp, "worldbuilding", None, "People", 2).unwrap();
    let elf = tags::create(&conn, &camp, None, "Elf", None, 3).unwrap();
    let home = fields::create_definition(&conn, &camp, "Home", "link", "", r#"{"many":false}"#, 4).unwrap();
    let mood = fields::create_definition(&conn, &camp, "Mood", "dropdown", "", r#"{"options":[{"id":"calm","label":"Calm","color":null}]}"#, 5).unwrap();
    let ashgrove = items::create(&conn, &camp, "worldbuilding", "document", "Ashgrove", None, 6).unwrap();
    let query = json!({
        "version": 1,
        "where": { "op": "all", "not": false, "rules": [
            { "kind": "folder", "folderId": people.id, "subfolders": true, "not": false },
            { "kind": "tag", "tagId": elf.id, "subtags": true, "not": false },
            { "kind": "tag", "tagId": "a-tag-that-is-not-in-the-pack", "subtags": true, "not": true },
            { "kind": "field", "fieldId": home.id, "test": { "check": "links", "itemId": ashgrove.id }, "not": false },
            { "kind": "field", "fieldId": mood.id, "test": { "check": "choice", "optionIds": ["calm"] }, "not": false },
            { "kind": "name", "text": "elf", "not": false }
        ] },
        "sort": [{ "by": "field", "fieldId": mood.id, "dir": "desc" }]
    });
    let collection = items::create(&conn, &camp, "worldbuilding", "smart_collection", "Calm elves", None, 7).unwrap();
    smart_collections::set_query(&conn, &collection.id, &query.to_string(), 8).unwrap();

    let imported = import_pack(&conn, &export_project(&conn, &camp, 5000).unwrap(), 6000).unwrap().project.id;
    let find_item = |name: &str| items::list(&conn, &imported, "worldbuilding", None).unwrap().into_iter().find(|i| i.name == name).unwrap();
    let new_collection = find_item("Calm elves");
    assert_ne!(new_collection.id, collection.id);
    let got: serde_json::Value = serde_json::from_str(&smart_collections::get(&conn, &new_collection.id).unwrap().query_json).unwrap();

    let new_folder = folders::list(&conn, &imported, "worldbuilding").unwrap().into_iter().find(|f| f.name == "People").unwrap();
    let new_tag = tags::list(&conn, &imported).unwrap().into_iter().find(|t| t.name == "Elf").unwrap();
    let new_home = fields::list_definitions(&conn, &imported).unwrap().into_iter().find(|d| d.name == "Home").unwrap();
    let new_mood = fields::list_definitions(&conn, &imported).unwrap().into_iter().find(|d| d.name == "Mood").unwrap();
    let new_ashgrove = find_item("Ashgrove");
    let rules = &got["where"]["rules"];
    assert_eq!(rules[0]["folderId"], json!(new_folder.id));
    assert_eq!(rules[1]["tagId"], json!(new_tag.id));
    assert_eq!(rules[2]["tagId"], json!("a-tag-that-is-not-in-the-pack"));
    assert_eq!(rules[3]["fieldId"], json!(new_home.id));
    assert_eq!(rules[3]["test"]["itemId"], json!(new_ashgrove.id));
    assert_eq!(rules[4]["fieldId"], json!(new_mood.id));
    assert_eq!(rules[4]["test"]["optionIds"], json!(["calm"]), "a dropdown's choice ids are not item ids and stay as they were");
    assert_eq!(rules[5]["text"], json!("elf"));
    assert_eq!(got["sort"][0]["fieldId"], json!(new_mood.id));
    // The original still points at the original.
    let original: serde_json::Value = serde_json::from_str(&smart_collections::get(&conn, &collection.id).unwrap().query_json).unwrap();
    assert_eq!(original, query);
    // And the imported one runs.
    assert!(smart_collections::run(&conn, &new_collection.id, 7000, None).is_ok());
}

#[test]
fn a_generators_template_and_fields_follow_it_to_the_imported_copies() {
    let conn = open_in_memory();
    let camp = projects::create(&conn, "Generators", 1).unwrap().id;
    let template = items::create(&conn, &camp, "worldbuilding", "template", "NPC", None, 2).unwrap();
    let race = fields::create_definition(&conn, &camp, "Race", "text", "", "{}", 3).unwrap();
    let definition = json!({
        "version": 1,
        "templateId": template.id,
        "rows": [
            { "id": "r1", "label": "Name", "target": { "kind": "name" }, "source": "[Names]", "fallback": "" },
            { "id": "r2", "label": "Race", "target": { "kind": "field", "fieldId": race.id }, "source": "[Races]", "fallback": "Plain races" },
            { "id": "r3", "label": "Gone", "target": { "kind": "field", "fieldId": "a-field-that-is-not-in-the-pack" }, "source": "x", "fallback": "" }
        ]
    });
    let maker = items::create(&conn, &camp, "tables", "generator", "NPC maker", None, 4).unwrap();
    generators::set_definition(&conn, &maker.id, &definition.to_string(), 5).unwrap();

    let imported = import_pack(&conn, &export_project(&conn, &camp, 5000).unwrap(), 6000).unwrap().project.id;
    let new_maker = items::list(&conn, &imported, "tables", None).unwrap().into_iter().find(|i| i.name == "NPC maker").unwrap();
    assert_ne!(new_maker.id, maker.id);
    let got: serde_json::Value = serde_json::from_str(&generators::get(&conn, &new_maker.id).unwrap().definition_json).unwrap();
    let new_template = items::list(&conn, &imported, "worldbuilding", None).unwrap().into_iter().find(|i| i.name == "NPC").unwrap();
    let new_race = fields::list_definitions(&conn, &imported).unwrap().into_iter().find(|d| d.name == "Race").unwrap();
    assert_eq!(got["templateId"], json!(new_template.id));
    assert_eq!(got["rows"][1]["target"]["fieldId"], json!(new_race.id));
    assert_eq!(got["rows"][2]["target"]["fieldId"], json!("a-field-that-is-not-in-the-pack"));
    assert_eq!(got["rows"][0]["source"], json!("[Names]"));
    // The original is untouched.
    let original: serde_json::Value = serde_json::from_str(&generators::get(&conn, &maker.id).unwrap().definition_json).unwrap();
    assert_eq!(original, definition);
}

#[test]
fn bad_generator_data_in_a_pack_is_skipped_with_warnings() {
    let item = |id: &str, kind: &str| json!({
        "id": id, "library": "tables", "itemType": kind, "name": id, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let record = |id: &str, def: &str| json!({ "itemId": id, "definitionJson": def, "createdAt": 1, "updatedAt": 1 });
    let good = generators::EMPTY_DEFINITION;
    let bytes = pack_with(&[
        (ITEMS_FILE, json!([item("g", "generator"), item("t", "table"), item("g2", "generator")])),
        (GENERATORS_FILE, json!([
            record("g", good),
            record("g", good),        // twice
            record("t", good),        // not a generator
            record("ghost", good),    // nothing there
            record("g2", "[1, 2]"),   // not an object
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.generators.len(), 1);
    assert!(pack.warnings.iter().any(|w| w.contains("generator")), "{:?}", pack.warnings);
    let conn = open_in_memory();
    let result = import_parsed(&conn, &pack, 10).unwrap();
    let g2 = items::list(&conn, &result.project.id, "tables", None).unwrap().into_iter().find(|i| i.name == "g2").unwrap();
    assert_eq!(generators::get(&conn, &g2.id).unwrap().definition_json, generators::EMPTY_DEFINITION);
}

#[test]
fn bad_smart_collection_data_in_a_pack_is_skipped_with_warnings() {
    let item = |id: &str, kind: &str| json!({
        "id": id, "library": "worldbuilding", "itemType": kind, "name": id, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let record = |id: &str, query: &str| json!({ "itemId": id, "queryJson": query, "createdAt": 1, "updatedAt": 1 });
    let good = smart_collections::EMPTY_QUERY;
    let bytes = pack_with(&[
        (ITEMS_FILE, json!([item("s", "smart_collection"), item("d", "document"), item("s2", "smart_collection"), item("s3", "smart_collection")])),
        (SMART_COLLECTIONS_FILE, json!([
            record("s", good),
            record("s", good),                                                     // twice
            record("d", good),                                                     // not a smart collection
            record("ghost", good),                                                 // nothing there
            record("s2", "nonsense"),                                              // unreadable
            record("s3", r#"{"version":7,"where":{"op":"all","rules":[]}}"#),     // from a newer app
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.smart_collections.len(), 1);
    assert_eq!(pack.smart_collections[0].item_id, "s");
    assert!(pack.warnings.iter().any(|w| w.contains("filter set")), "{:?}", pack.warnings);
    // Items whose query was dropped still import; they read as the empty query.
    let conn = open_in_memory();
    let result = import_parsed(&conn, &pack, 10).unwrap();
    let s2 = items::list(&conn, &result.project.id, "worldbuilding", None).unwrap().into_iter().find(|i| i.name == "s2").unwrap();
    assert_eq!(smart_collections::get(&conn, &s2.id).unwrap().query_json, smart_collections::EMPTY_QUERY);
}

#[test]
fn name_presets_in_an_old_pack_are_skipped_with_a_warning_and_the_rest_imports() {
    let item = |id: &str, kind: &str| json!({
        "id": id, "library": "tables", "itemType": kind, "name": id, "icon": null,
        "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null
    });
    let bytes = pack_with(&[
        (ITEMS_FILE, json!([item("p", "name_preset"), item("t", "table")])),
        ("data/name_presets.json", json!([{ "itemId": "p", "setupJson": "{}", "createdAt": 1, "updatedAt": 1 }])),
        (LINKS_FILE, json!([{ "sourceItemId": "p", "targetItemId": "t", "sourceRef": "manual", "createdAt": 1, "updatedAt": 1, "deletedAt": null }])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert!(pack.warnings.iter().any(|w| w.starts_with("1 saved name setup(s)")), "{:?}", pack.warnings);
    let conn = open_in_memory();
    let camp = import_parsed(&conn, &pack, 10).unwrap().project.id;
    let names: Vec<_> = items::list(&conn, &camp, "tables", None).unwrap().into_iter().map(|i| i.name).collect();
    assert_eq!(names, ["t"]);
    assert_eq!(count(&conn, "links"), 0);
}

// ------------------------------------------------------------- mentions

#[test]
fn link_slots_in_table_entries_and_generators_follow_their_pages_to_the_imported_copies() {
    let source = open_in_memory();
    let c = projects::create(&source, "Links", 1).unwrap().id;
    let syra = items::create(&source, &c, "worldbuilding", "document", "Syra Pyroc", None, 2).unwrap();
    let table = items::create(&source, &c, "tables", "table", "Allies", None, 3).unwrap();
    let outside = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    tables::add_entry(&source, &table.id, &format!("[link:{} Syra Pyroc] and [link:{outside} Gone] with [2d4]", syra.id), 1, 4).unwrap();
    let generator = items::create(&source, &c, "tables", "generator", "Raid", None, 5).unwrap();
    let definition = json!({ "version": 2, "text": format!("[link:{} Syra Pyroc] attacks", syra.id) }).to_string();
    generators::set_definition(&source, &generator.id, &definition, 6).unwrap();

    let bytes = export_project(&source, &c, 5000).unwrap();
    let imported = import_pack(&source, &bytes, 6000).unwrap().project.id;

    let new_syra = items::list(&source, &imported, "worldbuilding", None).unwrap().remove(0);
    assert_ne!(new_syra.id, syra.id);
    let new_table = find_table(&source, &imported, "Allies");
    let entry = &tables::get(&source, &new_table.id).unwrap().entries[0];
    assert_eq!(entry.text, format!("[link:{} Syra Pyroc] and [link:{outside} Gone] with [2d4]", new_syra.id));
    let new_generator = items::list(&source, &imported, "tables", None).unwrap().into_iter().find(|i| i.name == "Raid").unwrap();
    let text: serde_json::Value = serde_json::from_str(&generators::get(&source, &new_generator.id).unwrap().definition_json).unwrap();
    assert_eq!(text["text"], json!(format!("[link:{} Syra Pyroc] attacks", new_syra.id)));
    // The original is untouched.
    assert!(tables::get(&source, &table.id).unwrap().entries[0].text.contains(&syra.id));
}

#[test]
fn mentions_in_document_text_follow_their_items_into_an_imported_project() {
    let source = open_in_memory();
    let camp = projects::create(&source, "Mentions", 1000).unwrap();
    let c = camp.id.as_str();
    let strahd = items::create(&source, c, "worldbuilding", "document", "Strahd", None, 1100).unwrap();
    let ireena = items::create(&source, c, "worldbuilding", "document", "Ireena", None, 1200).unwrap();
    let body = format!("See [Ireena](item:{}) and [a stranger](item:{}).", ireena.id, "0a1b2c3d-1111-4222-8333-444455556666");
    documents::set_body_with_links(&source, &strahd.id, &body, Some(&[ireena.id.clone()]), 1300).unwrap();

    let bytes = export_project(&source, c, 5000).unwrap();
    let target = open_in_memory();
    let imported = import_pack(&target, &bytes, 6000).unwrap().project.id;

    let found = |name: &str| search::search(&target, &imported, name, None, 10).unwrap().remove(0);
    let (new_strahd, new_ireena) = (found("Strahd"), found("Ireena"));
    let new_body = documents::get_body(&target, &new_strahd.id).unwrap();
    assert!(new_body.contains(&format!("(item:{})", new_ireena.id)), "{new_body}");
    assert!(!new_body.contains(&ireena.id));
    // An item outside the pack is left as written, pointing at nothing.
    assert!(new_body.contains("item:0a1b2c3d-1111-4222-8333-444455556666"));
    // The link made by the mention came across and points at the new item.
    let linked: Vec<_> = links::outgoing(&target, &new_strahd.id).unwrap().into_iter().map(|i| i.id).collect();
    assert_eq!(linked, vec![new_ireena.id]);
}

#[test]
fn remapped_body_replaces_only_known_item_addresses() {
    use super::import::remapped_body;
    use std::collections::HashMap;
    let old = "0a1b2c3d-1111-4222-8333-444455556666";
    let new = "99999999-9999-4999-8999-999999999999";
    let map: HashMap<String, String> = [(old.to_string(), new.to_string())].into();
    assert_eq!(remapped_body("no mentions here", &map), "no mentions here");
    assert_eq!(remapped_body(&format!("[a](item:{old}) and [b](item:{old})"), &map), format!("[a](item:{new}) and [b](item:{new})"));
    assert_eq!(remapped_body(&format!("[a](item:{})", old.to_uppercase()), &map), format!("[a](item:{new})"));
    // Not an address, or not a known one: untouched. Short text and non-ASCII text are fine.
    assert_eq!(remapped_body("item:short and item:", &map), "item:short and item:");
    assert_eq!(remapped_body("item:ffffffff-ffff-4fff-8fff-ffffffffffff", &map), "item:ffffffff-ffff-4fff-8fff-ffffffffffff");
    assert_eq!(remapped_body("héllo item:é wörld item:", &map), "héllo item:é wörld item:");
}

#[test]
fn a_templates_starter_text_and_setup_survive_a_pack_round_trip() {
    use crate::db::templates;
    let source = open_in_memory();
    let camp = projects::create(&source, "Templates", 1000).unwrap();
    let c = camp.id.as_str();
    let template = items::create(&source, c, "worldbuilding", templates::TEMPLATE_TYPE, "NPC", None, 1100).unwrap();
    documents::set_body(&source, &template.id, "## Motivation\n\n", 1200).unwrap();
    let race = fields::create_definition(&source, c, "Race", "text", "", "{}", 1300).unwrap();
    let people = fields::create_set(&source, c, "People", "", 1310).unwrap();
    fields::set_set_fields(&source, &people.id, &[race.id.clone()], 1320).unwrap();
    fields::apply_set(&source, &template.id, &people.id, 1330).unwrap();

    let bytes = export_project(&source, c, 5000).unwrap();
    let target = open_in_memory();
    let result = import_pack(&target, &bytes, 6000).unwrap();
    assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    let imported = search::search(&target, &result.project.id, "NPC", None, 10).unwrap().remove(0);
    assert_eq!(imported.item_type, templates::TEMPLATE_TYPE);
    assert_eq!(documents::get_body(&target, &imported.id).unwrap(), "## Motivation\n\n");

    // And a document made from the imported template gets the imported field set.
    let made = templates::create_from(&target, &imported.id, "Ireena", None, 7000).unwrap();
    assert_eq!(documents::get_body(&target, &made.id).unwrap(), "## Motivation\n\n");
    assert_eq!(fields::list_item_sets(&target, &made.id).unwrap().len(), 1);
}

#[test]
fn tabs_keep_working_in_an_imported_project() {
    let source = open_in_memory();
    let original = populate(&source);
    let bytes = export_project(&source, &original, 5000).unwrap();
    let target = open_in_memory();
    let imported = import_pack(&target, &bytes, 6000).unwrap().project.id;

    let find = |name: &str| search::search(&target, &imported, name, None, 10).unwrap().into_iter().find(|i| i.name == name).unwrap();
    let (strahd, barovia, relationships) = (find("Strahd"), find("Barovia"), find("Relationships"));
    let listed: Vec<_> = tabs::list_tabs(&target, &strahd.id).unwrap();
    assert_eq!(listed.len(), 3); // the removed embed stays removed
    assert_eq!(listed[0].item.as_ref().unwrap().id, relationships.id);
    assert_eq!((listed[1].title.as_str(), listed[1].item.as_ref().unwrap().id.as_str()), ("Homeland", barovia.id.as_str()));
    assert!(listed[2].item.is_none() && listed[2].title == "Crypt map"); // the empty slot
    // The nested document is hidden from the folders, knows its page, and kept its text.
    let top: Vec<String> = items::list(&target, &imported, "worldbuilding", None).unwrap().into_iter().map(|i| i.name).collect();
    assert!(!top.contains(&"Relationships".to_string()));
    assert_eq!(tabs::family_of(&target, &relationships.id).unwrap().unwrap().parent.id, strahd.id);
    assert_eq!(documents::get_body(&target, &relationships.id).unwrap(), "Ireena is his obsession.");
}

#[test]
fn unusable_tabs_are_repaired_or_skipped_with_a_warning() {
    let item = |id: &str, ty: &str| json!({ "id": id, "library": "worldbuilding", "itemType": ty, "name": id, "icon": null, "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null });
    let tab = |id: &str, parent: &str, kind: &str, pos: i64, child: serde_json::Value, target: serde_json::Value, title: &str| {
        json!({ "id": id, "parentId": parent, "kind": kind, "position": pos, "childId": child, "targetId": target, "title": title, "createdAt": 1, "updatedAt": 1, "deletedAt": null })
    };
    let bytes = pack_with(&[
        ("data/items.json", json!([item("page", "document"), item("kid", "document"), item("deeper", "document"), item("deck", "deck"), item("card", "card"), item("other", "document")])),
        ("data/item_tabs.json", json!([
            tab("t1", "page", "document", 0, json!("kid"), json!(null), ""),
            tab("t2", "kid", "document", 0, json!("deeper"), json!(null), ""),              // a tab can't have tabs
            tab("t3", "page", "document", 1, json!("kid"), json!(null), ""),                // a document is one tab only
            tab("t4", "page", "document", 2, json!("deck"), json!(null), ""),               // not a document
            tab("t5", "card", "embed", 0, json!(null), json!("deck"), "Deck"),              // a card can't have tabs
            tab("t6", "page", "embed", 3, json!(null), json!("missing"), "Map"),            // shows nothing here: an empty slot
            tab("t7", "page", "embed", 4, json!(null), json!(null), ""),                    // empty and unnamed
            tab("t8", "page", "embed", 5, json!(null), json!("page"), "Itself"),            // can't show its own page
            tab("t9", "page", "bogus", 6, json!(null), json!(null), "x"),
            tab("t10", "other", "embed", 0, json!(null), json!("deck"), "Deck"),
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    let mut kept: Vec<_> = pack.item_tabs.iter().map(|t| t.id.as_str()).collect();
    kept.sort();
    assert_eq!(kept, ["t1", "t10", "t6", "t8"]); // t6 and t8 became empty slots
    assert!(pack.item_tabs.iter().filter(|t| t.id == "t6" || t.id == "t8").all(|t| t.target_id.is_none()));
    assert!(pack.warnings.iter().any(|w| w.contains("empty slots")));
    assert!(pack.warnings.iter().any(|w| w.contains("tab(s)")));

    let conn = open_in_memory();
    let result = import_parsed(&conn, &pack, 9000).unwrap();
    assert_eq!(count(&conn, "item_tabs"), 4);
    assert_eq!(result.counts.item_tabs, 4);
}


// ------------------------------------------------------------ encounters and rulesets

#[test]
fn an_encounters_combatants_follow_their_pages_to_the_imported_copies_and_undo_history_is_left_behind() {
    let conn = open_in_memory();
    let c = projects::create(&conn, "Fights", 1).unwrap().id;
    let page = items::create(&conn, &c, "worldbuilding", "document", "Strahd", None, 2).unwrap();
    let fight = items::create(&conn, &c, "encounters", "encounter", "Crypt fight", None, 3).unwrap();
    let state = json!({
        "version": 1, "phase": "running", "round": 3,
        "combatants": [
            { "id": "c1", "baseName": "Strahd", "itemId": page.id },
            { "id": "c2", "baseName": "Wolf", "itemId": null },
            { "id": "c3", "baseName": "Gone", "itemId": "not-in-this-pack" }
        ],
        "history": [format!("{{\"state\":{{\"combatants\":[{{\"itemId\":\"{}\"}}]}}}}", page.id)]
    });
    encounters::set_state(&conn, &fight.id, &state.to_string(), 4).unwrap();

    let bytes = export_project(&conn, &c, 5).unwrap();
    let imported = import_pack(&conn, &bytes, 6).unwrap().project.id;
    let new_page = items::list(&conn, &imported, "worldbuilding", None).unwrap().into_iter().find(|i| i.name == "Strahd").unwrap();
    let new_fight = items::list(&conn, &imported, "encounters", None).unwrap().into_iter().find(|i| i.name == "Crypt fight").unwrap();

    let got: serde_json::Value = serde_json::from_str(&encounters::get(&conn, &new_fight.id).unwrap().unwrap().state_json).unwrap();
    assert_eq!(got["combatants"][0]["itemId"], json!(new_page.id));
    assert_eq!(got["combatants"][1]["itemId"], json!(null));
    assert_eq!(got["combatants"][2]["itemId"], json!("not-in-this-pack"), "ids outside the pack stay as written");
    assert_eq!((got["phase"].as_str(), got["round"].as_i64()), (Some("running"), Some(3)));
    assert_eq!(got["history"], json!([]), "undo history isn't carried over");
    // The original still has its own.
    let original: serde_json::Value = serde_json::from_str(&encounters::get(&conn, &fight.id).unwrap().unwrap().state_json).unwrap();
    assert_eq!(original["history"].as_array().unwrap().len(), 1);
    assert_eq!(original["combatants"][0]["itemId"], json!(page.id));
}

#[test]
fn a_ruleset_copy_brings_its_ruleset_along_when_this_device_doesnt_have_it_and_links_to_it_when_it_does() {
    let source = open_in_memory();
    let original = populate(&source);
    let bytes = export_project(&source, &original, 5000).unwrap();

    // A fresh device has no "Generic d20": it is made from the copy, and the copy points at it.
    let target = open_in_memory();
    assert!(crate::db::rulesets::list(&target).unwrap().is_empty());
    let imported = import_pack(&target, &bytes, 6000).unwrap().project.id;
    let made = crate::db::rulesets::list(&target).unwrap();
    assert_eq!(made.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["Generic d20"]);
    let copies = crate::db::rulesets::list_for_project(&target, &imported).unwrap();
    assert_eq!(copies.len(), 1);
    assert_eq!(copies[0].ruleset_id.as_deref(), Some(made[0].id.as_str()));
    // The copy's ids are the imported project's own properties and sets.
    let ids: serde_json::Value = serde_json::from_str(&copies[0].ids_json).unwrap();
    let race = fields::list_definitions(&target, &imported).unwrap().into_iter().find(|d| d.name == "Race").unwrap();
    let npc = fields::list_sets(&target, &imported).unwrap().into_iter().find(|s| s.name == "NPC").unwrap();
    assert_eq!(ids["fields"]["race"], json!(race.id));
    assert_eq!(ids["sets"]["npc"], json!(npc.id));

    // Importing again finds the ruleset by name instead of making a second one.
    let again = import_pack(&target, &bytes, 7000).unwrap().project.id;
    assert_eq!(crate::db::rulesets::list(&target).unwrap().len(), 1);
    let copies = crate::db::rulesets::list_for_project(&target, &again).unwrap();
    assert_eq!(copies[0].ruleset_id.as_deref(), Some(made[0].id.as_str()));
}

#[test]
fn bad_encounter_and_ruleset_data_in_a_pack_is_skipped_with_warnings() {
    let item = |id: &str, ty: &str, lib: &str| json!({ "id": id, "library": lib, "itemType": ty, "name": id, "icon": null, "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null });
    let record = |id: &str, state: &str| json!({ "itemId": id, "stateJson": state, "createdAt": 1, "updatedAt": 1 });
    let copy = |id: &str, name: &str, rules: &str, ids: &str| json!({ "id": id, "name": name, "rulesJson": rules, "idsJson": ids, "position": 0, "createdAt": 1, "updatedAt": 1, "deletedAt": null });
    let bytes = pack_with(&[
        ("data/items.json", json!([item("e1", "encounter", "encounters"), item("d", "document", "worldbuilding"), item("e2", "encounter", "encounters")])),
        ("data/encounters.json", json!([
            record("e1", "{\"phase\":\"setup\"}"),
            record("d", "{}"),                 // not an encounter
            record("e2", "not json"),          // unreadable
            record("missing", "{}"),           // no such item
        ])),
        ("data/project_rulesets.json", json!([
            copy("a", "Good", "{}", "{}"),
            copy("b", "  ", "{}", "{}"),       // no name
            copy("c", "Broken", "[1]", "{}"),  // rules that aren't an object
            copy("d", "Ids", "{}", "oops"),    // ids that can't be read
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!(pack.encounters.len(), 1);
    assert_eq!(pack.project_rulesets.len(), 1);
    assert!(pack.warnings.iter().any(|w| w.contains("encounter")), "{:?}", pack.warnings);
    assert!(pack.warnings.iter().any(|w| w.contains("ruleset")), "{:?}", pack.warnings);

    let conn = open_in_memory();
    let result = import_parsed(&conn, &pack, 9000).unwrap();
    assert_eq!(result.counts.encounters, 1);
    assert_eq!(result.counts.project_rulesets, 1);
    // The second encounter item has no saved state, which reads as a new encounter.
    let e2 = items::list(&conn, &result.project.id, "encounters", None).unwrap().into_iter().find(|i| i.name == "e2").unwrap();
    assert_eq!(encounters::get(&conn, &e2.id).unwrap(), None);
}

#[test]
fn bad_time_data_in_a_pack_is_skipped_with_warnings_and_old_packs_have_none() {
    let item = |id: &str, ty: &str, lib: &str| json!({ "id": id, "library": lib, "itemType": ty, "name": id, "icon": null, "folderId": null, "visibility": "default", "createdAt": 1, "updatedAt": 1, "deletedAt": null });
    let event = |id: &str, start: i64, end: Option<i64>| json!({ "itemId": id, "startDay": start, "endDay": end, "body": "", "createdAt": 1, "updatedAt": 1 });
    let session = |id: &str, status: &str| json!({ "itemId": id, "realDate": "2026-10-10", "status": status, "createdAt": 1, "updatedAt": 1 });
    let bytes = pack_with(&[
        ("data/items.json", json!([
            item("cal", "calendar", "calendar"), item("doc", "document", "worldbuilding"), item("ev", "event", "calendar"),
            item("ev2", "event", "calendar"), item("ses", "session", "worldbuilding"), item("ses2", "session", "worldbuilding"),
            item("tl", "timeline", "calendar"),
        ])),
        ("data/calendars.json", json!([
            { "itemId": "cal", "calendarJson": "{}", "createdAt": 1, "updatedAt": 1 },
            { "itemId": "doc", "calendarJson": "{}", "createdAt": 1, "updatedAt": 1 },   // not a calendar
            { "itemId": "cal", "calendarJson": "{}", "createdAt": 1, "updatedAt": 1 },   // repeated
        ])),
        ("data/timelines.json", json!([{ "itemId": "tl", "configJson": "oops", "createdAt": 1, "updatedAt": 1 }])),
        ("data/calendar_events.json", json!([
            event("ev", 5, Some(7)),
            event("ev2", 9, Some(3)),            // ends before it starts
            event("doc", 1, None),               // not an event
        ])),
        ("data/sessions.json", json!([session("ses", "ended"), session("ses2", "someday")])),
        ("data/weather_days.json", json!([
            { "day": 3, "weatherJson": "{}", "createdAt": 1, "updatedAt": 1 },
            { "day": 3, "weatherJson": "{}", "createdAt": 1, "updatedAt": 1 },
            { "day": 4, "weatherJson": "[]", "createdAt": 1, "updatedAt": 1 },
        ])),
        ("data/project_state.json", json!([
            { "mainCalendarId": "cal", "nowDay": 77, "nowMinute": 5, "sessionId": "gone", "createdAt": 1, "updatedAt": 1 },
            { "nowDay": 1, "nowMinute": 1, "createdAt": 1, "updatedAt": 1 },
        ])),
    ]);
    let pack = read_pack(&bytes).unwrap();
    assert_eq!((pack.calendars.len(), pack.timelines.len(), pack.calendar_events.len(), pack.sessions.len(), pack.weather_days.len(), pack.project_state.len()), (1, 0, 1, 1, 1, 1));
    for word in ["calendar", "timeline", "event", "session", "weather", "project state"] {
        assert!(pack.warnings.iter().any(|w| w.contains(word)), "{word}: {:?}", pack.warnings);
    }

    let conn = open_in_memory();
    let result = import_parsed(&conn, &pack, 9000).unwrap();
    let state = project_state::get(&conn, &result.project.id).unwrap();
    assert_eq!((state.now_day, state.now_minute), (77, 5));
    // The calendar came with the pack and is the main one; the session it named wasn't in the pack, so none is current.
    let cal = items::list(&conn, &result.project.id, "calendar", None).unwrap().into_iter().find(|i| i.name == "cal").unwrap();
    assert_eq!(state.main_calendar_id.as_deref(), Some(cal.id.as_str()));
    assert_eq!(state.session_id, None);

    // A pack made before time existed has none of these files and imports without a word about them.
    let old = pack_with(&[("data/items.json", json!([item("doc", "document", "worldbuilding")]))]);
    let parsed = read_pack(&old).unwrap();
    assert!(parsed.warnings.is_empty(), "{:?}", parsed.warnings);
    assert_eq!(parsed.counts().calendars + parsed.counts().project_state + parsed.counts().sessions, 0);
}
