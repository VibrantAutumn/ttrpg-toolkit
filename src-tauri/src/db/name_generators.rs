//! Name generators: library items (library `tables`, type `name_generator`) that
//! keep lists of name parts and the rules for joining them. The lists are
//! ordinary `table_entries` rows told apart by their `part` (see
//! `tables.rs`), so editing, ordering, weights, undo and tags work the same way.
//! This only stores and validates; building a name is the app's TypeScript
//! (`src/lib/tables/nameGen.ts`).

use super::cards::MAX_NOTES_BYTES;
use super::error::DbError;
use super::items::{self, Item};
use super::tables::{self, Entry, EntryInput, LIBRARY};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const GENERATOR_TYPE: &str = "name_generator";
/// The lists a generator can have; a mode uses some of them.
pub const PARTS: [&str; 4] = ["full", "first", "middle", "last"];
pub const MODES: [&str; 3] = ["full", "two", "three"];
pub const SEPARATORS: [&str; 4] = ["none", "space", "hyphen", "apostrophe"];
pub const CAPITALISATIONS: [&str; 3] = ["asTyped", "firstLetter", "everyPart"];

/// How names are built (mirrors the app's `NameGenSettings`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorSettings {
    pub mode: String,
    pub join1: String,
    pub join2: String,
    pub capitalisation: String,
    pub merge_doubles: bool,
}

impl Default for GeneratorSettings {
    fn default() -> Self {
        GeneratorSettings {
            mode: "two".into(),
            join1: "none".into(),
            join2: "none".into(),
            capitalisation: "firstLetter".into(),
            merge_doubles: false,
        }
    }
}

/// The lists of a generator, each in order.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct PartLists {
    pub full: Vec<Entry>,
    pub first: Vec<Entry>,
    pub middle: Vec<Entry>,
    pub last: Vec<Entry>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorDetail {
    pub item_id: String,
    pub notes: String,
    pub settings: GeneratorSettings,
    pub parts: PartLists,
}

/// One row of the generators list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratorSummary {
    pub item_id: String,
    pub name: String,
    pub mode: String,
    /// Live entries in all its lists.
    pub entries: i64,
    /// Every list its mode uses has an entry that can be picked.
    pub ready: bool,
}

/// An entry as the generator needs it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartEntry {
    pub id: String,
    pub text: String,
    pub weight: i64,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct RollableParts {
    pub full: Vec<PartEntry>,
    pub first: Vec<PartEntry>,
    pub middle: Vec<PartEntry>,
    pub last: Vec<PartEntry>,
}

/// A generator with everything needed to generate names without more lookups.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollableGenerator {
    pub id: String,
    pub name: String,
    pub settings: GeneratorSettings,
    pub parts: RollableParts,
}

/// Checks the item exists, is live, and is a name generator.
fn require_live_generator(conn: &Connection, item_id: &str) -> Result<Item, DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.library != LIBRARY || item.item_type != GENERATOR_TYPE {
        return Err(DbError::Invalid("This item isn't a name generator."));
    }
    Ok(item)
}

/// Checks a generator's settings (also used when importing packs).
pub fn validate_settings(s: &GeneratorSettings) -> Result<(), DbError> {
    if !MODES.contains(&s.mode.as_str()) {
        return Err(DbError::Invalid("A name has one part, two or three."));
    }
    if !SEPARATORS.contains(&s.join1.as_str()) || !SEPARATORS.contains(&s.join2.as_str()) {
        return Err(DbError::Invalid("Parts are joined with nothing, a space, a hyphen or an apostrophe."));
    }
    if !CAPITALISATIONS.contains(&s.capitalisation.as_str()) {
        return Err(DbError::Invalid("Capitals are as typed, first letter, or every part."));
    }
    Ok(())
}

fn read_settings(conn: &Connection, item_id: &str) -> Result<(String, GeneratorSettings), DbError> {
    let row: Option<(String, GeneratorSettings)> = conn
        .query_row(
            "SELECT notes, mode, join1, join2, capitalisation, merge_doubles FROM name_generators WHERE item_id = ?1",
            [item_id],
            |r| {
                Ok((
                    r.get(0)?,
                    GeneratorSettings {
                        mode: r.get(1)?,
                        join1: r.get(2)?,
                        join2: r.get(3)?,
                        capitalisation: r.get(4)?,
                        merge_doubles: r.get(5)?,
                    },
                ))
            },
        )
        .optional()?;
    Ok(row.unwrap_or_else(|| (String::new(), GeneratorSettings::default())))
}

/// A generator's notes, settings and lists.
pub fn get(conn: &Connection, item_id: &str) -> Result<GeneratorDetail, DbError> {
    require_live_generator(conn, item_id)?;
    let (notes, settings) = read_settings(conn, item_id)?;
    Ok(GeneratorDetail {
        item_id: item_id.to_string(),
        notes,
        settings,
        parts: PartLists {
            full: tables::entries_of(conn, item_id, "full")?,
            first: tables::entries_of(conn, item_id, "first")?,
            middle: tables::entries_of(conn, item_id, "middle")?,
            last: tables::entries_of(conn, item_id, "last")?,
        },
    })
}

/// Replaces the notes.
pub fn set_notes(conn: &Connection, item_id: &str, notes: &str, now: i64) -> Result<(), DbError> {
    require_live_generator(conn, item_id)?;
    if notes.len() > MAX_NOTES_BYTES {
        return Err(DbError::Invalid("Those notes are too long to save."));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO name_generators (item_id, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (item_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at",
        params![item_id, notes, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Changes how names are built.
pub fn set_settings(conn: &Connection, item_id: &str, s: &GeneratorSettings, now: i64) -> Result<(), DbError> {
    require_live_generator(conn, item_id)?;
    validate_settings(s)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO name_generators (item_id, mode, join1, join2, capitalisation, merge_doubles, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT (item_id) DO UPDATE
             SET mode = excluded.mode, join1 = excluded.join1, join2 = excluded.join2,
                 capitalisation = excluded.capitalisation, merge_doubles = excluded.merge_doubles,
                 updated_at = excluded.updated_at",
        params![item_id, s.mode, s.join1, s.join2, s.capitalisation, s.merge_doubles, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Adds entries to the end of one of the generator's lists, all or nothing.
/// (Editing, deleting, moving and tagging entries use the functions in `tables.rs`.)
pub fn add_entries(
    conn: &Connection,
    item_id: &str,
    part: &str,
    inputs: &[EntryInput],
    now: i64,
) -> Result<Vec<Entry>, DbError> {
    require_live_generator(conn, item_id)?;
    if !PARTS.contains(&part) {
        return Err(DbError::Invalid("That isn't one of a name generator's lists."));
    }
    tables::add_part_entries(conn, item_id, part, inputs, now)
}

/// Which lists a mode draws from.
fn parts_of(mode: &str) -> &'static [&'static str] {
    match mode {
        "full" => &["full"],
        "three" => &["first", "middle", "last"],
        _ => &["first", "last"],
    }
}

/// Every live generator in a campaign (any folder), alphabetical, and whether it can make names.
pub fn list(conn: &Connection, campaign_id: &str) -> Result<Vec<GeneratorSummary>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, COALESCE(g.mode, 'two')
         FROM items i LEFT JOIN name_generators g ON g.item_id = i.id
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
         ORDER BY i.name COLLATE NOCASE, i.created_at, i.id",
    )?;
    let base = stmt
        .query_map(params![campaign_id, LIBRARY, GENERATOR_TYPE], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // (live entries, entries that can be picked) for each list of each generator.
    let mut counts: HashMap<(String, String), (i64, i64)> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT e.table_id, e.part, COUNT(*), SUM(e.weight > 0)
         FROM table_entries e JOIN items i ON i.id = e.table_id
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
           AND e.deleted_at IS NULL
         GROUP BY e.table_id, e.part",
    )?;
    for row in stmt.query_map(params![campaign_id, LIBRARY, GENERATOR_TYPE], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?))
    })? {
        let (id, part, total, pickable) = row?;
        counts.insert((id, part), (total, pickable));
    }

    Ok(base
        .into_iter()
        .map(|(id, name, mode)| {
            let entries = PARTS.iter().map(|p| counts.get(&(id.clone(), p.to_string())).map_or(0, |c| c.0)).sum();
            let ready = parts_of(&mode)
                .iter()
                .all(|p| counts.get(&(id.clone(), p.to_string())).is_some_and(|c| c.1 > 0));
            GeneratorSummary { item_id: id, name, mode, entries, ready }
        })
        .collect())
}

/// Every live generator in a campaign with its settings and lists, ready to generate names.
pub fn load_all(conn: &Connection, campaign_id: &str) -> Result<Vec<RollableGenerator>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, g.mode, g.join1, g.join2, g.capitalisation, g.merge_doubles
         FROM items i LEFT JOIN name_generators g ON g.item_id = i.id
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
         ORDER BY i.name COLLATE NOCASE, i.created_at, i.id",
    )?;
    let mut generators = stmt
        .query_map(params![campaign_id, LIBRARY, GENERATOR_TYPE], |r| {
            let defaults = GeneratorSettings::default();
            Ok(RollableGenerator {
                id: r.get(0)?,
                name: r.get(1)?,
                settings: GeneratorSettings {
                    mode: r.get::<_, Option<String>>(2)?.unwrap_or(defaults.mode),
                    join1: r.get::<_, Option<String>>(3)?.unwrap_or(defaults.join1),
                    join2: r.get::<_, Option<String>>(4)?.unwrap_or(defaults.join2),
                    capitalisation: r.get::<_, Option<String>>(5)?.unwrap_or(defaults.capitalisation),
                    merge_doubles: r.get::<_, Option<bool>>(6)?.unwrap_or(defaults.merge_doubles),
                },
                parts: RollableParts::default(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let index: HashMap<String, usize> = generators.iter().enumerate().map(|(i, g)| (g.id.clone(), i)).collect();

    let mut stmt = conn.prepare(
        "SELECT e.table_id, e.part, e.id, e.text, e.weight
         FROM table_entries e JOIN items i ON i.id = e.table_id
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
           AND e.deleted_at IS NULL
         ORDER BY e.table_id, e.part, e.position, e.created_at, e.id",
    )?;
    for row in stmt.query_map(params![campaign_id, LIBRARY, GENERATOR_TYPE], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            PartEntry { id: r.get(2)?, text: r.get(3)?, weight: r.get(4)? },
        ))
    })? {
        let (id, part, entry) = row?;
        let Some(&i) = index.get(&id) else { continue };
        let parts = &mut generators[i].parts;
        match part.as_str() {
            "full" => parts.full.push(entry),
            "first" => parts.first.push(entry),
            "middle" => parts.middle.push(entry),
            "last" => parts.last.push(entry),
            _ => {}
        }
    }
    Ok(generators)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{campaigns, open_in_memory, search, tags, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn generator(conn: &Connection, camp: &str, name: &str) -> Item {
        items::create(conn, camp, LIBRARY, GENERATOR_TYPE, name, None, 1).unwrap()
    }

    fn add(conn: &Connection, id: &str, part: &str, texts: &[&str]) -> Vec<Entry> {
        let inputs: Vec<_> = texts.iter().map(|t| EntryInput { text: (*t).into(), weight: 1 }).collect();
        add_entries(conn, id, part, &inputs, 2).unwrap()
    }

    fn texts(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|e| e.text.as_str()).collect()
    }

    #[test]
    fn a_new_generator_has_default_settings_and_empty_lists() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        let got = get(&conn, &g.id).unwrap();
        assert_eq!(got.notes, "");
        assert_eq!(got.settings, GeneratorSettings::default());
        assert_eq!(got.parts, PartLists::default());
        assert_eq!(
            (got.settings.mode.as_str(), got.settings.capitalisation.as_str(), got.settings.merge_doubles),
            ("two", "firstLetter", false)
        );
    }

    #[test]
    fn only_live_generators_can_be_used() {
        let (conn, camp) = setup();
        let table = items::create(&conn, &camp, LIBRARY, "table", "A table", None, 1).unwrap();
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 1).unwrap();
        let gone = generator(&conn, &camp, "Gone");
        items::soft_delete(&conn, &gone.id, 2).unwrap();
        for id in [&table.id, &doc.id] {
            assert!(matches!(get(&conn, id), Err(DbError::Invalid(_))));
            assert!(add_entries(&conn, id, "first", &[], 3).is_err());
        }
        assert!(matches!(get(&conn, &gone.id), Err(DbError::NotFound)));
        // And the table functions refuse a generator.
        let g = generator(&conn, &camp, "Elf names");
        assert!(matches!(tables::get(&conn, &g.id), Err(DbError::Invalid(_))));
        assert!(tables::add_entries(&conn, &g.id, &[], 3).is_err());
    }

    #[test]
    fn settings_round_trip_and_are_checked() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        let settings = GeneratorSettings {
            mode: "three".into(),
            join1: "hyphen".into(),
            join2: "apostrophe".into(),
            capitalisation: "everyPart".into(),
            merge_doubles: true,
        };
        set_settings(&conn, &g.id, &settings, 5).unwrap();
        set_notes(&conn, &g.id, "Sindarin-ish", 6).unwrap();
        let got = get(&conn, &g.id).unwrap();
        assert_eq!((got.settings.clone(), got.notes.as_str()), (settings.clone(), "Sindarin-ish"));
        // Setting the rules keeps the notes, and the notes keep the rules.
        set_settings(&conn, &g.id, &GeneratorSettings::default(), 7).unwrap();
        set_notes(&conn, &g.id, "Changed", 8).unwrap();
        let got = get(&conn, &g.id).unwrap();
        assert_eq!((got.settings, got.notes.as_str()), (GeneratorSettings::default(), "Changed"));

        let bad = |patch: &dyn Fn(&mut GeneratorSettings)| {
            let mut s = GeneratorSettings::default();
            patch(&mut s);
            assert!(matches!(set_settings(&conn, &g.id, &s, 9), Err(DbError::Invalid(_))));
        };
        bad(&|s| s.mode = "four".into());
        bad(&|s| s.join1 = "comma".into());
        bad(&|s| s.join2 = "".into());
        bad(&|s| s.capitalisation = "ALLCAPS".into());
        assert!(set_notes(&conn, &g.id, &"x".repeat(MAX_NOTES_BYTES + 1), 9).is_err());
    }

    #[test]
    fn each_list_keeps_its_own_entries_in_order() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        add(&conn, &g.id, "first", &["Ael", "Cal"]);
        add(&conn, &g.id, "last", &["wen"]);
        add(&conn, &g.id, "first", &["Fen"]);
        add(&conn, &g.id, "middle", &["ar"]);
        let got = get(&conn, &g.id).unwrap().parts;
        assert_eq!(texts(&got.first), ["Ael", "Cal", "Fen"]);
        assert_eq!(texts(&got.middle), ["ar"]);
        assert_eq!(texts(&got.last), ["wen"]);
        assert!(got.full.is_empty());
    }

    #[test]
    fn only_a_generators_own_lists_can_be_added_to() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        for part in ["", "prefix", "FIRST", "other"] {
            let inputs = [EntryInput { text: "x".into(), weight: 1 }];
            assert!(matches!(add_entries(&conn, &g.id, part, &inputs, 3), Err(DbError::Invalid(_))), "{part:?}");
        }
        assert!(add_entries(&conn, &g.id, "first", &[EntryInput { text: "  ".into(), weight: 1 }], 3).is_err());
        assert!(get(&conn, &g.id).unwrap().parts.first.is_empty());
    }

    #[test]
    fn entries_are_edited_deleted_restored_and_moved_within_their_own_list() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        let first = add(&conn, &g.id, "first", &["a", "b", "c"]);
        let last = add(&conn, &g.id, "last", &["x", "y"]);
        tables::update_entry(&conn, &first[0].id, "A!", 4, 5).unwrap();
        tables::move_entry(&conn, &first[2].id, 0, 6).unwrap();
        tables::delete_entry(&conn, &last[0].id, 7).unwrap();
        let got = get(&conn, &g.id).unwrap().parts;
        assert_eq!(texts(&got.first), ["c", "A!", "b"]);
        assert_eq!(got.first[1].weight, 4);
        assert_eq!(texts(&got.last), ["y"]);
        tables::restore_entry(&conn, &last[0].id, 8).unwrap();
        assert_eq!(texts(&get(&conn, &g.id).unwrap().parts.last), ["x", "y"]);
        // Moving in one list never disturbs the other.
        tables::move_entry(&conn, &last[1].id, 0, 9).unwrap();
        let got = get(&conn, &g.id).unwrap().parts;
        assert_eq!((texts(&got.first), texts(&got.last)), (vec!["c", "A!", "b"], vec!["y", "x"]));
    }

    #[test]
    fn each_list_holds_up_to_5000_entries_on_its_own() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Big");
        let many: Vec<_> = (0..tables::MAX_ENTRIES).map(|i| EntryInput { text: format!("e{i}"), weight: 1 }).collect();
        add_entries(&conn, &g.id, "first", &many, 2).unwrap();
        assert!(matches!(add_entries(&conn, &g.id, "first", &many[..1], 3), Err(DbError::Invalid(_))));
        add_entries(&conn, &g.id, "last", &many[..10], 4).unwrap(); // another list still has room
    }

    #[test]
    fn entries_can_carry_campaign_tags() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        let e = add(&conn, &g.id, "first", &["Ael"]).remove(0);
        let tag = tags::create(&conn, &camp, None, "Noble", None, 2).unwrap();
        tables::add_entry_tag(&conn, &e.id, &tag.id, 3).unwrap();
        assert_eq!(get(&conn, &g.id).unwrap().parts.first[0].tag_ids, [tag.id]);
    }

    #[test]
    fn the_list_says_which_generators_can_make_names() {
        let (conn, camp) = setup();
        let two = generator(&conn, &camp, "Two parts");
        let full = generator(&conn, &camp, "Whole names");
        let three = generator(&conn, &camp, "Three parts");
        let empty = generator(&conn, &camp, "Empty");
        let full_settings = GeneratorSettings { mode: "full".into(), ..Default::default() };
        let three_settings = GeneratorSettings { mode: "three".into(), ..Default::default() };
        set_settings(&conn, &full.id, &full_settings, 2).unwrap();
        set_settings(&conn, &three.id, &three_settings, 2).unwrap();
        add(&conn, &two.id, "first", &["Ael"]);
        add(&conn, &two.id, "last", &["wen"]);
        add(&conn, &full.id, "full", &["Aelwen Silverleaf"]);
        add(&conn, &three.id, "first", &["Ael"]);
        add(&conn, &three.id, "last", &["wen"]); // no middle yet
        // Entries that can never be picked don't make a list ready.
        let zero = add_entries(&conn, &empty.id, "first", &[EntryInput { text: "z".into(), weight: 0 }], 3).unwrap();
        assert_eq!(zero.len(), 1);
        add(&conn, &empty.id, "last", &["x"]);

        let rows = list(&conn, &camp).unwrap();
        let summary: Vec<_> = rows.iter().map(|r| (r.name.as_str(), r.mode.as_str(), r.entries, r.ready)).collect();
        assert_eq!(
            summary,
            [
                ("Empty", "two", 2, false),
                ("Three parts", "three", 2, false),
                ("Two parts", "two", 2, true),
                ("Whole names", "full", 1, true),
            ]
        );
        add(&conn, &three.id, "middle", &["ar"]);
        assert!(list(&conn, &camp).unwrap().iter().find(|r| r.name == "Three parts").unwrap().ready);
        // Tables are not generators.
        items::create(&conn, &camp, LIBRARY, "table", "A table", None, 1).unwrap();
        assert_eq!(list(&conn, &camp).unwrap().len(), 4);
    }

    #[test]
    fn load_all_gives_settings_and_live_entries_by_list() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        let bare = generator(&conn, &camp, "Bare");
        set_settings(
            &conn,
            &g.id,
            &GeneratorSettings { join1: "apostrophe".into(), merge_doubles: true, ..Default::default() },
            2,
        )
        .unwrap();
        let firsts = add(&conn, &g.id, "first", &["Ael", "Cal"]);
        add(&conn, &g.id, "last", &["wen"]);
        tables::delete_entry(&conn, &firsts[1].id, 3).unwrap();

        let loaded = load_all(&conn, &camp).unwrap();
        let names: Vec<_> = loaded.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, ["Bare", "Elf names"]);
        assert_eq!(loaded[0].id, bare.id);
        assert_eq!(loaded[0].settings, GeneratorSettings::default());
        let elf = &loaded[1];
        assert_eq!((elf.settings.join1.as_str(), elf.settings.merge_doubles), ("apostrophe", true));
        assert_eq!(elf.parts.first.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), ["Ael"]);
        assert_eq!(elf.parts.last.len(), 1);
        assert!(elf.parts.middle.is_empty() && elf.parts.full.is_empty());
    }

    #[test]
    fn tables_do_not_show_a_generators_entries_and_the_roller_ignores_generators() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        add(&conn, &g.id, "first", &["Ael"]);
        let table = items::create(&conn, &camp, LIBRARY, "table", "Rumors", None, 1).unwrap();
        tables::add_entry(&conn, &table.id, "A rumor", 1, 2).unwrap();
        assert_eq!(tables::get(&conn, &table.id).unwrap().entries.len(), 1);
        let rollable = tables::load_rollable(&conn, &camp).unwrap();
        assert_eq!(rollable.len(), 1);
        assert_eq!(rollable[0].entries.len(), 1);
        assert!(tables::entries_mentioning(&conn, &camp, "Ael").unwrap().is_empty());
    }

    #[test]
    fn two_generators_cannot_share_a_name_but_a_generator_and_a_table_can() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elves");
        for name in ["Elves", "ELVES", "  elves "] {
            let err = items::create(&conn, &camp, LIBRARY, GENERATOR_TYPE, name, None, 2).unwrap_err();
            assert!(matches!(err, DbError::Invalid(_)), "{name}");
            assert!(err.to_string().contains("name generator"), "{err}");
        }
        items::create(&conn, &camp, LIBRARY, "table", "Elves", None, 2).unwrap();
        let other = generator(&conn, &camp, "Orcs");
        assert!(items::rename(&conn, &other.id, "elves", 3).is_err());
        assert_eq!(items::rename(&conn, &g.id, "ELVES", 4).unwrap().name, "ELVES");

        // A trashed generator can't come back beside one with its name.
        items::soft_delete(&conn, &g.id, 5).unwrap();
        generator(&conn, &camp, "Elves");
        let err = trash::restore_item(&conn, &g.id, 6).unwrap_err();
        assert!(matches!(err, DbError::Invalid(_)));
        assert!(err.to_string().contains("name generator"), "{err}");
    }

    #[test]
    fn search_finds_a_generator_by_its_entries_and_notes() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        let e = add(&conn, &g.id, "first", &["Silvanesti"]);
        let hit = |q: &str| search::search(&conn, &camp, q, None, 50).unwrap().iter().any(|r| r.id == g.id);
        assert!(hit("silvanesti"));
        set_notes(&conn, &g.id, "Sindarin flavoured", 3).unwrap();
        assert!(hit("sindarin") && hit("silvanesti"));
        tables::update_entry(&conn, &e[0].id, "Qualinesti", 1, 4).unwrap();
        assert!(hit("qualinesti") && !hit("silvanesti") && hit("sindarin"));
        // Tables keep working too: their notes and entries are still indexed.
        let table = items::create(&conn, &camp, LIBRARY, "table", "Rumors", None, 1).unwrap();
        tables::set_notes(&conn, &table.id, "Heard in taverns", 2).unwrap();
        tables::add_entry(&conn, &table.id, "A dragon", 1, 3).unwrap();
        let table_hit = |q: &str| search::search(&conn, &camp, q, None, 50).unwrap().iter().any(|r| r.id == table.id);
        assert!(table_hit("taverns") && table_hit("dragon"));
    }

    #[test]
    fn trashing_restoring_and_purging_a_generator_takes_its_lists_along() {
        let (conn, camp) = setup();
        let g = generator(&conn, &camp, "Elf names");
        add(&conn, &g.id, "first", &["Ael"]);
        add(&conn, &g.id, "last", &["wen"]);
        items::soft_delete(&conn, &g.id, 3).unwrap();
        assert!(matches!(get(&conn, &g.id), Err(DbError::NotFound)));
        assert!(list(&conn, &camp).unwrap().is_empty());
        trash::restore_item(&conn, &g.id, 4).unwrap();
        assert_eq!(get(&conn, &g.id).unwrap().parts.first.len(), 1);
        items::soft_delete(&conn, &g.id, 5).unwrap();
        trash::purge_item(&conn, &g.id).unwrap();
        for sql in ["SELECT COUNT(*) FROM table_entries", "SELECT COUNT(*) FROM name_generators"] {
            assert_eq!(conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap(), 0, "{sql}");
        }
    }
}
