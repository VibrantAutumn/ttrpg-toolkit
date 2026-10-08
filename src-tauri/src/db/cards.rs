//! Cards: a card's value, notes and picture. Cards, sets, decks and pools are
//! all library items in the `cards` library; what is inside a set, deck or pool
//! is in `collections.rs`.

use super::error::DbError;
use super::items;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

pub const LIBRARY: &str = "cards";
pub const CARD_TYPE: &str = "card";
pub const SET_TYPE: &str = "set";
pub const DECK_TYPE: &str = "deck";
pub const POOL_TYPE: &str = "pool";

pub const MAX_VALUE_CHARS: usize = 50;
pub const MAX_NOTES_BYTES: usize = 20_000;
/// The app shrinks pictures before saving; these are safety limits on what arrives.
pub const MAX_IMAGE_BYTES: usize = 1_500_000;
pub const MAX_THUMB_BYTES: usize = 200_000;
/// How many thumbnails one request may ask for.
pub const MAX_THUMB_BATCH: usize = 500;

pub const IMAGE_MIMES: [&str; 3] = ["image/jpeg", "image/png", "image/webp"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDetails {
    pub item_id: String,
    pub value: String,
    pub notes: String,
}

/// A picture on its way to or from JavaScript (bytes as base64 text).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageData {
    pub item_id: String,
    pub mime: String,
    pub data: String,
}

/// Checks the item exists, is live, and is a card.
fn require_live_card(conn: &Connection, item_id: &str) -> Result<(), DbError> {
    let item = items::get(conn, item_id)?;
    if item.deleted_at.is_some() {
        return Err(DbError::NotFound);
    }
    if item.item_type != CARD_TYPE {
        return Err(DbError::Invalid("This item isn't a card."));
    }
    Ok(())
}

// ------------------------------------------------------------ value and notes

/// Checks a card's value and notes (also used when importing packs).
pub fn validate_details(value: &str, notes: &str) -> Result<(), DbError> {
    if value.chars().count() > MAX_VALUE_CHARS {
        return Err(DbError::Invalid("A card's value is too long."));
    }
    if notes.len() > MAX_NOTES_BYTES {
        return Err(DbError::Invalid("That card's notes are too long to save."));
    }
    Ok(())
}

/// A card's value and notes (both empty if none were ever saved).
pub fn get_details(conn: &Connection, item_id: &str) -> Result<CardDetails, DbError> {
    require_live_card(conn, item_id)?;
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT value, notes FROM card_details WHERE item_id = ?1",
            [item_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (value, notes) = row.unwrap_or_default();
    Ok(CardDetails { item_id: item_id.to_string(), value, notes })
}

/// Replaces a card's value and notes. Also marks the item as updated.
pub fn set_details(conn: &Connection, item_id: &str, value: &str, notes: &str, now: i64) -> Result<(), DbError> {
    require_live_card(conn, item_id)?;
    let value = value.trim();
    validate_details(value, notes)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO card_details (item_id, value, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (item_id) DO UPDATE
             SET value = excluded.value, notes = excluded.notes, updated_at = excluded.updated_at",
        params![item_id, value, notes, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

// -------------------------------------------------------------------- pictures

fn looks_like(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "image/webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

/// Checks a picture and its thumbnail (also used when importing packs): a
/// known type, bytes that really are that type, and within the size limits.
pub fn validate_image(mime: &str, image: &[u8], thumb: &[u8]) -> Result<(), DbError> {
    if !IMAGE_MIMES.contains(&mime) {
        return Err(DbError::Invalid("Pictures must be JPEG, PNG or WebP."));
    }
    if image.is_empty() || thumb.is_empty() {
        return Err(DbError::Invalid("The picture is empty."));
    }
    if image.len() > MAX_IMAGE_BYTES || thumb.len() > MAX_THUMB_BYTES {
        return Err(DbError::Invalid("That picture is too large to save."));
    }
    if !looks_like(mime, image) || !looks_like(mime, thumb) {
        return Err(DbError::Invalid("That file isn't a picture of the stated type."));
    }
    Ok(())
}

/// Sets (or replaces) a card's picture.
pub fn set_image(
    conn: &Connection,
    item_id: &str,
    mime: &str,
    image: &[u8],
    thumb: &[u8],
    now: i64,
) -> Result<(), DbError> {
    require_live_card(conn, item_id)?;
    validate_image(mime, image, thumb)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO card_images (item_id, mime, image, thumb, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT (item_id) DO UPDATE
             SET mime = excluded.mime, image = excluded.image, thumb = excluded.thumb,
                 updated_at = excluded.updated_at",
        params![item_id, mime, image, thumb, now],
    )?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    tx.commit()?;
    Ok(())
}

/// Removes a card's picture (nothing happens if it has none).
pub fn remove_image(conn: &Connection, item_id: &str, now: i64) -> Result<(), DbError> {
    require_live_card(conn, item_id)?;
    let tx = conn.unchecked_transaction()?;
    let removed = tx.execute("DELETE FROM card_images WHERE item_id = ?1", [item_id])?;
    if removed > 0 {
        tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![item_id, now])?;
    }
    tx.commit()?;
    Ok(())
}

/// A card's full-size picture, if it has one.
pub fn get_image(conn: &Connection, item_id: &str) -> Result<Option<ImageData>, DbError> {
    require_live_card(conn, item_id)?;
    let row: Option<(String, Vec<u8>)> = conn
        .query_row(
            "SELECT mime, image FROM card_images WHERE item_id = ?1",
            [item_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(row.map(|(mime, bytes)| ImageData {
        item_id: item_id.to_string(),
        mime,
        data: STANDARD.encode(bytes),
    }))
}

/// Thumbnails for several cards at once (cards without a picture, and items that
/// aren't live cards, are simply left out).
pub fn get_thumbs(conn: &Connection, item_ids: &[String]) -> Result<Vec<ImageData>, DbError> {
    if item_ids.len() > MAX_THUMB_BATCH {
        return Err(DbError::Invalid("Too many pictures were asked for at once."));
    }
    let mut stmt = conn.prepare(
        "SELECT c.mime, c.thumb FROM card_images c JOIN items i ON i.id = c.item_id
         WHERE c.item_id = ?1 AND i.deleted_at IS NULL",
    )?;
    let mut out = Vec::new();
    for id in item_ids {
        let row: Option<(String, Vec<u8>)> = stmt
            .query_row([id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        if let Some((mime, bytes)) = row {
            out.push(ImageData { item_id: id.clone(), mime, data: STANDARD.encode(bytes) });
        }
    }
    Ok(out)
}

/// Decodes base64 text from JavaScript (Android can't send raw bytes).
pub fn decode_base64(text: &str) -> Result<Vec<u8>, DbError> {
    STANDARD
        .decode(text.trim())
        .map_err(|_| DbError::Invalid("The picture couldn't be read."))
}

#[cfg(test)]
pub(crate) mod test_images {
    /// Tiny byte strings that pass the type check (they are not full pictures).
    pub fn jpeg() -> Vec<u8> {
        let mut b = vec![0xFF, 0xD8, 0xFF, 0xE0];
        b.extend_from_slice(b"fake jpeg data");
        b
    }
    pub fn png() -> Vec<u8> {
        let mut b = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        b.extend_from_slice(b"fake png data");
        b
    }
    pub fn webp() -> Vec<u8> {
        let mut b = b"RIFF".to_vec();
        b.extend_from_slice(&[0, 0, 0, 0]);
        b.extend_from_slice(b"WEBPfake");
        b
    }
}

#[cfg(test)]
mod tests {
    use super::test_images::*;
    use super::*;
    use crate::db::{campaigns, open_in_memory, search, tags, trash};

    fn setup() -> (Connection, String) {
        let conn = open_in_memory();
        let c = campaigns::create(&conn, "Test", 1).unwrap();
        (conn, c.id)
    }

    fn card(conn: &Connection, camp: &str, name: &str) -> items::Item {
        items::create(conn, camp, LIBRARY, CARD_TYPE, name, None, 1).unwrap()
    }

    #[test]
    fn a_new_card_has_an_empty_value_and_notes() {
        let (conn, camp) = setup();
        let c = card(&conn, &camp, "The Fool");
        assert_eq!(
            get_details(&conn, &c.id).unwrap(),
            CardDetails { item_id: c.id.clone(), value: String::new(), notes: String::new() }
        );
    }

    #[test]
    fn value_and_notes_round_trip_and_can_be_replaced() {
        let (conn, camp) = setup();
        let c = card(&conn, &camp, "The Fool");
        set_details(&conn, &c.id, "  0 ", "New beginnings, café ☀\nSecond line", 10).unwrap();
        let d = get_details(&conn, &c.id).unwrap();
        assert_eq!((d.value.as_str(), d.notes.as_str()), ("0", "New beginnings, café ☀\nSecond line"));
        assert_eq!(items::get(&conn, &c.id).unwrap().updated_at, 10);
        set_details(&conn, &c.id, "", "", 20).unwrap();
        let d = get_details(&conn, &c.id).unwrap();
        assert_eq!((d.value.as_str(), d.notes.as_str()), ("", ""));
    }

    #[test]
    fn overlong_value_or_notes_are_refused_and_keep_the_old_ones() {
        let (conn, camp) = setup();
        let c = card(&conn, &camp, "Card");
        set_details(&conn, &c.id, "7", "keep me", 2).unwrap();
        let long_value = "x".repeat(MAX_VALUE_CHARS + 1);
        assert!(matches!(set_details(&conn, &c.id, &long_value, "", 3), Err(DbError::Invalid(_))));
        let long_notes = "x".repeat(MAX_NOTES_BYTES + 1);
        assert!(matches!(set_details(&conn, &c.id, "7", &long_notes, 3), Err(DbError::Invalid(_))));
        assert_eq!(get_details(&conn, &c.id).unwrap().notes, "keep me");
        set_details(&conn, &c.id, &"x".repeat(MAX_VALUE_CHARS), &"x".repeat(MAX_NOTES_BYTES), 4).unwrap();
    }

    #[test]
    fn only_live_cards_have_details_and_pictures() {
        let (conn, camp) = setup();
        let deck = items::create(&conn, &camp, LIBRARY, DECK_TYPE, "Deck", None, 1).unwrap();
        assert!(matches!(get_details(&conn, &deck.id), Err(DbError::Invalid(_))));
        assert!(matches!(set_details(&conn, &deck.id, "1", "", 2), Err(DbError::Invalid(_))));
        assert!(matches!(set_image(&conn, &deck.id, "image/png", &png(), &png(), 2), Err(DbError::Invalid(_))));
        assert!(matches!(get_details(&conn, "nope"), Err(DbError::NotFound)));

        let c = card(&conn, &camp, "Gone");
        set_details(&conn, &c.id, "9", "text", 2).unwrap();
        items::soft_delete(&conn, &c.id, 3).unwrap();
        assert!(matches!(get_details(&conn, &c.id), Err(DbError::NotFound)));
        assert!(matches!(set_details(&conn, &c.id, "1", "", 4), Err(DbError::NotFound)));
        trash::restore_item(&conn, &c.id, 5).unwrap();
        assert_eq!(get_details(&conn, &c.id).unwrap().value, "9");
    }

    #[test]
    fn value_notes_and_tags_are_searchable() {
        let (conn, camp) = setup();
        let c = card(&conn, &camp, "The Tower");
        set_details(&conn, &c.id, "XVI", "Sudden upheaval", 2).unwrap();
        let tag = tags::create(&conn, &camp, None, "Omen", None, 3).unwrap();
        tags::add_to_item(&conn, &c.id, &tag.id, 4).unwrap();
        for q in ["tower", "xvi", "upheaval", "omen"] {
            assert_eq!(search::search(&conn, &camp, q, Some("cards"), 10).unwrap().len(), 1, "'{q}'");
        }
        set_details(&conn, &c.id, "16", "Calm", 5).unwrap();
        assert!(search::search(&conn, &camp, "upheaval", None, 10).unwrap().is_empty());
        assert_eq!(search::search(&conn, &camp, "calm", None, 10).unwrap().len(), 1);
    }

    #[test]
    fn pictures_round_trip_for_every_allowed_type() {
        let (conn, camp) = setup();
        for (mime, bytes) in [("image/jpeg", jpeg()), ("image/png", png()), ("image/webp", webp())] {
            let c = card(&conn, &camp, mime);
            assert_eq!(get_image(&conn, &c.id).unwrap(), None);
            set_image(&conn, &c.id, mime, &bytes, &bytes[..12], 10).unwrap();
            let full = get_image(&conn, &c.id).unwrap().unwrap();
            assert_eq!(full.mime, mime);
            assert_eq!(decode_base64(&full.data).unwrap(), bytes);
            let thumbs = get_thumbs(&conn, &[c.id.clone()]).unwrap();
            assert_eq!(decode_base64(&thumbs[0].data).unwrap(), &bytes[..12]);
            assert_eq!(items::get(&conn, &c.id).unwrap().updated_at, 10);
        }
    }

    #[test]
    fn a_picture_can_be_replaced_and_removed() {
        let (conn, camp) = setup();
        let c = card(&conn, &camp, "Card");
        set_image(&conn, &c.id, "image/png", &png(), &png(), 2).unwrap();
        set_image(&conn, &c.id, "image/jpeg", &jpeg(), &jpeg(), 3).unwrap();
        assert_eq!(get_image(&conn, &c.id).unwrap().unwrap().mime, "image/jpeg");
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM card_images", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);
        remove_image(&conn, &c.id, 4).unwrap();
        assert_eq!(get_image(&conn, &c.id).unwrap(), None);
        remove_image(&conn, &c.id, 5).unwrap(); // nothing to remove: fine
    }

    #[test]
    fn bad_pictures_are_refused_and_keep_the_old_one() {
        let (conn, camp) = setup();
        let c = card(&conn, &camp, "Card");
        set_image(&conn, &c.id, "image/png", &png(), &png(), 2).unwrap();
        let big = [png(), vec![0u8; MAX_IMAGE_BYTES]].concat();
        let big_thumb = [png(), vec![0u8; MAX_THUMB_BYTES]].concat();
        let cases: Vec<(&str, Vec<u8>, Vec<u8>)> = vec![
            ("image/gif", png(), png()),          // type not allowed
            ("image/png", jpeg(), png()),         // bytes are not a PNG
            ("image/png", png(), jpeg()),         // thumbnail is not a PNG
            ("image/png", b"hello".to_vec(), png()), // not a picture at all
            ("image/png", Vec::new(), png()),     // empty
            ("image/png", png(), Vec::new()),     // empty thumbnail
            ("image/png", big, png()),            // too large
            ("image/png", png(), big_thumb),      // thumbnail too large
        ];
        for (mime, image, thumb) in cases {
            assert!(
                matches!(set_image(&conn, &c.id, mime, &image, &thumb, 3), Err(DbError::Invalid(_))),
                "{mime} should be refused"
            );
        }
        assert_eq!(get_image(&conn, &c.id).unwrap().unwrap().mime, "image/png");
        // Exactly at the limits is fine.
        let max_image = [png(), vec![0u8; MAX_IMAGE_BYTES - png().len()]].concat();
        let max_thumb = [png(), vec![0u8; MAX_THUMB_BYTES - png().len()]].concat();
        set_image(&conn, &c.id, "image/png", &max_image, &max_thumb, 4).unwrap();
    }

    #[test]
    fn thumbnails_come_back_only_for_live_cards_that_have_one() {
        let (conn, camp) = setup();
        let with = card(&conn, &camp, "With");
        let without = card(&conn, &camp, "Without");
        let trashed = card(&conn, &camp, "Trashed");
        for c in [&with, &trashed] {
            set_image(&conn, &c.id, "image/png", &png(), &png(), 2).unwrap();
        }
        items::soft_delete(&conn, &trashed.id, 3).unwrap();
        let ids = vec![with.id.clone(), without.id.clone(), trashed.id.clone(), "nope".to_string()];
        let got = get_thumbs(&conn, &ids).unwrap();
        assert_eq!(got.iter().map(|t| t.item_id.as_str()).collect::<Vec<_>>(), [with.id.as_str()]);
        let too_many: Vec<String> = (0..=MAX_THUMB_BATCH).map(|i| i.to_string()).collect();
        assert!(matches!(get_thumbs(&conn, &too_many), Err(DbError::Invalid(_))));
    }

    #[test]
    fn purging_the_card_removes_its_details_and_picture() {
        let (conn, camp) = setup();
        let c = card(&conn, &camp, "Card");
        set_details(&conn, &c.id, "1", "n", 2).unwrap();
        set_image(&conn, &c.id, "image/png", &png(), &png(), 2).unwrap();
        items::soft_delete(&conn, &c.id, 3).unwrap();
        trash::purge_item(&conn, &c.id).unwrap();
        for table in ["card_details", "card_images"] {
            let rows: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
            assert_eq!(rows, 0, "{table}");
        }
    }

    #[test]
    fn base64_from_javascript_is_decoded_or_refused() {
        assert_eq!(decode_base64(" aGVsbG8= ").unwrap(), b"hello");
        assert!(matches!(decode_base64("not base64!!"), Err(DbError::Invalid(_))));
    }
}
