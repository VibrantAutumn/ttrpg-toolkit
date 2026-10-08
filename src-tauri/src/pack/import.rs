//! Import a pack as a NEW campaign.
//!
//! Reading is separate from writing: `read_pack` opens the zip under safety
//! limits, parses it, and tidies anything inconsistent (reporting each fix as a
//! warning) without touching the database. `import_pack` then writes the result
//! in a single transaction, so an import either fully happens or not at all.
//! Everything gets fresh ids; nothing existing is ever overwritten.

use super::format::*;
use super::PackError;
use crate::db::campaigns::{self, Campaign};
use crate::db::{cards, collections, documents, formulas, play_decks, saved_draws, saved_rolls, settings, spreads, tables};
use rusqlite::{params, Connection, ErrorCode};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Cursor, Read, Seek};
use uuid::Uuid;
use zip::{result::ZipError, ZipArchive};

/// Safety limits against huge or booby-trapped files ("zip bombs").
#[derive(Debug, Clone)]
pub struct Limits {
    pub max_entries: usize,
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_entries: 5_000,
            max_entry_bytes: 100 * 1024 * 1024,
            max_total_bytes: 300 * 1024 * 1024,
        }
    }
}

/// A pack that has been read and tidied; ready to preview or import.
#[derive(Debug)]
pub struct ParsedPack {
    pub manifest: Manifest,
    pub folders: Vec<FolderRecord>,
    pub items: Vec<ItemRecord>,
    pub tags: Vec<TagRecord>,
    pub item_tags: Vec<ItemTagRecord>,
    pub links: Vec<LinkRecord>,
    pub documents: Vec<DocumentRecord>,
    pub saved_rolls: Vec<SavedRollRecord>,
    pub formulas: Vec<FormulaRecord>,
    pub card_details: Vec<CardDetailRecord>,
    pub collection_members: Vec<CollectionMemberRecord>,
    pub card_images: Vec<ParsedCardImage>,
    pub saved_draws: Vec<SavedDrawRecord>,
    pub play_decks: Vec<PlayDeckRecord>,
    pub spreads: Vec<SpreadRecord>,
    pub spread_positions: Vec<SpreadPositionRecord>,
    pub random_tables: Vec<RandomTableRecord>,
    pub table_entries: Vec<TableEntryRecord>,
    pub table_entry_tags: Vec<TableEntryTagRecord>,
    /// Plain-language notes about anything that had to be fixed or skipped.
    pub warnings: Vec<String>,
}

impl ParsedPack {
    /// What will actually be imported (after tidying).
    pub fn counts(&self) -> Counts {
        Counts {
            folders: self.folders.len() as u32,
            items: self.items.len() as u32,
            tags: self.tags.len() as u32,
            item_tags: self.item_tags.len() as u32,
            links: self.links.len() as u32,
            documents: self.documents.len() as u32,
            saved_rolls: self.saved_rolls.len() as u32,
            formulas: self.formulas.len() as u32,
            card_details: self.card_details.len() as u32,
            collection_members: self.collection_members.len() as u32,
            card_images: self.card_images.len() as u32,
            saved_draws: self.saved_draws.len() as u32,
            play_decks: self.play_decks.len() as u32,
            spreads: self.spreads.len() as u32,
            spread_positions: self.spread_positions.len() as u32,
            random_tables: self.random_tables.len() as u32,
            table_entries: self.table_entries.len() as u32,
            table_entry_tags: self.table_entry_tags.len() as u32,
        }
    }
}

/// A card picture with the bytes of its two files (empty if a file was missing).
#[derive(Debug)]
pub struct ParsedCardImage {
    pub record: CardImageRecord,
    pub image: Vec<u8>,
    pub thumb: Vec<u8>,
}

/// What the import preview shows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPreview {
    pub campaign_name: String,
    pub created_at: i64,
    pub app_version: String,
    pub format_version: u32,
    pub counts: Counts,
    /// How many of the folders, items and tags are in the pack's trash.
    pub trashed: u32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub campaign: Campaign,
    pub counts: Counts,
    pub warnings: Vec<String>,
}

pub fn preview(pack: &ParsedPack) -> PackPreview {
    let trashed = pack.folders.iter().filter(|f| f.deleted_at.is_some()).count()
        + pack.items.iter().filter(|i| i.deleted_at.is_some()).count()
        + pack.tags.iter().filter(|t| t.deleted_at.is_some()).count();
    PackPreview {
        campaign_name: pack.manifest.campaign.name.clone(),
        created_at: pack.manifest.created_at,
        app_version: pack.manifest.app_version.clone(),
        format_version: pack.manifest.format_version,
        counts: pack.counts(),
        trashed: trashed as u32,
        warnings: pack.warnings.clone(),
    }
}

// ---------------------------------------------------------------- reading

pub fn read_pack(bytes: &[u8]) -> Result<ParsedPack, PackError> {
    read_pack_with(bytes, &Limits::default())
}

pub fn read_pack_with(bytes: &[u8], limits: &Limits) -> Result<ParsedPack, PackError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| PackError::NotAPack("it isn't a zip file"))?;
    if archive.len() > limits.max_entries {
        return Err(PackError::TooLarge);
    }
    let mut total = 0u64;

    let manifest_bytes = read_entry(&mut archive, MANIFEST_FILE, limits, &mut total)?
        .ok_or(PackError::NotAPack("it has no manifest"))?;
    let manifest = parse_manifest(&manifest_bytes)?;

    let image_records: Vec<CardImageRecord> = read_list(&mut archive, CARD_IMAGES_FILE, limits, &mut total)?;
    let mut card_images = Vec::with_capacity(image_records.len());
    for record in image_records {
        let image = read_asset(&mut archive, &record.image_file, limits, &mut total)?;
        let thumb = read_asset(&mut archive, &record.thumb_file, limits, &mut total)?;
        card_images.push(ParsedCardImage { record, image, thumb });
    }

    let mut pack = ParsedPack {
        manifest,
        folders: read_list(&mut archive, FOLDERS_FILE, limits, &mut total)?,
        items: read_list(&mut archive, ITEMS_FILE, limits, &mut total)?,
        tags: read_list(&mut archive, TAGS_FILE, limits, &mut total)?,
        item_tags: read_list(&mut archive, ITEM_TAGS_FILE, limits, &mut total)?,
        links: read_list(&mut archive, LINKS_FILE, limits, &mut total)?,
        documents: read_list(&mut archive, DOCUMENTS_FILE, limits, &mut total)?,
        saved_rolls: read_list(&mut archive, SAVED_ROLLS_FILE, limits, &mut total)?,
        formulas: read_list(&mut archive, FORMULAS_FILE, limits, &mut total)?,
        card_details: read_list(&mut archive, CARD_DETAILS_FILE, limits, &mut total)?,
        collection_members: read_list(&mut archive, COLLECTION_MEMBERS_FILE, limits, &mut total)?,
        card_images,
        saved_draws: read_list(&mut archive, SAVED_DRAWS_FILE, limits, &mut total)?,
        play_decks: read_list(&mut archive, PLAY_DECKS_FILE, limits, &mut total)?,
        spreads: read_list(&mut archive, SPREADS_FILE, limits, &mut total)?,
        spread_positions: read_list(&mut archive, SPREAD_POSITIONS_FILE, limits, &mut total)?,
        random_tables: read_list(&mut archive, RANDOM_TABLES_FILE, limits, &mut total)?,
        table_entries: read_list(&mut archive, TABLE_ENTRIES_FILE, limits, &mut total)?,
        table_entry_tags: read_list(&mut archive, TABLE_ENTRY_TAGS_FILE, limits, &mut total)?,
        warnings: Vec::new(),
    };
    sanitize(&mut pack);
    Ok(pack)
}

fn parse_manifest(bytes: &[u8]) -> Result<Manifest, PackError> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| PackError::NotAPack("its manifest can't be read"))?;
    if value.get("format").and_then(|f| f.as_str()) != Some(FORMAT) {
        return Err(PackError::NotAPack("it's some other kind of zip file"));
    }
    let version = value
        .get("formatVersion")
        .and_then(|v| v.as_u64())
        .filter(|v| *v > 0)
        .ok_or_else(|| PackError::Corrupt("the manifest has no valid format version".into()))?;
    if version > FORMAT_VERSION as u64 {
        return Err(PackError::TooNew {
            found: version.min(u32::MAX as u64) as u32,
            supported: FORMAT_VERSION,
        });
    }
    // Older format versions would be upgraded to the current shape here.
    serde_json::from_value(value)
        .map_err(|e| PackError::Corrupt(format!("the manifest is incomplete ({e})")))
}

/// Reads one named entry, refusing anything over the size limits.
/// `Ok(None)` if the zip has no such entry.
fn read_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    limits: &Limits,
    total: &mut u64,
) -> Result<Option<Vec<u8>>, PackError> {
    let file = match archive.by_name(name) {
        Ok(file) => file,
        Err(ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(PackError::Corrupt(format!("{name} can't be opened ({e})"))),
    };
    let mut buf = Vec::new();
    file.take(limits.max_entry_bytes + 1)
        .read_to_end(&mut buf)
        .map_err(|e| PackError::Corrupt(format!("{name} can't be read ({e})")))?;
    if buf.len() as u64 > limits.max_entry_bytes {
        return Err(PackError::TooLarge);
    }
    *total += buf.len() as u64;
    if *total > limits.max_total_bytes {
        return Err(PackError::TooLarge);
    }
    Ok(Some(buf))
}

/// Reads a card picture file. Only files under `assets/cards/` are looked at; a
/// missing or misplaced file gives empty bytes (the picture is then dropped when tidying).
fn read_asset<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    limits: &Limits,
    total: &mut u64,
) -> Result<Vec<u8>, PackError> {
    if !name.starts_with(CARD_ASSET_DIR) {
        return Ok(Vec::new());
    }
    Ok(read_entry(archive, name, limits, total)?.unwrap_or_default())
}

/// Reads a JSON array entry. A missing entry counts as empty.
fn read_list<T: DeserializeOwned, R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
    limits: &Limits,
    total: &mut u64,
) -> Result<Vec<T>, PackError> {
    match read_entry(archive, name, limits, total)? {
        None => Ok(Vec::new()),
        Some(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| PackError::Corrupt(format!("{name} can't be read ({e})"))),
    }
}

// -------------------------------------------------------------- tidying

const VISIBILITIES: [&str; 3] = ["default", "visible", "secret"];

fn valid_color(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn name_or_untitled(name: &str) -> String {
    let name = name.trim();
    if name.is_empty() { "Untitled".to_string() } else { name.to_string() }
}

/// Orders records so every parent comes before its children (parents must be
/// inserted first). Records caught in a parent loop have their parent cleared to
/// break it. Returns the ordered records and how many loops were broken.
pub fn parent_first<T>(
    records: Vec<T>,
    id: impl Fn(&T) -> String,
    parent: impl Fn(&T) -> Option<String>,
    clear_parent: impl Fn(&mut T),
) -> (Vec<T>, usize) {
    let n = records.len();
    let ids: Vec<String> = records.iter().map(&id).collect();
    let mut children: HashMap<String, Vec<usize>> = HashMap::new();
    let mut queue: VecDeque<usize> = VecDeque::new();
    for (i, record) in records.iter().enumerate() {
        match parent(record) {
            Some(p) => children.entry(p).or_default().push(i),
            None => queue.push_back(i),
        }
    }

    let mut order = Vec::with_capacity(n);
    let mut seen = vec![false; n];
    let mut cleared = vec![false; n];
    let mut broken = 0;
    let mut next_unseen = 0;
    loop {
        while let Some(i) = queue.pop_front() {
            if seen[i] {
                continue;
            }
            seen[i] = true;
            order.push(i);
            if let Some(kids) = children.get(&ids[i]) {
                queue.extend(kids.iter().copied());
            }
        }
        while next_unseen < n && seen[next_unseen] {
            next_unseen += 1;
        }
        if next_unseen == n {
            break;
        }
        // Whatever is left is stuck in a parent loop: cut it here.
        cleared[next_unseen] = true;
        broken += 1;
        queue.push_back(next_unseen);
    }

    let mut slots: Vec<Option<T>> = records.into_iter().map(Some).collect();
    let ordered = order
        .into_iter()
        .map(|i| {
            let mut record = slots[i].take().expect("each record is placed once");
            if cleared[i] {
                clear_parent(&mut record);
            }
            record
        })
        .collect();
    (ordered, broken)
}

/// Fixes what can be fixed so the import can't trip over the pack's contents,
/// and records a plain-language warning for each kind of fix.
fn sanitize(pack: &mut ParsedPack) {
    let mut warnings: Vec<String> = Vec::new();
    let mut note = |count: usize, message: &str| {
        if count > 0 {
            warnings.push(format!("{count} {message}"));
        }
    };

    // Folders
    let before = pack.folders.len();
    let mut seen = HashSet::new();
    pack.folders
        .retain(|f| !f.id.is_empty() && !f.library.trim().is_empty() && seen.insert(f.id.clone()));
    note(before - pack.folders.len(), "folder(s) were incomplete or duplicated and were skipped.");
    for f in &mut pack.folders {
        f.name = name_or_untitled(&f.name);
    }
    let folder_library: HashMap<String, String> =
        pack.folders.iter().map(|f| (f.id.clone(), f.library.clone())).collect();
    let mut fixed = 0;
    for f in &mut pack.folders {
        if let Some(parent) = &f.parent_id {
            if folder_library.get(parent) != Some(&f.library) {
                f.parent_id = None;
                fixed += 1;
            }
        }
    }
    note(fixed, "folder(s) pointed at a missing parent folder and were moved to the top level.");
    let (folders, broken) = parent_first(
        std::mem::take(&mut pack.folders),
        |f| f.id.clone(),
        |f| f.parent_id.clone(),
        |f| f.parent_id = None,
    );
    pack.folders = folders;
    note(broken, "folder loop(s) were broken by moving a folder to the top level.");

    // Items
    let before = pack.items.len();
    let mut seen = HashSet::new();
    pack.items.retain(|i| {
        !i.id.is_empty()
            && !i.library.trim().is_empty()
            && !i.item_type.trim().is_empty()
            && seen.insert(i.id.clone())
    });
    note(before - pack.items.len(), "item(s) were incomplete or duplicated and were skipped.");
    let (mut bad_visibility, mut bad_folder) = (0, 0);
    for i in &mut pack.items {
        i.name = name_or_untitled(&i.name);
        if !VISIBILITIES.contains(&i.visibility.as_str()) {
            i.visibility = "default".to_string();
            bad_visibility += 1;
        }
        if let Some(folder) = &i.folder_id {
            if folder_library.get(folder) != Some(&i.library) {
                i.folder_id = None;
                bad_folder += 1;
            }
        }
    }
    note(bad_visibility, "item(s) had an unknown visibility and were set to the default.");
    note(bad_folder, "item(s) pointed at a missing folder and were moved to the top level.");

    // Slots find tables by name, so live tables must have different names: the older keeps
    // its name and later ones get a number.
    let mut live_tables: Vec<usize> = (0..pack.items.len())
        .filter(|&i| {
            let item = &pack.items[i];
            item.library == tables::LIBRARY && item.item_type == tables::TABLE_TYPE && item.deleted_at.is_none()
        })
        .collect();
    live_tables.sort_by_key(|&i| (pack.items[i].created_at, pack.items[i].id.clone()));
    let mut taken_names = HashSet::new();
    let mut renamed_tables = 0;
    for i in live_tables {
        let name = pack.items[i].name.clone();
        let mut candidate = name.clone();
        let mut n = 2;
        while !taken_names.insert(candidate.to_lowercase()) {
            candidate = format!("{name} ({n})");
            n += 1;
        }
        if candidate != name {
            pack.items[i].name = candidate;
            renamed_tables += 1;
        }
    }
    note(renamed_tables, "table(s) had the same name as another table and were renamed with a number.");

    // Tags
    let before = pack.tags.len();
    let mut seen = HashSet::new();
    pack.tags.retain(|t| {
        !t.id.is_empty() && !t.name.trim().is_empty() && seen.insert(t.id.clone())
    });
    note(before - pack.tags.len(), "tag(s) were incomplete or duplicated and were skipped.");
    let tag_ids: HashSet<String> = pack.tags.iter().map(|t| t.id.clone()).collect();
    let (mut bad_color, mut bad_parent) = (0, 0);
    for t in &mut pack.tags {
        t.name = t.name.trim().to_string();
        if t.color.as_deref().is_some_and(|c| !valid_color(c)) {
            t.color = None;
            bad_color += 1;
        }
        if t.parent_id.as_ref().is_some_and(|p| !tag_ids.contains(p)) {
            t.parent_id = None;
            bad_parent += 1;
        }
    }
    note(bad_color, "tag colour(s) were invalid and were removed.");
    note(bad_parent, "tag(s) pointed at a missing parent tag and were moved to the top level.");
    let (tags, broken) = parent_first(
        std::mem::take(&mut pack.tags),
        |t| t.id.clone(),
        |t| t.parent_id.clone(),
        |t| t.parent_id = None,
    );
    pack.tags = tags;
    note(broken, "tag loop(s) were broken by moving a tag to the top level.");
    // Live sibling tags must have different names; rename clashes.
    let mut taken: HashSet<(Option<String>, String)> = HashSet::new();
    let mut renamed = 0;
    for t in &mut pack.tags {
        if t.deleted_at.is_some() {
            continue;
        }
        let mut candidate = t.name.clone();
        let mut n = 2;
        while !taken.insert((t.parent_id.clone(), candidate.to_lowercase())) {
            candidate = format!("{} ({n})", t.name);
            n += 1;
        }
        if candidate != t.name {
            t.name = candidate;
            renamed += 1;
        }
    }
    note(renamed, "tag(s) shared a name with a sibling tag and were renamed.");

    // Links between things
    let item_type: HashMap<&str, &str> =
        pack.items.iter().map(|i| (i.id.as_str(), i.item_type.as_str())).collect();

    let before = pack.item_tags.len();
    let mut seen = HashSet::new();
    pack.item_tags.retain(|l| {
        item_type.contains_key(l.item_id.as_str())
            && tag_ids.contains(&l.tag_id)
            && seen.insert((l.item_id.clone(), l.tag_id.clone()))
    });
    note(before - pack.item_tags.len(), "tag attachment(s) referred to something missing and were skipped.");

    let before = pack.links.len();
    let mut seen = HashSet::new();
    for l in &mut pack.links {
        if l.source_ref.trim().is_empty() {
            l.source_ref = "manual".to_string();
        }
    }
    pack.links.retain(|l| {
        l.source_item_id != l.target_item_id
            && item_type.contains_key(l.source_item_id.as_str())
            && item_type.contains_key(l.target_item_id.as_str())
            && seen.insert((l.source_item_id.clone(), l.target_item_id.clone(), l.source_ref.clone()))
    });
    note(before - pack.links.len(), "link(s) referred to something missing and were skipped.");

    let before = pack.documents.len();
    let mut seen = HashSet::new();
    pack.documents.retain(|d| {
        item_type.get(d.item_id.as_str()) == Some(&documents::DOCUMENT_TYPE)
            && d.body.len() <= documents::MAX_BODY_BYTES
            && seen.insert(d.item_id.clone())
    });
    note(before - pack.documents.len(), "document text(s) belonged to something missing or were too long and were skipped.");

    let before = pack.saved_rolls.len();
    let mut seen = HashSet::new();
    pack.saved_rolls.retain(|r| {
        item_type.get(r.item_id.as_str()) == Some(&saved_rolls::SAVED_ROLL_TYPE)
            && saved_rolls::validate(&r.notation, &r.text, &r.result_json).is_ok()
            && seen.insert(r.item_id.clone())
    });
    note(before - pack.saved_rolls.len(), "saved roll(s) belonged to something missing or were unreadable and were skipped.");

    let before = pack.formulas.len();
    let mut seen = HashSet::new();
    pack.formulas.retain(|f| {
        item_type.get(f.item_id.as_str()) == Some(&formulas::FORMULA_TYPE)
            && formulas::validate(&f.notation).is_ok()
            && seen.insert(f.item_id.clone())
    });
    note(before - pack.formulas.len(), "formula(s) belonged to something missing or were unreadable and were skipped.");

    let before = pack.card_details.len();
    let mut seen = HashSet::new();
    pack.card_details.retain(|d| {
        item_type.get(d.item_id.as_str()) == Some(&cards::CARD_TYPE)
            && cards::validate_details(&d.value, &d.notes).is_ok()
            && seen.insert(d.item_id.clone())
    });
    note(before - pack.card_details.len(), "card value/notes were for something that isn't a card, were too long, or were duplicated and were skipped.");

    let before = pack.card_images.len();
    let mut seen = HashSet::new();
    pack.card_images.retain(|p| {
        item_type.get(p.record.item_id.as_str()) == Some(&cards::CARD_TYPE)
            && cards::validate_image(&p.record.mime, &p.image, &p.thumb).is_ok()
            && seen.insert(p.record.item_id.clone())
    });
    note(before - pack.card_images.len(), "card picture(s) were missing, damaged, too large or the wrong type and were skipped.");

    let before = pack.collection_members.len();
    let mut seen = HashSet::new();
    pack.collection_members.retain(|m| {
        let holds = match (item_type.get(m.collection_id.as_str()), item_type.get(m.member_id.as_str())) {
            (Some(collection), Some(member)) => collections::may_hold(collection, member),
            _ => false,
        };
        holds
            && m.collection_id != m.member_id
            && seen.insert((m.collection_id.clone(), m.member_id.clone()))
    });
    note(before - pack.collection_members.len(), "set/deck/pool entries referred to something missing or not allowed there and were skipped.");

    let before = pack.saved_draws.len();
    let mut seen = HashSet::new();
    pack.saved_draws.retain(|d| {
        item_type.get(d.item_id.as_str()) == Some(&saved_draws::DRAW_TYPE)
            && saved_draws::validate(&d.source_name, &d.text, &d.result_json, &d.notes).is_ok()
            && seen.insert(d.item_id.clone())
    });
    note(before - pack.saved_draws.len(), "saved draw(s) belonged to something missing or were unreadable and were skipped.");

    let before = pack.play_decks.len();
    let mut seen = HashSet::new();
    pack.play_decks.retain(|p| {
        item_type.get(p.item_id.as_str()) == Some(&play_decks::PLAY_TYPE)
            && play_decks::validate(&p.source_name, &p.state_json).is_ok()
            && seen.insert(p.item_id.clone())
    });
    note(before - pack.play_decks.len(), "deck(s) in play belonged to something missing or were unreadable and were skipped.");

    let before = pack.spreads.len();
    let mut seen = HashSet::new();
    pack.spreads.retain(|s| {
        item_type.get(s.item_id.as_str()) == Some(&spreads::SPREAD_TYPE)
            && s.notes.len() <= cards::MAX_NOTES_BYTES
            && (0..=100).contains(&s.reversal_percent)
            && seen.insert(s.item_id.clone())
    });
    note(before - pack.spreads.len(), "spread setting(s) belonged to something missing or were unreadable and were skipped.");

    // Positions: only for spreads, readable, at most 10 per spread, one per place.
    let before = pack.spread_positions.len();
    let mut seen = HashSet::new();
    let mut per_spread: HashMap<String, usize> = HashMap::new();
    pack.spread_positions.sort_by_key(|p| p.position);
    pack.spread_positions.retain(|p| {
        let keep = item_type.get(p.spread_id.as_str()) == Some(&spreads::SPREAD_TYPE)
            && spreads::validate_position(&p.name, &p.meaning).is_ok()
            && seen.insert((p.spread_id.clone(), p.position));
        if !keep {
            return false;
        }
        let n = per_spread.entry(p.spread_id.clone()).or_insert(0);
        *n += 1;
        *n <= spreads::MAX_POSITIONS
    });
    note(before - pack.spread_positions.len(), "spread position(s) belonged to something missing, were unreadable or were beyond the 10 allowed, and were skipped.");
    // A position's source must be a set, deck or pool that is in the pack; otherwise it is left unchosen.
    let mut cleared = 0;
    for p in &mut pack.spread_positions {
        let ok = p.source_id.as_deref().is_none_or(|s| {
            item_type.get(s).is_some_and(|t| collections::allowed_members(t).len() > 0)
        });
        if !ok {
            p.source_id = None;
            cleared += 1;
        }
    }
    note(cleared, "spread position(s) pointed at a missing source and were left without one.");

    // Random tables: settings for tables only, readable, once each.
    let before = pack.random_tables.len();
    let mut seen = HashSet::new();
    pack.random_tables.retain(|t| {
        item_type.get(t.item_id.as_str()) == Some(&tables::TABLE_TYPE)
            && t.notes.len() <= cards::MAX_NOTES_BYTES
            && tables::validate_options(t.die_size, t.avoid_recent).is_ok()
            && seen.insert(t.item_id.clone())
    });
    note(before - pack.random_tables.len(), "table setting(s) belonged to something missing or were unreadable and were skipped.");

    // Entries: for tables, readable, a unique id, and no more than 5,000 live ones per table.
    let before = pack.table_entries.len();
    let mut seen = HashSet::new();
    let mut live_per_table: HashMap<String, usize> = HashMap::new();
    pack.table_entries.sort_by_key(|e| e.position);
    pack.table_entries.retain(|e| {
        let keep = !e.id.is_empty()
            && item_type.get(e.table_id.as_str()) == Some(&tables::TABLE_TYPE)
            && tables::validate_entry(&e.text, e.weight).is_ok()
            && seen.insert(e.id.clone());
        if !keep {
            return false;
        }
        if e.deleted_at.is_some() {
            return true;
        }
        let n = live_per_table.entry(e.table_id.clone()).or_insert(0);
        *n += 1;
        *n <= tables::MAX_ENTRIES
    });
    note(before - pack.table_entries.len(), "table entry(ies) belonged to something missing, were unreadable or were beyond the 5,000 allowed, and were skipped.");

    let entry_ids: HashSet<String> = pack.table_entries.iter().map(|e| e.id.clone()).collect();
    let before = pack.table_entry_tags.len();
    let mut seen = HashSet::new();
    pack.table_entry_tags.retain(|l| {
        entry_ids.contains(&l.entry_id) && tag_ids.contains(&l.tag_id) && seen.insert((l.entry_id.clone(), l.tag_id.clone()))
    });
    note(before - pack.table_entry_tags.len(), "tag(s) on table entries referred to something missing and were skipped.");

    pack.warnings = warnings;
}

// -------------------------------------------------------------- writing

/// A constraint failure while writing means the pack's data didn't hold together.
fn db_error(e: rusqlite::Error) -> PackError {
    match &e {
        rusqlite::Error::SqliteFailure(err, _) if err.code == ErrorCode::ConstraintViolation => {
            PackError::Corrupt(format!("its data is inconsistent ({e})"))
        }
        _ => e.into(),
    }
}

/// Rewrites every string in `value` that is an old item id into its new id (a
/// saved draw or a game in play remembers cards by id, and import gives every
/// item a new id). Returns whether anything changed.
fn remap_ids(value: &mut serde_json::Value, ids: &HashMap<String, String>) -> bool {
    use serde_json::Value;
    match value {
        Value::String(s) => match ids.get(s.as_str()) {
            Some(new) => {
                *s = new.clone();
                true
            }
            None => false,
        },
        Value::Array(list) => list.iter_mut().fold(false, |changed, v| remap_ids(v, ids) || changed),
        Value::Object(map) => map.values_mut().fold(false, |changed, v| remap_ids(v, ids) || changed),
        _ => false,
    }
}

/// JSON text with old item ids replaced by new ones. Text with nothing to
/// replace (or that isn't JSON) is returned exactly as it was.
fn remapped_json(text: &str, ids: &HashMap<String, String>) -> String {
    let Ok(mut value) = serde_json::from_str::<serde_json::Value>(text) else {
        return text.to_string();
    };
    if remap_ids(&mut value, ids) {
        value.to_string()
    } else {
        text.to_string()
    }
}

/// Reads a pack and imports it as a new campaign called "<name> (imported)".
pub fn import_pack(conn: &Connection, bytes: &[u8], now: i64) -> Result<ImportResult, PackError> {
    let pack = read_pack(bytes)?;
    import_parsed(conn, &pack, now)
}

pub fn import_parsed(conn: &Connection, pack: &ParsedPack, now: i64) -> Result<ImportResult, PackError> {
    let tx = conn.unchecked_transaction()?;

    let original = pack.manifest.campaign.name.trim();
    let name = if original.is_empty() {
        "Imported campaign".to_string()
    } else {
        format!("{original} (imported)")
    };
    let campaign = campaigns::create(&tx, &name, now)?;

    // Fresh ids for everything; the pack's own ids are kept only as provenance.
    let new_ids = |ids: Vec<&str>| -> HashMap<String, String> {
        ids.into_iter().map(|id| (id.to_string(), Uuid::now_v7().to_string())).collect()
    };
    let folder_ids = new_ids(pack.folders.iter().map(|f| f.id.as_str()).collect());
    let item_ids = new_ids(pack.items.iter().map(|i| i.id.as_str()).collect());
    let tag_ids = new_ids(pack.tags.iter().map(|t| t.id.as_str()).collect());

    // Folders and tags are already ordered parents-first, so each parent exists
    // by the time its children are inserted.
    for f in &pack.folders {
        let parent = f.parent_id.as_ref().and_then(|p| folder_ids.get(p));
        tx.execute(
            "INSERT INTO folders (id, campaign_id, library, parent_id, name, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![folder_ids[&f.id], campaign.id, f.library, parent, f.name, f.created_at, f.updated_at, f.deleted_at],
        )
        .map_err(db_error)?;
    }
    for t in &pack.tags {
        let parent = t.parent_id.as_ref().and_then(|p| tag_ids.get(p));
        tx.execute(
            "INSERT INTO tags (id, campaign_id, parent_id, name, color, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![tag_ids[&t.id], campaign.id, parent, t.name, t.color, t.created_at, t.updated_at, t.deleted_at],
        )
        .map_err(db_error)?;
    }
    for i in &pack.items {
        let folder = i.folder_id.as_ref().and_then(|f| folder_ids.get(f));
        tx.execute(
            "INSERT INTO items (id, campaign_id, library, item_type, name, icon, folder_id, visibility,
                                created_at, updated_at, deleted_at, origin_pack_id, origin_item_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                item_ids[&i.id], campaign.id, i.library, i.item_type, i.name, i.icon, folder, i.visibility,
                i.created_at, i.updated_at, i.deleted_at, pack.manifest.pack_id, i.id
            ],
        )
        .map_err(db_error)?;
    }
    for l in &pack.item_tags {
        tx.execute(
            "INSERT INTO item_tags (item_id, tag_id, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![item_ids[&l.item_id], tag_ids[&l.tag_id], l.created_at, l.updated_at, l.deleted_at],
        )
        .map_err(db_error)?;
    }
    for l in &pack.links {
        tx.execute(
            "INSERT INTO links (source_item_id, target_item_id, source_ref, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                item_ids[&l.source_item_id], item_ids[&l.target_item_id], l.source_ref,
                l.created_at, l.updated_at, l.deleted_at
            ],
        )
        .map_err(db_error)?;
    }
    for d in &pack.documents {
        tx.execute(
            "INSERT INTO document_content (item_id, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![item_ids[&d.item_id], d.body, d.created_at, d.updated_at],
        )
        .map_err(db_error)?;
    }

    for r in &pack.saved_rolls {
        tx.execute(
            "INSERT INTO saved_rolls (item_id, notation, seed, text, result_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![item_ids[&r.item_id], r.notation, r.seed, r.text, r.result_json, r.created_at, r.updated_at],
        )
        .map_err(db_error)?;
    }

    for f in &pack.formulas {
        tx.execute(
            "INSERT INTO formulas (item_id, notation, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![item_ids[&f.item_id], f.notation, f.created_at, f.updated_at],
        )
        .map_err(db_error)?;
    }

    for d in &pack.card_details {
        tx.execute(
            "INSERT INTO card_details (item_id, value, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![item_ids[&d.item_id], d.value, d.notes, d.created_at, d.updated_at],
        )
        .map_err(db_error)?;
    }
    for p in &pack.card_images {
        tx.execute(
            "INSERT INTO card_images (item_id, mime, image, thumb, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                item_ids[&p.record.item_id], p.record.mime, p.image, p.thumb,
                p.record.created_at, p.record.updated_at
            ],
        )
        .map_err(db_error)?;
    }
    for m in &pack.collection_members {
        tx.execute(
            "INSERT INTO collection_members (collection_id, member_id, position, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                item_ids[&m.collection_id], item_ids[&m.member_id], m.position,
                m.created_at, m.updated_at, m.deleted_at
            ],
        )
        .map_err(db_error)?;
    }

    for d in &pack.saved_draws {
        // The cards in a saved draw are remembered by id: point them at the imported cards.
        let result_json = remapped_json(&d.result_json, &item_ids);
        tx.execute(
            "INSERT INTO saved_draws (item_id, source_name, seed, text, result_json, notes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                item_ids[&d.item_id], d.source_name, d.seed, d.text, result_json, d.notes,
                d.created_at, d.updated_at
            ],
        )
        .map_err(db_error)?;
    }
    for s in &pack.spreads {
        tx.execute(
            "INSERT INTO spreads (item_id, notes, reversals, reversal_percent, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![item_ids[&s.item_id], s.notes, s.reversals, s.reversal_percent, s.created_at, s.updated_at],
        )
        .map_err(db_error)?;
    }
    for p in &pack.spread_positions {
        let source = p.source_id.as_ref().and_then(|s| item_ids.get(s));
        tx.execute(
            "INSERT INTO spread_positions (spread_id, position, name, source_id, meaning)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![item_ids[&p.spread_id], p.position, p.name.trim(), source, p.meaning],
        )
        .map_err(db_error)?;
    }
    for t in &pack.random_tables {
        tx.execute(
            "INSERT INTO random_tables (item_id, notes, die_size, avoid_recent, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![item_ids[&t.item_id], t.notes, t.die_size, t.avoid_recent, t.created_at, t.updated_at],
        )
        .map_err(db_error)?;
    }
    let entry_ids = new_ids(pack.table_entries.iter().map(|e| e.id.as_str()).collect());
    for e in &pack.table_entries {
        tx.execute(
            "INSERT INTO table_entries (id, table_id, position, text, weight, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                entry_ids[&e.id], item_ids[&e.table_id], e.position, e.text, e.weight,
                e.created_at, e.updated_at, e.deleted_at
            ],
        )
        .map_err(db_error)?;
    }
    for l in &pack.table_entry_tags {
        tx.execute(
            "INSERT INTO table_entry_tags (entry_id, tag_id, created_at, updated_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![entry_ids[&l.entry_id], tag_ids[&l.tag_id], l.created_at, l.updated_at, l.deleted_at],
        )
        .map_err(db_error)?;
    }
    for p in &pack.play_decks {
        let state_json = remapped_json(&p.state_json, &item_ids);
        // Where the cards came from: the imported copy of it, or nothing if it wasn't in the pack.
        let source_id = p.source_id.as_ref().and_then(|s| item_ids.get(s));
        tx.execute(
            "INSERT INTO play_decks (item_id, source_id, source_name, state_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![item_ids[&p.item_id], source_id, p.source_name, state_json, p.created_at, p.updated_at],
        )
        .map_err(db_error)?;
    }

    settings::set_current_campaign_if_none(&tx, &campaign.id, now)?;
    tx.commit()?;

    Ok(ImportResult {
        campaign: campaigns::get_live(conn, &campaign.id)?,
        counts: pack.counts(),
        warnings: pack.warnings.clone(),
    })
}
