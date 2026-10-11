//! Tabs: a page (a document or template) can have tabs under its title. A tab is either a nested
//! **document** (a real document item of its own, shown as a tab of the page, with its own text,
//! fields, tags and links) or an **embed** (a live view of any other item, or an empty slot waiting
//! to be filled). See migration 0020.
//!
//! A child document is hidden from the library's folder lists (it lives in its page) but is found
//! by search and links; the app resolves it to its page with `family_of`. Tabs go one level deep.
//! Removing a document tab trashes the child document, and restoring it brings the tab back at the
//! same place. Triggers in the migration keep a page and its child documents together through
//! trash, restore and purge, whichever way the page got there.

use super::documents;
use super::error::{clean_name, DbError};
use super::items::{self, Item};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use uuid::Uuid;

pub const MAX_TABS: usize = 12;
pub const MAX_TITLE_CHARS: usize = 60;
/// The type of item a document tab holds.
pub const CHILD_TYPE: &str = "document";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: String,
    pub parent_id: String,
    /// `document` or `embed`.
    pub kind: String,
    pub position: i64,
    /// An embed tab's name (a document tab is named by its document).
    pub title: String,
    /// A document tab's document, or an embed tab's item (which may be in the trash); none for an
    /// empty embed slot.
    pub item: Option<Item>,
}

/// Where a child document lives: its page, and which tab it is.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Family {
    pub parent: Item,
    pub tab_id: String,
}

fn live_item(conn: &Connection, id: &str) -> Result<Item, DbError> {
    let item = items::get(conn, id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    Ok(item)
}

/// The page this item is a document tab of, if any.
pub fn family_of(conn: &Connection, item_id: &str) -> Result<Option<Family>, DbError> {
    let found: Option<(String, String)> = conn
        .query_row(
            "SELECT id, parent_id FROM item_tabs WHERE child_id = ?1 AND kind = 'document'",
            [item_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match found {
        Some((tab_id, parent_id)) => Ok(Some(Family { parent: items::get(conn, &parent_id)?, tab_id })),
        None => Ok(None),
    }
}

/// A page can have tabs if it holds text (a document or a template) and is not itself a tab.
fn require_page(conn: &Connection, parent_id: &str) -> Result<Item, DbError> {
    let parent = live_item(conn, parent_id)?;
    if !documents::holds_text(&parent.item_type) {
        return Err(DbError::Invalid("Only a page (a document, template or session) can have tabs."));
    }
    if family_of(conn, parent_id)?.is_some() {
        return Err(DbError::Invalid("A tab can't have tabs of its own."));
    }
    Ok(parent)
}

/// The tabs of a page, in order. A document tab whose document is in the trash is left out until
/// it is restored; an embed tab whose item is in the trash is kept (it shows that the item is).
pub fn list_tabs(conn: &Connection, parent_id: &str) -> Result<Vec<Tab>, DbError> {
    let rows: Vec<(String, String, i64, String, Option<String>, Option<String>)> = {
        let mut stmt = conn.prepare(
            "SELECT id, kind, position, title, child_id, target_id FROM item_tabs
             WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY position, created_at",
        )?;
        let mapped = stmt.query_map([parent_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?;
        mapped.collect::<Result<_, _>>()?
    };
    let mut tabs = Vec::new();
    for (id, kind, position, title, child_id, target_id) in rows {
        let item = match child_id.or(target_id) {
            Some(item_id) => items::get(conn, &item_id).ok(),
            None => None,
        };
        if kind == "document" && item.as_ref().is_none_or(|i| i.deleted_at.is_some()) {
            continue;
        }
        tabs.push(Tab { id, parent_id: parent_id.to_string(), kind, position, title, item });
    }
    Ok(tabs)
}

fn next_position(conn: &Connection, parent_id: &str) -> Result<i64, DbError> {
    Ok(conn.query_row("SELECT COALESCE(MAX(position), -1) + 1 FROM item_tabs WHERE parent_id = ?1", [parent_id], |r| r.get(0))?)
}

fn require_room(conn: &Connection, parent_id: &str) -> Result<(), DbError> {
    if list_tabs(conn, parent_id)?.len() >= MAX_TABS {
        return Err(DbError::Invalid("A page can have at most 12 tabs."));
    }
    Ok(())
}

fn tab_by_id(conn: &Connection, tab_id: &str) -> Result<Tab, DbError> {
    let parent_id: String = conn
        .query_row("SELECT parent_id FROM item_tabs WHERE id = ?1 AND deleted_at IS NULL", [tab_id], |r| r.get(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
            other => other.into(),
        })?;
    list_tabs(conn, &parent_id)?.into_iter().find(|t| t.id == tab_id).ok_or(DbError::NotFound)
}

/// Adds a nested document as a new last tab: a new document of the given name, in the page's
/// library, that lives inside the page.
pub fn add_document_tab(conn: &Connection, parent_id: &str, name: &str, now: i64) -> Result<Tab, DbError> {
    let name = clean_name(name)?;
    let parent = require_page(conn, parent_id)?;
    require_room(conn, parent_id)?;
    let tx = conn.unchecked_transaction()?;
    let (id, _) = insert_document_tab(&tx, &parent, name, now)?;
    tx.commit()?;
    tab_by_id(conn, &id)
}

/// Makes a nested document and its tab, with no checks and no transaction of its own (for callers
/// that have done their checks and are already in one). Returns the tab's id and the new document.
pub(super) fn insert_document_tab(conn: &Connection, parent: &Item, name: &str, now: i64) -> Result<(String, Item), DbError> {
    let child = items::create(conn, &parent.project_id, &parent.library, CHILD_TYPE, name, None, now)?;
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO item_tabs (id, parent_id, kind, position, child_id, created_at, updated_at)
         VALUES (?1, ?2, 'document', ?3, ?4, ?5, ?5)",
        params![id, parent.id, next_position(conn, &parent.id)?, child.id, now],
    )?;
    Ok((id, child))
}

/// Adds an embed tab with no checks and no transaction of its own (see `insert_document_tab`).
pub(super) fn insert_embed_tab(conn: &Connection, parent_id: &str, title: &str, target_id: Option<&str>, now: i64) -> Result<String, DbError> {
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO item_tabs (id, parent_id, kind, position, target_id, title, created_at, updated_at)
         VALUES (?1, ?2, 'embed', ?3, ?4, ?5, ?6, ?6)",
        params![id, parent_id, next_position(conn, parent_id)?, target_id, title, now],
    )?;
    Ok(id)
}

/// Checks an embed's target: a live item of the page's project, and not the page itself.
fn check_target(conn: &Connection, parent: &Item, target_id: Option<&str>) -> Result<(), DbError> {
    let Some(target_id) = target_id else { return Ok(()) };
    let target = live_item(conn, target_id)?;
    if target.project_id != parent.project_id {
        return Err(DbError::Invalid("That item is in a different project."));
    }
    if target.id == parent.id {
        return Err(DbError::Invalid("A page can't be embedded in itself."));
    }
    Ok(())
}

fn clean_title(title: &str) -> Result<String, DbError> {
    let title = title.trim();
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(DbError::Invalid("A tab's name can be at most 60 characters."));
    }
    Ok(title.to_string())
}

/// Adds an embed as a new last tab: a live view of `target_id`, or an empty slot (`None`) to be
/// filled later. `title` names the tab (when blank, the embedded item's name is shown).
pub fn add_embed_tab(conn: &Connection, parent_id: &str, title: &str, target_id: Option<&str>, now: i64) -> Result<Tab, DbError> {
    let title = clean_title(title)?;
    let parent = require_page(conn, parent_id)?;
    require_room(conn, parent_id)?;
    check_target(conn, &parent, target_id)?;
    if title.is_empty() && target_id.is_none() {
        return Err(DbError::Invalid("Give the empty slot a name, so you know what to put in it."));
    }
    let id = insert_embed_tab(conn, parent_id, &title, target_id, now)?;
    tab_by_id(conn, &id)
}

/// Changes an embed tab's name and what it shows (`None` empties the slot).
pub fn update_embed_tab(conn: &Connection, tab_id: &str, title: &str, target_id: Option<&str>, now: i64) -> Result<Tab, DbError> {
    let title = clean_title(title)?;
    let tab = tab_by_id(conn, tab_id)?;
    if tab.kind != "embed" {
        return Err(DbError::Invalid("Only an embed tab can be changed this way."));
    }
    let parent = live_item(conn, &tab.parent_id)?;
    check_target(conn, &parent, target_id)?;
    if title.is_empty() && target_id.is_none() {
        return Err(DbError::Invalid("Give the empty slot a name, so you know what to put in it."));
    }
    conn.execute(
        "UPDATE item_tabs SET title = ?2, target_id = ?3, updated_at = ?4 WHERE id = ?1",
        params![tab_id, title, target_id, now],
    )?;
    tab_by_id(conn, tab_id)
}

/// Removes a tab. An embed tab just goes. A document tab's document goes to the trash (restore it
/// there and the tab comes back where it was).
pub fn remove_tab(conn: &Connection, tab_id: &str, now: i64) -> Result<(), DbError> {
    let tab = tab_by_id(conn, tab_id)?;
    match (tab.kind.as_str(), tab.item) {
        ("document", Some(child)) => items::soft_delete(conn, &child.id, now),
        _ => {
            conn.execute("UPDATE item_tabs SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1", params![tab_id, now])?;
            Ok(())
        }
    }
}

/// Moves a tab one place earlier (`delta` negative) or later (positive); at the ends it stays put.
pub fn move_tab(conn: &Connection, tab_id: &str, delta: i64, now: i64) -> Result<(), DbError> {
    let tab = tab_by_id(conn, tab_id)?;
    let mut order: Vec<String> = list_tabs(conn, &tab.parent_id)?.into_iter().map(|t| t.id).collect();
    let from = order.iter().position(|id| id == tab_id).ok_or(DbError::NotFound)?;
    let to = from as i64 + delta;
    if to < 0 || to >= order.len() as i64 {
        return Ok(());
    }
    let moved = order.remove(from);
    order.insert(to as usize, moved);
    let tx = conn.unchecked_transaction()?;
    for (position, id) in order.iter().enumerate() {
        tx.execute("UPDATE item_tabs SET position = ?2, updated_at = ?3 WHERE id = ?1", params![id, position as i64, now])?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{projects, folders, open_in_memory, search, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = projects::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn doc(conn: &Connection, camp: &str, name: &str) -> Item {
        items::create(conn, camp, "worldbuilding", "document", name, None, 1).unwrap()
    }

    fn titles(conn: &Connection, parent: &str) -> Vec<String> {
        list_tabs(conn, parent)
            .unwrap()
            .into_iter()
            .map(|t| if t.title.is_empty() { t.item.map(|i| i.name).unwrap_or_default() } else { t.title })
            .collect()
    }

    fn item_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).unwrap()
    }

    // ------------------------------------------------ document tabs

    #[test]
    fn a_document_tab_is_a_real_document_hidden_from_the_folder_lists_but_found_by_search() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        let tab = add_document_tab(&conn, &strahd.id, "  Relationships ", 2).unwrap();
        assert_eq!(tab.kind, "document");
        let child = tab.item.unwrap();
        assert_eq!((child.name.as_str(), child.item_type.as_str(), child.library.as_str()), ("Relationships", "document", "worldbuilding"));
        assert_eq!(child.folder_id, None);

        let top: Vec<String> = items::list(&conn, &camp, "worldbuilding", None).unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(top, ["Strahd"]); // the child is not listed beside its page
        assert_eq!(items::list_of_type(&conn, &camp, "worldbuilding", "document").unwrap().len(), 1);
        let found = search::search(&conn, &camp, "relationships", None, 10).unwrap();
        assert_eq!(found.len(), 1);

        // It knows its page, and a page that isn't a tab knows nothing.
        let family = family_of(&conn, &child.id).unwrap().unwrap();
        assert_eq!((family.parent.id.as_str(), family.tab_id.as_str()), (strahd.id.as_str(), tab.id.as_str()));
        assert!(family_of(&conn, &strahd.id).unwrap().is_none());
    }

    #[test]
    fn tabs_are_listed_in_order_and_can_be_moved() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        let a = add_document_tab(&conn, &strahd.id, "A", 2).unwrap();
        let b = add_embed_tab(&conn, &strahd.id, "B", None, 3).unwrap();
        let c = add_document_tab(&conn, &strahd.id, "C", 4).unwrap();
        assert_eq!(titles(&conn, &strahd.id), ["A", "B", "C"]);
        move_tab(&conn, &c.id, -1, 5).unwrap();
        assert_eq!(titles(&conn, &strahd.id), ["A", "C", "B"]);
        move_tab(&conn, &a.id, -1, 6).unwrap(); // already first: stays
        move_tab(&conn, &b.id, 1, 7).unwrap(); // already last: stays
        assert_eq!(titles(&conn, &strahd.id), ["A", "C", "B"]);
        move_tab(&conn, &a.id, 2, 8).unwrap();
        assert_eq!(titles(&conn, &strahd.id), ["C", "B", "A"]);
    }

    #[test]
    fn only_a_page_can_have_tabs_and_only_one_level_deep() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        let child = add_document_tab(&conn, &strahd.id, "Notes", 2).unwrap().item.unwrap();
        assert!(matches!(add_document_tab(&conn, &child.id, "Deeper", 3), Err(DbError::Invalid(_))));
        assert!(matches!(add_embed_tab(&conn, &child.id, "Slot", None, 3), Err(DbError::Invalid(_))));
        let card = items::create(&conn, &camp, "cards", "card", "A card", None, 1).unwrap();
        assert!(matches!(add_document_tab(&conn, &card.id, "Tab", 3), Err(DbError::Invalid(_))));
        assert!(matches!(add_document_tab(&conn, &strahd.id, "  ", 3), Err(DbError::EmptyName)));
        assert!(matches!(add_document_tab(&conn, "nope", "Tab", 3), Err(DbError::NotFound)));
        // A template can have tabs too.
        let template = items::create(&conn, &camp, "worldbuilding", "template", "NPC", None, 1).unwrap();
        add_document_tab(&conn, &template.id, "Relationships", 3).unwrap();
    }

    #[test]
    fn a_page_has_at_most_twelve_tabs() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        for i in 0..MAX_TABS {
            add_document_tab(&conn, &strahd.id, &format!("Tab {i}"), 2).unwrap();
        }
        assert!(matches!(add_document_tab(&conn, &strahd.id, "One more", 3), Err(DbError::Invalid(_))));
        assert!(matches!(add_embed_tab(&conn, &strahd.id, "One more", None, 3), Err(DbError::Invalid(_))));
        assert_eq!(item_count(&conn), 1 + MAX_TABS as i64); // nothing half-made
    }

    // ------------------------------------------------ embed tabs

    #[test]
    fn an_embed_tab_shows_any_item_and_can_be_an_empty_slot_filled_later() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        let deck = items::create(&conn, &camp, "cards", "deck", "Tarokka", None, 1).unwrap();
        let slot = add_embed_tab(&conn, &strahd.id, "Hometown map", None, 2).unwrap();
        assert!(slot.item.is_none());
        let filled = update_embed_tab(&conn, &slot.id, "Hometown map", Some(&deck.id), 3).unwrap();
        assert_eq!(filled.item.unwrap().name, "Tarokka");
        assert_eq!(filled.title, "Hometown map");
        // A blank title is fine when there is an item (its name is shown); emptying the slot needs a name.
        let unnamed = add_embed_tab(&conn, &strahd.id, "", Some(&deck.id), 4).unwrap();
        assert_eq!(unnamed.title, "");
        assert!(matches!(update_embed_tab(&conn, &unnamed.id, "", None, 5), Err(DbError::Invalid(_))));
        assert!(matches!(add_embed_tab(&conn, &strahd.id, "", None, 5), Err(DbError::Invalid(_))));
        let emptied = update_embed_tab(&conn, &unnamed.id, "Cards", None, 5).unwrap();
        assert!(emptied.item.is_none());
    }

    #[test]
    fn an_embed_can_only_show_a_live_item_of_the_same_project_other_than_its_page() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        let other = projects::create(&conn, "Other", 1).unwrap();
        let foreign = doc(&conn, &other.id, "Foreign");
        let gone = doc(&conn, &camp, "Gone");
        items::soft_delete(&conn, &gone.id, 2).unwrap();
        assert!(matches!(add_embed_tab(&conn, &strahd.id, "x", Some(&strahd.id), 3), Err(DbError::Invalid(_))));
        assert!(matches!(add_embed_tab(&conn, &strahd.id, "x", Some(&foreign.id), 3), Err(DbError::Invalid(_))));
        assert!(matches!(add_embed_tab(&conn, &strahd.id, "x", Some(&gone.id), 3), Err(DbError::NotFound)));
        assert!(matches!(add_embed_tab(&conn, &strahd.id, "x", Some("nope"), 3), Err(DbError::NotFound)));
        assert!(matches!(add_embed_tab(&conn, &strahd.id, &"x".repeat(61), None, 3), Err(DbError::Invalid(_))));
        assert!(list_tabs(&conn, &strahd.id).unwrap().is_empty());
    }

    #[test]
    fn a_trashed_embedded_item_still_shows_and_a_purged_one_leaves_an_empty_slot() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        let deck = items::create(&conn, &camp, "cards", "deck", "Tarokka", None, 1).unwrap();
        let tab = add_embed_tab(&conn, &strahd.id, "Cards", Some(&deck.id), 2).unwrap();
        items::soft_delete(&conn, &deck.id, 3).unwrap();
        let shown = list_tabs(&conn, &strahd.id).unwrap().remove(0);
        assert_eq!(shown.id, tab.id);
        assert_eq!(shown.item.unwrap().deleted_at, Some(3)); // so the app can say it is in the trash
        trash::purge_item(&conn, &deck.id).unwrap();
        let slot = list_tabs(&conn, &strahd.id).unwrap().remove(0);
        assert!(slot.item.is_none());
        assert_eq!(slot.title, "Cards");
    }

    #[test]
    fn removing_an_embed_tab_removes_only_the_tab() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        let deck = items::create(&conn, &camp, "cards", "deck", "Tarokka", None, 1).unwrap();
        let tab = add_embed_tab(&conn, &strahd.id, "Cards", Some(&deck.id), 2).unwrap();
        remove_tab(&conn, &tab.id, 3).unwrap();
        assert!(list_tabs(&conn, &strahd.id).unwrap().is_empty());
        assert!(items::get(&conn, &deck.id).unwrap().deleted_at.is_none()); // the deck is untouched
        assert!(matches!(remove_tab(&conn, &tab.id, 4), Err(DbError::NotFound)));
    }

    // ------------------------------------------------ trash

    #[test]
    fn removing_a_document_tab_trashes_its_document_and_restoring_brings_the_tab_back_in_place() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        add_document_tab(&conn, &strahd.id, "A", 2).unwrap();
        let b = add_document_tab(&conn, &strahd.id, "B", 3).unwrap();
        add_document_tab(&conn, &strahd.id, "C", 4).unwrap();
        remove_tab(&conn, &b.id, 5).unwrap();
        assert_eq!(titles(&conn, &strahd.id), ["A", "C"]);
        // It is in the trash as its own entry, and restoring it restores the tab.
        let listed = trash::list(&conn, &camp, "worldbuilding").unwrap();
        assert_eq!(listed.items.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["B"]);
        trash::restore_item(&conn, &b.item.unwrap().id, 6).unwrap();
        assert_eq!(titles(&conn, &strahd.id), ["A", "B", "C"]);
    }

    #[test]
    fn a_page_takes_its_child_documents_through_the_trash_and_back() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        let a = add_document_tab(&conn, &strahd.id, "A", 2).unwrap().item.unwrap();
        let b = add_document_tab(&conn, &strahd.id, "B", 3).unwrap().item.unwrap();
        items::soft_delete(&conn, &b.id, 4).unwrap(); // B was removed earlier, on its own

        items::soft_delete(&conn, &strahd.id, 10).unwrap();
        assert_eq!(items::get(&conn, &a.id).unwrap().deleted_at, Some(10));
        assert_eq!(items::get(&conn, &b.id).unwrap().deleted_at, Some(4)); // keeps its own time
        // The trash lists the page and B (removed on its own), not A (trashed with its page).
        let listed: Vec<String> = trash::list(&conn, &camp, "worldbuilding").unwrap().items.into_iter().map(|i| i.name).collect();
        assert_eq!(listed, ["Strahd", "B"]);
        assert!(search::search(&conn, &camp, "A", None, 10).unwrap().iter().all(|i| i.deleted_at.is_some() || i.name != "A"));

        trash::restore_item(&conn, &strahd.id, 11).unwrap();
        assert!(items::get(&conn, &a.id).unwrap().deleted_at.is_none());
        assert_eq!(items::get(&conn, &b.id).unwrap().deleted_at, Some(4)); // still removed
        assert_eq!(titles(&conn, &strahd.id), ["A"]);
    }

    #[test]
    fn deleting_and_restoring_a_folder_carries_the_child_documents() {
        let (conn, camp) = setup();
        let folder = folders::create(&conn, &camp, "worldbuilding", None, "NPCs", 1).unwrap();
        let strahd = items::create(&conn, &camp, "worldbuilding", "document", "Strahd", Some(&folder.id), 1).unwrap();
        let child = add_document_tab(&conn, &strahd.id, "Notes", 2).unwrap().item.unwrap();
        folders::soft_delete(&conn, &folder.id, 5).unwrap();
        assert_eq!(items::get(&conn, &child.id).unwrap().deleted_at, Some(5));
        trash::restore_folder(&conn, &folder.id, 6).unwrap();
        assert!(items::get(&conn, &child.id).unwrap().deleted_at.is_none());
        assert_eq!(titles(&conn, &strahd.id), ["Notes"]);
    }

    #[test]
    fn deleting_a_page_for_good_deletes_its_child_documents_and_tabs() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        add_document_tab(&conn, &strahd.id, "A", 2).unwrap();
        add_embed_tab(&conn, &strahd.id, "Slot", None, 3).unwrap();
        items::soft_delete(&conn, &strahd.id, 4).unwrap();
        trash::purge_item(&conn, &strahd.id).unwrap();
        assert_eq!(item_count(&conn), 0);
        let tabs: i64 = conn.query_row("SELECT COUNT(*) FROM item_tabs", [], |r| r.get(0)).unwrap();
        assert_eq!(tabs, 0);
    }

    #[test]
    fn emptying_the_trash_leaves_no_orphan_documents() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        add_document_tab(&conn, &strahd.id, "A", 2).unwrap();
        items::soft_delete(&conn, &strahd.id, 4).unwrap();
        trash::empty(&conn, &camp, "worldbuilding", None).unwrap();
        assert_eq!(item_count(&conn), 0);
    }

    #[test]
    fn a_child_document_keeps_its_own_fields_tags_links_and_text() {
        let (conn, camp) = setup();
        let strahd = doc(&conn, &camp, "Strahd");
        let ireena = doc(&conn, &camp, "Ireena");
        let child = add_document_tab(&conn, &strahd.id, "Relationships", 2).unwrap().item.unwrap();
        documents::set_body_with_links(&conn, &child.id, "Loves [Ireena]", Some(&[ireena.id.clone()]), 3).unwrap();
        let back = crate::db::links::backlinks(&conn, &ireena.id).unwrap();
        assert_eq!(back.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(), ["Relationships"]);
        // ... and a link to the child resolves to its page.
        let family = family_of(&conn, &back[0].id).unwrap().unwrap();
        assert_eq!(family.parent.name, "Strahd");
    }
}
