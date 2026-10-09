//! Export one campaign to a pack (a zip held in memory).
//!
//! A backup should be complete, so trashed folders, items and tags are included
//! (with their `deleted_at`) and come back as trash when imported.

use super::format::*;
use super::PackError;
use crate::db::{campaigns, migrations};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::io::{Cursor, Write};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

/// Builds the pack for a live campaign and returns the zip file's bytes.
pub fn export_campaign(conn: &Connection, campaign_id: &str, now: i64) -> Result<Vec<u8>, PackError> {
    let campaign = campaigns::get_live(conn, campaign_id)?;

    let folders = read_folders(conn, campaign_id)?;
    let items = read_items(conn, campaign_id)?;
    let tags = read_tags(conn, campaign_id)?;
    let item_tags = read_item_tags(conn, campaign_id)?;
    let links = read_links(conn, campaign_id)?;
    let documents = read_documents(conn, campaign_id)?;
    let saved_rolls = read_saved_rolls(conn, campaign_id)?;
    let formulas = read_formulas(conn, campaign_id)?;
    let card_details = read_card_details(conn, campaign_id)?;
    let collection_members = read_collection_members(conn, campaign_id)?;
    let card_images = read_card_images(conn, campaign_id)?;
    let saved_draws = read_saved_draws(conn, campaign_id)?;
    let play_decks = read_play_decks(conn, campaign_id)?;
    let spreads = read_spreads(conn, campaign_id)?;
    let spread_positions = read_spread_positions(conn, campaign_id)?;
    let random_tables = read_random_tables(conn, campaign_id)?;
    let table_entries = read_table_entries(conn, campaign_id)?;
    let table_entry_tags = read_table_entry_tags(conn, campaign_id)?;
    let name_presets = read_name_presets(conn, campaign_id)?;
    let field_definitions = read_field_definitions(conn, campaign_id)?;
    let field_sets = read_field_sets(conn, campaign_id)?;
    let field_set_members = read_field_set_members(conn, campaign_id)?;
    let item_field_sets = read_item_field_sets(conn, campaign_id)?;
    let field_values = read_field_values(conn, campaign_id)?;

    let manifest = Manifest {
        format: FORMAT.to_string(),
        format_version: FORMAT_VERSION,
        pack_id: Uuid::now_v7().to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version: migrations::current_version(conn)?,
        created_at: now,
        campaign: CampaignInfo { name: campaign.name },
        counts: Counts {
            folders: folders.len() as u32,
            items: items.len() as u32,
            tags: tags.len() as u32,
            item_tags: item_tags.len() as u32,
            links: links.len() as u32,
            documents: documents.len() as u32,
            saved_rolls: saved_rolls.len() as u32,
            formulas: formulas.len() as u32,
            card_details: card_details.len() as u32,
            collection_members: collection_members.len() as u32,
            card_images: card_images.len() as u32,
            saved_draws: saved_draws.len() as u32,
            play_decks: play_decks.len() as u32,
            spreads: spreads.len() as u32,
            spread_positions: spread_positions.len() as u32,
            random_tables: random_tables.len() as u32,
            table_entries: table_entries.len() as u32,
            table_entry_tags: table_entry_tags.len() as u32,
            name_presets: name_presets.len() as u32,
            field_definitions: field_definitions.len() as u32,
            field_sets: field_sets.len() as u32,
            field_set_members: field_set_members.len() as u32,
            item_field_sets: item_field_sets.len() as u32,
            field_values: field_values.len() as u32,
        },
    };

    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    put(&mut zip, options, MANIFEST_FILE, &manifest, true)?;
    put(&mut zip, options, FOLDERS_FILE, &folders, false)?;
    put(&mut zip, options, ITEMS_FILE, &items, false)?;
    put(&mut zip, options, TAGS_FILE, &tags, false)?;
    put(&mut zip, options, ITEM_TAGS_FILE, &item_tags, false)?;
    put(&mut zip, options, LINKS_FILE, &links, false)?;
    put(&mut zip, options, DOCUMENTS_FILE, &documents, false)?;
    put(&mut zip, options, SAVED_ROLLS_FILE, &saved_rolls, false)?;
    put(&mut zip, options, FORMULAS_FILE, &formulas, false)?;
    put(&mut zip, options, CARD_DETAILS_FILE, &card_details, false)?;
    put(&mut zip, options, SAVED_DRAWS_FILE, &saved_draws, false)?;
    put(&mut zip, options, PLAY_DECKS_FILE, &play_decks, false)?;
    put(&mut zip, options, SPREADS_FILE, &spreads, false)?;
    put(&mut zip, options, SPREAD_POSITIONS_FILE, &spread_positions, false)?;
    put(&mut zip, options, RANDOM_TABLES_FILE, &random_tables, false)?;
    put(&mut zip, options, TABLE_ENTRIES_FILE, &table_entries, false)?;
    put(&mut zip, options, TABLE_ENTRY_TAGS_FILE, &table_entry_tags, false)?;
    put(&mut zip, options, NAME_PRESETS_FILE, &name_presets, false)?;
    put(&mut zip, options, FIELD_DEFINITIONS_FILE, &field_definitions, false)?;
    put(&mut zip, options, FIELD_SETS_FILE, &field_sets, false)?;
    put(&mut zip, options, FIELD_SET_MEMBERS_FILE, &field_set_members, false)?;
    put(&mut zip, options, ITEM_FIELD_SETS_FILE, &item_field_sets, false)?;
    put(&mut zip, options, FIELD_VALUES_FILE, &field_values, false)?;
    put(&mut zip, options, COLLECTION_MEMBERS_FILE, &collection_members, false)?;
    let image_records: Vec<CardImageRecord> = card_images.iter().map(|(r, _, _)| r.clone()).collect();
    put(&mut zip, options, CARD_IMAGES_FILE, &image_records, false)?;
    // Pictures are already compressed, so they are stored as they are.
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (record, image, thumb) in &card_images {
        put_bytes(&mut zip, stored, &record.image_file, image)?;
        put_bytes(&mut zip, stored, &record.thumb_file, thumb)?;
    }
    let cursor = zip.finish().map_err(|e| PackError::Failed(e.to_string()))?;
    Ok(cursor.into_inner())
}

fn put<T: Serialize>(
    zip: &mut ZipWriter<Cursor<Vec<u8>>>,
    options: SimpleFileOptions,
    name: &str,
    value: &T,
    pretty: bool,
) -> Result<(), PackError> {
    let bytes = if pretty {
        serde_json::to_vec_pretty(value)
    } else {
        serde_json::to_vec(value)
    }
    .map_err(|e| PackError::Failed(e.to_string()))?;
    zip.start_file(name, options)
        .map_err(|e| PackError::Failed(e.to_string()))?;
    zip.write_all(&bytes)
        .map_err(|e| PackError::Failed(e.to_string()))
}

fn read_folders(conn: &Connection, campaign_id: &str) -> Result<Vec<FolderRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT id, library, parent_id, name, created_at, updated_at, deleted_at
         FROM folders WHERE campaign_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(FolderRecord {
            id: r.get(0)?,
            library: r.get(1)?,
            parent_id: r.get(2)?,
            name: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
            deleted_at: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_items(conn: &Connection, campaign_id: &str) -> Result<Vec<ItemRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT id, library, item_type, name, icon, folder_id, visibility, created_at, updated_at, deleted_at
         FROM items WHERE campaign_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(ItemRecord {
            id: r.get(0)?,
            library: r.get(1)?,
            item_type: r.get(2)?,
            name: r.get(3)?,
            icon: r.get(4)?,
            folder_id: r.get(5)?,
            visibility: r.get(6)?,
            created_at: r.get(7)?,
            updated_at: r.get(8)?,
            deleted_at: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_tags(conn: &Connection, campaign_id: &str) -> Result<Vec<TagRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, name, color, created_at, updated_at, deleted_at
         FROM tags WHERE campaign_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(TagRecord {
            id: r.get(0)?,
            parent_id: r.get(1)?,
            name: r.get(2)?,
            color: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
            deleted_at: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_item_tags(conn: &Connection, campaign_id: &str) -> Result<Vec<ItemTagRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT it.item_id, it.tag_id, it.created_at, it.updated_at, it.deleted_at
         FROM item_tags it JOIN items i ON i.id = it.item_id
         WHERE i.campaign_id = ?1 ORDER BY it.created_at, it.item_id, it.tag_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(ItemTagRecord {
            item_id: r.get(0)?,
            tag_id: r.get(1)?,
            created_at: r.get(2)?,
            updated_at: r.get(3)?,
            deleted_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_links(conn: &Connection, campaign_id: &str) -> Result<Vec<LinkRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT l.source_item_id, l.target_item_id, l.source_ref, l.created_at, l.updated_at, l.deleted_at
         FROM links l JOIN items s ON s.id = l.source_item_id
         WHERE s.campaign_id = ?1
         ORDER BY l.created_at, l.source_item_id, l.target_item_id, l.source_ref",
    )?;
    let rows = stmt.query_map(params![campaign_id], |r| {
        Ok(LinkRecord {
            source_item_id: r.get(0)?,
            target_item_id: r.get(1)?,
            source_ref: r.get(2)?,
            created_at: r.get(3)?,
            updated_at: r.get(4)?,
            deleted_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_documents(conn: &Connection, campaign_id: &str) -> Result<Vec<DocumentRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT d.item_id, d.body, d.created_at, d.updated_at
         FROM document_content d JOIN items i ON i.id = d.item_id
         WHERE i.campaign_id = ?1 ORDER BY d.created_at, d.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(DocumentRecord {
            item_id: r.get(0)?,
            body: r.get(1)?,
            created_at: r.get(2)?,
            updated_at: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_saved_rolls(conn: &Connection, campaign_id: &str) -> Result<Vec<SavedRollRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT s.item_id, s.notation, s.seed, s.text, s.result_json, s.created_at, s.updated_at
         FROM saved_rolls s JOIN items i ON i.id = s.item_id
         WHERE i.campaign_id = ?1 ORDER BY s.created_at, s.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(SavedRollRecord {
            item_id: r.get(0)?,
            notation: r.get(1)?,
            seed: r.get(2)?,
            text: r.get(3)?,
            result_json: r.get(4)?,
            created_at: r.get(5)?,
            updated_at: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_formulas(conn: &Connection, campaign_id: &str) -> Result<Vec<FormulaRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT f.item_id, f.notation, f.created_at, f.updated_at
         FROM formulas f JOIN items i ON i.id = f.item_id
         WHERE i.campaign_id = ?1 ORDER BY f.created_at, f.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(FormulaRecord {
            item_id: r.get(0)?,
            notation: r.get(1)?,
            created_at: r.get(2)?,
            updated_at: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn put_bytes(
    zip: &mut ZipWriter<Cursor<Vec<u8>>>,
    options: SimpleFileOptions,
    name: &str,
    bytes: &[u8],
) -> Result<(), PackError> {
    zip.start_file(name, options)
        .map_err(|e| PackError::Failed(e.to_string()))?;
    zip.write_all(bytes).map_err(|e| PackError::Failed(e.to_string()))
}

fn read_card_details(conn: &Connection, campaign_id: &str) -> Result<Vec<CardDetailRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT d.item_id, d.value, d.notes, d.created_at, d.updated_at
         FROM card_details d JOIN items i ON i.id = d.item_id
         WHERE i.campaign_id = ?1 ORDER BY d.created_at, d.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(CardDetailRecord {
            item_id: r.get(0)?,
            value: r.get(1)?,
            notes: r.get(2)?,
            created_at: r.get(3)?,
            updated_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_collection_members(
    conn: &Connection,
    campaign_id: &str,
) -> Result<Vec<CollectionMemberRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT m.collection_id, m.member_id, m.position, m.created_at, m.updated_at, m.deleted_at
         FROM collection_members m JOIN items c ON c.id = m.collection_id
         WHERE c.campaign_id = ?1
         ORDER BY m.collection_id, m.position, m.member_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(CollectionMemberRecord {
            collection_id: r.get(0)?,
            member_id: r.get(1)?,
            position: r.get(2)?,
            created_at: r.get(3)?,
            updated_at: r.get(4)?,
            deleted_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn extension_for(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/webp" => "webp",
        _ => "jpg",
    }
}

/// Each card picture with the record that names its two files in the zip.
fn read_card_images(
    conn: &Connection,
    campaign_id: &str,
) -> Result<Vec<(CardImageRecord, Vec<u8>, Vec<u8>)>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT c.item_id, c.mime, c.image, c.thumb, c.created_at, c.updated_at
         FROM card_images c JOIN items i ON i.id = c.item_id
         WHERE i.campaign_id = ?1 ORDER BY c.created_at, c.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        let item_id: String = r.get(0)?;
        let mime: String = r.get(1)?;
        let ext = extension_for(&mime);
        let record = CardImageRecord {
            image_file: format!("{CARD_ASSET_DIR}{item_id}.{ext}"),
            thumb_file: format!("{CARD_ASSET_DIR}{item_id}.thumb.{ext}"),
            item_id,
            mime,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        };
        Ok((record, r.get::<_, Vec<u8>>(2)?, r.get::<_, Vec<u8>>(3)?))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_saved_draws(conn: &Connection, campaign_id: &str) -> Result<Vec<SavedDrawRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT s.item_id, s.source_name, s.seed, s.text, s.result_json, s.notes, s.created_at, s.updated_at
         FROM saved_draws s JOIN items i ON i.id = s.item_id
         WHERE i.campaign_id = ?1 ORDER BY s.created_at, s.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(SavedDrawRecord {
            item_id: r.get(0)?,
            source_name: r.get(1)?,
            seed: r.get(2)?,
            text: r.get(3)?,
            result_json: r.get(4)?,
            notes: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_play_decks(conn: &Connection, campaign_id: &str) -> Result<Vec<PlayDeckRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT p.item_id, p.source_id, p.source_name, p.state_json, p.created_at, p.updated_at
         FROM play_decks p JOIN items i ON i.id = p.item_id
         WHERE i.campaign_id = ?1 ORDER BY p.created_at, p.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(PlayDeckRecord {
            item_id: r.get(0)?,
            source_id: r.get(1)?,
            source_name: r.get(2)?,
            state_json: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_spreads(conn: &Connection, campaign_id: &str) -> Result<Vec<SpreadRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT s.item_id, s.notes, s.reversals, s.reversal_percent, s.created_at, s.updated_at
         FROM spreads s JOIN items i ON i.id = s.item_id
         WHERE i.campaign_id = ?1 ORDER BY s.created_at, s.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(SpreadRecord {
            item_id: r.get(0)?,
            notes: r.get(1)?,
            reversals: r.get(2)?,
            reversal_percent: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_spread_positions(conn: &Connection, campaign_id: &str) -> Result<Vec<SpreadPositionRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT p.spread_id, p.position, p.name, p.source_id, p.meaning
         FROM spread_positions p JOIN items i ON i.id = p.spread_id
         WHERE i.campaign_id = ?1 ORDER BY p.spread_id, p.position",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(SpreadPositionRecord {
            spread_id: r.get(0)?,
            position: r.get(1)?,
            name: r.get(2)?,
            source_id: r.get(3)?,
            meaning: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_random_tables(conn: &Connection, campaign_id: &str) -> Result<Vec<RandomTableRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT t.item_id, t.notes, t.die_size, t.avoid_recent, t.created_at, t.updated_at
         FROM random_tables t JOIN items i ON i.id = t.item_id
         WHERE i.campaign_id = ?1 ORDER BY t.created_at, t.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(RandomTableRecord {
            item_id: r.get(0)?,
            notes: r.get(1)?,
            die_size: r.get(2)?,
            avoid_recent: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Every entry, including deleted ones. (What was recently rolled is per-device memory and is not exported.)
fn read_table_entries(conn: &Connection, campaign_id: &str) -> Result<Vec<TableEntryRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.table_id, e.position, e.text, e.weight, e.created_at, e.updated_at, e.deleted_at
         FROM table_entries e JOIN items i ON i.id = e.table_id
         WHERE i.campaign_id = ?1 ORDER BY e.table_id, e.position, e.created_at, e.id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(TableEntryRecord {
            id: r.get(0)?,
            table_id: r.get(1)?,
            position: r.get(2)?,
            text: r.get(3)?,
            weight: r.get(4)?,
            created_at: r.get(5)?,
            updated_at: r.get(6)?,
            deleted_at: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_table_entry_tags(conn: &Connection, campaign_id: &str) -> Result<Vec<TableEntryTagRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT l.entry_id, l.tag_id, l.created_at, l.updated_at, l.deleted_at
         FROM table_entry_tags l
         JOIN table_entries e ON e.id = l.entry_id
         JOIN items i ON i.id = e.table_id
         WHERE i.campaign_id = ?1 ORDER BY l.entry_id, l.tag_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(TableEntryTagRecord {
            entry_id: r.get(0)?,
            tag_id: r.get(1)?,
            created_at: r.get(2)?,
            updated_at: r.get(3)?,
            deleted_at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_field_definitions(conn: &Connection, campaign_id: &str) -> Result<Vec<FieldDefinitionRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, kind, description, config_json, created_at, updated_at, deleted_at
         FROM field_definitions WHERE campaign_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(FieldDefinitionRecord {
            id: r.get(0)?,
            name: r.get(1)?,
            kind: r.get(2)?,
            description: r.get(3)?,
            config_json: r.get(4)?,
            created_at: r.get(5)?,
            updated_at: r.get(6)?,
            deleted_at: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_field_sets(conn: &Connection, campaign_id: &str) -> Result<Vec<FieldSetRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, description, created_at, updated_at, deleted_at
         FROM field_sets WHERE campaign_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(FieldSetRecord {
            id: r.get(0)?,
            name: r.get(1)?,
            description: r.get(2)?,
            created_at: r.get(3)?,
            updated_at: r.get(4)?,
            deleted_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_field_set_members(conn: &Connection, campaign_id: &str) -> Result<Vec<FieldSetMemberRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT m.set_id, m.field_id, m.position, m.created_at, m.updated_at, m.deleted_at
         FROM field_set_members m JOIN field_sets s ON s.id = m.set_id
         WHERE s.campaign_id = ?1 ORDER BY m.set_id, m.position, m.field_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(FieldSetMemberRecord {
            set_id: r.get(0)?,
            field_id: r.get(1)?,
            position: r.get(2)?,
            created_at: r.get(3)?,
            updated_at: r.get(4)?,
            deleted_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_item_field_sets(conn: &Connection, campaign_id: &str) -> Result<Vec<ItemFieldSetRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT a.item_id, a.set_id, a.position, a.created_at, a.updated_at, a.deleted_at
         FROM item_field_sets a JOIN items i ON i.id = a.item_id
         WHERE i.campaign_id = ?1 ORDER BY a.item_id, a.position, a.set_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(ItemFieldSetRecord {
            item_id: r.get(0)?,
            set_id: r.get(1)?,
            position: r.get(2)?,
            created_at: r.get(3)?,
            updated_at: r.get(4)?,
            deleted_at: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_field_values(conn: &Connection, campaign_id: &str) -> Result<Vec<FieldValueRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT v.item_id, v.field_id, v.value_json, v.sort_num, v.sort_text, v.search_text, v.secret,
                v.created_at, v.updated_at, v.deleted_at
         FROM field_values v JOIN items i ON i.id = v.item_id
         WHERE i.campaign_id = ?1 ORDER BY v.item_id, v.field_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(FieldValueRecord {
            item_id: r.get(0)?,
            field_id: r.get(1)?,
            value_json: r.get(2)?,
            sort_num: r.get(3)?,
            sort_text: r.get(4)?,
            search_text: r.get(5)?,
            secret: r.get::<_, i64>(6)? != 0,
            created_at: r.get(7)?,
            updated_at: r.get(8)?,
            deleted_at: r.get(9)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn read_name_presets(conn: &Connection, campaign_id: &str) -> Result<Vec<NamePresetRecord>, PackError> {
    let mut stmt = conn.prepare(
        "SELECT p.item_id, p.setup_json, p.created_at, p.updated_at
         FROM name_presets p JOIN items i ON i.id = p.item_id
         WHERE i.campaign_id = ?1 ORDER BY p.created_at, p.item_id",
    )?;
    let rows = stmt.query_map([campaign_id], |r| {
        Ok(NamePresetRecord { item_id: r.get(0)?, setup_json: r.get(1)?, created_at: r.get(2)?, updated_at: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}
