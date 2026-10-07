//! Tags: campaign-wide labels with optional colour and nesting, attachable to any item.

use super::error::{clean_name, DbError};
use super::items::{self, Item};
use super::campaigns;
use rusqlite::{params, Connection, Row};
use serde::Serialize;
use uuid::Uuid;

const COLUMNS: &str = "id, campaign_id, parent_id, name, color, created_at, updated_at, deleted_at";

/// A tag plus all tags nested below it.
const SUBTREE: &str = "WITH RECURSIVE tree(id) AS (
        SELECT ?1
        UNION ALL
        SELECT t.id FROM tags t JOIN tree ON t.parent_id = tree.id
    )
    SELECT id FROM tree";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub campaign_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    /// `#rrggbb`, or none.
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

fn from_row(row: &Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get("id")?,
        campaign_id: row.get("campaign_id")?,
        parent_id: row.get("parent_id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

pub fn get(conn: &Connection, id: &str) -> Result<Tag, DbError> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM tags WHERE id = ?1"),
        [id],
        from_row,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => DbError::NotFound,
        other => other.into(),
    })
}

fn get_live(conn: &Connection, id: &str) -> Result<Tag, DbError> {
    let tag = get(conn, id)?;
    if tag.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    Ok(tag)
}

fn check_color(color: Option<&str>) -> Result<(), DbError> {
    match color {
        None => Ok(()),
        Some(c)
            if c.len() == 7
                && c.starts_with('#')
                && c[1..].chars().all(|ch| ch.is_ascii_hexdigit()) =>
        {
            Ok(())
        }
        Some(_) => Err(DbError::Invalid("A colour looks like #aabbcc.")),
    }
}

/// Is a live tag with this name already a child of `parent` (ignoring case)?
fn name_taken(
    conn: &Connection,
    campaign_id: &str,
    parent: Option<&str>,
    name: &str,
    except_id: Option<&str>,
) -> Result<bool, DbError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tags
         WHERE campaign_id = ?1 AND parent_id IS ?2 AND name = ?3 COLLATE NOCASE
           AND deleted_at IS NULL AND (?4 IS NULL OR id <> ?4)",
        params![campaign_id, parent, name, except_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

const NAME_TAKEN: DbError = DbError::Invalid("A tag with that name already exists there.");

pub fn create(
    conn: &Connection,
    campaign_id: &str,
    parent_id: Option<&str>,
    name: &str,
    color: Option<&str>,
    now: i64,
) -> Result<Tag, DbError> {
    let name = clean_name(name)?;
    check_color(color)?;
    campaigns::require_live(conn, campaign_id)?;
    if let Some(parent) = parent_id {
        if get_live(conn, parent)?.campaign_id != campaign_id {
            return Err(DbError::Invalid("That tag belongs to a different campaign."));
        }
    }
    if name_taken(conn, campaign_id, parent_id, name, None)? {
        return Err(NAME_TAKEN);
    }
    let id = Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO tags (id, campaign_id, parent_id, name, color, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        params![id, campaign_id, parent_id, name, color, now],
    )?;
    get(conn, &id)
}

/// Every live tag in a campaign (the front end builds the tree from `parent_id`).
pub fn list(conn: &Connection, campaign_id: &str) -> Result<Vec<Tag>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM tags WHERE campaign_id = ?1 AND deleted_at IS NULL
         ORDER BY name COLLATE NOCASE, created_at"
    ))?;
    let rows = stmt.query_map([campaign_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn rename(conn: &Connection, id: &str, name: &str, now: i64) -> Result<Tag, DbError> {
    let name = clean_name(name)?;
    let tag = get_live(conn, id)?;
    if name_taken(conn, &tag.campaign_id, tag.parent_id.as_deref(), name, Some(id))? {
        return Err(NAME_TAKEN);
    }
    conn.execute(
        "UPDATE tags SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, now],
    )?;
    get(conn, id)
}

pub fn set_color(conn: &Connection, id: &str, color: Option<&str>, now: i64) -> Result<Tag, DbError> {
    check_color(color)?;
    get_live(conn, id)?;
    conn.execute(
        "UPDATE tags SET color = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, color, now],
    )?;
    get(conn, id)
}

/// Nests a tag under `new_parent` (or makes it top level when `None`).
pub fn move_to(conn: &Connection, id: &str, new_parent: Option<&str>, now: i64) -> Result<Tag, DbError> {
    let tag = get_live(conn, id)?;
    if let Some(parent) = new_parent {
        if get_live(conn, parent)?.campaign_id != tag.campaign_id {
            return Err(DbError::Invalid("That tag belongs to a different campaign."));
        }
        // Walk up from the new parent; meeting this tag would make it its own ancestor.
        let loops: i64 = conn.query_row(
            "WITH RECURSIVE up(id, parent_id) AS (
                 SELECT id, parent_id FROM tags WHERE id = ?1
                 UNION ALL
                 SELECT t.id, t.parent_id FROM tags t JOIN up ON t.id = up.parent_id
             )
             SELECT COUNT(*) FROM up WHERE id = ?2",
            params![parent, id],
            |row| row.get(0),
        )?;
        if loops > 0 {
            return Err(DbError::Invalid("A tag can't be nested inside itself or its own sub-tags."));
        }
    }
    if name_taken(conn, &tag.campaign_id, new_parent, &tag.name, Some(id))? {
        return Err(NAME_TAKEN);
    }
    conn.execute(
        "UPDATE tags SET parent_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, new_parent, now],
    )?;
    get(conn, id)
}

/// Trashes a tag and its sub-tags with one shared timestamp. Item links are kept
/// (but hidden) so restoring the tag brings them back.
pub fn soft_delete(conn: &Connection, id: &str, now: i64) -> Result<(), DbError> {
    get_live(conn, id)?;
    conn.execute(
        &format!(
            "UPDATE tags SET deleted_at = ?2, updated_at = ?2
             WHERE deleted_at IS NULL AND id IN ({SUBTREE})"
        ),
        params![id, now],
    )?;
    Ok(())
}

/// Restores a tag and the sub-tags trashed with it. If its parent is still in the
/// trash it returns to the top level. Fails if a live tag already uses its name there.
pub fn restore(conn: &Connection, id: &str, now: i64) -> Result<Tag, DbError> {
    let tag = get(conn, id)?;
    let stamp = tag.deleted_at.ok_or(DbError::NotFound)?;
    let parent_trashed = match tag.parent_id.as_deref() {
        Some(p) => get(conn, p)?.deleted_at.is_some(),
        None => false,
    };
    let new_parent = if parent_trashed { None } else { tag.parent_id.as_deref() };
    if name_taken(conn, &tag.campaign_id, new_parent, &tag.name, Some(id))? {
        return Err(DbError::Invalid(
            "A tag with that name exists now. Rename it first, then restore.",
        ));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE tags SET parent_id = ?2 WHERE id = ?1",
        params![id, new_parent],
    )?;
    tx.execute(
        &format!(
            "UPDATE tags SET deleted_at = NULL, updated_at = ?3
             WHERE deleted_at = ?2 AND id IN ({SUBTREE})"
        ),
        params![id, stamp, now],
    )?;
    tx.commit()?;
    get(conn, id)
}

/// Puts a tag on an item. Adding it twice is harmless; adding one that was
/// removed earlier brings the link back.
pub fn add_to_item(conn: &Connection, item_id: &str, tag_id: &str, now: i64) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    let tag = get_live(conn, tag_id)?;
    if item.campaign_id != tag.campaign_id {
        return Err(DbError::Invalid("That tag belongs to a different campaign."));
    }
    conn.execute(
        "INSERT INTO item_tags (item_id, tag_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT (item_id, tag_id) DO UPDATE SET deleted_at = NULL, updated_at = ?3
         WHERE item_tags.deleted_at IS NOT NULL",
        params![item_id, tag_id, now],
    )?;
    Ok(())
}

/// Takes a tag off an item. Harmless if it wasn't on it.
pub fn remove_from_item(conn: &Connection, item_id: &str, tag_id: &str, now: i64) -> Result<(), DbError> {
    conn.execute(
        "UPDATE item_tags SET deleted_at = ?3, updated_at = ?3
         WHERE item_id = ?1 AND tag_id = ?2 AND deleted_at IS NULL",
        params![item_id, tag_id, now],
    )?;
    Ok(())
}

/// The live tags on an item, alphabetical.
pub fn for_item(conn: &Connection, item_id: &str) -> Result<Vec<Tag>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM tags
         WHERE deleted_at IS NULL
           AND id IN (SELECT tag_id FROM item_tags WHERE item_id = ?1 AND deleted_at IS NULL)
         ORDER BY name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([item_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// One tag on one item (see `links_in_library`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagLink {
    pub item_id: String,
    pub tag: Tag,
}

/// Every live tag on every live item in a library, in one query, so a list of
/// items can show its tag chips without asking once per item.
pub fn links_in_library(
    conn: &Connection,
    campaign_id: &str,
    library: &str,
) -> Result<Vec<TagLink>, DbError> {
    let tag_columns = COLUMNS
        .split(", ")
        .map(|c| format!("t.{c}"))
        .collect::<Vec<_>>()
        .join(", ");
    let mut stmt = conn.prepare(&format!(
        "SELECT it.item_id AS link_item_id, {tag_columns}
         FROM item_tags it
         JOIN tags t ON t.id = it.tag_id
         JOIN items i ON i.id = it.item_id
         WHERE i.campaign_id = ?1 AND i.library = ?2 AND i.deleted_at IS NULL
           AND it.deleted_at IS NULL AND t.deleted_at IS NULL
         ORDER BY t.name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map(params![campaign_id, library], |row| {
        Ok(TagLink {
            item_id: row.get("link_item_id")?,
            tag: from_row(row)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Live items carrying a tag. With `include_subtags`, also those carrying any
/// tag nested below it (so "Region" finds things tagged "Sword Coast").
pub fn items_with_tag(
    conn: &Connection,
    campaign_id: &str,
    tag_id: &str,
    include_subtags: bool,
) -> Result<Vec<Item>, DbError> {
    let mut stmt = conn.prepare(&format!(
        "WITH RECURSIVE tree(id) AS (
             SELECT id FROM tags WHERE id = ?1 AND deleted_at IS NULL
             UNION ALL
             SELECT t.id FROM tags t JOIN tree ON t.parent_id = tree.id
             WHERE ?3 = 1 AND t.deleted_at IS NULL
         )
         SELECT {} FROM items
         WHERE campaign_id = ?2 AND deleted_at IS NULL
           AND id IN (SELECT item_id FROM item_tags
                      WHERE deleted_at IS NULL AND tag_id IN (SELECT id FROM tree))
         ORDER BY name COLLATE NOCASE, created_at",
        items::COLUMNS
    ))?;
    let rows = stmt.query_map(
        params![tag_id, campaign_id, include_subtags as i64],
        items::from_row,
    )?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{open_in_memory, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn new_item(conn: &Connection, camp: &str, name: &str) -> Item {
        items::create(conn, camp, "w", "document", name, None, 1).unwrap()
    }

    fn tag_names(tags: Vec<Tag>) -> Vec<String> {
        tags.into_iter().map(|t| t.name).collect()
    }

    fn item_names(items: Vec<Item>) -> Vec<String> {
        items.into_iter().map(|i| i.name).collect()
    }

    #[test]
    fn create_trims_names_and_validates_colour() {
        let (conn, camp) = setup();
        let t = create(&conn, &camp, None, "  Omen ", Some("#aa00FF"), 10).unwrap();
        assert_eq!((t.name.as_str(), t.color.as_deref()), ("Omen", Some("#aa00FF")));
        assert_eq!((t.created_at, t.updated_at, t.deleted_at), (10, 10, None));
        assert!(matches!(create(&conn, &camp, None, "  ", None, 1), Err(DbError::EmptyName)));
        for bad in ["red", "#fff", "#gggggg", "aabbcc1"] {
            assert!(
                matches!(create(&conn, &camp, None, "X", Some(bad), 1), Err(DbError::Invalid(_))),
                "{bad} should be rejected"
            );
        }
    }

    #[test]
    fn sibling_names_must_differ_ignoring_case_but_cousins_may_match() {
        let (conn, camp) = setup();
        let region = create(&conn, &camp, None, "Region", None, 1).unwrap();
        let faction = create(&conn, &camp, None, "Faction", None, 1).unwrap();
        create(&conn, &camp, Some(&region.id), "North", None, 1).unwrap();
        assert!(matches!(
            create(&conn, &camp, Some(&region.id), "north", None, 1),
            Err(DbError::Invalid(_))
        ));
        // Same name under a different parent is fine.
        create(&conn, &camp, Some(&faction.id), "North", None, 1).unwrap();
        assert!(matches!(create(&conn, &camp, None, "REGION", None, 1), Err(DbError::Invalid(_))));
    }

    #[test]
    fn the_database_also_enforces_unique_sibling_names() {
        let (conn, camp) = setup();
        create(&conn, &camp, None, "Omen", None, 1).unwrap();
        let result = conn.execute(
            "INSERT INTO tags (id, campaign_id, name, created_at, updated_at) VALUES ('x', ?1, 'omen', 1, 1)",
            [&camp],
        );
        assert!(result.is_err());
    }

    #[test]
    fn rename_and_recolour() {
        let (conn, camp) = setup();
        let a = create(&conn, &camp, None, "A", None, 1).unwrap();
        create(&conn, &camp, None, "B", None, 1).unwrap();
        assert!(matches!(rename(&conn, &a.id, "b", 2), Err(DbError::Invalid(_))));
        // Renaming to its own name with different case is allowed.
        assert_eq!(rename(&conn, &a.id, "a", 2).unwrap().name, "a");
        let c = set_color(&conn, &a.id, Some("#112233"), 3).unwrap();
        assert_eq!((c.color.as_deref(), c.updated_at), (Some("#112233"), 3));
        assert_eq!(set_color(&conn, &a.id, None, 4).unwrap().color, None);
    }

    #[test]
    fn list_is_alphabetical_and_per_campaign() {
        let (conn, camp) = setup();
        let other = campaigns::create(&conn, "Other", 1).unwrap();
        create(&conn, &camp, None, "beta", None, 1).unwrap();
        create(&conn, &camp, None, "Alpha", None, 1).unwrap();
        create(&conn, &other.id, None, "Elsewhere", None, 1).unwrap();
        assert_eq!(tag_names(list(&conn, &camp).unwrap()), ["Alpha", "beta"]);
    }

    #[test]
    fn nesting_cannot_form_loops_or_cross_campaigns() {
        let (conn, camp) = setup();
        let a = create(&conn, &camp, None, "A", None, 1).unwrap();
        let b = create(&conn, &camp, Some(&a.id), "B", None, 1).unwrap();
        let c = create(&conn, &camp, Some(&b.id), "C", None, 1).unwrap();
        assert!(matches!(move_to(&conn, &a.id, Some(&a.id), 2), Err(DbError::Invalid(_))));
        assert!(matches!(move_to(&conn, &a.id, Some(&c.id), 2), Err(DbError::Invalid(_))));
        assert_eq!(get(&conn, &a.id).unwrap().parent_id, None);
        let other = campaigns::create(&conn, "Other", 1).unwrap();
        let foreign = create(&conn, &other.id, None, "F", None, 1).unwrap();
        assert!(matches!(move_to(&conn, &a.id, Some(&foreign.id), 2), Err(DbError::Invalid(_))));
        assert!(matches!(
            create(&conn, &camp, Some(&foreign.id), "X", None, 2),
            Err(DbError::Invalid(_))
        ));
        // A valid move works, and a clash at the destination is refused.
        assert_eq!(move_to(&conn, &c.id, Some(&a.id), 3).unwrap().parent_id.as_deref(), Some(a.id.as_str()));
        let b2 = create(&conn, &camp, None, "B", None, 4).unwrap();
        assert!(matches!(move_to(&conn, &b2.id, Some(&a.id), 5), Err(DbError::Invalid(_))));
    }

    #[test]
    fn deleting_a_tag_trashes_subtags_and_restore_brings_back_the_group() {
        let (conn, camp) = setup();
        let region = create(&conn, &camp, None, "Region", None, 1).unwrap();
        let coast = create(&conn, &camp, Some(&region.id), "Coast", None, 1).unwrap();
        let hills = create(&conn, &camp, Some(&region.id), "Hills", None, 1).unwrap();
        soft_delete(&conn, &hills.id, 50).unwrap(); // trashed earlier, separately
        soft_delete(&conn, &region.id, 100).unwrap();
        assert!(list(&conn, &camp).unwrap().is_empty());
        assert_eq!(get(&conn, &coast.id).unwrap().deleted_at, Some(100));
        assert_eq!(get(&conn, &hills.id).unwrap().deleted_at, Some(50));

        restore(&conn, &region.id, 200).unwrap();
        assert_eq!(tag_names(list(&conn, &camp).unwrap()), ["Coast", "Region"]);
        assert_eq!(get(&conn, &hills.id).unwrap().deleted_at, Some(50));
    }

    #[test]
    fn restoring_a_subtag_with_a_trashed_parent_goes_to_the_top_level() {
        let (conn, camp) = setup();
        let region = create(&conn, &camp, None, "Region", None, 1).unwrap();
        let coast = create(&conn, &camp, Some(&region.id), "Coast", None, 1).unwrap();
        soft_delete(&conn, &region.id, 100).unwrap();
        let back = restore(&conn, &coast.id, 200).unwrap();
        assert_eq!((back.parent_id, back.deleted_at), (None, None));
        assert_eq!(get(&conn, &region.id).unwrap().deleted_at, Some(100));
    }

    #[test]
    fn restoring_into_a_name_clash_is_refused_until_renamed() {
        let (conn, camp) = setup();
        let old = create(&conn, &camp, None, "Omen", None, 1).unwrap();
        soft_delete(&conn, &old.id, 2).unwrap();
        create(&conn, &camp, None, "Omen", None, 3).unwrap();
        assert!(matches!(restore(&conn, &old.id, 4), Err(DbError::Invalid(_))));
        assert!(matches!(restore(&conn, "nope", 4), Err(DbError::NotFound)));
        let live = create(&conn, &camp, None, "Live", None, 5).unwrap();
        assert!(matches!(restore(&conn, &live.id, 6), Err(DbError::NotFound)));
    }

    #[test]
    fn adding_and_removing_tags_on_items() {
        let (conn, camp) = setup();
        let item = new_item(&conn, &camp, "Bob");
        let a = create(&conn, &camp, None, "A", None, 1).unwrap();
        let b = create(&conn, &camp, None, "B", None, 1).unwrap();
        add_to_item(&conn, &item.id, &b.id, 10).unwrap();
        add_to_item(&conn, &item.id, &a.id, 10).unwrap();
        add_to_item(&conn, &item.id, &a.id, 11).unwrap(); // twice is harmless
        assert_eq!(tag_names(for_item(&conn, &item.id).unwrap()), ["A", "B"]);

        remove_from_item(&conn, &item.id, &a.id, 20).unwrap();
        remove_from_item(&conn, &item.id, &a.id, 21).unwrap(); // harmless too
        assert_eq!(tag_names(for_item(&conn, &item.id).unwrap()), ["B"]);

        add_to_item(&conn, &item.id, &a.id, 30).unwrap(); // re-adding revives the link
        assert_eq!(tag_names(for_item(&conn, &item.id).unwrap()), ["A", "B"]);
    }

    #[test]
    fn tags_and_items_must_be_live_and_in_the_same_campaign() {
        let (conn, camp) = setup();
        let item = new_item(&conn, &camp, "Bob");
        let t = create(&conn, &camp, None, "T", None, 1).unwrap();
        let other = campaigns::create(&conn, "Other", 1).unwrap();
        let foreign = create(&conn, &other.id, None, "F", None, 1).unwrap();
        assert!(matches!(add_to_item(&conn, &item.id, &foreign.id, 2), Err(DbError::Invalid(_))));
        assert!(matches!(add_to_item(&conn, "nope", &t.id, 2), Err(DbError::NotFound)));
        assert!(matches!(add_to_item(&conn, &item.id, "nope", 2), Err(DbError::NotFound)));
        soft_delete(&conn, &t.id, 3).unwrap();
        assert!(matches!(add_to_item(&conn, &item.id, &t.id, 4), Err(DbError::NotFound)));
        let t2 = create(&conn, &camp, None, "T2", None, 5).unwrap();
        items::soft_delete(&conn, &item.id, 6).unwrap();
        assert!(matches!(add_to_item(&conn, &item.id, &t2.id, 7), Err(DbError::NotFound)));
    }

    #[test]
    fn a_deleted_tag_disappears_from_items_and_comes_back_on_restore() {
        let (conn, camp) = setup();
        let item = new_item(&conn, &camp, "Bob");
        let t = create(&conn, &camp, None, "T", None, 1).unwrap();
        add_to_item(&conn, &item.id, &t.id, 2).unwrap();
        soft_delete(&conn, &t.id, 3).unwrap();
        assert!(for_item(&conn, &item.id).unwrap().is_empty());
        assert!(items_with_tag(&conn, &camp, &t.id, true).unwrap().is_empty());
        restore(&conn, &t.id, 4).unwrap();
        assert_eq!(tag_names(for_item(&conn, &item.id).unwrap()), ["T"]);
    }

    #[test]
    fn finding_items_by_tag_with_and_without_subtags() {
        let (conn, camp) = setup();
        let region = create(&conn, &camp, None, "Region", None, 1).unwrap();
        let coast = create(&conn, &camp, Some(&region.id), "Coast", None, 1).unwrap();
        let faction = create(&conn, &camp, None, "Faction", None, 1).unwrap();
        let direct = new_item(&conn, &camp, "Direct");
        let nested = new_item(&conn, &camp, "Nested");
        let unrelated = new_item(&conn, &camp, "Unrelated");
        let trashed = new_item(&conn, &camp, "Trashed");
        add_to_item(&conn, &direct.id, &region.id, 2).unwrap();
        add_to_item(&conn, &nested.id, &coast.id, 2).unwrap();
        add_to_item(&conn, &unrelated.id, &faction.id, 2).unwrap();
        add_to_item(&conn, &trashed.id, &region.id, 2).unwrap();
        items::soft_delete(&conn, &trashed.id, 3).unwrap();

        let with_sub = items_with_tag(&conn, &camp, &region.id, true).unwrap();
        assert_eq!(item_names(with_sub), ["Direct", "Nested"]);
        let exact = items_with_tag(&conn, &camp, &region.id, false).unwrap();
        assert_eq!(item_names(exact), ["Direct"]);
    }

    #[test]
    fn links_in_library_lists_live_tags_on_live_items_of_that_library() {
        let (conn, camp) = setup();
        let bob = new_item(&conn, &camp, "Bob");
        let gone = new_item(&conn, &camp, "Gone");
        let elsewhere = items::create(&conn, &camp, "maps", "map", "Map", None, 1).unwrap();
        let a = create(&conn, &camp, None, "A", None, 1).unwrap();
        let b = create(&conn, &camp, None, "B", None, 1).unwrap();
        let dead = create(&conn, &camp, None, "Dead", None, 1).unwrap();
        for (item, tag) in [(&bob, &b), (&bob, &a), (&bob, &dead), (&gone, &a), (&elsewhere, &a)] {
            add_to_item(&conn, &item.id, &tag.id, 2).unwrap();
        }
        soft_delete(&conn, &dead.id, 3).unwrap();
        items::soft_delete(&conn, &gone.id, 3).unwrap();

        let links = links_in_library(&conn, &camp, "w").unwrap();
        let pairs: Vec<_> = links.iter().map(|l| (l.item_id.as_str(), l.tag.name.as_str())).collect();
        assert_eq!(pairs, [(bob.id.as_str(), "A"), (bob.id.as_str(), "B")]);
    }

    #[test]
    fn purging_an_item_removes_its_tag_links() {
        let (conn, camp) = setup();
        let item = new_item(&conn, &camp, "Bob");
        let t = create(&conn, &camp, None, "T", None, 1).unwrap();
        add_to_item(&conn, &item.id, &t.id, 2).unwrap();
        items::soft_delete(&conn, &item.id, 3).unwrap();
        trash::purge_item(&conn, &item.id).unwrap();
        let links: i64 = conn
            .query_row("SELECT COUNT(*) FROM item_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(links, 0);
        assert!(get(&conn, &t.id).is_ok()); // the tag itself is untouched
    }
}
