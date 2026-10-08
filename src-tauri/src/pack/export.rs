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
