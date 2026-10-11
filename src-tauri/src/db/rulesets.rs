//! Rulesets: global definitions of a game system (Phase 5).
//!
//! A ruleset belongs to no project. Its definition is JSON text whose shape and meaning belong to
//! the app's TypeScript (`src/lib/rulesets/ruleset.ts`); the database only checks that it is a
//! JSON object of reasonable size, like generators.
//!
//! **Picking a ruleset for a project copies it in** (`apply`): the properties and property sets
//! its stat blocks need are made in the project (or the ones with the same name are used, as
//! starter templates do), its dice formulas become formulas in the Dice library, and its
//! encounter rules are kept with the project (`project_rulesets`). After that the project does
//! not depend on the global ruleset: editing or deleting it changes nothing until it is applied
//! again, and applying it again only adds what is missing and refreshes the rules.

use super::error::{clean_name, DbError};
use super::fields::{self, FieldDefinition};
use super::formulas;
use super::items;
use super::projects;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub const MAX_NAME_CHARS: usize = 60;
pub const MAX_DESCRIPTION_CHARS: usize = 500;
pub const MAX_DEFINITION_BYTES: usize = 500_000;
const MAX_FIELDS: usize = 80;
const MAX_SETS: usize = 20;
const MAX_FORMULAS: usize = 40;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ruleset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub definition_json: String,
    /// `starter:<name>` for rulesets that come with the app.
    pub origin_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn from_row(r: &Row) -> rusqlite::Result<Ruleset> {
    Ok(Ruleset {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        definition_json: r.get(3)?,
        origin_id: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

const COLUMNS: &str = "id, name, description, definition_json, origin_id, created_at, updated_at";

/// Checks a stored definition (also used when importing packs).
pub fn validate_definition(definition_json: &str) -> Result<(), DbError> {
    if definition_json.len() > MAX_DEFINITION_BYTES {
        return Err(DbError::Invalid("That ruleset is too large to save."));
    }
    match serde_json::from_str::<serde_json::Value>(definition_json) {
        Ok(value) if value.is_object() => Ok(()),
        _ => Err(DbError::Invalid("That ruleset can't be read.")),
    }
}

fn check_text(name: &str, description: &str) -> Result<String, DbError> {
    let name = clean_name(name)?;
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(DbError::Invalid("A ruleset's name can be at most 60 characters."));
    }
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(DbError::Invalid("A ruleset's description can be at most 500 characters."));
    }
    Ok(name.to_string())
}

fn name_taken(conn: &Connection, name: &str, except_id: &str) -> Result<bool, DbError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM rulesets WHERE deleted_at IS NULL AND name = ?1 COLLATE NOCASE AND id <> ?2",
        params![name, except_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn get_any(conn: &Connection, id: &str) -> Result<Ruleset, DbError> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM rulesets WHERE id = ?1"), [id], from_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
            other => other.into(),
        })
}

pub fn get(conn: &Connection, id: &str) -> Result<Ruleset, DbError> {
    let found = get_any(conn, id)?;
    let deleted: Option<i64> = conn.query_row("SELECT deleted_at FROM rulesets WHERE id = ?1", [id], |r| r.get(0))?;
    if deleted.is_some() {
        return Err(DbError::NotFound);
    }
    Ok(found)
}

pub fn create(
    conn: &Connection,
    name: &str,
    description: &str,
    definition_json: &str,
    origin_id: Option<&str>,
    now: i64,
) -> Result<Ruleset, DbError> {
    let name = check_text(name, description)?;
    validate_definition(definition_json)?;
    if name_taken(conn, &name, "")? {
        return Err(DbError::Invalid("A ruleset with that name already exists."));
    }
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO rulesets (id, name, description, definition_json, origin_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, name, description, definition_json, origin_id, now],
    )?;
    get(conn, &id)
}

/// Changes a ruleset's name, description and definition. Projects that already use it keep
/// the copy they have until it is applied again.
pub fn update(conn: &Connection, id: &str, name: &str, description: &str, definition_json: &str, now: i64) -> Result<Ruleset, DbError> {
    get(conn, id)?;
    let name = check_text(name, description)?;
    validate_definition(definition_json)?;
    if name_taken(conn, &name, id)? {
        return Err(DbError::Invalid("A ruleset with that name already exists."));
    }
    conn.execute(
        "UPDATE rulesets SET name = ?2, description = ?3, definition_json = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, name, description, definition_json, now],
    )?;
    get(conn, id)
}

pub fn list(conn: &Connection) -> Result<Vec<Ruleset>, DbError> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM rulesets WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE, created_at"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn list_deleted(conn: &Connection) -> Result<Vec<Ruleset>, DbError> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM rulesets WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Moves a ruleset to the trash. Projects that use it keep their copy.
pub fn soft_delete(conn: &Connection, id: &str, now: i64) -> Result<(), DbError> {
    get(conn, id)?;
    conn.execute("UPDATE rulesets SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    Ok(())
}

/// Brings a ruleset back. Refuses if another live one has taken its name.
pub fn restore(conn: &Connection, id: &str, now: i64) -> Result<Ruleset, DbError> {
    let found = get_any(conn, id)?;
    if name_taken(conn, &found.name, id)? {
        return Err(DbError::Invalid("Another ruleset now has that name. Rename it first."));
    }
    conn.execute("UPDATE rulesets SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    get(conn, id)
}

/// Deletes a trashed ruleset for good. Copies in projects stay.
pub fn purge(conn: &Connection, id: &str) -> Result<(), DbError> {
    let deleted: Option<Option<i64>> = conn.query_row("SELECT deleted_at FROM rulesets WHERE id = ?1", [id], |r| r.get(0)).optional()?;
    match deleted {
        None => Err(DbError::NotFound),
        Some(None) => Err(DbError::Invalid("Only a ruleset in the trash can be deleted for good.")),
        Some(Some(_)) => {
            conn.execute("DELETE FROM rulesets WHERE id = ?1", [id])?;
            Ok(())
        }
    }
}

/// `origin_id`s of the starter rulesets that are live (so the Library knows what is added).
pub fn installed_starters(conn: &Connection) -> Result<Vec<String>, DbError> {
    let mut stmt = conn.prepare("SELECT origin_id FROM rulesets WHERE deleted_at IS NULL AND origin_id IS NOT NULL")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

// ---------------------------------------------------------------- using a ruleset in a project

/// What a ruleset needs in a project (field names must match `RulesetBundleJson` in TypeScript).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesetBundle {
    #[serde(default)]
    pub fields: Vec<BundleField>,
    #[serde(default)]
    pub sets: Vec<BundleSet>,
    #[serde(default)]
    pub formulas: Vec<BundleFormula>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleField {
    pub key: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "empty_object")]
    pub config_json: String,
}

fn empty_object() -> String {
    "{}".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleSet {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub field_keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BundleFormula {
    pub name: String,
    pub notation: String,
}

/// A project's copy of a ruleset.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuleset {
    pub id: String,
    pub project_id: String,
    /// The global ruleset it was copied from, if that still exists.
    pub ruleset_id: Option<String>,
    pub name: String,
    /// The ruleset's definition as it was when applied (TypeScript reads the encounter rules from it).
    pub rules_json: String,
    /// `{"fields": {key: field id}, "sets": {key: set id}}`
    pub ids_json: String,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub project_ruleset: ProjectRuleset,
    /// Made new in the project (the others already existed and were used as they were).
    pub fields_made: u32,
    pub sets_made: u32,
    pub formulas_made: u32,
}

fn project_ruleset_from_row(r: &Row) -> rusqlite::Result<ProjectRuleset> {
    Ok(ProjectRuleset {
        id: r.get(0)?,
        project_id: r.get(1)?,
        ruleset_id: r.get(2)?,
        name: r.get(3)?,
        rules_json: r.get(4)?,
        ids_json: r.get(5)?,
        position: r.get(6)?,
    })
}

const PR_COLUMNS: &str = "id, project_id, ruleset_id, name, rules_json, ids_json, position";

fn validate_bundle(bundle: &RulesetBundle) -> Result<(), DbError> {
    if bundle.fields.len() > MAX_FIELDS || bundle.sets.len() > MAX_SETS || bundle.formulas.len() > MAX_FORMULAS {
        return Err(DbError::Invalid("That ruleset is too large."));
    }
    let mut keys = HashSet::new();
    let mut names = HashSet::new();
    for field in &bundle.fields {
        clean_name(&field.name)?;
        if field.name.trim().chars().count() > fields::MAX_NAME_CHARS || field.description.chars().count() > fields::MAX_DESCRIPTION_CHARS {
            return Err(DbError::Invalid("A ruleset property's name or description is too long."));
        }
        if field.key.trim().is_empty() || !keys.insert(field.key.as_str()) {
            return Err(DbError::Invalid("Every ruleset property needs its own key."));
        }
        if !names.insert(field.name.trim().to_lowercase()) {
            return Err(DbError::Invalid("A ruleset's properties need different names."));
        }
        if !fields::KINDS.contains(&field.kind.as_str()) {
            return Err(DbError::Invalid("A ruleset property is of a kind that isn't known."));
        }
        fields::validate_config(&field.config_json)?;
    }
    let mut set_keys = HashSet::new();
    let mut set_names = HashSet::new();
    for set in &bundle.sets {
        clean_name(&set.name)?;
        if set.key.trim().is_empty() || !set_keys.insert(set.key.as_str()) {
            return Err(DbError::Invalid("Every ruleset stat block needs its own key."));
        }
        if !set_names.insert(set.name.trim().to_lowercase()) {
            return Err(DbError::Invalid("A ruleset's stat blocks need different names."));
        }
        let mut seen = HashSet::new();
        for key in &set.field_keys {
            if !keys.contains(key.as_str()) {
                return Err(DbError::Invalid("A stat block uses a property the ruleset doesn't have."));
            }
            if !seen.insert(key.as_str()) {
                return Err(DbError::Invalid("A stat block lists a property twice."));
            }
        }
    }
    for formula in &bundle.formulas {
        clean_name(&formula.name)?;
        formulas::validate(&formula.notation)?;
    }
    Ok(())
}

/// Copies a ruleset into a project. All or nothing. `definition_json` is kept as the project's
/// copy of the rules. If the project already has a copy of this ruleset, it is refreshed in
/// place (its properties and sets are found by name, so nothing is duplicated).
///
/// Refuses a property whose name exists in the project with a different kind (it could not hold
/// the ruleset's values).
pub fn apply(
    conn: &Connection,
    project_id: &str,
    ruleset_id: &str,
    bundle: &RulesetBundle,
    now: i64,
) -> Result<ApplyResult, DbError> {
    projects::require_live(conn, project_id)?;
    let ruleset = get(conn, ruleset_id)?;
    validate_bundle(bundle)?;

    let existing_fields: Vec<FieldDefinition> = fields::list_definitions(conn, project_id)?;
    for field in &bundle.fields {
        if let Some(found) = existing_fields.iter().find(|d| d.name.eq_ignore_ascii_case(field.name.trim())) {
            if found.kind != field.kind {
                return Err(DbError::Invalid(
                    "A property with the same name as one in this ruleset already exists, but it is a different kind of property. Rename it first.",
                ));
            }
        }
    }

    let tx = conn.unchecked_transaction()?;

    let mut field_ids: HashMap<&str, String> = HashMap::new();
    let mut fields_made = 0;
    for field in &bundle.fields {
        let id = match existing_fields.iter().find(|d| d.name.eq_ignore_ascii_case(field.name.trim())) {
            Some(found) => found.id.clone(),
            None => {
                fields_made += 1;
                fields::create_definition(&tx, project_id, &field.name, &field.kind, &field.description, &field.config_json, now)?.id
            }
        };
        field_ids.insert(field.key.as_str(), id);
    }

    let existing_sets = fields::list_sets(&tx, project_id)?;
    let mut set_ids: HashMap<&str, String> = HashMap::new();
    let mut sets_made = 0;
    for set in &bundle.sets {
        let id = match existing_sets.iter().find(|s| s.name.eq_ignore_ascii_case(set.name.trim())) {
            Some(found) => found.id.clone(),
            None => {
                sets_made += 1;
                let made = fields::create_set(&tx, project_id, &set.name, &set.description, now)?;
                for (position, key) in set.field_keys.iter().enumerate() {
                    tx.execute(
                        "INSERT INTO field_set_members (set_id, field_id, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                        params![made.id, field_ids[key.as_str()], position as i64, now],
                    )?;
                }
                made.id
            }
        };
        set_ids.insert(set.key.as_str(), id);
    }

    // Formulas: skip one whose name a live formula already has.
    let mut formulas_made = 0;
    let have: HashSet<String> = formulas::list(&tx, project_id)?.into_iter().map(|f| f.name.to_lowercase()).collect();
    for formula in &bundle.formulas {
        if !have.contains(&formula.name.trim().to_lowercase()) {
            // Direct inserts: `formulas::create` opens its own transaction, which can't nest.
            let item = items::create(&tx, project_id, formulas::LIBRARY, formulas::FORMULA_TYPE, &formula.name, None, now)?;
            tx.execute(
                "INSERT INTO formulas (item_id, notation, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                params![item.id, formula.notation.trim(), now],
            )?;
            formulas_made += 1;
        }
    }

    let ids_json = serde_json::json!({
        "fields": field_ids.iter().map(|(k, v)| (k.to_string(), v.clone())).collect::<HashMap<_, _>>(),
        "sets": set_ids.iter().map(|(k, v)| (k.to_string(), v.clone())).collect::<HashMap<_, _>>(),
    })
    .to_string();

    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM project_rulesets WHERE project_id = ?1 AND ruleset_id = ?2 AND deleted_at IS NULL",
            params![project_id, ruleset_id],
            |r| r.get(0),
        )
        .optional()?;
    let id = match existing {
        Some(id) => {
            tx.execute(
                "UPDATE project_rulesets SET name = ?2, rules_json = ?3, ids_json = ?4, updated_at = ?5 WHERE id = ?1",
                params![id, ruleset.name, ruleset.definition_json, ids_json, now],
            )?;
            id
        }
        None => {
            let id = Uuid::now_v7().to_string();
            let position: i64 = tx.query_row(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM project_rulesets WHERE project_id = ?1 AND deleted_at IS NULL",
                [project_id],
                |r| r.get(0),
            )?;
            tx.execute(
                "INSERT INTO project_rulesets (id, project_id, ruleset_id, name, rules_json, ids_json, position, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                params![id, project_id, ruleset_id, ruleset.name, ruleset.definition_json, ids_json, position, now],
            )?;
            id
        }
    };
    let project_ruleset = tx.query_row(
        &format!("SELECT {PR_COLUMNS} FROM project_rulesets WHERE id = ?1"),
        [&id],
        project_ruleset_from_row,
    )?;
    tx.commit()?;
    Ok(ApplyResult { project_ruleset, fields_made, sets_made, formulas_made })
}

/// The rulesets a project uses, main one first.
pub fn list_for_project(conn: &Connection, project_id: &str) -> Result<Vec<ProjectRuleset>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PR_COLUMNS} FROM project_rulesets WHERE project_id = ?1 AND deleted_at IS NULL ORDER BY position, created_at"
    ))?;
    let rows = stmt.query_map([project_id], project_ruleset_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Stops a project using a ruleset. The properties, sets and formulas it made stay (pages may
/// hold values in them); the encounter rules go.
pub fn remove_from_project(conn: &Connection, project_ruleset_id: &str, now: i64) -> Result<(), DbError> {
    let changed = conn.execute(
        "UPDATE project_rulesets SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![project_ruleset_id, now],
    )?;
    if changed == 0 {
        return Err(DbError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, projects};

    fn bundle() -> RulesetBundle {
        RulesetBundle {
            fields: vec![
                BundleField { key: "hp".into(), name: "Hit points".into(), kind: "bar".into(), description: String::new(), config_json: r#"{"decimals":0}"#.into() },
                BundleField { key: "dex".into(), name: "Dexterity".into(), kind: "number".into(), description: String::new(), config_json: "{}".into() },
            ],
            sets: vec![BundleSet { key: "monster".into(), name: "Monster".into(), description: String::new(), field_keys: vec!["hp".into(), "dex".into()] }],
            formulas: vec![BundleFormula { name: "Attack".into(), notation: "1d20+5".into() }],
        }
    }

    fn setup() -> (Connection, String, String) {
        let conn = open_in_memory();
        let project = projects::create(&conn, "Test", 1).unwrap();
        let ruleset = create(&conn, "D20", "A d20 game", r#"{"version":1}"#, None, 2).unwrap();
        (conn, project.id, ruleset.id)
    }

    #[test]
    fn rulesets_are_created_listed_renamed_and_names_are_unique() {
        let (conn, _, id) = setup();
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert!(create(&conn, "d20", "", "{}", None, 3).is_err());
        assert!(create(&conn, "  ", "", "{}", None, 3).is_err());
        assert!(create(&conn, "Bad", "", "[1]", None, 3).is_err());
        assert!(create(&conn, "Bad", "", "not json", None, 3).is_err());
        let other = create(&conn, "Narrative", "", "{}", None, 3).unwrap();
        assert!(update(&conn, &other.id, "D20", "", "{}", 4).is_err());
        let changed = update(&conn, &id, "D20 (mine)", "x", r#"{"version":1,"a":1}"#, 5).unwrap();
        assert_eq!((changed.name.as_str(), changed.updated_at), ("D20 (mine)", 5));
    }

    #[test]
    fn deleting_restoring_and_purging() {
        let (conn, _, id) = setup();
        soft_delete(&conn, &id, 5).unwrap();
        assert!(list(&conn).unwrap().is_empty());
        assert_eq!(list_deleted(&conn).unwrap().len(), 1);
        assert!(get(&conn, &id).is_err());
        // Its name can be taken meanwhile; then restoring is refused.
        create(&conn, "D20", "", "{}", None, 6).unwrap();
        assert!(restore(&conn, &id, 7).is_err());
        assert!(purge(&conn, &list(&conn).unwrap()[0].id).is_err(), "a live ruleset can't be purged");
        purge(&conn, &id).unwrap();
        assert!(list_deleted(&conn).unwrap().is_empty());
    }

    #[test]
    fn applying_copies_properties_sets_and_formulas_into_the_project() {
        let (conn, project, ruleset) = setup();
        let result = apply(&conn, &project, &ruleset, &bundle(), 10).unwrap();
        assert_eq!((result.fields_made, result.sets_made, result.formulas_made), (2, 1, 1));
        assert_eq!(fields::list_definitions(&conn, &project).unwrap().len(), 2);
        let sets = fields::list_sets(&conn, &project).unwrap();
        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0].field_ids.len(), 2);
        assert_eq!(formulas::list(&conn, &project).unwrap().len(), 1);

        let ids: serde_json::Value = serde_json::from_str(&result.project_ruleset.ids_json).unwrap();
        assert_eq!(ids["sets"]["monster"], sets[0].id);
        assert!(ids["fields"]["hp"].is_string());
        assert_eq!(result.project_ruleset.rules_json, r#"{"version":1}"#);
        assert_eq!(list_for_project(&conn, &project).unwrap().len(), 1);
    }

    #[test]
    fn applying_again_makes_nothing_twice_and_refreshes_the_rules() {
        let (conn, project, ruleset) = setup();
        let first = apply(&conn, &project, &ruleset, &bundle(), 10).unwrap();
        update(&conn, &ruleset, "D20", "", r#"{"version":1,"changed":true}"#, 11).unwrap();
        let second = apply(&conn, &project, &ruleset, &bundle(), 12).unwrap();
        assert_eq!((second.fields_made, second.sets_made, second.formulas_made), (0, 0, 0));
        assert_eq!(second.project_ruleset.id, first.project_ruleset.id);
        assert!(second.project_ruleset.rules_json.contains("changed"));
        assert_eq!(list_for_project(&conn, &project).unwrap().len(), 1);
    }

    #[test]
    fn an_existing_property_of_the_same_name_is_used_unless_its_kind_differs() {
        let (conn, project, ruleset) = setup();
        let mine = fields::create_definition(&conn, &project, "Hit points", "bar", "mine", r#"{"decimals":1}"#, 5).unwrap();
        let result = apply(&conn, &project, &ruleset, &bundle(), 10).unwrap();
        assert_eq!(result.fields_made, 1);
        let ids: serde_json::Value = serde_json::from_str(&result.project_ruleset.ids_json).unwrap();
        assert_eq!(ids["fields"]["hp"], mine.id);

        let (conn, project, ruleset) = setup();
        fields::create_definition(&conn, &project, "Hit points", "text", "", "{}", 5).unwrap();
        assert!(apply(&conn, &project, &ruleset, &bundle(), 10).is_err());
        // Nothing was left behind by the refused apply.
        assert_eq!(fields::list_definitions(&conn, &project).unwrap().len(), 1);
        assert!(list_for_project(&conn, &project).unwrap().is_empty());
    }

    #[test]
    fn a_broken_bundle_changes_nothing() {
        let (conn, project, ruleset) = setup();
        let mut bad = bundle();
        bad.sets[0].field_keys.push("ghost".into());
        assert!(apply(&conn, &project, &ruleset, &bad, 10).is_err());
        let mut bad = bundle();
        bad.formulas[0].notation = "  ".into();
        assert!(apply(&conn, &project, &ruleset, &bad, 10).is_err());
        assert!(fields::list_definitions(&conn, &project).unwrap().is_empty());
        assert!(apply(&conn, "nope", &ruleset, &bundle(), 10).is_err());
    }

    #[test]
    fn the_projects_copy_survives_the_global_ruleset_being_deleted() {
        let (conn, project, ruleset) = setup();
        apply(&conn, &project, &ruleset, &bundle(), 10).unwrap();
        soft_delete(&conn, &ruleset, 11).unwrap();
        assert_eq!(list_for_project(&conn, &project).unwrap().len(), 1);
        purge(&conn, &ruleset).unwrap();
        let left = list_for_project(&conn, &project).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].ruleset_id, None);
        // Applying a ruleset that is gone is refused.
        assert!(apply(&conn, &project, &ruleset, &bundle(), 12).is_err());
    }

    #[test]
    fn removing_a_ruleset_from_a_project_keeps_its_properties() {
        let (conn, project, ruleset) = setup();
        let applied = apply(&conn, &project, &ruleset, &bundle(), 10).unwrap();
        remove_from_project(&conn, &applied.project_ruleset.id, 11).unwrap();
        assert!(list_for_project(&conn, &project).unwrap().is_empty());
        assert_eq!(fields::list_definitions(&conn, &project).unwrap().len(), 2);
        assert!(remove_from_project(&conn, &applied.project_ruleset.id, 12).is_err());
        // Picking it again brings the rules back without duplicating anything.
        let again = apply(&conn, &project, &ruleset, &bundle(), 13).unwrap();
        assert_eq!((again.fields_made, again.sets_made), (0, 0));
        assert_eq!(list_for_project(&conn, &project).unwrap().len(), 1);
    }

    #[test]
    fn several_rulesets_can_be_used_in_one_project() {
        let (conn, project, a) = setup();
        let b = create(&conn, "Ships", "", "{}", None, 3).unwrap();
        apply(&conn, &project, &a, &bundle(), 10).unwrap();
        let second_bundle = RulesetBundle { fields: vec![], sets: vec![], formulas: vec![] };
        apply(&conn, &project, &b.id, &second_bundle, 11).unwrap();
        let used = list_for_project(&conn, &project).unwrap();
        assert_eq!(used.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["D20", "Ships"]);
    }
}
