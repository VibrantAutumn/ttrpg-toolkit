//! Starter templates: ready-made templates (with the fields and field sets they use) that come
//! with the app, added to a campaign in one all-or-nothing step, like the starter decks and tables.
//!
//! The app builds a "bundle" (plain data, see `TemplateBundle`) and this module writes it:
//! a folder holding the templates, each with its starter text, tags and applied field sets.
//! The templates carry `origin_pack_id = <bundle id>`, which is how "already added" is known.
//! Once added they are ordinary templates: edit, rename or delete them freely.
//!
//! Fields and field sets are shared by name across the campaign, so a starter that wants a field
//! or set that already exists *uses the existing one* (and leaves it as it is) instead of making
//! a second; the one exception is a field of the same name but another kind, which is refused
//! (it could not hold the starter's values).

use super::documents::MAX_BODY_BYTES;
use super::error::{clean_name, DbError};
use super::fields::{self, FieldDefinition};
use super::starters::{installed, BundleTag, ID_PREFIX};
use super::tabs;
use super::templates::{LIBRARY, TEMPLATE_TYPE};
use super::{campaigns, folders, items, tags};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const MAX_FIELDS: usize = 80;
const MAX_SETS: usize = 20;
const MAX_TEMPLATES: usize = 20;
const MAX_TAGS: usize = 40;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateBundle {
    /// e.g. `starter:templates`.
    pub id: String,
    /// Name of the folder the templates are put in.
    pub name: String,
    #[serde(default)]
    pub tags: Vec<BundleTag>,
    #[serde(default)]
    pub fields: Vec<BundleField>,
    #[serde(default)]
    pub sets: Vec<BundleSet>,
    pub templates: Vec<BundleTemplate>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleField {
    /// Unique inside the bundle; sets refer to fields by it.
    pub key: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub description: String,
    /// The kind's settings, as JSON text.
    #[serde(default = "empty_object")]
    pub config_json: String,
}

fn empty_object() -> String {
    "{}".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleSet {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Keys of the bundle's `fields`, in order.
    pub field_keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleTemplate {
    /// Unique inside the bundle; remembered as the item's `origin_item_id`.
    pub key: String,
    pub name: String,
    pub icon: Option<String>,
    /// The starter text (Markdown).
    #[serde(default)]
    pub body: String,
    /// Names of the bundle's `sets`, in the order they are applied.
    #[serde(default)]
    pub sets: Vec<String>,
    /// Names of the bundle's `tags`.
    #[serde(default)]
    pub tags: Vec<String>,
    /// The template's tabs, in order.
    #[serde(default)]
    pub tabs: Vec<BundleTab>,
}

/// A tab of a starter template: a nested document with starter text, or an empty embed slot.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleTab {
    /// `document` or `slot`.
    pub kind: String,
    /// The tab's name.
    pub title: String,
    /// A document tab's starter text (Markdown).
    #[serde(default)]
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInstallResult {
    pub folder_id: String,
    pub templates: u32,
    /// Fields and sets made new (the others already existed and were used as they were).
    pub fields_made: u32,
    pub sets_made: u32,
}

fn validate(bundle: &TemplateBundle) -> Result<(), DbError> {
    if !bundle.id.starts_with(ID_PREFIX) || bundle.id.len() > 64 {
        return Err(DbError::Invalid("That isn't a starter."));
    }
    clean_name(&bundle.name)?;
    if bundle.templates.is_empty() || bundle.templates.len() > MAX_TEMPLATES {
        return Err(DbError::Invalid("A starter needs between 1 and 20 templates."));
    }
    if bundle.fields.len() > MAX_FIELDS || bundle.sets.len() > MAX_SETS || bundle.tags.len() > MAX_TAGS {
        return Err(DbError::Invalid("That starter is too large."));
    }

    let mut tag_names = HashSet::new();
    for tag in &bundle.tags {
        clean_name(&tag.name)?;
        if !tag_names.insert(tag.name.trim().to_lowercase()) {
            return Err(DbError::Invalid("A starter's tags need different names."));
        }
    }

    let mut field_keys = HashSet::new();
    let mut field_names = HashSet::new();
    for field in &bundle.fields {
        clean_name(&field.name)?;
        if field.name.trim().chars().count() > fields::MAX_NAME_CHARS || field.description.chars().count() > fields::MAX_DESCRIPTION_CHARS {
            return Err(DbError::Invalid("A starter field's name or description is too long."));
        }
        if field.key.trim().is_empty() || !field_keys.insert(field.key.as_str()) {
            return Err(DbError::Invalid("Every starter field needs its own key."));
        }
        if !field_names.insert(field.name.trim().to_lowercase()) {
            return Err(DbError::Invalid("A starter's fields need different names."));
        }
        if !fields::KINDS.contains(&field.kind.as_str()) {
            return Err(DbError::Invalid("A starter field is of a kind that isn't known."));
        }
        fields::validate_config(&field.config_json)?;
    }

    let mut set_names = HashSet::new();
    for set in &bundle.sets {
        clean_name(&set.name)?;
        if !set_names.insert(set.name.trim().to_lowercase()) {
            return Err(DbError::Invalid("A starter's field sets need different names."));
        }
        let mut seen = HashSet::new();
        for key in &set.field_keys {
            if !field_keys.contains(key.as_str()) {
                return Err(DbError::Invalid("A starter field set uses a field the starter doesn't have."));
            }
            if !seen.insert(key.as_str()) {
                return Err(DbError::Invalid("A starter field set lists a field twice."));
            }
        }
    }

    let mut template_keys = HashSet::new();
    let mut template_names = HashSet::new();
    for template in &bundle.templates {
        clean_name(&template.name)?;
        if template.key.trim().is_empty() || !template_keys.insert(template.key.as_str()) {
            return Err(DbError::Invalid("Every starter template needs its own key."));
        }
        if !template_names.insert(template.name.trim().to_lowercase()) {
            return Err(DbError::Invalid("A starter's templates need different names."));
        }
        if template.body.len() > MAX_BODY_BYTES {
            return Err(DbError::Invalid("A starter template's text is too long."));
        }
        if template.sets.iter().any(|s| !set_names.contains(&s.trim().to_lowercase())) {
            return Err(DbError::Invalid("A starter template uses a field set the starter doesn't have."));
        }
        if template.tags.iter().any(|t| !tag_names.contains(&t.trim().to_lowercase())) {
            return Err(DbError::Invalid("A starter template uses a tag the starter doesn't define."));
        }
        if template.tabs.len() > tabs::MAX_TABS {
            return Err(DbError::Invalid("A starter template has too many tabs."));
        }
        for tab in &template.tabs {
            clean_name(&tab.title)?;
            if tab.title.trim().chars().count() > tabs::MAX_TITLE_CHARS || tab.body.len() > MAX_BODY_BYTES {
                return Err(DbError::Invalid("A starter template's tab is too long."));
            }
            if tab.kind != "document" && tab.kind != "slot" {
                return Err(DbError::Invalid("A starter template has a tab of a kind that isn't known."));
            }
        }
    }
    Ok(())
}

/// Puts the bundle into the campaign. All or nothing: a failure part-way leaves the campaign
/// exactly as it was. Refuses if this starter is already there, if a template with one of its
/// names exists, or if a field of one of its names exists with a different kind.
pub fn install(conn: &Connection, campaign_id: &str, bundle: &TemplateBundle, now: i64) -> Result<TemplateInstallResult, DbError> {
    campaigns::require_live(conn, campaign_id)?;
    validate(bundle)?;
    if installed(conn, campaign_id)?.contains(&bundle.id) {
        return Err(DbError::Invalid("That starter has already been added to this campaign."));
    }
    for template in &bundle.templates {
        let taken: i64 = conn.query_row(
            "SELECT COUNT(*) FROM items
             WHERE campaign_id = ?1 AND library = ?2 AND item_type = ?3 AND deleted_at IS NULL AND name = ?4 COLLATE NOCASE",
            params![campaign_id, LIBRARY, TEMPLATE_TYPE, template.name.trim()],
            |r| r.get(0),
        )?;
        if taken > 0 {
            return Err(DbError::Invalid(
                "A template with the same name as one in this starter already exists. Rename or delete it first.",
            ));
        }
    }
    let existing_fields: Vec<FieldDefinition> = fields::list_definitions(conn, campaign_id)?;
    for field in &bundle.fields {
        if let Some(found) = existing_fields.iter().find(|d| d.name.eq_ignore_ascii_case(field.name.trim())) {
            if found.kind != field.kind {
                return Err(DbError::Invalid(
                    "A field with the same name as one in this starter already exists, but it is a different kind of field. Rename it first.",
                ));
            }
        }
    }

    // One transaction makes everything from here on all-or-nothing. (Direct inserts below, not
    // helpers that open their own transaction: those can't nest.)
    let tx = conn.unchecked_transaction()?;

    // Tags: reuse a top-level tag with the same name.
    let existing_tags = tags::list(&tx, campaign_id)?;
    let mut tag_ids: HashMap<String, String> = HashMap::new();
    for tag in &bundle.tags {
        let found = existing_tags.iter().find(|t| t.parent_id.is_none() && t.name.eq_ignore_ascii_case(tag.name.trim()));
        let id = match found {
            Some(t) => t.id.clone(),
            None => tags::create(&tx, campaign_id, None, &tag.name, tag.color.as_deref(), now)?.id,
        };
        tag_ids.insert(tag.name.trim().to_lowercase(), id);
    }

    // Fields: use the existing one of that name, or make it.
    let mut field_ids: HashMap<&str, String> = HashMap::new();
    let mut fields_made = 0;
    for field in &bundle.fields {
        let id = match existing_fields.iter().find(|d| d.name.eq_ignore_ascii_case(field.name.trim())) {
            Some(found) => found.id.clone(),
            None => {
                fields_made += 1;
                fields::create_definition(&tx, campaign_id, &field.name, &field.kind, &field.description, &field.config_json, now)?.id
            }
        };
        field_ids.insert(field.key.as_str(), id);
    }

    // Sets: use the existing one of that name (as the person has it), or make it.
    let existing_sets = fields::list_sets(&tx, campaign_id)?;
    let mut set_ids: HashMap<String, String> = HashMap::new();
    let mut sets_made = 0;
    for set in &bundle.sets {
        let id = match existing_sets.iter().find(|s| s.name.eq_ignore_ascii_case(set.name.trim())) {
            Some(found) => found.id.clone(),
            None => {
                sets_made += 1;
                let made = fields::create_set(&tx, campaign_id, &set.name, &set.description, now)?;
                for (position, key) in set.field_keys.iter().enumerate() {
                    tx.execute(
                        "INSERT INTO field_set_members (set_id, field_id, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                        params![made.id, field_ids[key.as_str()], position as i64, now],
                    )?;
                }
                made.id
            }
        };
        set_ids.insert(set.name.trim().to_lowercase(), id);
    }

    let folder = folders::create(&tx, campaign_id, LIBRARY, None, &bundle.name, now)?;
    for template in &bundle.templates {
        let item = items::create(&tx, campaign_id, LIBRARY, TEMPLATE_TYPE, &template.name, Some(&folder.id), now)?;
        tx.execute(
            "UPDATE items SET origin_pack_id = ?2, origin_item_id = ?3, icon = ?4 WHERE id = ?1",
            params![item.id, bundle.id, template.key, template.icon],
        )?;
        if !template.body.is_empty() {
            tx.execute(
                "INSERT INTO document_content (item_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                params![item.id, template.body, now],
            )?;
        }
        for tag in &template.tags {
            tx.execute(
                "INSERT OR IGNORE INTO item_tags (item_id, tag_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                params![item.id, tag_ids[&tag.trim().to_lowercase()], now],
            )?;
        }
        for (position, set) in template.sets.iter().enumerate() {
            tx.execute(
                "INSERT OR IGNORE INTO item_field_sets (item_id, set_id, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![item.id, set_ids[&set.trim().to_lowercase()], position as i64, now],
            )?;
        }
        for tab in &template.tabs {
            if tab.kind == "document" {
                let (_, child) = tabs::insert_document_tab(&tx, &item, tab.title.trim(), now)?;
                if !tab.body.is_empty() {
                    tx.execute(
                        "INSERT INTO document_content (item_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                        params![child.id, tab.body, now],
                    )?;
                }
            } else {
                tabs::insert_embed_tab(&tx, &item.id, tab.title.trim(), None, now)?;
            }
        }
    }

    tx.commit()?;
    Ok(TemplateInstallResult {
        folder_id: folder.id,
        templates: bundle.templates.len() as u32,
        fields_made,
        sets_made,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::templates;
    use crate::db::{documents, open_in_memory, search};

    fn field(key: &str, name: &str, kind: &str, config: &str) -> BundleField {
        BundleField { key: key.into(), name: name.into(), kind: kind.into(), description: String::new(), config_json: config.into() }
    }

    fn bundle() -> TemplateBundle {
        TemplateBundle {
            id: "starter:test-templates".into(),
            name: "Templates".into(),
            tags: vec![BundleTag { name: "NPC".into(), color: Some("#1971c2".into()) }],
            fields: vec![
                field("role", "Role", "text", "{}"),
                field("status", "Status", "dropdown", r#"{"options":[{"id":"alive","label":"Alive","color":null},{"id":"dead","label":"Dead","color":null}]}"#),
                field("home", "Home", "link", r#"{"many":false,"library":null,"itemTypes":[]}"#),
            ],
            sets: vec![BundleSet { name: "NPC".into(), description: "People".into(), field_keys: vec!["role".into(), "status".into(), "home".into()] }],
            templates: vec![
                BundleTemplate {
                    key: "npc".into(),
                    name: "NPC".into(),
                    icon: Some("🧙".into()),
                    body: "## Appearance\n\n## Motivation".into(),
                    sets: vec!["NPC".into()],
                    tags: vec!["NPC".into()],
                    tabs: vec![
                        BundleTab { kind: "document".into(), title: "Relationships".into(), body: "## Allies".into() },
                        BundleTab { kind: "slot".into(), title: "Map".into(), body: String::new() },
                    ],
                },
                BundleTemplate { key: "blank".into(), name: "Blank".into(), icon: None, body: String::new(), sets: vec![], tags: vec![], tabs: vec![] },
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
    fn installing_makes_a_folder_of_templates_with_their_text_tags_and_sets() {
        let (conn, camp) = setup();
        let result = install(&conn, &camp, &bundle(), 10).unwrap();
        assert_eq!((result.templates, result.fields_made, result.sets_made), (2, 3, 1));

        let folder = folders::get(&conn, &result.folder_id).unwrap();
        assert_eq!((folder.name.as_str(), folder.library.as_str()), ("Templates", "worldbuilding"));
        let in_folder = items::list(&conn, &camp, "worldbuilding", Some(&result.folder_id)).unwrap();
        assert_eq!(in_folder.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["Blank", "NPC"]);
        assert!(in_folder.iter().all(|i| i.item_type == "template"));

        let npc = in_folder.iter().find(|i| i.name == "NPC").unwrap();
        assert_eq!(npc.icon.as_deref(), Some("🧙"));
        assert_eq!(documents::get_body(&conn, &npc.id).unwrap(), "## Appearance\n\n## Motivation");
        let tag_names: Vec<String> = tags::for_item(&conn, &npc.id).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(tag_names, ["NPC"]);
        let sets = fields::list_sets(&conn, &camp).unwrap();
        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0].field_ids.len(), 3);
        assert_eq!(fields::list_item_sets(&conn, &npc.id).unwrap(), vec![sets[0].id.clone()]);
        // Found by search like any template.
        assert_eq!(search::search(&conn, &camp, "motivation", None, 10).unwrap().len(), 1);
    }

    #[test]
    fn a_starter_templates_tabs_come_with_it_and_into_documents_made_from_it() {
        let (conn, camp) = setup();
        let result = install(&conn, &camp, &bundle(), 10).unwrap();
        let npc = items::list(&conn, &camp, "worldbuilding", Some(&result.folder_id)).unwrap().into_iter().find(|i| i.name == "NPC").unwrap();
        let on_template = tabs::list_tabs(&conn, &npc.id).unwrap();
        assert_eq!(on_template.iter().map(|t| t.kind.as_str()).collect::<Vec<_>>(), ["document", "embed"]);
        assert_eq!(documents::get_body(&conn, &on_template[0].item.as_ref().unwrap().id).unwrap(), "## Allies");
        assert!(on_template[1].item.is_none());
        // The nested document is not listed beside the templates in their folder.
        let listed: Vec<String> = items::list(&conn, &camp, "worldbuilding", Some(&result.folder_id)).unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(listed, ["Blank", "NPC"]);

        let made = templates::create_from(&conn, &npc.id, "Ireena", None, 20).unwrap();
        let tabs_made = tabs::list_tabs(&conn, &made.id).unwrap();
        assert_eq!(tabs_made.len(), 2);
        assert_eq!(tabs_made[0].item.as_ref().unwrap().name, "Relationships");
        assert_eq!((tabs_made[1].title.as_str(), tabs_made[1].item.is_none()), ("Map", true));
    }

    #[test]
    fn a_document_made_from_a_starter_template_has_its_fields_ready() {
        let (conn, camp) = setup();
        let result = install(&conn, &camp, &bundle(), 10).unwrap();
        let npc = items::list(&conn, &camp, "worldbuilding", Some(&result.folder_id)).unwrap().into_iter().find(|i| i.name == "NPC").unwrap();
        let made = templates::create_from(&conn, &npc.id, "Ireena", None, 20).unwrap();
        let sets = fields::list_sets(&conn, &camp).unwrap();
        assert_eq!(fields::list_item_sets(&conn, &made.id).unwrap(), vec![sets[0].id.clone()]);
        assert_eq!(documents::get_body(&conn, &made.id).unwrap(), "## Appearance\n\n## Motivation");
    }

    #[test]
    fn the_templates_remember_where_they_came_from_so_it_is_not_added_twice() {
        let (conn, camp) = setup();
        install(&conn, &camp, &bundle(), 10).unwrap();
        assert_eq!(installed(&conn, &camp).unwrap(), vec!["starter:test-templates".to_string()]);
        assert!(matches!(install(&conn, &camp, &bundle(), 11), Err(DbError::Invalid(_))));
        assert_eq!(count(&conn, "field_definitions"), 3);
    }

    #[test]
    fn existing_fields_sets_and_tags_are_used_as_they_are() {
        let (conn, camp) = setup();
        let mine = fields::create_definition(&conn, &camp, "role", "text", "My own", r#"{"multiline":true}"#, 2).unwrap();
        let my_set = fields::create_set(&conn, &camp, "npc", "Mine", 2).unwrap();
        fields::set_set_fields(&conn, &my_set.id, &[mine.id.clone()], 3).unwrap();
        tags::create(&conn, &camp, None, "npc", Some("#ff0000"), 4).unwrap();

        let result = install(&conn, &camp, &bundle(), 10).unwrap();
        assert_eq!((result.fields_made, result.sets_made), (2, 0)); // Status and Home are new; Role and the NPC set were used
        assert_eq!(fields::list_definitions(&conn, &camp).unwrap().len(), 3);
        let still = fields::list_definitions(&conn, &camp).unwrap().into_iter().find(|d| d.id == mine.id).unwrap();
        assert_eq!((still.description.as_str(), still.config_json.as_str()), ("My own", r#"{"multiline":true}"#));
        // The person's own set is unchanged, and the template uses it.
        let sets = fields::list_sets(&conn, &camp).unwrap();
        assert_eq!(sets.len(), 1);
        assert_eq!(sets[0].field_ids, vec![mine.id.clone()]);
        let npc = items::list(&conn, &camp, "worldbuilding", Some(&result.folder_id)).unwrap().into_iter().find(|i| i.name == "NPC").unwrap();
        assert_eq!(fields::list_item_sets(&conn, &npc.id).unwrap(), vec![my_set.id.clone()]);
        assert_eq!(tags::list(&conn, &camp).unwrap().len(), 1);
    }

    #[test]
    fn a_clash_is_refused_and_leaves_nothing_behind() {
        let (conn, camp) = setup();
        fields::create_definition(&conn, &camp, "Home", "text", "", "{}", 2).unwrap(); // same name, other kind
        let before = (count(&conn, "items"), count(&conn, "field_definitions"), count(&conn, "folders"), count(&conn, "tags"));
        assert!(matches!(install(&conn, &camp, &bundle(), 10), Err(DbError::Invalid(_))));
        assert_eq!((count(&conn, "items"), count(&conn, "field_definitions"), count(&conn, "folders"), count(&conn, "tags")), before);

        let (conn, camp) = setup();
        items::create(&conn, &camp, "worldbuilding", "template", "npc", None, 2).unwrap(); // a template with the name
        assert!(matches!(install(&conn, &camp, &bundle(), 10), Err(DbError::Invalid(_))));
        assert_eq!(count(&conn, "field_definitions"), 0);
    }

    #[test]
    fn a_bundle_that_does_not_hold_together_is_refused_before_anything_is_written() {
        let (conn, camp) = setup();
        let mut cases: Vec<TemplateBundle> = Vec::new();
        let mut b = bundle();
        b.id = "no-prefix".into();
        cases.push(b);
        let mut b = bundle();
        b.sets[0].field_keys.push("nope".into());
        cases.push(b);
        let mut b = bundle();
        b.templates[0].sets = vec!["Nope".into()];
        cases.push(b);
        let mut b = bundle();
        b.templates[0].tags = vec!["Nope".into()];
        cases.push(b);
        let mut b = bundle();
        b.fields[0].kind = "date".into();
        cases.push(b);
        let mut b = bundle();
        b.fields[0].config_json = "[1]".into();
        cases.push(b);
        let mut b = bundle();
        b.templates[1].name = "nPc".into();
        cases.push(b);
        let mut b = bundle();
        b.fields[1].name = "role".into();
        cases.push(b);
        let mut b = bundle();
        b.templates[0].body = "x".repeat(MAX_BODY_BYTES + 1);
        cases.push(b);
        let mut b = bundle();
        b.templates.clear();
        cases.push(b);
        for (i, case) in cases.iter().enumerate() {
            assert!(matches!(install(&conn, &camp, case, 10), Err(DbError::Invalid(_))), "case {i}");
        }
        assert_eq!(count(&conn, "items"), 0);
        assert_eq!(count(&conn, "field_definitions"), 0);
    }

    /// The file the app's TypeScript writes for its real starter templates (a test in
    /// src/lib/templates/starterTemplates.test.ts keeps it up to date): the database must accept it.
    #[test]
    fn the_real_starter_templates_install_and_make_documents_with_their_fields() {
        let (conn, camp) = setup();
        let bundle: TemplateBundle = serde_json::from_str(include_str!("../../tests/fixtures/starter_templates_core.json")).unwrap();
        let result = install(&conn, &camp, &bundle, 10).unwrap();
        assert_eq!((result.templates, result.sets_made), (6, 6));
        assert_eq!(result.fields_made as usize, bundle.fields.len());
        let made = items::list(&conn, &camp, "worldbuilding", Some(&result.folder_id)).unwrap();
        let names: Vec<&str> = made.iter().map(|i| i.name.as_str()).collect();
        assert_eq!(names, ["Faction", "Item", "Location", "NPC", "Quest", "Session"]);

        // A new NPC has the NPC set with its seven fields, the NPC tag, and the starter headings.
        let npc = made.iter().find(|i| i.name == "NPC").unwrap();
        let doc = templates::create_from(&conn, &npc.id, "Ireena", None, 20).unwrap();
        let sets = fields::list_item_sets(&conn, &doc.id).unwrap();
        assert_eq!(sets.len(), 1);
        let set = fields::list_sets(&conn, &camp).unwrap().into_iter().find(|s| s.id == sets[0]).unwrap();
        assert_eq!((set.name.as_str(), set.field_ids.len()), ("NPC", 7));
        assert!(documents::get_body(&conn, &doc.id).unwrap().starts_with("## Appearance"));
        let tag_names: Vec<String> = tags::for_item(&conn, &doc.id).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(tag_names, ["NPC"]);

        // NPC comes with a Relationships document tab and Location with an empty Map slot, and a new NPC gets its own.
        let on_npc = tabs::list_tabs(&conn, &npc.id).unwrap();
        assert_eq!(on_npc.iter().map(|t| t.kind.as_str()).collect::<Vec<_>>(), ["document"]);
        assert_eq!(on_npc[0].item.as_ref().unwrap().name, "Relationships");
        let location = made.iter().find(|i| i.name == "Location").unwrap();
        let slots = tabs::list_tabs(&conn, &location.id).unwrap();
        assert_eq!((slots.len(), slots[0].title.as_str(), slots[0].item.is_none()), (1, "Map", true));
        assert_eq!(tabs::list_tabs(&conn, &doc.id).unwrap().len(), 1);

        // Adding them twice is refused, and nothing changes.
        assert!(matches!(install(&conn, &camp, &bundle, 11), Err(DbError::Invalid(_))));
        assert_eq!(count(&conn, "field_definitions") as usize, bundle.fields.len());
    }

    #[test]
    fn a_missing_campaign_is_refused() {
        let (conn, _) = setup();
        assert!(matches!(install(&conn, "nope", &bundle(), 10), Err(DbError::NotFound)));
    }
}
