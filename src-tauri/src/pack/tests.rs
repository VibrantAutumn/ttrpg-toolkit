use super::export::export_campaign;
use super::format::*;
use super::import::{import_pack, import_parsed, parent_first, read_pack, read_pack_with, Limits};
use super::PackError;
use crate::db::{campaigns, documents, folders, items, links, open_in_memory, search, settings, tags};
use rusqlite::types::Value;
use rusqlite::Connection;
use serde_json::json;
use std::io::{Cursor, Write};
use zip::{write::SimpleFileOptions, ZipWriter};

/// A campaign exercising everything a pack carries, with fixed timestamps:
/// nested folders, items in and out of folders, a map, document text, nested and
/// coloured tags, attached and removed tags, links (one removed), and trash
/// (a deleted item, a deleted folder with a deleted item inside, a deleted tag).
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
        Counts { folders: 3, items: 6, tags: 4, item_tags: 4, links: 3, documents: 4 }
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
    assert_eq!(count(&conn, "items"), 12);
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
    assert_eq!(rows.len(), 6);
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
        Counts { folders: 0, items: 2, tags: 3, item_tags: 1, links: 1, documents: 1 }
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
        Counts { folders: 3, items: 6, tags: 4, item_tags: 4, links: 3, documents: 4 }
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
