//! Templates: a template is a library item (library `worldbuilding`, type `template`) that is set
//! up like a document. Its text is the starter text, the field sets applied to it are the sets a
//! new document gets, the tags on it are the tags a new document gets, and the values it holds are
//! the default values. Nothing else is stored for it: it uses the same body, tags, field sets and
//! field values as every other item, so it also gets folders, search, trash and content packs.
//!
//! "New from template" *copies* all of that into a new document in one transaction. The new
//! document does not remember the template, so editing a template later never changes documents
//! made from it. The folder is chosen when the document is made (it is not part of a template).

use super::error::DbError;
use super::fields;
use super::items::{self, Item};
use super::links;
use super::tabs;
use rusqlite::{params, Connection};

pub const TEMPLATE_TYPE: &str = "template";
/// The library templates (and the documents made from them) live in.
pub const LIBRARY: &str = "worldbuilding";
/// The type of item a template makes.
pub const MADE_TYPE: &str = "document";

/// Copies what one item holds into another that was just made: the icon, the text (and the links
/// its mentions make), the tags, the field sets (in order), and the field values (a link field's
/// value makes its links). Anything deleted is not copied. Runs inside the caller's transaction.
fn copy_content(conn: &Connection, from: &Item, to_id: &str, now: i64) -> Result<(), DbError> {
    if from.icon.is_some() {
        conn.execute("UPDATE items SET icon = ?2 WHERE id = ?1", params![to_id, from.icon])?;
    }

    // The text, and the links its mentions make.
    conn.execute(
        "INSERT INTO document_content (item_id, body, created_at, updated_at)
         SELECT ?2, body, ?3, ?3 FROM document_content WHERE item_id = ?1",
        params![from.id, to_id, now],
    )?;
    let mentions: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT l.target_item_id FROM links l JOIN items t ON t.id = l.target_item_id
             WHERE l.source_item_id = ?1 AND l.source_ref = ?2 AND l.deleted_at IS NULL AND t.deleted_at IS NULL",
        )?;
        let rows = stmt.query_map(params![from.id, links::BODY], |r| r.get(0))?;
        rows.collect::<Result<_, _>>()?
    };
    links::sync_source(conn, to_id, links::BODY, &mentions, now)?;

    // The tags that still exist.
    conn.execute(
        "INSERT INTO item_tags (item_id, tag_id, created_at, updated_at)
         SELECT ?2, it.tag_id, ?3, ?3 FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id = ?1 AND it.deleted_at IS NULL AND t.deleted_at IS NULL",
        params![from.id, to_id, now],
    )?;

    // The field sets that still exist, in the order they were applied.
    conn.execute(
        "INSERT INTO item_field_sets (item_id, set_id, position, created_at, updated_at)
         SELECT ?2, a.set_id, a.position, ?3, ?3 FROM item_field_sets a JOIN field_sets s ON s.id = a.set_id
         WHERE a.item_id = ?1 AND a.deleted_at IS NULL AND s.deleted_at IS NULL",
        params![from.id, to_id, now],
    )?;

    // The values of fields that still exist (a link field's value makes its links).
    conn.execute(
        "INSERT INTO field_values (item_id, field_id, value_json, sort_num, sort_text, search_text, secret, created_at, updated_at)
         SELECT ?2, v.field_id, v.value_json, v.sort_num, v.sort_text, v.search_text, v.secret, ?3, ?3
         FROM field_values v JOIN field_definitions d ON d.id = v.field_id
         WHERE v.item_id = ?1 AND v.deleted_at IS NULL AND d.deleted_at IS NULL",
        params![from.id, to_id, now],
    )?;
    let link_values: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT v.field_id, v.value_json FROM field_values v JOIN field_definitions d ON d.id = v.field_id
             WHERE v.item_id = ?1 AND v.deleted_at IS NULL AND d.deleted_at IS NULL AND d.kind = 'link'",
        )?;
        let rows = stmt.query_map([to_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    for (field_id, value_json) in link_values {
        let targets: Vec<String> = serde_json::from_str(&value_json).unwrap_or_default();
        links::sync_source(conn, to_id, &fields::link_ref(&field_id), &targets, now)?;
    }
    Ok(())
}

/// Makes a new document from a template: the template's starter text (and the links its mentions
/// make), tags, applied field sets and default values (with their GM-only marks), and its tabs: each
/// nested document tab becomes a new document of its own with the same content, and each embed tab
/// is copied (what it shows, or an empty slot). All or nothing. `name` is the new document's name;
/// `folder_id` is where it goes (or none).
pub fn create_from(
    conn: &Connection,
    template_id: &str,
    name: &str,
    folder_id: Option<&str>,
    now: i64,
) -> Result<Item, DbError> {
    let template = items::get(conn, template_id)?;
    if template.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if template.library != LIBRARY || template.item_type != TEMPLATE_TYPE {
        return Err(DbError::Invalid("That item isn't a template."));
    }

    let tx = conn.unchecked_transaction()?;
    let made = items::create(&tx, &template.project_id, LIBRARY, MADE_TYPE, name, folder_id, now)?;
    copy_content(&tx, &template, &made.id, now)?;

    for tab in tabs::list_tabs(&tx, template_id)? {
        match (tab.kind.as_str(), tab.item) {
            ("document", Some(child)) => {
                let (_, copy) = tabs::insert_document_tab(&tx, &made, &child.name, now)?;
                copy_content(&tx, &child, &copy.id, now)?;
            }
            ("embed", target) => {
                // What it showed, if that still exists; otherwise an empty slot (named, so it can be filled).
                let shown_name = target.as_ref().map(|t| t.name.clone());
                let live = target.filter(|t| t.deleted_at.is_none());
                let title = if tab.title.is_empty() { shown_name.unwrap_or_else(|| "Empty slot".to_string()) } else { tab.title };
                tabs::insert_embed_tab(&tx, &made.id, &title, live.as_ref().map(|t| t.id.as_str()), now)?;
            }
            _ => {}
        }
    }

    tx.commit()?;
    items::get(conn, &made.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::documents;
    use crate::db::fields::{self, ValueIndex};
    use crate::db::{projects, folders, open_in_memory, search, tags};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn template(conn: &Connection, camp: &str, name: &str) -> Item {
        items::create(conn, camp, LIBRARY, TEMPLATE_TYPE, name, None, 2).unwrap()
    }

    fn text_index(t: &str) -> ValueIndex {
        ValueIndex { sort_num: None, sort_text: Some(t.to_lowercase()), search_text: t.to_string() }
    }

    fn count(conn: &Connection, sql: &str, id: &str) -> i64 {
        conn.query_row(sql, [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_template_holds_starter_text_like_a_document() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "NPC");
        documents::set_body(&conn, &t.id, "## Appearance\n\n## Motivation", 3).unwrap();
        assert_eq!(documents::get_body(&conn, &t.id).unwrap(), "## Appearance\n\n## Motivation");
        // ... and its text is searchable, so templates are found like anything else.
        assert_eq!(search::search(&conn, &camp, "motivation", None, 10).unwrap().len(), 1);
    }

    #[test]
    fn a_new_document_gets_the_text_tags_sets_and_default_values() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "NPC");
        conn.execute("UPDATE items SET icon = '🧙' WHERE id = ?1", [&t.id]).unwrap();
        documents::set_body(&conn, &t.id, "## Motivation\n\n", 3).unwrap();
        let villain = tags::create(&conn, &camp, None, "Villain", None, 3).unwrap();
        tags::add_to_item(&conn, &t.id, &villain.id, 4).unwrap();

        let race = fields::create_definition(&conn, &camp, "Race", "text", "", "{}", 5).unwrap();
        let status = fields::create_definition(&conn, &camp, "Status", "dropdown", "", r#"{"options":[{"id":"o1","label":"Alive","color":null}]}"#, 5).unwrap();
        let people = fields::create_set(&conn, &camp, "People", "", 5).unwrap();
        let combat = fields::create_set(&conn, &camp, "Combat", "", 5).unwrap();
        fields::apply_set(&conn, &t.id, &combat.id, 6).unwrap();
        fields::apply_set(&conn, &t.id, &people.id, 7).unwrap();
        fields::set_value(&conn, &t.id, &race.id, r#""Human""#, &text_index("Human"), true, 8).unwrap();
        fields::set_value(&conn, &t.id, &status.id, r#""o1""#, &ValueIndex { sort_num: Some(0.0), sort_text: Some("alive".into()), search_text: "Alive".into() }, false, 8).unwrap();

        let folder = folders::create(&conn, &camp, LIBRARY, None, "NPCs", 9).unwrap();
        let made = create_from(&conn, &t.id, " Ireena ", Some(&folder.id), 10).unwrap();

        assert_eq!((made.item_type.as_str(), made.library.as_str(), made.name.as_str()), ("document", "worldbuilding", "Ireena"));
        assert_eq!(made.folder_id.as_deref(), Some(folder.id.as_str()));
        assert_eq!(made.icon.as_deref(), Some("🧙"));
        assert_eq!(documents::get_body(&conn, &made.id).unwrap(), "## Motivation\n\n");
        let tag_names: Vec<String> = tags::for_item(&conn, &made.id).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(tag_names, ["Villain"]);
        // The sets come back in the order they were applied to the template.
        assert_eq!(fields::list_item_sets(&conn, &made.id).unwrap(), vec![combat.id.clone(), people.id.clone()]);
        let values = fields::get_item_fields(&conn, &made.id).unwrap().values;
        let by_name = |name: &str, id: &str| values.iter().find(|v| v.field_id == id).map(|v| (name.to_string(), v.value_json.clone(), v.secret));
        assert_eq!(by_name("Race", &race.id), Some(("Race".into(), "\"Human\"".into(), true)));
        assert_eq!(by_name("Status", &status.id), Some(("Status".into(), "\"o1\"".into(), false)));
        // The copied value is searchable text too, not just stored.
        let kept: String = conn.query_row("SELECT search_text FROM field_values WHERE item_id = ?1 AND field_id = ?2", params![made.id, race.id], |r| r.get(0)).unwrap();
        assert_eq!(kept, "Human");
    }

    #[test]
    fn the_template_itself_is_left_exactly_as_it_was() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "NPC");
        documents::set_body(&conn, &t.id, "text", 3).unwrap();
        let race = fields::create_definition(&conn, &camp, "Race", "text", "", "{}", 5).unwrap();
        fields::set_value(&conn, &t.id, &race.id, r#""Human""#, &text_index("Human"), false, 6).unwrap();
        let before = items::get(&conn, &t.id).unwrap().updated_at;
        let made = create_from(&conn, &t.id, "A", None, 10).unwrap();
        assert_eq!(items::get(&conn, &t.id).unwrap().updated_at, before);
        // Changing the new document never changes the template, and the other way round.
        fields::set_value(&conn, &made.id, &race.id, r#""Elf""#, &text_index("Elf"), false, 11).unwrap();
        documents::set_body(&conn, &t.id, "changed later", 12).unwrap();
        assert_eq!(fields::get_item_fields(&conn, &t.id).unwrap().values[0].value_json, "\"Human\"");
        assert_eq!(documents::get_body(&conn, &made.id).unwrap(), "text");
    }

    #[test]
    fn mentions_and_link_fields_in_a_template_make_links_for_the_new_document() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "Faction member");
        let hq = items::create(&conn, &camp, LIBRARY, "document", "Headquarters", None, 2).unwrap();
        let boss = items::create(&conn, &camp, LIBRARY, "document", "The Boss", None, 2).unwrap();
        documents::set_body_with_links(&conn, &t.id, "Based at [Headquarters]", Some(&[hq.id.clone()]), 3).unwrap();
        let reports = fields::create_definition(&conn, &camp, "Reports to", "link", "", r#"{"many":false,"library":null,"itemTypes":[]}"#, 4).unwrap();
        fields::set_value(&conn, &t.id, &reports.id, &format!("[\"{}\"]", boss.id), &ValueIndex::default(), false, 5).unwrap();

        let made = create_from(&conn, &t.id, "New member", None, 10).unwrap();
        let linked: Vec<String> = links::outgoing(&conn, &made.id).unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(linked, ["Headquarters", "The Boss"]);
        let refs: Vec<String> = conn.prepare("SELECT source_ref FROM links WHERE source_item_id = ?1 ORDER BY source_ref").unwrap()
            .query_map([&made.id], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(refs, vec!["body".to_string(), fields::link_ref(&reports.id)]);
        // Removing the new document's value later removes only its link, not the template's.
        fields::clear_value(&conn, &made.id, &reports.id, 11).unwrap();
        assert_eq!(links::outgoing(&conn, &t.id).unwrap().len(), 2);
    }

    #[test]
    fn what_no_longer_exists_is_not_copied() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "NPC");
        let old_tag = tags::create(&conn, &camp, None, "Old", None, 3).unwrap();
        let kept_tag = tags::create(&conn, &camp, None, "Kept", None, 3).unwrap();
        tags::add_to_item(&conn, &t.id, &old_tag.id, 4).unwrap();
        tags::add_to_item(&conn, &t.id, &kept_tag.id, 4).unwrap();
        tags::soft_delete(&conn, &old_tag.id, 5).unwrap();
        let gone = fields::create_definition(&conn, &camp, "Gone", "text", "", "{}", 5).unwrap();
        let cleared = fields::create_definition(&conn, &camp, "Cleared", "text", "", "{}", 5).unwrap();
        let live = fields::create_definition(&conn, &camp, "Live", "text", "", "{}", 5).unwrap();
        for f in [&gone, &cleared, &live] {
            fields::set_value(&conn, &t.id, &f.id, "\"x\"", &text_index("x"), false, 6).unwrap();
        }
        fields::clear_value(&conn, &t.id, &cleared.id, 7).unwrap();
        fields::delete_definition(&conn, &gone.id, 8).unwrap();
        let dead_set = fields::create_set(&conn, &camp, "Dead set", "", 5).unwrap();
        let live_set = fields::create_set(&conn, &camp, "Live set", "", 5).unwrap();
        fields::apply_set(&conn, &t.id, &dead_set.id, 6).unwrap();
        fields::apply_set(&conn, &t.id, &live_set.id, 6).unwrap();
        fields::delete_set(&conn, &dead_set.id, 9).unwrap();

        let made = create_from(&conn, &t.id, "A", None, 10).unwrap();
        let tag_names: Vec<String> = tags::for_item(&conn, &made.id).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(tag_names, ["Kept"]);
        assert_eq!(fields::list_item_sets(&conn, &made.id).unwrap(), vec![live_set.id.clone()]);
        let values: Vec<String> = fields::get_item_fields(&conn, &made.id).unwrap().values.into_iter().map(|v| v.field_id).collect();
        assert_eq!(values, vec![live.id.clone()]);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM field_values WHERE item_id = ?1", &made.id), 1);
    }

    #[test]
    fn an_empty_template_makes_an_empty_document() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "Blank");
        let made = create_from(&conn, &t.id, "Blank page", None, 10).unwrap();
        assert_eq!(documents::get_body(&conn, &made.id).unwrap(), "");
        assert!(tags::for_item(&conn, &made.id).unwrap().is_empty());
        assert!(fields::get_item_fields(&conn, &made.id).unwrap().values.is_empty());
    }

    #[test]
    fn a_failure_leaves_nothing_behind() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "NPC");
        documents::set_body(&conn, &t.id, "text", 3).unwrap();
        let items_before = count(&conn, "SELECT COUNT(*) FROM items WHERE project_id = ?1", &camp);
        // A blank name, a folder that doesn't exist, and a folder of another tool's library.
        assert!(matches!(create_from(&conn, &t.id, "  ", None, 10), Err(DbError::EmptyName)));
        assert!(matches!(create_from(&conn, &t.id, "A", Some("no-folder"), 10), Err(DbError::NotFound)));
        let wrong = folders::create(&conn, &camp, "cards", None, "Cards", 4).unwrap();
        assert!(matches!(create_from(&conn, &t.id, "A", Some(&wrong.id), 10), Err(DbError::Invalid(_))));
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM items WHERE project_id = ?1", &camp), items_before);
        let bodies: i64 = conn.query_row("SELECT COUNT(*) FROM document_content", [], |r| r.get(0)).unwrap();
        assert_eq!(bodies, 1); // only the template's own
    }

    #[test]
    fn a_new_document_gets_its_own_copies_of_the_templates_tabs() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "NPC");
        let deck = items::create(&conn, &camp, "cards", "deck", "Tarokka", None, 2).unwrap();
        let role = fields::create_definition(&conn, &camp, "Role", "text", "", "{}", 2).unwrap();
        let people = fields::create_set(&conn, &camp, "People", "", 2).unwrap();
        let tag = tags::create(&conn, &camp, None, "Relation", None, 2).unwrap();

        let rel = tabs::add_document_tab(&conn, &t.id, "Relationships", 3).unwrap().item.unwrap();
        documents::set_body(&conn, &rel.id, "## Allies", 3).unwrap();
        fields::apply_set(&conn, &rel.id, &people.id, 4).unwrap();
        fields::set_value(&conn, &rel.id, &role.id, r#""Friend""#, &text_index("Friend"), true, 4).unwrap();
        tags::add_to_item(&conn, &rel.id, &tag.id, 4).unwrap();
        tabs::add_embed_tab(&conn, &t.id, "Cards", Some(&deck.id), 5).unwrap();
        tabs::add_embed_tab(&conn, &t.id, "Hometown map", None, 6).unwrap();

        let made = create_from(&conn, &t.id, "Ireena", None, 10).unwrap();
        let copied = tabs::list_tabs(&conn, &made.id).unwrap();
        assert_eq!(copied.len(), 3);
        // A nested document: a new one, with the same content.
        let child = copied[0].item.as_ref().unwrap();
        assert_eq!((copied[0].kind.as_str(), child.name.as_str()), ("document", "Relationships"));
        assert_ne!(child.id, rel.id);
        assert_eq!(documents::get_body(&conn, &child.id).unwrap(), "## Allies");
        assert_eq!(fields::list_item_sets(&conn, &child.id).unwrap(), vec![people.id.clone()]);
        let value = fields::get_item_fields(&conn, &child.id).unwrap().values.remove(0);
        assert_eq!((value.value_json.as_str(), value.secret), ("\"Friend\"", true));
        let tag_names: Vec<String> = tags::for_item(&conn, &child.id).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(tag_names, ["Relation"]);
        // The embeds: the same item, and the empty slot with its name.
        assert_eq!(copied[1].item.as_ref().unwrap().id, deck.id);
        assert_eq!((copied[1].title.as_str(), copied[2].title.as_str(), copied[2].item.is_none()), ("Cards", "Hometown map", true));

        // The copies are independent of the template's, and hidden from the folders like any tab.
        documents::set_body(&conn, &child.id, "changed", 11).unwrap();
        assert_eq!(documents::get_body(&conn, &rel.id).unwrap(), "## Allies");
        assert_eq!(tabs::list_tabs(&conn, &t.id).unwrap().len(), 3);
        let top: Vec<String> = items::list(&conn, &camp, LIBRARY, None).unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(top, ["Ireena", "NPC"]);
    }

    #[test]
    fn removed_tabs_are_not_copied_and_a_gone_embed_becomes_an_empty_slot() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "Place");
        let gone = tabs::add_document_tab(&conn, &t.id, "Removed", 3).unwrap();
        tabs::remove_tab(&conn, &gone.id, 4).unwrap();
        let deck = items::create(&conn, &camp, "cards", "deck", "Tarokka", None, 2).unwrap();
        tabs::add_embed_tab(&conn, &t.id, "", Some(&deck.id), 5).unwrap(); // unnamed: shows the deck's name
        items::soft_delete(&conn, &deck.id, 6).unwrap();

        let made = create_from(&conn, &t.id, "Barovia", None, 10).unwrap();
        let copied = tabs::list_tabs(&conn, &made.id).unwrap();
        assert_eq!(copied.len(), 1);
        assert!(copied[0].item.is_none());
        assert_eq!(copied[0].title, "Tarokka"); // named after what it used to show, so it can be filled again
    }

    #[test]
    fn a_failed_copy_leaves_no_child_documents_behind() {
        let (conn, camp) = setup();
        let t = template(&conn, &camp, "NPC");
        tabs::add_document_tab(&conn, &t.id, "Relationships", 3).unwrap();
        let before: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert!(create_from(&conn, &t.id, " ", None, 10).is_err());
        assert!(create_from(&conn, &t.id, "A", Some("no-folder"), 10).is_err());
        let after: i64 = conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap();
        assert_eq!(before, after);
    }

    #[test]
    fn only_a_live_template_can_be_used() {
        let (conn, camp) = setup();
        let doc = items::create(&conn, &camp, LIBRARY, "document", "Just a document", None, 2).unwrap();
        assert!(matches!(create_from(&conn, &doc.id, "A", None, 10), Err(DbError::Invalid(_))));
        assert!(matches!(create_from(&conn, "nope", "A", None, 10), Err(DbError::NotFound)));
        let t = template(&conn, &camp, "NPC");
        items::soft_delete(&conn, &t.id, 5).unwrap();
        assert!(matches!(create_from(&conn, &t.id, "A", None, 10), Err(DbError::NotFound)));
    }
}
