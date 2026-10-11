//! Fields: project-wide field definitions, reusable field sets, the sets applied to an item, and
//! the values an item holds. Any item can have fields.
//!
//! What a field's settings and a value *mean* belongs to the app's TypeScript
//! (`src/lib/fields/`), which checks every value before it is saved; this module stores them and
//! checks what the database must be able to rely on (sizes, that JSON is JSON, that things belong
//! to one project). The one kind it looks inside is a **link** field: its value is a list of item
//! ids, and saving it makes the matching rows in the `links` table (`source_ref` `field:<field id>`),
//! so "Linked from" on the target shows the item.
//!
//! Definitions and sets are soft-deleted and can be restored. Deleting a link field hides the links
//! it made, and restoring it brings back exactly those.

use super::error::{clean_name, DbError};
use super::items::{self, Item};
use super::links;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const KINDS: &[&str] = &["text", "number", "bar", "formula", "dropdown", "list", "link", "date"];

pub const MAX_NAME_CHARS: usize = 60;
pub const MAX_DESCRIPTION_CHARS: usize = 300;
/// Largest settings object kept, in bytes.
pub const MAX_CONFIG_BYTES: usize = 20_000;
/// Largest value (and largest search text) kept, in bytes. A full list of long entries is about 1 MB.
pub const MAX_VALUE_BYTES: usize = 1_200_000;
/// Only the start of a text is needed to sort by it.
pub const MAX_SORT_TEXT_CHARS: usize = 200;
pub const MAX_LINK_TARGETS: usize = 200;

/// What the `source_ref` of a link made by a link field starts with (then the field's id).
pub const LINK_REF_PREFIX: &str = "field:";

/// The `source_ref` of the links a link field makes.
pub fn link_ref(field_id: &str) -> String {
    format!("{LINK_REF_PREFIX}{field_id}")
}

// ---------------------------------------------------------------- types

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDefinition {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub kind: String,
    pub description: String,
    pub config_json: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSet {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    /// The live fields in the set, in order.
    pub field_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldValue {
    pub item_id: String,
    pub field_id: String,
    pub value_json: String,
    pub secret: bool,
    pub updated_at: i64,
}

/// What an item's page needs in one call.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemFields {
    /// The applied sets, in the order they were applied.
    pub set_ids: Vec<String>,
    pub values: Vec<FieldValue>,
}

/// What the app works out from a value so the database can sort, filter and search by it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueIndex {
    pub sort_num: Option<f64>,
    pub sort_text: Option<String>,
    #[serde(default)]
    pub search_text: String,
}

/// A new index for a value that already exists (used when a field's settings change what its
/// values sort or search as).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexUpdate {
    pub item_id: String,
    #[serde(flatten)]
    pub index: ValueIndex,
}

const DEFINITION_COLUMNS: &str = "id, project_id, name, kind, description, config_json, created_at, updated_at, deleted_at";

fn definition_from_row(r: &Row) -> rusqlite::Result<FieldDefinition> {
    Ok(FieldDefinition {
        id: r.get(0)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        kind: r.get(3)?,
        description: r.get(4)?,
        config_json: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        deleted_at: r.get(8)?,
    })
}

// ---------------------------------------------------------------- checks

fn clean_field_name(name: &str) -> Result<&str, DbError> {
    let name = clean_name(name)?;
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(DbError::Invalid("A name can be at most 60 characters."));
    }
    Ok(name)
}

fn check_description(description: &str) -> Result<(), DbError> {
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(DbError::Invalid("A description can be at most 300 characters."));
    }
    Ok(())
}

/// The settings must be a JSON object of reasonable size (also used when importing packs).
pub fn validate_config(config_json: &str) -> Result<(), DbError> {
    if config_json.len() > MAX_CONFIG_BYTES {
        return Err(DbError::Invalid("That property's settings are too large to save."));
    }
    match serde_json::from_str::<serde_json::Value>(config_json) {
        Ok(v) if v.is_object() => Ok(()),
        _ => Err(DbError::Invalid("That property's settings can't be read.")),
    }
}

/// Is another live row of `table` ("field_definitions" or "field_sets") in this project already called this (ignoring case)?
fn name_taken(conn: &Connection, table: &'static str, project_id: &str, name: &str, except_id: &str) -> Result<bool, DbError> {
    let taken: Option<i64> = conn
        .query_row(
            &format!("SELECT 1 FROM {table} WHERE project_id = ?1 AND name = ?2 COLLATE NOCASE AND deleted_at IS NULL AND id <> ?3"),
            params![project_id, name, except_id],
            |r| r.get(0),
        )
        .optional()?;
    Ok(taken.is_some())
}

fn get_definition_any(conn: &Connection, id: &str) -> Result<FieldDefinition, DbError> {
    conn.query_row(
        &format!("SELECT {DEFINITION_COLUMNS} FROM field_definitions WHERE id = ?1"),
        [id],
        definition_from_row,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

fn get_definition_live(conn: &Connection, id: &str) -> Result<FieldDefinition, DbError> {
    let def = get_definition_any(conn, id)?;
    if def.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    Ok(def)
}

fn live_item(conn: &Connection, id: &str) -> Result<Item, DbError> {
    let item = items::get(conn, id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    Ok(item)
}

// ---------------------------------------------------------------- definitions

pub fn create_definition(
    conn: &Connection,
    project_id: &str,
    name: &str,
    kind: &str,
    description: &str,
    config_json: &str,
    now: i64,
) -> Result<FieldDefinition, DbError> {
    let name = clean_field_name(name)?;
    if !KINDS.contains(&kind) {
        return Err(DbError::Invalid("That kind of property isn't known."));
    }
    check_description(description)?;
    validate_config(config_json)?;
    if name_taken(conn, "field_definitions", project_id, name, "")? {
        return Err(DbError::Invalid("A property with that name already exists."));
    }
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO field_definitions (id, project_id, name, kind, description, config_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, project_id, name, kind, description, config_json, now],
    )
    .map_err(|e| match e {
        // A project that doesn't exist fails the foreign key.
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => DbError::NotFound,
        other => other.into(),
    })?;
    get_definition_live(conn, &id)
}

/// Changes a field's name, description and settings. Its kind cannot change.
pub fn update_definition(
    conn: &Connection,
    id: &str,
    name: &str,
    description: &str,
    config_json: &str,
    now: i64,
) -> Result<FieldDefinition, DbError> {
    let name = clean_field_name(name)?;
    check_description(description)?;
    validate_config(config_json)?;
    let def = get_definition_live(conn, id)?;
    if name_taken(conn, "field_definitions", &def.project_id, name, id)? {
        return Err(DbError::Invalid("A property with that name already exists."));
    }
    conn.execute(
        "UPDATE field_definitions SET name = ?2, description = ?3, config_json = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, name, description, config_json, now],
    )?;
    get_definition_live(conn, id)
}

/// Live definitions in a project, alphabetical.
pub fn list_definitions(conn: &Connection, project_id: &str) -> Result<Vec<FieldDefinition>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {DEFINITION_COLUMNS} FROM field_definitions
         WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE, created_at"
    ))?;
    let rows = stmt.query_map([project_id], definition_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Deleted definitions in a project (the ones that can be restored), newest deletion first.
pub fn list_deleted_definitions(conn: &Connection, project_id: &str) -> Result<Vec<FieldDefinition>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {DEFINITION_COLUMNS} FROM field_definitions
         WHERE project_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([project_id], definition_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Deletes a field (it can be restored). Its values stay stored but are hidden, and so are the
/// links a link field made.
pub fn delete_definition(conn: &Connection, id: &str, now: i64) -> Result<(), DbError> {
    let def = get_definition_live(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE field_definitions SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    if def.kind == "link" {
        tx.execute(
            "UPDATE links SET deleted_at = ?2, updated_at = ?2 WHERE source_ref = ?1 AND deleted_at IS NULL",
            params![link_ref(id), now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Brings a deleted field back, with its values and the links it made. Refused if another live
/// field has taken its name in the meantime.
pub fn restore_definition(conn: &Connection, id: &str, now: i64) -> Result<FieldDefinition, DbError> {
    let def = get_definition_any(conn, id)?;
    let Some(deleted_at) = def.deleted_at else {
        return Ok(def);
    };
    if name_taken(conn, "field_definitions", &def.project_id, &def.name, id)? {
        return Err(DbError::Invalid("Another property already has that name. Rename one of them first."));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE field_definitions SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    if def.kind == "link" {
        // Only the links the deletion hid (they share its timestamp), not ones removed earlier.
        tx.execute(
            "UPDATE links SET deleted_at = NULL, updated_at = ?3 WHERE source_ref = ?1 AND deleted_at = ?2",
            params![link_ref(id), deleted_at, now],
        )?;
    }
    tx.commit()?;
    get_definition_live(conn, id)
}

// ---------------------------------------------------------------- sets

fn set_field_ids(conn: &Connection, set_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT m.field_id FROM field_set_members m
         JOIN field_definitions d ON d.id = m.field_id
         WHERE m.set_id = ?1 AND m.deleted_at IS NULL AND d.deleted_at IS NULL
         ORDER BY m.position, m.created_at",
    )?;
    let rows = stmt.query_map([set_id], |r| r.get(0))?;
    Ok(rows.collect::<Result<Vec<String>, _>>()?)
}

fn set_from_row(conn: &Connection, r: &Row) -> Result<FieldSet, DbError> {
    let id: String = r.get(0)?;
    Ok(FieldSet {
        field_ids: set_field_ids(conn, &id)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        description: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
        deleted_at: r.get(6)?,
        id,
    })
}

const SET_COLUMNS: &str = "id, project_id, name, description, created_at, updated_at, deleted_at";

fn get_set_any(conn: &Connection, id: &str) -> Result<FieldSet, DbError> {
    let mut stmt = conn.prepare(&format!("SELECT {SET_COLUMNS} FROM field_sets WHERE id = ?1"))?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(row) => set_from_row(conn, row),
        None => Err(DbError::NotFound),
    }
}

fn get_set_live(conn: &Connection, id: &str) -> Result<FieldSet, DbError> {
    let set = get_set_any(conn, id)?;
    if set.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    Ok(set)
}

pub fn create_set(conn: &Connection, project_id: &str, name: &str, description: &str, now: i64) -> Result<FieldSet, DbError> {
    let name = clean_field_name(name)?;
    check_description(description)?;
    if name_taken(conn, "field_sets", project_id, name, "")? {
        return Err(DbError::Invalid("A property set with that name already exists."));
    }
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO field_sets (id, project_id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, project_id, name, description, now],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::ConstraintViolation => DbError::NotFound,
        other => other.into(),
    })?;
    get_set_live(conn, &id)
}

pub fn update_set(conn: &Connection, id: &str, name: &str, description: &str, now: i64) -> Result<FieldSet, DbError> {
    let name = clean_field_name(name)?;
    check_description(description)?;
    let set = get_set_live(conn, id)?;
    if name_taken(conn, "field_sets", &set.project_id, name, id)? {
        return Err(DbError::Invalid("A property set with that name already exists."));
    }
    conn.execute(
        "UPDATE field_sets SET name = ?2, description = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, name, description, now],
    )?;
    get_set_live(conn, id)
}

/// Replaces which fields are in the set, and in what order. The fields must be live and in the
/// set's project, each listed once; nothing changes if any of them is refused.
pub fn set_set_fields(conn: &Connection, set_id: &str, field_ids: &[String], now: i64) -> Result<FieldSet, DbError> {
    let set = get_set_live(conn, set_id)?;
    let mut seen = std::collections::HashSet::new();
    for field_id in field_ids {
        if !seen.insert(field_id.as_str()) {
            return Err(DbError::Invalid("A property can only be in a set once."));
        }
        let def = get_definition_live(conn, field_id)?;
        if def.project_id != set.project_id {
            return Err(DbError::Invalid("A set can only hold properties from its own project."));
        }
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE field_set_members SET deleted_at = ?2, updated_at = ?2 WHERE set_id = ?1 AND deleted_at IS NULL",
        params![set_id, now],
    )?;
    for (position, field_id) in field_ids.iter().enumerate() {
        tx.execute(
            "INSERT INTO field_set_members (set_id, field_id, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)
             ON CONFLICT (set_id, field_id)
             DO UPDATE SET position = ?3, deleted_at = NULL, updated_at = ?4",
            params![set_id, field_id, position as i64, now],
        )?;
    }
    tx.execute("UPDATE field_sets SET updated_at = ?2 WHERE id = ?1", params![set_id, now])?;
    tx.commit()?;
    get_set_live(conn, set_id)
}

pub fn list_sets(conn: &Connection, project_id: &str) -> Result<Vec<FieldSet>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SET_COLUMNS} FROM field_sets WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE, created_at"
    ))?;
    let mut rows = stmt.query([project_id])?;
    let mut sets = Vec::new();
    while let Some(row) = rows.next()? {
        sets.push(set_from_row(conn, row)?);
    }
    Ok(sets)
}

/// Deletes a set (it can be restored). Items that had it applied simply stop showing its fields
/// (any values they hold for those fields are still shown).
pub fn delete_set(conn: &Connection, id: &str, now: i64) -> Result<(), DbError> {
    get_set_live(conn, id)?;
    conn.execute("UPDATE field_sets SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    Ok(())
}

pub fn restore_set(conn: &Connection, id: &str, now: i64) -> Result<FieldSet, DbError> {
    let set = get_set_any(conn, id)?;
    if set.deleted_at.is_none() {
        return Ok(set);
    }
    if name_taken(conn, "field_sets", &set.project_id, &set.name, id)? {
        return Err(DbError::Invalid("Another property set already has that name. Rename one of them first."));
    }
    conn.execute("UPDATE field_sets SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    get_set_live(conn, id)
}

pub fn list_deleted_sets(conn: &Connection, project_id: &str) -> Result<Vec<FieldSet>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SET_COLUMNS} FROM field_sets WHERE project_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, name COLLATE NOCASE"
    ))?;
    let mut rows = stmt.query([project_id])?;
    let mut sets = Vec::new();
    while let Some(row) = rows.next()? {
        sets.push(set_from_row(conn, row)?);
    }
    Ok(sets)
}

// ---------------------------------------------------------------- sets applied to an item

/// Applies a set to an item (last in order). Doing it twice is harmless; a set that was taken off
/// comes back at the end.
pub fn apply_set(conn: &Connection, item_id: &str, set_id: &str, now: i64) -> Result<(), DbError> {
    let item = live_item(conn, item_id)?;
    let set = get_set_live(conn, set_id)?;
    if item.project_id != set.project_id {
        return Err(DbError::Invalid("A set can only be applied to items in its own project."));
    }
    let already: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM item_field_sets WHERE item_id = ?1 AND set_id = ?2 AND deleted_at IS NULL",
            params![item_id, set_id],
            |r| r.get(0),
        )
        .optional()?;
    if already.is_some() {
        return Ok(());
    }
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM item_field_sets WHERE item_id = ?1 AND deleted_at IS NULL",
        [item_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO item_field_sets (item_id, set_id, position, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (item_id, set_id)
         DO UPDATE SET position = ?3, deleted_at = NULL, updated_at = ?4",
        params![item_id, set_id, next, now],
    )?;
    Ok(())
}

/// Takes a set off an item. Values the item holds are kept. Harmless if it wasn't applied.
pub fn unapply_set(conn: &Connection, item_id: &str, set_id: &str, now: i64) -> Result<(), DbError> {
    conn.execute(
        "UPDATE item_field_sets SET deleted_at = ?3, updated_at = ?3 WHERE item_id = ?1 AND set_id = ?2 AND deleted_at IS NULL",
        params![item_id, set_id, now],
    )?;
    Ok(())
}

/// The live sets applied to an item, in the order they were applied.
pub fn list_item_sets(conn: &Connection, item_id: &str) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT a.set_id FROM item_field_sets a JOIN field_sets s ON s.id = a.set_id
         WHERE a.item_id = ?1 AND a.deleted_at IS NULL AND s.deleted_at IS NULL
         ORDER BY a.position, a.created_at",
    )?;
    let rows = stmt.query_map([item_id], |r| r.get(0))?;
    Ok(rows.collect::<Result<Vec<String>, _>>()?)
}

// ---------------------------------------------------------------- values

fn value_ids_for_link(value_json: &str) -> Result<Vec<String>, DbError> {
    let parsed: Result<Vec<String>, _> = serde_json::from_str(value_json);
    match parsed {
        Ok(ids) if ids.len() <= MAX_LINK_TARGETS => Ok(ids),
        _ => Err(DbError::Invalid("A link property holds a list of items.")),
    }
}

/// Saves what an item holds for a field (replacing any earlier value, and bringing back a cleared
/// one). For a link field the matching links are made in the same transaction (targets that can't
/// be linked, such as items since deleted, are skipped). Also marks the item as updated.
pub fn set_value(
    conn: &Connection,
    item_id: &str,
    field_id: &str,
    value_json: &str,
    index: &ValueIndex,
    secret: bool,
    now: i64,
) -> Result<(), DbError> {
    let item = live_item(conn, item_id)?;
    let def = get_definition_live(conn, field_id)?;
    if item.project_id != def.project_id {
        return Err(DbError::Invalid("That property belongs to a different project."));
    }
    if value_json.len() > MAX_VALUE_BYTES || index.search_text.len() > MAX_VALUE_BYTES {
        return Err(DbError::Invalid("That value is too large to save."));
    }
    if serde_json::from_str::<serde_json::Value>(value_json).is_err() {
        return Err(DbError::Invalid("That value can't be read."));
    }
    let link_targets = if def.kind == "link" { Some(value_ids_for_link(value_json)?) } else { None };
    let sort_num = index.sort_num.filter(|n| n.is_finite());
    let sort_text: Option<String> = index.sort_text.as_ref().map(|s| s.chars().take(MAX_SORT_TEXT_CHARS).collect());

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO field_values (item_id, field_id, value_json, sort_num, sort_text, search_text, secret, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT (item_id, field_id) DO UPDATE SET
            value_json = excluded.value_json, sort_num = excluded.sort_num, sort_text = excluded.sort_text,
            search_text = excluded.search_text, secret = excluded.secret,
            deleted_at = NULL, updated_at = excluded.updated_at",
        params![item_id, field_id, value_json, sort_num, sort_text, index.search_text, secret as i64, now],
    )?;
    if let Some(targets) = link_targets {
        links::sync_source(&tx, item_id, &link_ref(field_id), &targets, now)?;
    }
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Clears an item's value for a field (and the links a link field made). Harmless if it had none.
pub fn clear_value(conn: &Connection, item_id: &str, field_id: &str, now: i64) -> Result<(), DbError> {
    live_item(conn, item_id)?;
    let def = get_definition_any(conn, field_id)?;
    let tx = conn.unchecked_transaction()?;
    let cleared = tx.execute(
        "UPDATE field_values SET deleted_at = ?3, updated_at = ?3 WHERE item_id = ?1 AND field_id = ?2 AND deleted_at IS NULL",
        params![item_id, field_id, now],
    )?;
    if def.kind == "link" {
        links::sync_source(&tx, item_id, &link_ref(field_id), &[], now)?;
    }
    if cleared > 0 {
        tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    }
    tx.commit()?;
    Ok(())
}

/// Marks an item's value for a field GM-only (or not).
pub fn set_secret(conn: &Connection, item_id: &str, field_id: &str, secret: bool, now: i64) -> Result<(), DbError> {
    let changed = conn.execute(
        "UPDATE field_values SET secret = ?3, updated_at = ?4 WHERE item_id = ?1 AND field_id = ?2 AND deleted_at IS NULL",
        params![item_id, field_id, secret as i64, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    Ok(())
}

/// The applied sets and the values of one item (values of deleted fields are left out).
pub fn get_item_fields(conn: &Connection, item_id: &str) -> Result<ItemFields, DbError> {
    items::get(conn, item_id)?;
    let mut stmt = conn.prepare(
        "SELECT v.item_id, v.field_id, v.value_json, v.secret, v.updated_at
         FROM field_values v JOIN field_definitions d ON d.id = v.field_id
         WHERE v.item_id = ?1 AND v.deleted_at IS NULL AND d.deleted_at IS NULL
         ORDER BY d.name COLLATE NOCASE",
    )?;
    let values = stmt
        .query_map([item_id], |r| {
            Ok(FieldValue {
                item_id: r.get(0)?,
                field_id: r.get(1)?,
                value_json: r.get(2)?,
                secret: r.get::<_, i64>(3)? != 0,
                updated_at: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ItemFields { set_ids: list_item_sets(conn, item_id)?, values })
}

/// Every live value of one field, for work that has to look at them all (see `update_indexes`).
pub fn list_values_for_field(conn: &Connection, field_id: &str) -> Result<Vec<FieldValue>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT v.item_id, v.field_id, v.value_json, v.secret, v.updated_at
         FROM field_values v JOIN items i ON i.id = v.item_id
         WHERE v.field_id = ?1 AND v.deleted_at IS NULL AND i.deleted_at IS NULL
         ORDER BY v.item_id",
    )?;
    let rows = stmt.query_map([field_id], |r| {
        Ok(FieldValue {
            item_id: r.get(0)?,
            field_id: r.get(1)?,
            value_json: r.get(2)?,
            secret: r.get::<_, i64>(3)? != 0,
            updated_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Replaces what the database sorts and searches by for existing values of one field, in one
/// transaction, without touching the values themselves. Used when a field's settings change
/// (renaming a dropdown choice changes what its values sort and search as).
pub fn update_indexes(conn: &Connection, field_id: &str, updates: &[IndexUpdate], now: i64) -> Result<(), DbError> {
    get_definition_live(conn, field_id)?;
    let tx = conn.unchecked_transaction()?;
    for u in updates {
        if u.index.search_text.len() > MAX_VALUE_BYTES {
            return Err(DbError::Invalid("That value is too large to save."));
        }
        let sort_text: Option<String> = u.index.sort_text.as_ref().map(|s| s.chars().take(MAX_SORT_TEXT_CHARS).collect());
        tx.execute(
            "UPDATE field_values SET sort_num = ?3, sort_text = ?4, search_text = ?5, updated_at = ?6
             WHERE item_id = ?1 AND field_id = ?2 AND deleted_at IS NULL",
            params![u.item_id, field_id, u.index.sort_num.filter(|n| n.is_finite()), sort_text, u.index.search_text, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{projects, open_in_memory, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn doc(conn: &Connection, camp: &str, name: &str) -> Item {
        items::create(conn, camp, "worldbuilding", "document", name, None, 1).unwrap()
    }

    fn def(conn: &Connection, camp: &str, name: &str, kind: &str) -> FieldDefinition {
        create_definition(conn, camp, name, kind, "", "{}", 2).unwrap()
    }

    fn index(text: &str) -> ValueIndex {
        ValueIndex { sort_num: None, sort_text: Some(text.to_lowercase()), search_text: text.to_string() }
    }

    fn names(defs: Vec<FieldDefinition>) -> Vec<String> {
        defs.into_iter().map(|d| d.name).collect()
    }

    // ------------------------------------------------ definitions

    #[test]
    fn a_definition_is_made_listed_alphabetically_and_changed() {
        let (conn, camp) = setup();
        def(&conn, &camp, "Race", "text");
        let age = def(&conn, &camp, "age", "number");
        def(&conn, &camp, "Faction", "link");
        assert_eq!(names(list_definitions(&conn, &camp).unwrap()), ["age", "Faction", "Race"]);
        assert_eq!(age.kind, "number");
        assert_eq!(age.config_json, "{}");

        let changed = update_definition(&conn, &age.id, "Age in years", "How old", r#"{"min":0}"#, 5).unwrap();
        assert_eq!((changed.name.as_str(), changed.description.as_str(), changed.config_json.as_str()), ("Age in years", "How old", r#"{"min":0}"#));
        assert_eq!(changed.kind, "number"); // the kind is never changed
        assert_eq!(changed.updated_at, 5);
    }

    #[test]
    fn names_are_unique_ignoring_case_among_live_fields() {
        let (conn, camp) = setup();
        let race = def(&conn, &camp, "Race", "text");
        assert!(matches!(create_definition(&conn, &camp, "  race ", "text", "", "{}", 3), Err(DbError::Invalid(_))));
        let other = def(&conn, &camp, "Other", "text");
        assert!(matches!(update_definition(&conn, &other.id, "RACE", "", "{}", 4), Err(DbError::Invalid(_))));
        // Renaming a field to its own name in another case is fine.
        update_definition(&conn, &race.id, "RACE", "", "{}", 5).unwrap();
        // Another project may reuse a name.
        let second = projects::create(&conn, "Second", 1).unwrap();
        def(&conn, &second.id, "Race", "text");
    }

    #[test]
    fn bad_definitions_are_refused() {
        let (conn, camp) = setup();
        let make = |name: &str, kind: &str, desc: &str, config: &str| create_definition(&conn, &camp, name, kind, desc, config, 2);
        assert!(matches!(make("  ", "text", "", "{}"), Err(DbError::EmptyName)));
        assert!(matches!(make(&"x".repeat(61), "text", "", "{}"), Err(DbError::Invalid(_))));
        assert!(matches!(make("A", "location", "", "{}"), Err(DbError::Invalid(_))));
        assert!(matches!(make("A", "text", &"x".repeat(301), "{}"), Err(DbError::Invalid(_))));
        assert!(matches!(make("A", "text", "", "[1]"), Err(DbError::Invalid(_))));
        assert!(matches!(make("A", "text", "", "nope"), Err(DbError::Invalid(_))));
        let too_big = format!(r#"{{"x":"{}"}}"#, "y".repeat(MAX_CONFIG_BYTES));
        assert!(matches!(make("A", "text", "", &too_big), Err(DbError::Invalid(_))));
        assert!(matches!(create_definition(&conn, "no-such-project", "A", "text", "", "{}", 2), Err(DbError::NotFound)));
        assert!(list_definitions(&conn, &camp).unwrap().is_empty());
    }

    #[test]
    fn deleting_hides_a_field_and_its_values_and_restoring_brings_them_back() {
        let (conn, camp) = setup();
        let race = def(&conn, &camp, "Race", "text");
        let strahd = doc(&conn, &camp, "Strahd");
        set_value(&conn, &strahd.id, &race.id, r#""Vampire""#, &index("Vampire"), false, 3).unwrap();

        delete_definition(&conn, &race.id, 4).unwrap();
        assert!(list_definitions(&conn, &camp).unwrap().is_empty());
        assert_eq!(names(list_deleted_definitions(&conn, &camp).unwrap()), ["Race"]);
        assert!(get_item_fields(&conn, &strahd.id).unwrap().values.is_empty());
        assert!(matches!(set_value(&conn, &strahd.id, &race.id, r#""x""#, &index("x"), false, 5), Err(DbError::NotFound)));

        restore_definition(&conn, &race.id, 6).unwrap();
        let fields = get_item_fields(&conn, &strahd.id).unwrap();
        assert_eq!(fields.values.len(), 1);
        assert_eq!(fields.values[0].value_json, r#""Vampire""#);
    }

    #[test]
    fn a_deleted_name_can_be_reused_and_then_the_old_field_cannot_be_restored_until_renamed() {
        let (conn, camp) = setup();
        let old = def(&conn, &camp, "Race", "text");
        delete_definition(&conn, &old.id, 3).unwrap();
        let fresh = def(&conn, &camp, "Race", "text");
        assert!(matches!(restore_definition(&conn, &old.id, 4), Err(DbError::Invalid(_))));
        update_definition(&conn, &fresh.id, "Species", "", "{}", 5).unwrap();
        restore_definition(&conn, &old.id, 6).unwrap();
        assert_eq!(names(list_definitions(&conn, &camp).unwrap()), ["Race", "Species"]);
    }

    // ------------------------------------------------ values

    #[test]
    fn a_value_is_saved_replaced_and_cleared() {
        let (conn, camp) = setup();
        let age = def(&conn, &camp, "Age", "number");
        let strahd = doc(&conn, &camp, "Strahd");
        let by_number = |n: f64| ValueIndex { sort_num: Some(n), sort_text: None, search_text: n.to_string() };

        set_value(&conn, &strahd.id, &age.id, "400", &by_number(400.0), false, 3).unwrap();
        assert_eq!(items::get(&conn, &strahd.id).unwrap().updated_at, 3);
        set_value(&conn, &strahd.id, &age.id, "500", &by_number(500.0), true, 4).unwrap();
        let fields = get_item_fields(&conn, &strahd.id).unwrap();
        assert_eq!(fields.values.len(), 1);
        assert_eq!((fields.values[0].value_json.as_str(), fields.values[0].secret), ("500", true));
        let (sort, search): (f64, String) = conn
            .query_row("SELECT sort_num, search_text FROM field_values WHERE item_id = ?1", [&strahd.id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((sort, search.as_str()), (500.0, "500"));

        clear_value(&conn, &strahd.id, &age.id, 6).unwrap();
        assert!(get_item_fields(&conn, &strahd.id).unwrap().values.is_empty());
        clear_value(&conn, &strahd.id, &age.id, 7).unwrap(); // harmless
        set_value(&conn, &strahd.id, &age.id, "10", &by_number(10.0), false, 8).unwrap(); // comes back
        assert_eq!(get_item_fields(&conn, &strahd.id).unwrap().values[0].value_json, "10");
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM field_values", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn values_are_checked_before_they_are_saved() {
        let (conn, camp) = setup();
        let race = def(&conn, &camp, "Race", "text");
        let a = doc(&conn, &camp, "A");
        let other = projects::create(&conn, "Other", 1).unwrap();
        let foreign_item = doc(&conn, &other.id, "Foreign");
        let foreign_field = def(&conn, &other.id, "Race", "text");

        assert!(matches!(set_value(&conn, &a.id, &race.id, "not json", &index("x"), false, 3), Err(DbError::Invalid(_))));
        let huge = format!("\"{}\"", "x".repeat(MAX_VALUE_BYTES));
        assert!(matches!(set_value(&conn, &a.id, &race.id, &huge, &index("x"), false, 3), Err(DbError::Invalid(_))));
        assert!(matches!(set_value(&conn, &foreign_item.id, &race.id, "\"x\"", &index("x"), false, 3), Err(DbError::Invalid(_))));
        assert!(matches!(set_value(&conn, &a.id, &foreign_field.id, "\"x\"", &index("x"), false, 3), Err(DbError::Invalid(_))));
        assert!(matches!(set_value(&conn, "nope", &race.id, "\"x\"", &index("x"), false, 3), Err(DbError::NotFound)));
        assert!(matches!(set_value(&conn, &a.id, "nope", "\"x\"", &index("x"), false, 3), Err(DbError::NotFound)));
        items::soft_delete(&conn, &a.id, 4).unwrap();
        assert!(matches!(set_value(&conn, &a.id, &race.id, "\"x\"", &index("x"), false, 5), Err(DbError::NotFound)));
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM field_values", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
    }

    #[test]
    fn the_sort_text_is_cut_to_its_start() {
        let (conn, camp) = setup();
        let notes = def(&conn, &camp, "Notes", "text");
        let a = doc(&conn, &camp, "A");
        let long = "é".repeat(500);
        set_value(&conn, &a.id, &notes.id, "\"x\"", &ValueIndex { sort_num: Some(f64::NAN), sort_text: Some(long), search_text: String::new() }, false, 3).unwrap();
        let (text, num): (String, Option<f64>) = conn
            .query_row("SELECT sort_text, sort_num FROM field_values", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(text.chars().count(), MAX_SORT_TEXT_CHARS);
        assert_eq!(num, None); // a number that isn't a number is not stored
    }

    #[test]
    fn the_secret_mark_can_be_changed_and_needs_a_value() {
        let (conn, camp) = setup();
        let race = def(&conn, &camp, "Race", "text");
        let a = doc(&conn, &camp, "A");
        assert!(matches!(set_secret(&conn, &a.id, &race.id, true, 3), Err(DbError::NotFound)));
        set_value(&conn, &a.id, &race.id, "\"x\"", &index("x"), false, 3).unwrap();
        set_secret(&conn, &a.id, &race.id, true, 4).unwrap();
        assert!(get_item_fields(&conn, &a.id).unwrap().values[0].secret);
        set_secret(&conn, &a.id, &race.id, false, 5).unwrap();
        assert!(!get_item_fields(&conn, &a.id).unwrap().values[0].secret);
    }

    #[test]
    fn indexes_can_be_replaced_without_touching_the_values() {
        let (conn, camp) = setup();
        let status = def(&conn, &camp, "Status", "dropdown");
        let a = doc(&conn, &camp, "A");
        set_value(&conn, &a.id, &status.id, "\"o1\"", &index("alive"), false, 3).unwrap();
        let before = items::get(&conn, &a.id).unwrap().updated_at;
        update_indexes(
            &conn,
            &status.id,
            &[IndexUpdate { item_id: a.id.clone(), index: ValueIndex { sort_num: Some(0.0), sort_text: Some("living".into()), search_text: "Living".into() } }],
            9,
        )
        .unwrap();
        let (value, sort, search): (String, String, String) = conn
            .query_row("SELECT value_json, sort_text, search_text FROM field_values", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        assert_eq!((value.as_str(), sort.as_str(), search.as_str()), ("\"o1\"", "living", "Living"));
        assert_eq!(items::get(&conn, &a.id).unwrap().updated_at, before);
        assert_eq!(list_values_for_field(&conn, &status.id).unwrap().len(), 1);
    }

    #[test]
    fn purging_an_item_removes_its_values_and_applied_sets() {
        let (conn, camp) = setup();
        let race = def(&conn, &camp, "Race", "text");
        let npc = create_set(&conn, &camp, "NPC", "", 2).unwrap();
        let a = doc(&conn, &camp, "A");
        set_value(&conn, &a.id, &race.id, "\"x\"", &index("x"), false, 3).unwrap();
        apply_set(&conn, &a.id, &npc.id, 4).unwrap();
        items::soft_delete(&conn, &a.id, 5).unwrap();
        trash::purge_item(&conn, &a.id).unwrap();
        for table in ["field_values", "item_field_sets"] {
            let rows: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
            assert_eq!(rows, 0, "{table}");
        }
    }

    // ------------------------------------------------ link fields

    #[test]
    fn a_link_field_makes_links_that_follow_its_value() {
        let (conn, camp) = setup();
        let faction = def(&conn, &camp, "Faction", "link");
        let strahd = doc(&conn, &camp, "Strahd");
        let zhent = doc(&conn, &camp, "Zhentarim");
        let harpers = doc(&conn, &camp, "Harpers");
        let ids = |v: Vec<Item>| v.into_iter().map(|i| i.name).collect::<Vec<_>>();
        let value = |targets: &[&Item]| serde_json::to_string(&targets.iter().map(|i| i.id.clone()).collect::<Vec<_>>()).unwrap();

        set_value(&conn, &strahd.id, &faction.id, &value(&[&zhent, &harpers]), &ValueIndex::default(), false, 3).unwrap();
        assert_eq!(ids(links::outgoing(&conn, &strahd.id).unwrap()), ["Harpers", "Zhentarim"]);
        assert_eq!(ids(links::backlinks(&conn, &zhent.id).unwrap()), ["Strahd"]);
        let refs: Vec<String> = conn.prepare("SELECT DISTINCT source_ref FROM links").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(refs, vec![link_ref(&faction.id)]);

        set_value(&conn, &strahd.id, &faction.id, &value(&[&harpers]), &ValueIndex::default(), false, 4).unwrap();
        assert_eq!(ids(links::outgoing(&conn, &strahd.id).unwrap()), ["Harpers"]);
        assert!(links::backlinks(&conn, &zhent.id).unwrap().is_empty());

        clear_value(&conn, &strahd.id, &faction.id, 5).unwrap();
        assert!(links::outgoing(&conn, &strahd.id).unwrap().is_empty());
    }

    #[test]
    fn a_link_field_leaves_other_links_alone_and_skips_what_cannot_be_linked() {
        let (conn, camp) = setup();
        let faction = def(&conn, &camp, "Faction", "link");
        let strahd = doc(&conn, &camp, "Strahd");
        let zhent = doc(&conn, &camp, "Zhentarim");
        let gone = doc(&conn, &camp, "Gone");
        items::soft_delete(&conn, &gone.id, 3).unwrap();
        links::add(&conn, &strahd.id, &zhent.id, links::MANUAL, 3).unwrap();
        let value = serde_json::to_string(&[&strahd.id, &gone.id, &"no-such-item".to_string(), &zhent.id]).unwrap();
        set_value(&conn, &strahd.id, &faction.id, &value, &ValueIndex::default(), false, 4).unwrap();
        clear_value(&conn, &strahd.id, &faction.id, 5).unwrap();
        // The hand-made link survives, and nothing could be linked to itself or to what is gone.
        assert_eq!(links::manual_target_ids(&conn, &strahd.id).unwrap(), vec![zhent.id.clone()]);
        assert_eq!(links::outgoing(&conn, &strahd.id).unwrap().len(), 1);
    }

    #[test]
    fn a_link_field_must_hold_a_list_of_ids() {
        let (conn, camp) = setup();
        let faction = def(&conn, &camp, "Faction", "link");
        let a = doc(&conn, &camp, "A");
        for bad in ["\"just text\"", "3", "{\"a\":1}", "[1,2]", "null"] {
            assert!(matches!(set_value(&conn, &a.id, &faction.id, bad, &ValueIndex::default(), false, 3), Err(DbError::Invalid(_))), "{bad}");
        }
        let too_many = serde_json::to_string(&(0..=MAX_LINK_TARGETS).map(|i| format!("id{i}")).collect::<Vec<_>>()).unwrap();
        assert!(matches!(set_value(&conn, &a.id, &faction.id, &too_many, &ValueIndex::default(), false, 3), Err(DbError::Invalid(_))));
    }

    #[test]
    fn deleting_a_link_field_hides_its_links_and_restoring_brings_back_only_those() {
        let (conn, camp) = setup();
        let faction = def(&conn, &camp, "Faction", "link");
        let a = doc(&conn, &camp, "A");
        let b = doc(&conn, &camp, "B");
        let c = doc(&conn, &camp, "C");
        let value = |ids: &[&str]| serde_json::to_string(ids).unwrap();
        set_value(&conn, &a.id, &faction.id, &value(&[&b.id, &c.id]), &ValueIndex::default(), false, 3).unwrap();
        set_value(&conn, &a.id, &faction.id, &value(&[&b.id]), &ValueIndex::default(), false, 4).unwrap(); // C's link is removed earlier

        delete_definition(&conn, &faction.id, 5).unwrap();
        assert!(links::outgoing(&conn, &a.id).unwrap().is_empty());
        assert!(links::backlinks(&conn, &b.id).unwrap().is_empty());

        restore_definition(&conn, &faction.id, 6).unwrap();
        let back: Vec<String> = links::outgoing(&conn, &a.id).unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(back, ["B"]); // not C: that link was removed before the deletion
    }

    // ------------------------------------------------ sets

    #[test]
    fn a_set_holds_fields_in_order_and_hides_deleted_ones() {
        let (conn, camp) = setup();
        let race = def(&conn, &camp, "Race", "text");
        let class = def(&conn, &camp, "Class", "text");
        let age = def(&conn, &camp, "Age", "number");
        let npc = create_set(&conn, &camp, "NPC", "People", 3).unwrap();
        assert!(npc.field_ids.is_empty());

        let set = set_set_fields(&conn, &npc.id, &[class.id.clone(), race.id.clone(), age.id.clone()], 4).unwrap();
        assert_eq!(set.field_ids, vec![class.id.clone(), race.id.clone(), age.id.clone()]);
        let set = set_set_fields(&conn, &npc.id, &[age.id.clone(), class.id.clone()], 5).unwrap();
        assert_eq!(set.field_ids, vec![age.id.clone(), class.id.clone()]);
        // A field taken out and put back returns at its new place.
        let set = set_set_fields(&conn, &npc.id, &[race.id.clone(), age.id.clone(), class.id.clone()], 6).unwrap();
        assert_eq!(set.field_ids, vec![race.id.clone(), age.id.clone(), class.id.clone()]);

        delete_definition(&conn, &age.id, 7).unwrap();
        assert_eq!(list_sets(&conn, &camp).unwrap()[0].field_ids, vec![race.id.clone(), class.id.clone()]);
        restore_definition(&conn, &age.id, 8).unwrap();
        assert_eq!(list_sets(&conn, &camp).unwrap()[0].field_ids.len(), 3);
    }

    #[test]
    fn a_refused_membership_change_changes_nothing() {
        let (conn, camp) = setup();
        let race = def(&conn, &camp, "Race", "text");
        let npc = create_set(&conn, &camp, "NPC", "", 3).unwrap();
        set_set_fields(&conn, &npc.id, &[race.id.clone()], 4).unwrap();
        let other = projects::create(&conn, "Other", 1).unwrap();
        let foreign = def(&conn, &other.id, "Foreign", "text");
        assert!(matches!(set_set_fields(&conn, &npc.id, &[race.id.clone(), race.id.clone()], 5), Err(DbError::Invalid(_))));
        assert!(matches!(set_set_fields(&conn, &npc.id, &[foreign.id.clone()], 5), Err(DbError::Invalid(_))));
        assert!(matches!(set_set_fields(&conn, &npc.id, &["nope".to_string()], 5), Err(DbError::NotFound)));
        assert_eq!(get_set_live(&conn, &npc.id).unwrap().field_ids, vec![race.id.clone()]);
    }

    #[test]
    fn set_names_are_unique_and_sets_can_be_deleted_and_restored() {
        let (conn, camp) = setup();
        let npc = create_set(&conn, &camp, "NPC", "", 3).unwrap();
        assert!(matches!(create_set(&conn, &camp, "npc", "", 4), Err(DbError::Invalid(_))));
        let place = create_set(&conn, &camp, "Place", "", 4).unwrap();
        assert!(matches!(update_set(&conn, &place.id, "NPC", "", 5), Err(DbError::Invalid(_))));
        update_set(&conn, &place.id, "Location", "Where", 5).unwrap();

        delete_set(&conn, &npc.id, 6).unwrap();
        assert_eq!(list_sets(&conn, &camp).unwrap().len(), 1);
        assert_eq!(list_deleted_sets(&conn, &camp).unwrap().len(), 1);
        create_set(&conn, &camp, "NPC", "", 7).unwrap();
        assert!(matches!(restore_set(&conn, &npc.id, 8), Err(DbError::Invalid(_))));
    }

    #[test]
    fn sets_are_applied_to_items_in_order_and_taken_off_again() {
        let (conn, camp) = setup();
        let npc = create_set(&conn, &camp, "NPC", "", 3).unwrap();
        let combat = create_set(&conn, &camp, "Combat", "", 3).unwrap();
        let a = doc(&conn, &camp, "A");
        apply_set(&conn, &a.id, &combat.id, 4).unwrap();
        apply_set(&conn, &a.id, &npc.id, 5).unwrap();
        apply_set(&conn, &a.id, &npc.id, 6).unwrap(); // harmless
        assert_eq!(list_item_sets(&conn, &a.id).unwrap(), vec![combat.id.clone(), npc.id.clone()]);

        unapply_set(&conn, &a.id, &combat.id, 7).unwrap();
        unapply_set(&conn, &a.id, &combat.id, 8).unwrap(); // harmless
        assert_eq!(list_item_sets(&conn, &a.id).unwrap(), vec![npc.id.clone()]);
        apply_set(&conn, &a.id, &combat.id, 9).unwrap();
        assert_eq!(list_item_sets(&conn, &a.id).unwrap(), vec![npc.id.clone(), combat.id.clone()]);

        delete_set(&conn, &npc.id, 10).unwrap();
        assert_eq!(list_item_sets(&conn, &a.id).unwrap(), vec![combat.id.clone()]);
        restore_set(&conn, &npc.id, 11).unwrap();
        assert_eq!(list_item_sets(&conn, &a.id).unwrap().len(), 2);
    }

    #[test]
    fn a_set_only_goes_on_live_items_of_its_own_project() {
        let (conn, camp) = setup();
        let npc = create_set(&conn, &camp, "NPC", "", 3).unwrap();
        let other = projects::create(&conn, "Other", 1).unwrap();
        let foreign = doc(&conn, &other.id, "Foreign");
        let gone = doc(&conn, &camp, "Gone");
        items::soft_delete(&conn, &gone.id, 4).unwrap();
        assert!(matches!(apply_set(&conn, &foreign.id, &npc.id, 5), Err(DbError::Invalid(_))));
        assert!(matches!(apply_set(&conn, &gone.id, &npc.id, 5), Err(DbError::NotFound)));
        assert!(matches!(apply_set(&conn, "nope", &npc.id, 5), Err(DbError::NotFound)));
        delete_set(&conn, &npc.id, 6).unwrap();
        let a = doc(&conn, &camp, "A");
        assert!(matches!(apply_set(&conn, &a.id, &npc.id, 7), Err(DbError::NotFound)));
    }
}
