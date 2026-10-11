//! Starter tables: ready-made random tables that come with the app, added to a project in one all-or-nothing step.
//!
//! The app builds a "bundle" (plain data, see `TableBundle`) and this module
//! writes it, the same way `starters.rs` writes a starter deck. Everything made
//! carries `origin_pack_id = <bundle id>` (like items from a content pack), which is
//! how "already added" is known. Once added they are ordinary tables: rename,
//! edit, tag or delete them freely.
//!
use super::cards::MAX_NOTES_BYTES;
use super::error::{clean_name, DbError};
use super::starters::{installed, BundleTag, ID_PREFIX};
use super::tables::{self, LIBRARY, TABLE_TYPE};
use super::{projects, folders, items, tags};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

const MAX_TABLES: usize = 40;
const MAX_ENTRIES_PER_TABLE: usize = 500;
const MAX_ENTRIES_TOTAL: usize = 3_000;
const MAX_TAGS: usize = 60;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableBundle {
    /// e.g. `starter:fantasy-names`.
    pub id: String,
    /// Name of the folder everything is put in.
    pub name: String,
    #[serde(default)]
    pub tags: Vec<BundleTag>,
    pub tables: Vec<BundleTable>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleTable {
    /// Unique inside the bundle; remembered as the item's `origin_item_id`.
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub notes: String,
    pub die_size: Option<i64>,
    #[serde(default)]
    pub avoid_recent: i64,
    pub entries: Vec<BundleEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleEntry {
    pub text: String,
    #[serde(default = "one")]
    pub weight: i64,
    /// Names of tags from the bundle's `tags`.
    #[serde(default)]
    pub tags: Vec<String>,
}

fn one() -> i64 {
    1
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInstallResult {
    pub folder_id: String,
    pub tables: u32,
    pub entries: u32,
}

/// Checks the whole bundle before anything is written.
fn validate(bundle: &TableBundle) -> Result<(), DbError> {
    if !bundle.id.starts_with(ID_PREFIX) || bundle.id.len() > 64 {
        return Err(DbError::Invalid("That isn't a starter."));
    }
    clean_name(&bundle.name)?;
    if bundle.tables.is_empty() || bundle.tables.len() > MAX_TABLES {
        return Err(DbError::Invalid("A starter needs between 1 and 40 tables."));
    }
    if bundle.tags.len() > MAX_TAGS {
        return Err(DbError::Invalid("That starter is too large."));
    }

    let mut tag_names = HashSet::new();
    for tag in &bundle.tags {
        clean_name(&tag.name)?;
        if !tag_names.insert(tag.name.trim().to_lowercase()) {
            return Err(DbError::Invalid("A starter's tags need different names."));
        }
    }
    let mut keys = HashSet::new();
    let mut names = HashSet::new();
    let mut total = 0;
    for table in &bundle.tables {
        clean_name(&table.name)?;
        if table.key.trim().is_empty() || !keys.insert(table.key.as_str()) {
            return Err(DbError::Invalid("Every starter table needs its own key."));
        }
        if !names.insert(table.name.trim().to_lowercase()) {
            return Err(DbError::Invalid("A starter's tables need different names."));
        }
        tables::validate_options(table.die_size, table.avoid_recent)?;
        if table.notes.len() > MAX_NOTES_BYTES {
            return Err(DbError::Invalid("A starter table's notes are too long."));
        }
        if table.entries.is_empty() || table.entries.len() > MAX_ENTRIES_PER_TABLE {
            return Err(DbError::Invalid("A starter table needs between 1 and 500 entries."));
        }
        total += table.entries.len();
        for entry in &table.entries {
            tables::validate_entry(&entry.text, entry.weight)?;
            if entry.tags.iter().any(|t| !tag_names.contains(&t.trim().to_lowercase())) {
                return Err(DbError::Invalid("A starter entry uses a tag the starter doesn't define."));
            }
        }
    }
    if total > MAX_ENTRIES_TOTAL {
        return Err(DbError::Invalid("That starter has too many entries."));
    }
    Ok(())
}

/// Puts the bundle into the project. All or nothing: a failure part-way leaves
/// the project exactly as it was. Refuses if this starter is already there, or
/// if a table with the same name as one of its tables already exists.
pub fn install(conn: &Connection, project_id: &str, bundle: &TableBundle, now: i64) -> Result<TableInstallResult, DbError> {
    projects::require_live(conn, project_id)?;
    validate(bundle)?;
    if installed(conn, project_id)?.contains(&bundle.id) {
        return Err(DbError::Invalid("That starter has already been added to this project."));
    }
    for table in &bundle.tables {
        let taken: i64 = conn.query_row(
            "SELECT COUNT(*) FROM items
             WHERE project_id = ?1 AND library = ?2 AND item_type = ?3 AND deleted_at IS NULL
               AND name = ?4 COLLATE NOCASE",
            params![project_id, LIBRARY, TABLE_TYPE, table.name.trim()],
            |r| r.get(0),
        )?;
        if taken > 0 {
            return Err(DbError::Invalid(
                "A table with the same name as one in this starter already exists. Rename or delete it first.",
            ));
        }
    }

    // One transaction makes everything from here on all-or-nothing. (Direct inserts
    // below, not helpers that open their own transaction: those can't nest.)
    let tx = conn.unchecked_transaction()?;

    // Tags: reuse a top-level tag with the same name, so a second starter that uses "Elf" doesn't make another.
    let existing = tags::list(&tx, project_id)?;
    let mut tag_ids: HashMap<String, String> = HashMap::new();
    for tag in &bundle.tags {
        let found = existing
            .iter()
            .find(|t| t.parent_id.is_none() && t.name.eq_ignore_ascii_case(tag.name.trim()));
        let id = match found {
            Some(t) => t.id.clone(),
            None => tags::create(&tx, project_id, None, &tag.name, tag.color.as_deref(), now)?.id,
        };
        tag_ids.insert(tag.name.trim().to_lowercase(), id);
    }

    let folder = folders::create(&tx, project_id, LIBRARY, None, &bundle.name, now)?;
    let make = |item_type: &str, name: &str, origin: &str| -> Result<String, DbError> {
        let item = items::create(&tx, project_id, LIBRARY, item_type, name, Some(&folder.id), now)?;
        tx.execute(
            "UPDATE items SET origin_pack_id = ?2, origin_item_id = ?3 WHERE id = ?1",
            params![item.id, bundle.id, origin],
        )?;
        Ok(item.id)
    };

    let mut entry_count = 0;
    for table in &bundle.tables {
        let id = make(TABLE_TYPE, &table.name, &table.key)?;
        if !table.notes.is_empty() || table.die_size.is_some() || table.avoid_recent != 0 {
            tx.execute(
                "INSERT INTO random_tables (item_id, notes, die_size, avoid_recent, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![id, table.notes, table.die_size, table.avoid_recent, now],
            )?;
        }
        for (i, entry) in table.entries.iter().enumerate() {
            let entry_id = Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO table_entries (id, table_id, position, text, weight, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![entry_id, id, i as i64 + 1, entry.text, entry.weight, now],
            )?;
            for tag in &entry.tags {
                tx.execute(
                    "INSERT OR IGNORE INTO table_entry_tags (entry_id, tag_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?3)",
                    params![entry_id, tag_ids[&tag.trim().to_lowercase()], now],
                )?;
            }
            entry_count += 1;
        }
    }

    tx.commit()?;
    Ok(TableInstallResult {
        folder_id: folder.id,
        tables: bundle.tables.len() as u32,
        entries: entry_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, search, trash};

    fn entry(text: &str, weight: i64, tags: &[&str]) -> BundleEntry {
        BundleEntry { text: text.into(), weight, tags: tags.iter().map(|t| t.to_string()).collect() }
    }

    fn table(key: &str, name: &str, entries: Vec<BundleEntry>) -> BundleTable {
        BundleTable { key: key.into(), name: name.into(), notes: String::new(), die_size: None, avoid_recent: 0, entries }
    }

    /// Two name tables, a table with a slot, and two tags.
    fn bundle() -> TableBundle {
        TableBundle {
            id: "starter:test".into(),
            name: "Test names".into(),
            tags: vec![
                BundleTag { name: "Elf".into(), color: Some("#2b8a3e".into()) },
                BundleTag { name: "Orc".into(), color: None },
            ],
            tables: vec![
                table("pre", "Prefixes", vec![entry("Ael", 2, &["Elf"]), entry("Gor", 1, &["Orc"]), entry("Cal", 1, &["Elf", "Orc"])]),
                BundleTable {
                    notes: "Roll once a day".into(),
                    die_size: Some(20),
                    avoid_recent: 2,
                    ..table("suf", "Suffixes", vec![entry("wen", 10, &["Elf"]), entry("gash", 10, &["Orc"])])
                },
                table("quest", "Quests", vec![entry("Find [2d4] [Prefixes]", 1, &[])]),
            ],
        }
    }

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    fn find(conn: &Connection, camp: &str, name: &str) -> items::Item {
        let folder = folders::list(conn, camp, LIBRARY).unwrap().remove(0);
        items::list(conn, camp, LIBRARY, Some(&folder.id)).unwrap().into_iter().find(|i| i.name == name).unwrap()
    }

    #[test]
    fn installing_makes_a_folder_with_tables_entries_and_tags() {
        let (conn, camp) = setup();
        let result = install(&conn, &camp, &bundle(), 100).unwrap();
        assert_eq!((result.tables, result.entries), (3, 6));

        let folders = folders::list(&conn, &camp, LIBRARY).unwrap();
        assert_eq!(folders.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["Test names"]);
        let in_folder = items::list(&conn, &camp, LIBRARY, Some(&folders[0].id)).unwrap();
        let kinds: Vec<_> = in_folder.iter().map(|i| (i.name.as_str(), i.item_type.as_str())).collect();
        assert_eq!(
            kinds,
            [("Prefixes", "table"), ("Quests", "table"), ("Suffixes", "table")]
        );

        // Entries keep their order, weights and tags; settings and notes are stored.
        let prefixes = tables::get(&conn, &find(&conn, &camp, "Prefixes").id).unwrap();
        let got: Vec<_> = prefixes.entries.iter().map(|e| (e.text.as_str(), e.weight, e.tag_ids.len())).collect();
        assert_eq!(got, [("Ael", 2, 1), ("Gor", 1, 1), ("Cal", 1, 2)]);
        let suffixes = tables::get(&conn, &find(&conn, &camp, "Suffixes").id).unwrap();
        assert_eq!((suffixes.notes.as_str(), suffixes.die_size, suffixes.avoid_recent), ("Roll once a day", Some(20), 2));
        // A table with no settings has no settings row (it reads as the defaults).
        let quests = tables::get(&conn, &find(&conn, &camp, "Quests").id).unwrap();
        assert_eq!((quests.die_size, quests.avoid_recent), (None, 0));

        let tag_list = tags::list(&conn, &camp).unwrap();
        assert_eq!(tag_list.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["Elf", "Orc"]);
        assert_eq!(tag_list[0].color.as_deref(), Some("#2b8a3e"));
        // They are found by search, and remember where they came from.
        assert_eq!(search::search(&conn, &camp, "dragon OR gash", None, 10).unwrap().len(), 0);
        assert_eq!(search::search(&conn, &camp, "wen", Some("tables"), 10).unwrap().len(), 1);
        let origin: (String, String) = conn
            .query_row(
                "SELECT origin_pack_id, origin_item_id FROM items WHERE name = 'Suffixes'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(origin, ("starter:test".to_string(), "suf".to_string()));
        assert_eq!(installed(&conn, &camp).unwrap(), ["starter:test"]);
    }

    #[test]
    fn the_roller_sees_the_installed_tables_with_their_tags() {
        let (conn, camp) = setup();
        install(&conn, &camp, &bundle(), 100).unwrap();
        let loaded = tables::load_rollable(&conn, &camp).unwrap();
        let prefixes = loaded.iter().find(|t| t.name == "Prefixes").unwrap();
        assert_eq!(prefixes.entries.len(), 3);
        assert_eq!(prefixes.entries[2].tag_ids.len(), 2);
    }

    #[test]
    fn a_starter_can_only_be_added_once() {
        let (conn, camp) = setup();
        install(&conn, &camp, &bundle(), 100).unwrap();
        assert!(matches!(install(&conn, &camp, &bundle(), 101), Err(DbError::Invalid(_))));
        assert_eq!(count(&conn, "table_entries"), 6);
        // Another project is separate.
        let other = projects::create(&conn, "Other", 2).unwrap();
        install(&conn, &other.id, &bundle(), 102).unwrap();
        // Once everything from it is in the trash it can be added again.
        for item in items::list(&conn, &camp, LIBRARY, None).unwrap() {
            items::soft_delete(&conn, &item.id, 103).unwrap();
        }
        let folder = folders::list(&conn, &camp, LIBRARY).unwrap().remove(0);
        for item in items::list(&conn, &camp, LIBRARY, Some(&folder.id)).unwrap() {
            items::soft_delete(&conn, &item.id, 104).unwrap();
        }
        assert!(installed(&conn, &camp).unwrap().is_empty());
        install(&conn, &camp, &bundle(), 105).unwrap();
    }

    #[test]
    fn it_refuses_to_clash_with_a_table_that_already_has_a_name_and_writes_nothing() {
        let (conn, camp) = setup();
        items::create(&conn, &camp, LIBRARY, TABLE_TYPE, "SUFFIXES", None, 5).unwrap();
        let before = (count(&conn, "items"), count(&conn, "tags"), count(&conn, "folders"));
        let err = install(&conn, &camp, &bundle(), 100).unwrap_err();
        assert!(matches!(err, DbError::Invalid(_)));
        assert!(err.to_string().contains("same name"), "{err}");
        assert_eq!((count(&conn, "items"), count(&conn, "tags"), count(&conn, "folders")), before);

        // A table in the trash doesn't count; a document with the same name doesn't either.
        let (conn, camp) = setup();
        let old = items::create(&conn, &camp, LIBRARY, TABLE_TYPE, "Suffixes", None, 5).unwrap();
        items::soft_delete(&conn, &old.id, 6).unwrap();
        items::create(&conn, &camp, "worldbuilding", "document", "Prefixes", None, 7).unwrap();
        install(&conn, &camp, &bundle(), 100).unwrap();
    }

    #[test]
    fn an_existing_top_level_tag_is_reused_not_duplicated() {
        let (conn, camp) = setup();
        let elf = tags::create(&conn, &camp, None, "elf", Some("#112233"), 2).unwrap();
        install(&conn, &camp, &bundle(), 100).unwrap();
        let names: Vec<_> = tags::list(&conn, &camp).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(names, ["elf", "Orc"]);
        let ael: String = conn
            .query_row(
                "SELECT l.tag_id FROM table_entry_tags l JOIN table_entries e ON e.id = l.entry_id WHERE e.text = 'Ael'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ael, elf.id);
    }

    #[test]
    fn a_bad_bundle_is_refused_before_anything_is_written() {
        let (conn, camp) = setup();
        let long = "x".repeat(tables::MAX_ENTRY_BYTES + 1);
        let cases: Vec<(&str, Box<dyn Fn(&mut TableBundle)>)> = vec![
            ("not a starter id", Box::new(|b| b.id = "pack:test".into())),
            ("blank folder name", Box::new(|b| b.name = "  ".into())),
            ("no tables", Box::new(|b| b.tables.clear())),
            ("duplicate keys", Box::new(|b| b.tables[1].key = "pre".into())),
            ("duplicate names ignoring case", Box::new(|b| b.tables[1].name = "prefixes".into())),
            ("a blank table name", Box::new(|b| b.tables[0].name = " ".into())),
            ("a table with no entries", Box::new(|b| b.tables[0].entries.clear())),
            ("a blank entry", Box::new(|b| b.tables[0].entries[0].text = "  ".into())),
            ("a too long entry", Box::new(move |b| b.tables[0].entries[0].text = long.clone())),
            ("a negative weight", Box::new(|b| b.tables[0].entries[0].weight = -1)),
            ("an undefined tag", Box::new(|b| b.tables[0].entries[0].tags = vec!["Dwarf".into()])),
            ("duplicate tag names", Box::new(|b| b.tags[1].name = "ELF".into())),
            ("a bad die", Box::new(|b| b.tables[1].die_size = Some(1))),
            ("too much avoiding", Box::new(|b| b.tables[1].avoid_recent = 51)),
        ];
        for (what, change) in cases {
            let mut b = bundle();
            change(&mut b);
            assert!(install(&conn, &camp, &b, 100).is_err(), "{what}");
        }
        for table in ["items", "folders", "tags", "table_entries", "random_tables"] {
            assert_eq!(count(&conn, table), 0, "{table} should be empty after refused installs");
        }
    }

    #[test]
    fn a_failure_part_way_leaves_the_project_exactly_as_it_was() {
        let (conn, camp) = setup();
        // The second table's settings are written after the first table's entries, so this fails part-way.
        conn.execute_batch("DROP TABLE random_tables").unwrap();
        assert!(install(&conn, &camp, &bundle(), 100).is_err());
        for table in ["items", "folders", "tags", "table_entries", "table_entry_tags"] {
            assert_eq!(count(&conn, table), 0, "{table} should be empty after a failed install");
        }
    }

    #[test]
    fn installed_items_can_be_trashed_and_the_tables_follow_the_name_rule() {
        let (conn, camp) = setup();
        install(&conn, &camp, &bundle(), 100).unwrap();
        // Their names are taken now, like any other table's.
        assert!(items::create(&conn, &camp, LIBRARY, TABLE_TYPE, "prefixes", None, 101).is_err());
        let prefixes = find(&conn, &camp, "Prefixes");
        items::soft_delete(&conn, &prefixes.id, 102).unwrap();
        trash::restore_item(&conn, &prefixes.id, 103).unwrap();
    }
}
