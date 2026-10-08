//! Random tables: library items (library `tables`, type `table`) whose entries
//! are rolled by weight. This module only stores and validates; the slot syntax
//! inside an entry's text and the rolling rules live in the app's TypeScript
//! (`src/lib/tables/`).
//!
//! Entries are rows owned by their table (not items). They are ordered, carry a
//! weight (0 = never picked) and campaign tags, and are soft-deleted so a
//! deletion can be undone. "Recent" picks are per-device memory for the
//! "avoid recent" setting and are never part of content packs.

use super::cards::MAX_NOTES_BYTES;
use super::error::DbError;
use super::items::{self, Item};
use super::name_generators::{GENERATOR_TYPE, PARTS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

pub const LIBRARY: &str = "tables";
pub const TABLE_TYPE: &str = "table";
pub const MAX_ENTRIES: usize = 5_000;
pub const MAX_ENTRY_BYTES: usize = 2_000;
pub const MAX_WEIGHT: i64 = 10_000;
pub const MIN_DIE: i64 = 2;
pub const MAX_DIE: i64 = 1_000;
pub const MAX_AVOID: i64 = 50;
/// How many recent picks are kept per table (enough for the largest "avoid" setting).
pub const RECENT_KEPT: i64 = 50;
/// Most picks one `record_recent` call accepts.
pub const MAX_RECORDED_PICKS: usize = 200;

/// One entry as it is stored and shown.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub text: String,
    pub weight: i64,
    /// Live campaign tags on the entry (ids).
    pub tag_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDetail {
    pub item_id: String,
    pub notes: String,
    pub die_size: Option<i64>,
    pub avoid_recent: i64,
    /// Live entries, in order.
    pub entries: Vec<Entry>,
    /// Another live table in the campaign has this name (ignoring case).
    pub duplicate_name: bool,
    /// Slots that name this table find it: it is the oldest with that name.
    pub found_by_slots: bool,
}

/// What the app sends when adding entries.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryInput {
    pub text: String,
    #[serde(default = "default_weight")]
    pub weight: i64,
}

fn default_weight() -> i64 {
    1
}

/// One entry's new text (used to rewrite slots after a table is renamed, and to undo that).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryTextUpdate {
    pub entry_id: String,
    pub text: String,
}

/// An entry that may use a table's name in a slot (a candidate for rewriting).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryRef {
    pub entry_id: String,
    pub table_id: String,
    pub table_name: String,
    pub text: String,
}

/// One row of the "tables" list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSummary {
    pub item_id: String,
    pub name: String,
    /// Live entries.
    pub entries: i64,
    pub duplicate_name: bool,
    pub found_by_slots: bool,
}

/// An entry as the roller needs it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollableEntry {
    pub id: String,
    pub text: String,
    pub weight: i64,
}

/// A table with everything the roller needs, so a roll can run without more lookups.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollableTable {
    pub id: String,
    pub name: String,
    pub avoid_recent: i64,
    pub entries: Vec<RollableEntry>,
    /// Entry ids recently rolled from this table, newest first.
    pub recent: Vec<String>,
}

/// An entry that a roll picked.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pick {
    pub table_id: String,
    pub entry_id: String,
}

/// Checks the item exists, is live, and is a table.
fn require_live_table(conn: &Connection, item_id: &str) -> Result<Item, DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.library != LIBRARY || item.item_type != TABLE_TYPE {
        return Err(DbError::Invalid("This item isn't a random table."));
    }
    Ok(item)
}

/// Checks the item exists, is live, and owns entries (a table or a name generator).
fn require_live_owner(conn: &Connection, item_id: &str) -> Result<Item, DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.library != LIBRARY || (item.item_type != TABLE_TYPE && item.item_type != GENERATOR_TYPE) {
        return Err(DbError::Invalid("This item doesn't have entries."));
    }
    Ok(item)
}

/// The live entry's owner: a table or a name generator (which must be live too).
fn require_live_entry(conn: &Connection, entry_id: &str) -> Result<Item, DbError> {
    let table_id: Option<String> = conn
        .query_row(
            "SELECT table_id FROM table_entries WHERE id = ?1 AND deleted_at IS NULL",
            [entry_id],
            |r| r.get(0),
        )
        .optional()?;
    require_live_owner(conn, &table_id.ok_or(DbError::NotFound)?)
}

/// Checks an entry's text and weight (also used when importing packs).
pub fn validate_entry(text: &str, weight: i64) -> Result<(), DbError> {
    if text.trim().is_empty() {
        return Err(DbError::Invalid("An entry needs some text."));
    }
    if text.len() > MAX_ENTRY_BYTES {
        return Err(DbError::Invalid("That entry is too long."));
    }
    if !(0..=MAX_WEIGHT).contains(&weight) {
        return Err(DbError::Invalid("An entry's weight must be between 0 and 10,000."));
    }
    Ok(())
}

/// Checks the die size and "avoid recent" settings (also used when importing packs).
pub fn validate_options(die_size: Option<i64>, avoid_recent: i64) -> Result<(), DbError> {
    if let Some(d) = die_size {
        if !(MIN_DIE..=MAX_DIE).contains(&d) {
            return Err(DbError::Invalid("A table's die has between 2 and 1,000 sides."));
        }
    }
    if !(0..=MAX_AVOID).contains(&avoid_recent) {
        return Err(DbError::Invalid("\"Avoid recent\" can skip between 0 and 50 entries."));
    }
    Ok(())
}

/// Live entries in one list: a table's entries (`part` is empty) or one of a generator's lists.
fn live_entry_count(conn: &Connection, owner_id: &str, part: &str) -> Result<usize, DbError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM table_entries WHERE table_id = ?1 AND part = ?2 AND deleted_at IS NULL",
        params![owner_id, part],
        |r| r.get(0),
    )?;
    Ok(n as usize)
}

const TOO_MANY: DbError = DbError::Invalid("A list can hold at most 5,000 entries.");

/// Is there another live table with this table's name, and does it come first?
/// Returns (duplicate, found_by_slots): slots find the oldest table of that name.
fn name_status(conn: &Connection, item: &Item) -> Result<(bool, bool), DbError> {
    let (count, older): (i64, i64) = conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(created_at < ?5 OR (created_at = ?5 AND id < ?4)), 0)
         FROM items
         WHERE campaign_id = ?1 AND library = ?2 AND item_type = ?3 AND deleted_at IS NULL
           AND name = ?6 COLLATE NOCASE AND id <> ?4",
        params![item.campaign_id, LIBRARY, TABLE_TYPE, item.id, item.created_at, item.name],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((count > 0, older == 0))
}

/// The live entries of one list, in order (see `live_entry_count` for what `part` means).
pub(super) fn entries_of(conn: &Connection, table_id: &str, part: &str) -> Result<Vec<Entry>, DbError> {
    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT l.entry_id, l.tag_id
         FROM table_entry_tags l
         JOIN table_entries e ON e.id = l.entry_id
         JOIN tags t ON t.id = l.tag_id
         WHERE e.table_id = ?1 AND e.deleted_at IS NULL AND l.deleted_at IS NULL AND t.deleted_at IS NULL
         ORDER BY l.created_at, l.tag_id",
    )?;
    for row in stmt.query_map([table_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (entry, tag) = row?;
        tags.entry(entry).or_default().push(tag);
    }

    let mut stmt = conn.prepare(
        "SELECT id, text, weight FROM table_entries
         WHERE table_id = ?1 AND part = ?2 AND deleted_at IS NULL ORDER BY position, created_at, id",
    )?;
    let rows = stmt.query_map(params![table_id, part], |r| {
        Ok(Entry { id: r.get(0)?, text: r.get(1)?, weight: r.get(2)?, tag_ids: vec![] })
    })?;
    let mut entries = rows.collect::<Result<Vec<_>, _>>()?;
    for e in &mut entries {
        e.tag_ids = tags.remove(&e.id).unwrap_or_default();
    }
    Ok(entries)
}

/// A table's settings and live entries (in order).
pub fn get(conn: &Connection, item_id: &str) -> Result<TableDetail, DbError> {
    let item = require_live_table(conn, item_id)?;
    let settings: Option<(String, Option<i64>, i64)> = conn
        .query_row(
            "SELECT notes, die_size, avoid_recent FROM random_tables WHERE item_id = ?1",
            [item_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (notes, die_size, avoid_recent) = settings.unwrap_or((String::new(), None, 0));
    let (duplicate_name, found_by_slots) = name_status(conn, &item)?;
    Ok(TableDetail {
        item_id: item_id.to_string(),
        notes,
        die_size,
        avoid_recent,
        entries: entries_of(conn, item_id, "")?,
        duplicate_name,
        found_by_slots,
    })
}

/// Replaces the table's notes.
pub fn set_notes(conn: &Connection, item_id: &str, notes: &str, now: i64) -> Result<(), DbError> {
    require_live_table(conn, item_id)?;
    if notes.len() > MAX_NOTES_BYTES {
        return Err(DbError::Invalid("Those notes are too long to save."));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO random_tables (item_id, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (item_id) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at",
        params![item_id, notes, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Sets the optional die size (2 to 1,000) and how many recent entries to skip (0 to 50).
pub fn set_options(
    conn: &Connection,
    item_id: &str,
    die_size: Option<i64>,
    avoid_recent: i64,
    now: i64,
) -> Result<(), DbError> {
    require_live_table(conn, item_id)?;
    validate_options(die_size, avoid_recent)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO random_tables (item_id, die_size, avoid_recent, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (item_id) DO UPDATE
             SET die_size = excluded.die_size, avoid_recent = excluded.avoid_recent,
                 updated_at = excluded.updated_at",
        params![item_id, die_size, avoid_recent, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Adds entries to the end of a table, all or nothing. Returns them as stored.
pub fn add_entries(conn: &Connection, table_id: &str, inputs: &[EntryInput], now: i64) -> Result<Vec<Entry>, DbError> {
    require_live_table(conn, table_id)?;
    add_part_entries(conn, table_id, "", inputs, now)
}

/// Adds entries to the end of one list of a table (`part` empty) or name generator
/// (`full`, `first`, `middle` or `last`), all or nothing. The caller has checked the owner.
pub(super) fn add_part_entries(
    conn: &Connection,
    table_id: &str,
    part: &str,
    inputs: &[EntryInput],
    now: i64,
) -> Result<Vec<Entry>, DbError> {
    if part != "" && !PARTS.contains(&part) {
        return Err(DbError::Invalid("That isn't one of a name generator's lists."));
    }
    for input in inputs {
        validate_entry(&input.text, input.weight)?;
    }
    if live_entry_count(conn, table_id, part)? + inputs.len() > MAX_ENTRIES {
        return Err(TOO_MANY);
    }
    let tx = conn.unchecked_transaction()?;
    let mut position: i64 = tx.query_row(
        "SELECT COALESCE(MAX(position), 0) FROM table_entries WHERE table_id = ?1 AND part = ?2",
        params![table_id, part],
        |r| r.get(0),
    )?;
    let mut added = Vec::with_capacity(inputs.len());
    for input in inputs {
        position += 1;
        let id = Uuid::now_v7().to_string();
        tx.execute(
            "INSERT INTO table_entries (id, table_id, part, position, text, weight, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![id, table_id, part, position, input.text, input.weight, now],
        )?;
        added.push(Entry { id, text: input.text.clone(), weight: input.weight, tag_ids: vec![] });
    }
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![table_id, now])?;
    tx.commit()?;
    Ok(added)
}

/// Adds one entry at the end.
#[cfg(test)]
pub fn add_entry(conn: &Connection, table_id: &str, text: &str, weight: i64, now: i64) -> Result<Entry, DbError> {
    let input = EntryInput { text: text.to_string(), weight };
    Ok(add_entries(conn, table_id, &[input], now)?.remove(0))
}

fn touch_table(conn: &Connection, table_id: &str, now: i64) -> Result<(), DbError> {
    conn.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![table_id, now])?;
    Ok(())
}

/// Changes an entry's text and weight.
pub fn update_entry(conn: &Connection, entry_id: &str, text: &str, weight: i64, now: i64) -> Result<(), DbError> {
    let table = require_live_entry(conn, entry_id)?;
    validate_entry(text, weight)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE table_entries SET text = ?2, weight = ?3, updated_at = ?4 WHERE id = ?1",
        params![entry_id, text, weight, now],
    )?;
    touch_table(&tx, &table.id, now)?;
    tx.commit()?;
    Ok(())
}

/// Rewrites the text of several entries together, all or nothing (used to fix
/// slots after a table is renamed, and to undo that).
pub fn set_entry_texts(conn: &Connection, updates: &[EntryTextUpdate], now: i64) -> Result<(), DbError> {
    let mut tables = Vec::new();
    for u in updates {
        let table = require_live_entry(conn, &u.entry_id)?;
        validate_entry(&u.text, 0)?; // weight untouched; 0 is just a placeholder that passes
        if !tables.contains(&table.id) {
            tables.push(table.id);
        }
    }
    let tx = conn.unchecked_transaction()?;
    for u in updates {
        tx.execute(
            "UPDATE table_entries SET text = ?2, updated_at = ?3 WHERE id = ?1",
            params![u.entry_id, u.text, now],
        )?;
    }
    for table in &tables {
        touch_table(&tx, table, now)?;
    }
    tx.commit()?;
    Ok(())
}

/// Soft-deletes an entry (restorable).
pub fn delete_entry(conn: &Connection, entry_id: &str, now: i64) -> Result<(), DbError> {
    let table = require_live_entry(conn, entry_id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE table_entries SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![entry_id, now],
    )?;
    touch_table(&tx, &table.id, now)?;
    tx.commit()?;
    Ok(())
}

/// Brings a deleted entry back where it was.
pub fn restore_entry(conn: &Connection, entry_id: &str, now: i64) -> Result<(), DbError> {
    let row: Option<(String, String, Option<i64>)> = conn
        .query_row("SELECT table_id, part, deleted_at FROM table_entries WHERE id = ?1", [entry_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let (table_id, part, deleted_at) = row.ok_or(DbError::NotFound)?;
    require_live_owner(conn, &table_id)?;
    if deleted_at.is_none() {
        return Ok(());
    }
    if live_entry_count(conn, &table_id, &part)? >= MAX_ENTRIES {
        return Err(TOO_MANY);
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE table_entries SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![entry_id, now],
    )?;
    touch_table(&tx, &table_id, now)?;
    tx.commit()?;
    Ok(())
}

/// Moves a live entry to a place in the order (0 = first; past the end = last).
pub fn move_entry(conn: &Connection, entry_id: &str, to_index: usize, now: i64) -> Result<(), DbError> {
    let table = require_live_entry(conn, entry_id)?;
    let part: String = conn.query_row("SELECT part FROM table_entries WHERE id = ?1", [entry_id], |r| r.get(0))?;
    let mut ids: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT id FROM table_entries WHERE table_id = ?1 AND part = ?2 AND deleted_at IS NULL
             ORDER BY position, created_at, id",
        )?;
        let rows = stmt.query_map(params![&table.id, &part], |r| r.get(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let from = ids.iter().position(|id| id == entry_id).ok_or(DbError::NotFound)?;
    let moving = ids.remove(from);
    ids.insert(to_index.min(ids.len()), moving);

    let tx = conn.unchecked_transaction()?;
    for (i, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE table_entries SET position = ?2, updated_at = ?3 WHERE id = ?1 AND position <> ?2",
            params![id, i as i64 + 1, now],
        )?;
    }
    touch_table(&tx, &table.id, now)?;
    tx.commit()?;
    Ok(())
}

/// Puts a campaign tag on an entry. Adding it twice is harmless; one removed
/// earlier comes back.
pub fn add_entry_tag(conn: &Connection, entry_id: &str, tag_id: &str, now: i64) -> Result<(), DbError> {
    let table = require_live_entry(conn, entry_id)?;
    let tag = super::tags::get(conn, tag_id)?;
    if tag.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if tag.campaign_id != table.campaign_id {
        return Err(DbError::Invalid("That tag belongs to a different campaign."));
    }
    conn.execute(
        "INSERT INTO table_entry_tags (entry_id, tag_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (entry_id, tag_id) DO UPDATE SET deleted_at = NULL, updated_at = ?3
         WHERE table_entry_tags.deleted_at IS NOT NULL",
        params![entry_id, tag_id, now],
    )?;
    Ok(())
}

/// Takes a tag off an entry. Harmless if it wasn't on it.
pub fn remove_entry_tag(conn: &Connection, entry_id: &str, tag_id: &str, now: i64) -> Result<(), DbError> {
    conn.execute(
        "UPDATE table_entry_tags SET deleted_at = ?3, updated_at = ?3
         WHERE entry_id = ?1 AND tag_id = ?2 AND deleted_at IS NULL",
        params![entry_id, tag_id, now],
    )?;
    Ok(())
}

/// Every live table in a campaign (any folder), alphabetical.
pub fn list(conn: &Connection, campaign_id: &str) -> Result<Vec<TableSummary>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name,
                (SELECT COUNT(*) FROM table_entries e WHERE e.table_id = i.id AND e.deleted_at IS NULL),
                EXISTS (SELECT 1 FROM items o
                        WHERE o.campaign_id = i.campaign_id AND o.library = i.library
                          AND o.item_type = i.item_type AND o.deleted_at IS NULL
                          AND o.name = i.name COLLATE NOCASE AND o.id <> i.id),
                NOT EXISTS (SELECT 1 FROM items o
                        WHERE o.campaign_id = i.campaign_id AND o.library = i.library
                          AND o.item_type = i.item_type AND o.deleted_at IS NULL
                          AND o.name = i.name COLLATE NOCASE AND o.id <> i.id
                          AND (o.created_at < i.created_at OR (o.created_at = i.created_at AND o.id < i.id)))
         FROM items i
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
         ORDER BY i.name COLLATE NOCASE, i.created_at, i.id",
    )?;
    let rows = stmt.query_map(params![campaign_id, LIBRARY, TABLE_TYPE], |r| {
        Ok(TableSummary {
            item_id: r.get(0)?,
            name: r.get(1)?,
            entries: r.get(2)?,
            duplicate_name: r.get(3)?,
            found_by_slots: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Every live table in a campaign with its live entries and recent picks, oldest
/// table first (so when two tables share a name the roller finds the oldest).
pub fn load_rollable(conn: &Connection, campaign_id: &str) -> Result<Vec<RollableTable>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, COALESCE(t.avoid_recent, 0)
         FROM items i LEFT JOIN random_tables t ON t.item_id = i.id
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
         ORDER BY i.created_at, i.id",
    )?;
    let mut tables = stmt
        .query_map(params![campaign_id, LIBRARY, TABLE_TYPE], |r| {
            Ok(RollableTable { id: r.get(0)?, name: r.get(1)?, avoid_recent: r.get(2)?, entries: vec![], recent: vec![] })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let index: HashMap<String, usize> = tables.iter().enumerate().map(|(i, t)| (t.id.clone(), i)).collect();

    let mut stmt = conn.prepare(
        "SELECT e.table_id, e.id, e.text, e.weight
         FROM table_entries e JOIN items i ON i.id = e.table_id
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
           AND e.deleted_at IS NULL
         ORDER BY e.table_id, e.position, e.created_at, e.id",
    )?;
    for row in stmt.query_map(params![campaign_id, LIBRARY, TABLE_TYPE], |r| {
        Ok((r.get::<_, String>(0)?, RollableEntry { id: r.get(1)?, text: r.get(2)?, weight: r.get(3)? }))
    })? {
        let (table_id, entry) = row?;
        if let Some(&i) = index.get(&table_id) {
            tables[i].entries.push(entry);
        }
    }

    let mut stmt = conn.prepare(
        "SELECT r.table_id, r.entry_id
         FROM table_recent r JOIN items i ON i.id = r.table_id
         JOIN table_entries e ON e.id = r.entry_id AND e.deleted_at IS NULL
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
         ORDER BY r.id DESC",
    )?;
    for row in stmt.query_map(params![campaign_id, LIBRARY, TABLE_TYPE], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })? {
        let (table_id, entry_id) = row?;
        if let Some(&i) = index.get(&table_id) {
            tables[i].recent.push(entry_id);
        }
    }
    Ok(tables)
}

/// Live entries in the campaign whose text contains `needle` (ignoring case):
/// the candidates for rewriting slots when a table is renamed. The app checks
/// each one properly with its slot parser.
pub fn entries_mentioning(conn: &Connection, campaign_id: &str, needle: &str) -> Result<Vec<EntryRef>, DbError> {
    if needle.trim().is_empty() {
        return Ok(vec![]);
    }
    let pattern = format!(
        "%{}%",
        needle.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
    );
    let mut stmt = conn.prepare(
        "SELECT e.id, i.id, i.name, e.text
         FROM table_entries e JOIN items i ON i.id = e.table_id
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.item_type = ?3 AND i.deleted_at IS NULL
           AND e.deleted_at IS NULL AND e.text LIKE ?4 ESCAPE '\\'
         ORDER BY i.name COLLATE NOCASE, e.position, e.created_at, e.id",
    )?;
    let rows = stmt.query_map(params![campaign_id, LIBRARY, TABLE_TYPE, pattern], |r| {
        Ok(EntryRef { entry_id: r.get(0)?, table_id: r.get(1)?, table_name: r.get(2)?, text: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Remembers the entries a roll picked (oldest first, as listed), keeping only
/// the newest 50 per table. Picks whose entry isn't in that table any more are skipped.
pub fn record_recent(conn: &Connection, picks: &[Pick], now: i64) -> Result<(), DbError> {
    if picks.len() > MAX_RECORDED_PICKS {
        return Err(DbError::Invalid("That roll recorded too many picks."));
    }
    let tx = conn.unchecked_transaction()?;
    let mut touched: Vec<&str> = Vec::new();
    for p in picks {
        tx.execute(
            "INSERT INTO table_recent (table_id, entry_id, rolled_at)
             SELECT ?1, ?2, ?3
             WHERE EXISTS (SELECT 1 FROM table_entries WHERE id = ?2 AND table_id = ?1 AND deleted_at IS NULL)",
            params![p.table_id, p.entry_id, now],
        )?;
        if !touched.contains(&p.table_id.as_str()) {
            touched.push(&p.table_id);
        }
    }
    for table in touched {
        tx.execute(
            "DELETE FROM table_recent
             WHERE table_id = ?1
               AND id NOT IN (SELECT id FROM table_recent WHERE table_id = ?1 ORDER BY id DESC LIMIT ?2)",
            params![table, RECENT_KEPT],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Forgets what was recently rolled from a table.
pub fn clear_recent(conn: &Connection, table_id: &str) -> Result<(), DbError> {
    conn.execute("DELETE FROM table_recent WHERE table_id = ?1", [table_id])?;
    Ok(())
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

    fn table(conn: &Connection, camp: &str, name: &str) -> Item {
        items::create(conn, camp, LIBRARY, TABLE_TYPE, name, None, 1).unwrap()
    }

    fn texts(conn: &Connection, id: &str) -> Vec<String> {
        get(conn, id).unwrap().entries.into_iter().map(|e| e.text).collect()
    }

    fn add(conn: &Connection, id: &str, items: &[&str]) -> Vec<Entry> {
        let inputs: Vec<_> = items.iter().map(|t| EntryInput { text: (*t).into(), weight: 1 }).collect();
        add_entries(conn, id, &inputs, 2).unwrap()
    }

    #[test]
    fn a_new_table_is_empty_with_default_settings() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        assert_eq!(
            get(&conn, &t.id).unwrap(),
            TableDetail {
                item_id: t.id.clone(),
                notes: String::new(),
                die_size: None,
                avoid_recent: 0,
                entries: vec![],
                duplicate_name: false,
                found_by_slots: true,
            }
        );
    }

    #[test]
    fn only_live_tables_can_be_used() {
        let (conn, camp) = setup();
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 1).unwrap();
        let wrong_type = items::create(&conn, &camp, LIBRARY, "other", "Other", None, 1).unwrap();
        let gone = table(&conn, &camp, "Gone");
        items::soft_delete(&conn, &gone.id, 2).unwrap();
        for id in [&doc.id, &wrong_type.id] {
            assert!(matches!(get(&conn, id), Err(DbError::Invalid(_))));
            assert!(add_entry(&conn, id, "x", 1, 3).is_err());
        }
        assert!(matches!(get(&conn, &gone.id), Err(DbError::NotFound)));
        assert!(matches!(get(&conn, "nope"), Err(DbError::NotFound)));
    }

    #[test]
    fn entries_keep_their_order_text_and_weight() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        add_entry(&conn, &t.id, "First", 1, 2).unwrap();
        add_entry(&conn, &t.id, "  Second with [Slot]\nand a second line ", 3, 3).unwrap();
        add_entries(
            &conn,
            &t.id,
            &[EntryInput { text: "Third".into(), weight: 0 }, EntryInput { text: "Fourth".into(), weight: 10_000 }],
            4,
        )
        .unwrap();
        let got = get(&conn, &t.id).unwrap().entries;
        let summary: Vec<_> = got.iter().map(|e| (e.text.as_str(), e.weight)).collect();
        assert_eq!(
            summary,
            [("First", 1), ("  Second with [Slot]\nand a second line ", 3), ("Third", 0), ("Fourth", 10_000)]
        );
        assert_eq!(items::get(&conn, &t.id).unwrap().updated_at, 4);
    }

    #[test]
    fn bad_entries_are_refused_and_nothing_is_added() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        add(&conn, &t.id, &["keep"]);
        let long = "x".repeat(MAX_ENTRY_BYTES + 1);
        let cases: Vec<(&str, Vec<EntryInput>)> = vec![
            ("blank", vec![EntryInput { text: "  \n ".into(), weight: 1 }]),
            ("too long", vec![EntryInput { text: long, weight: 1 }]),
            ("negative weight", vec![EntryInput { text: "a".into(), weight: -1 }]),
            ("huge weight", vec![EntryInput { text: "a".into(), weight: MAX_WEIGHT + 1 }]),
            (
                "one bad among good ones",
                vec![EntryInput { text: "ok".into(), weight: 1 }, EntryInput { text: "".into(), weight: 1 }],
            ),
        ];
        for (what, inputs) in cases {
            assert!(matches!(add_entries(&conn, &t.id, &inputs, 3), Err(DbError::Invalid(_))), "{what}");
        }
        assert_eq!(texts(&conn, &t.id), ["keep"]);
    }

    #[test]
    fn a_table_holds_at_most_5000_entries() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Big");
        let many: Vec<_> = (0..MAX_ENTRIES).map(|i| EntryInput { text: format!("e{i}"), weight: 1 }).collect();
        add_entries(&conn, &t.id, &many, 2).unwrap();
        assert!(matches!(add_entry(&conn, &t.id, "one more", 1, 3), Err(DbError::Invalid(_))));
        // Deleting one makes room, and restoring into a full table is refused.
        let first = get(&conn, &t.id).unwrap().entries[0].id.clone();
        delete_entry(&conn, &first, 4).unwrap();
        add_entry(&conn, &t.id, "fits now", 1, 5).unwrap();
        assert!(matches!(restore_entry(&conn, &first, 6), Err(DbError::Invalid(_))));
    }

    #[test]
    fn updating_an_entry_changes_text_and_weight() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        let e = add(&conn, &t.id, &["old"]).remove(0);
        update_entry(&conn, &e.id, "new [2d4]", 5, 9).unwrap();
        let got = get(&conn, &t.id).unwrap().entries;
        assert_eq!((got[0].text.as_str(), got[0].weight), ("new [2d4]", 5));
        assert_eq!(items::get(&conn, &t.id).unwrap().updated_at, 9);
        assert!(update_entry(&conn, &e.id, "", 1, 10).is_err());
        assert!(matches!(update_entry(&conn, "nope", "x", 1, 10), Err(DbError::NotFound)));
        assert_eq!(texts(&conn, &t.id), ["new [2d4]"]);
    }

    #[test]
    fn deleting_and_restoring_an_entry_keeps_its_place() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        let e = add(&conn, &t.id, &["a", "b", "c"]);
        delete_entry(&conn, &e[1].id, 5).unwrap();
        assert_eq!(texts(&conn, &t.id), ["a", "c"]);
        // A deleted entry can't be edited, moved, deleted again or tagged.
        assert!(matches!(update_entry(&conn, &e[1].id, "x", 1, 6), Err(DbError::NotFound)));
        assert!(matches!(delete_entry(&conn, &e[1].id, 6), Err(DbError::NotFound)));
        restore_entry(&conn, &e[1].id, 7).unwrap();
        assert_eq!(texts(&conn, &t.id), ["a", "b", "c"]);
        restore_entry(&conn, &e[1].id, 8).unwrap(); // already live: harmless
    }

    #[test]
    fn entries_can_be_moved() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        let e = add(&conn, &t.id, &["a", "b", "c", "d"]);
        move_entry(&conn, &e[3].id, 0, 5).unwrap();
        assert_eq!(texts(&conn, &t.id), ["d", "a", "b", "c"]);
        move_entry(&conn, &e[3].id, 2, 6).unwrap();
        assert_eq!(texts(&conn, &t.id), ["a", "b", "d", "c"]);
        move_entry(&conn, &e[0].id, 99, 7).unwrap(); // past the end = last
        assert_eq!(texts(&conn, &t.id), ["b", "d", "c", "a"]);
        // New entries still go last after moves and deletions.
        delete_entry(&conn, &e[1].id, 8).unwrap();
        add(&conn, &t.id, &["e"]);
        assert_eq!(texts(&conn, &t.id), ["d", "c", "a", "e"]);
    }

    #[test]
    fn settings_round_trip_and_are_checked() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        set_notes(&conn, &t.id, "How to use this", 5).unwrap();
        set_options(&conn, &t.id, Some(100), 3, 6).unwrap();
        let got = get(&conn, &t.id).unwrap();
        assert_eq!((got.notes.as_str(), got.die_size, got.avoid_recent), ("How to use this", Some(100), 3));
        // Setting options keeps the notes; clearing the die works.
        set_options(&conn, &t.id, None, 0, 7).unwrap();
        let got = get(&conn, &t.id).unwrap();
        assert_eq!((got.notes.as_str(), got.die_size, got.avoid_recent), ("How to use this", None, 0));

        for (die, avoid) in [(Some(1), 0), (Some(1001), 0), (None, -1), (None, 51)] {
            assert!(matches!(set_options(&conn, &t.id, die, avoid, 8), Err(DbError::Invalid(_))), "{die:?} {avoid}");
        }
        assert!(set_notes(&conn, &t.id, &"x".repeat(MAX_NOTES_BYTES + 1), 8).is_err());
    }

    #[test]
    fn entry_tags_use_campaign_tags() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        let e = add(&conn, &t.id, &["a", "b"]);
        let elf = tags::create(&conn, &camp, None, "Elf", None, 2).unwrap();
        let orc = tags::create(&conn, &camp, None, "Orc", None, 2).unwrap();
        add_entry_tag(&conn, &e[0].id, &elf.id, 3).unwrap();
        add_entry_tag(&conn, &e[0].id, &elf.id, 4).unwrap(); // twice: harmless
        add_entry_tag(&conn, &e[0].id, &orc.id, 5).unwrap();
        let got = get(&conn, &t.id).unwrap().entries;
        assert_eq!(got[0].tag_ids, [elf.id.clone(), orc.id.clone()]);
        assert!(got[1].tag_ids.is_empty());

        remove_entry_tag(&conn, &e[0].id, &elf.id, 6).unwrap();
        remove_entry_tag(&conn, &e[1].id, &elf.id, 6).unwrap(); // not on it: harmless
        assert_eq!(get(&conn, &t.id).unwrap().entries[0].tag_ids, [orc.id.clone()]);
        add_entry_tag(&conn, &e[0].id, &elf.id, 7).unwrap(); // comes back
        assert_eq!(get(&conn, &t.id).unwrap().entries[0].tag_ids.len(), 2);

        // A deleted tag disappears from the entry.
        tags::soft_delete(&conn, &orc.id, 8).unwrap();
        assert_eq!(get(&conn, &t.id).unwrap().entries[0].tag_ids, [elf.id.clone()]);
    }

    #[test]
    fn entry_tags_must_be_live_and_from_the_same_campaign() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        let e = add(&conn, &t.id, &["a"]).remove(0);
        let other = campaigns::create(&conn, "Other", 2).unwrap();
        let foreign = tags::create(&conn, &other.id, None, "Foreign", None, 2).unwrap();
        let dead = tags::create(&conn, &camp, None, "Dead", None, 2).unwrap();
        tags::soft_delete(&conn, &dead.id, 3).unwrap();
        assert!(matches!(add_entry_tag(&conn, &e.id, &foreign.id, 4), Err(DbError::Invalid(_))));
        assert!(matches!(add_entry_tag(&conn, &e.id, &dead.id, 4), Err(DbError::NotFound)));
        assert!(matches!(add_entry_tag(&conn, &e.id, "nope", 4), Err(DbError::NotFound)));
    }

    #[test]
    fn trashing_and_restoring_a_table_keeps_its_entries() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        add(&conn, &t.id, &["a", "b"]);
        items::soft_delete(&conn, &t.id, 5).unwrap();
        assert!(matches!(get(&conn, &t.id), Err(DbError::NotFound)));
        assert!(list(&conn, &camp).unwrap().is_empty());
        trash::restore_item(&conn, &t.id, 6).unwrap();
        assert_eq!(texts(&conn, &t.id), ["a", "b"]);
    }

    #[test]
    fn purging_a_table_removes_its_entries_tags_and_recents() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        let e = add(&conn, &t.id, &["a"]).remove(0);
        let tag = tags::create(&conn, &camp, None, "Elf", None, 2).unwrap();
        add_entry_tag(&conn, &e.id, &tag.id, 3).unwrap();
        record_recent(&conn, &[Pick { table_id: t.id.clone(), entry_id: e.id.clone() }], 4).unwrap();
        items::soft_delete(&conn, &t.id, 5).unwrap();
        trash::purge_item(&conn, &t.id).unwrap();
        for sql in [
            "SELECT COUNT(*) FROM table_entries",
            "SELECT COUNT(*) FROM table_entry_tags",
            "SELECT COUNT(*) FROM table_recent",
        ] {
            assert_eq!(conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap(), 0, "{sql}");
        }
    }

    #[test]
    fn the_list_counts_live_entries_alphabetically() {
        let (conn, camp) = setup();
        let b = table(&conn, &camp, "beta");
        let a = table(&conn, &camp, "Alpha");
        let e = add(&conn, &b.id, &["x", "y", "z"]);
        delete_entry(&conn, &e[0].id, 3).unwrap();
        let rows = list(&conn, &camp).unwrap();
        let summary: Vec<_> = rows.iter().map(|r| (r.name.as_str(), r.entries)).collect();
        assert_eq!(summary, [("Alpha", 0), ("beta", 2)]);
        assert_eq!(rows[0].item_id, a.id);
    }

    /// Makes two tables share a name the way data from before the rule could (the rule itself refuses this).
    fn legacy_duplicate(conn: &Connection, camp: &str) -> (Item, Item) {
        let old = items::create(conn, camp, LIBRARY, TABLE_TYPE, "Rumors", None, 10).unwrap();
        let new = items::create(conn, camp, LIBRARY, TABLE_TYPE, "Other name", None, 20).unwrap();
        conn.execute("UPDATE items SET name = 'rumors' WHERE id = ?1", [&new.id]).unwrap();
        (old, items::get(conn, &new.id).unwrap())
    }

    #[test]
    fn old_same_named_tables_are_flagged_and_the_oldest_is_found_by_slots() {
        let (conn, camp) = setup();
        let (old, new) = legacy_duplicate(&conn, &camp);
        let unique = table(&conn, &camp, "Names");
        let (old_d, new_d, uniq_d) =
            (get(&conn, &old.id).unwrap(), get(&conn, &new.id).unwrap(), get(&conn, &unique.id).unwrap());
        assert_eq!((old_d.duplicate_name, old_d.found_by_slots), (true, true));
        assert_eq!((new_d.duplicate_name, new_d.found_by_slots), (true, false));
        assert_eq!((uniq_d.duplicate_name, uniq_d.found_by_slots), (false, true));

        let rows = list(&conn, &camp).unwrap();
        let flags = |id: &str| rows.iter().find(|r| r.item_id == id).map(|r| (r.duplicate_name, r.found_by_slots)).unwrap();
        assert_eq!(flags(&old.id), (true, true));
        assert_eq!(flags(&new.id), (true, false));
        assert_eq!(flags(&unique.id), (false, true));

        // Trashing the older one hands the name to the newer one.
        items::soft_delete(&conn, &old.id, 30).unwrap();
        let n = get(&conn, &new.id).unwrap();
        assert_eq!((n.duplicate_name, n.found_by_slots), (false, true));
        // Tables of other campaigns with the same name don't count.
        let other = campaigns::create(&conn, "Other", 31).unwrap();
        table(&conn, &other.id, "rumors");
        assert!(!get(&conn, &new.id).unwrap().duplicate_name);
    }

    #[test]
    fn two_tables_cannot_share_a_name_ignoring_case_and_spaces() {
        let (conn, camp) = setup();
        let first = table(&conn, &camp, "Rumors");
        for name in ["Rumors", "rumors", "  RUMORS  "] {
            let err = items::create(&conn, &camp, LIBRARY, TABLE_TYPE, name, None, 2).unwrap_err();
            assert!(matches!(err, DbError::Invalid(_)), "{name}");
            assert!(err.to_string().contains("already exists"));
        }
        // Folders don't make a name different.
        let folder = crate::db::folders::create(&conn, &camp, LIBRARY, None, "North", 2).unwrap();
        assert!(items::create(&conn, &camp, LIBRARY, TABLE_TYPE, "Rumors", Some(&folder.id), 2).is_err());
        // The refused attempts left nothing behind.
        assert_eq!(list(&conn, &camp).unwrap().len(), 1);
        assert_eq!(list(&conn, &camp).unwrap()[0].item_id, first.id);
    }

    #[test]
    fn the_same_name_is_fine_for_other_campaigns_other_kinds_and_trashed_tables() {
        let (conn, camp) = setup();
        let first = table(&conn, &camp, "Rumors");
        let other = campaigns::create(&conn, "Other", 2).unwrap();
        table(&conn, &other.id, "Rumors");
        items::create(&conn, &camp, "worldbuilding", "document", "Rumors", None, 3).unwrap();
        items::create(&conn, &camp, LIBRARY, "other", "Rumors", None, 3).unwrap();
        // A trashed table gives its name up.
        items::soft_delete(&conn, &first.id, 4).unwrap();
        table(&conn, &camp, "Rumors");
    }

    #[test]
    fn renaming_to_a_taken_name_is_refused_but_changing_your_own_case_is_fine() {
        let (conn, camp) = setup();
        let a = table(&conn, &camp, "Rumors");
        let b = table(&conn, &camp, "Names");
        assert!(matches!(items::rename(&conn, &b.id, "RUMORS", 5), Err(DbError::Invalid(_))));
        assert_eq!(items::get(&conn, &b.id).unwrap().name, "Names");
        assert_eq!(items::rename(&conn, &a.id, "rumors", 6).unwrap().name, "rumors");
        assert_eq!(items::rename(&conn, &b.id, "Quests", 7).unwrap().name, "Quests");
        // Items that don't need unique names can be renamed to anything.
        let doc = items::create(&conn, &camp, "worldbuilding", "document", "Doc", None, 8).unwrap();
        items::create(&conn, &camp, "worldbuilding", "document", "Other doc", None, 8).unwrap();
        items::rename(&conn, &doc.id, "Other doc", 9).unwrap();
    }

    #[test]
    fn a_trashed_table_cannot_come_back_beside_a_table_with_its_name() {
        let (conn, camp) = setup();
        let old = table(&conn, &camp, "Rumors");
        items::soft_delete(&conn, &old.id, 2).unwrap();
        let replacement = table(&conn, &camp, "Rumors");
        let err = trash::restore_item(&conn, &old.id, 3).unwrap_err();
        assert!(matches!(err, DbError::Invalid(_)));
        assert!(err.to_string().contains("Rename the other table"));
        assert!(items::get(&conn, &old.id).unwrap().deleted_at.is_some());
        // Once the other one is renamed (or trashed) it can come back.
        items::rename(&conn, &replacement.id, "Rumors (new)", 4).unwrap();
        trash::restore_item(&conn, &old.id, 5).unwrap();
        assert!(items::get(&conn, &old.id).unwrap().deleted_at.is_none());
    }

    #[test]
    fn restoring_a_folder_is_refused_if_a_table_in_it_would_clash() {
        let (conn, camp) = setup();
        let folder = crate::db::folders::create(&conn, &camp, LIBRARY, None, "North", 1).unwrap();
        let inside = items::create(&conn, &camp, LIBRARY, TABLE_TYPE, "Rumors", Some(&folder.id), 1).unwrap();
        crate::db::folders::soft_delete(&conn, &folder.id, 2).unwrap();
        table(&conn, &camp, "Rumors");
        assert!(matches!(trash::restore_folder(&conn, &folder.id, 3), Err(DbError::Invalid(_))));
        // Nothing was restored.
        assert!(items::get(&conn, &inside.id).unwrap().deleted_at.is_some());
        assert!(crate::db::folders::get(&conn, &folder.id).unwrap().deleted_at.is_some());
    }

    #[test]
    fn rollable_tables_come_oldest_first_with_entries_and_recents() {
        let (conn, camp) = setup();
        let a = items::create(&conn, &camp, LIBRARY, TABLE_TYPE, "A", None, 10).unwrap();
        let b = items::create(&conn, &camp, LIBRARY, TABLE_TYPE, "B", None, 5).unwrap();
        set_options(&conn, &a.id, None, 2, 11).unwrap();
        let ea = add(&conn, &a.id, &["a1", "a2", "a3"]);
        let eb = add(&conn, &b.id, &["b1"]);
        delete_entry(&conn, &ea[2].id, 12).unwrap();
        record_recent(
            &conn,
            &[
                Pick { table_id: a.id.clone(), entry_id: ea[0].id.clone() },
                Pick { table_id: a.id.clone(), entry_id: ea[1].id.clone() },
                Pick { table_id: b.id.clone(), entry_id: eb[0].id.clone() },
            ],
            13,
        )
        .unwrap();
        let got = load_rollable(&conn, &camp).unwrap();
        assert_eq!(got.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["B", "A"]);
        assert_eq!(got[1].avoid_recent, 2);
        assert_eq!(got[1].entries.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), ["a1", "a2"]);
        assert_eq!(got[1].recent, [ea[1].id.clone(), ea[0].id.clone()]); // newest first
        assert_eq!(got[0].recent, [eb[0].id.clone()]);
        assert_eq!(got[0].avoid_recent, 0); // no settings row = default
    }

    #[test]
    fn recent_picks_are_trimmed_to_fifty_per_table_and_can_be_cleared() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        let other = table(&conn, &camp, "Other");
        let e = add(&conn, &t.id, &["a"]).remove(0);
        let o = add(&conn, &other.id, &["o"]).remove(0);
        record_recent(&conn, &[Pick { table_id: other.id.clone(), entry_id: o.id.clone() }], 2).unwrap();
        for round in 0..3 {
            let picks: Vec<_> = (0..40).map(|_| Pick { table_id: t.id.clone(), entry_id: e.id.clone() }).collect();
            record_recent(&conn, &picks, 3 + round).unwrap();
        }
        let count = |id: &str| -> i64 {
            conn.query_row("SELECT COUNT(*) FROM table_recent WHERE table_id = ?1", [id], |r| r.get(0)).unwrap()
        };
        assert_eq!(count(&t.id), RECENT_KEPT);
        assert_eq!(count(&other.id), 1); // other tables are not trimmed by this one
        clear_recent(&conn, &t.id).unwrap();
        assert_eq!((count(&t.id), count(&other.id)), (0, 1));
    }

    #[test]
    fn recording_skips_entries_that_are_gone_or_in_another_table() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        let other = table(&conn, &camp, "Other");
        let e = add(&conn, &t.id, &["a", "b"]);
        delete_entry(&conn, &e[1].id, 3).unwrap();
        record_recent(
            &conn,
            &[
                Pick { table_id: t.id.clone(), entry_id: e[0].id.clone() },
                Pick { table_id: t.id.clone(), entry_id: e[1].id.clone() }, // deleted
                Pick { table_id: other.id.clone(), entry_id: e[0].id.clone() }, // wrong table
                Pick { table_id: t.id.clone(), entry_id: "nope".into() },
            ],
            4,
        )
        .unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM table_recent", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let too_many: Vec<_> = (0..=MAX_RECORDED_PICKS)
            .map(|_| Pick { table_id: t.id.clone(), entry_id: e[0].id.clone() })
            .collect();
        assert!(record_recent(&conn, &too_many, 5).is_err());
    }

    #[test]
    fn entries_mentioning_finds_candidates_for_a_rename() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Quests");
        let u = table(&conn, &camp, "Hooks");
        let e = add(&conn, &t.id, &["Hear [Rumors] now", "nothing here", "100% [rumors] _x_"]);
        add(&conn, &u.id, &["Roll [3 unique RUMORS]"]);
        delete_entry(&conn, &e[0].id, 3).unwrap(); // deleted entries don't count
        let got = entries_mentioning(&conn, &camp, "rumors").unwrap();
        let found: Vec<_> = got.iter().map(|r| (r.table_name.as_str(), r.text.as_str())).collect();
        assert_eq!(found, [("Hooks", "Roll [3 unique RUMORS]"), ("Quests", "100% [rumors] _x_")]);
        // % and _ are plain characters, not wildcards.
        assert_eq!(entries_mentioning(&conn, &camp, "100%").unwrap().len(), 1);
        assert!(entries_mentioning(&conn, &camp, "%").unwrap().len() == 1);
        assert!(entries_mentioning(&conn, &camp, "_").unwrap().len() == 1);
        assert!(entries_mentioning(&conn, &camp, "  ").unwrap().is_empty());
        // Another campaign's entries are never returned.
        let other = campaigns::create(&conn, "Other", 4).unwrap();
        assert!(entries_mentioning(&conn, &other.id, "rumors").unwrap().is_empty());
    }

    #[test]
    fn rewriting_entry_texts_is_all_or_nothing() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Quests");
        let e = add(&conn, &t.id, &["one [A]", "two [A]"]);
        let update = |i: usize, text: &str| EntryTextUpdate { entry_id: e[i].id.clone(), text: text.into() };
        set_entry_texts(&conn, &[update(0, "one [B]"), update(1, "two [B]")], 9).unwrap();
        assert_eq!(texts(&conn, &t.id), ["one [B]", "two [B]"]);
        assert_eq!(items::get(&conn, &t.id).unwrap().updated_at, 9);
        // One bad update (blank text) changes nothing.
        assert!(set_entry_texts(&conn, &[update(0, "changed"), update(1, " ")], 10).is_err());
        assert_eq!(texts(&conn, &t.id), ["one [B]", "two [B]"]);
        // So does an entry that no longer exists.
        let missing = EntryTextUpdate { entry_id: "nope".into(), text: "x".into() };
        assert!(matches!(set_entry_texts(&conn, &[update(0, "changed"), missing], 10), Err(DbError::NotFound)));
        assert_eq!(texts(&conn, &t.id), ["one [B]", "two [B]"]);
    }

    #[test]
    fn search_finds_a_table_by_its_entries_and_notes() {
        let (conn, camp) = setup();
        let t = table(&conn, &camp, "Rumors");
        let e = add(&conn, &t.id, &["A dragon sleeps under the mill", "Bandits on the road"]);
        let hit = |q: &str| search::search(&conn, &camp, q, None, 50).unwrap().iter().any(|r| r.id == t.id);
        assert!(hit("dragon"));
        assert!(!hit("kraken"));
        set_notes(&conn, &t.id, "Use in taverns", 3).unwrap();
        assert!(hit("taverns") && hit("dragon"));
        update_entry(&conn, &e[0].id, "A kraken sleeps under the mill", 1, 4).unwrap();
        assert!(hit("kraken") && !hit("dragon"));
        delete_entry(&conn, &e[1].id, 5).unwrap();
        assert!(!hit("bandits"));
        restore_entry(&conn, &e[1].id, 6).unwrap();
        assert!(hit("bandits"));
    }
}
