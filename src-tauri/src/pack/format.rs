//! The content pack file format (version 1).
//!
//! A pack is a zip file containing:
//!   manifest.json            what this is, who made it, counts
//!   data/folders.json        one JSON array per kind of data
//!   data/items.json
//!   data/tags.json
//!   data/item_tags.json
//!   data/links.json
//!   data/documents.json
//!   data/saved_rolls.json    (added later; older packs simply lack it)
//!   data/formulas.json       (likewise)
//!   data/card_details.json, data/collection_members.json, data/card_images.json (likewise)
//!   data/saved_draws.json, data/play_decks.json, data/spreads.json, data/spread_positions.json    (likewise)
//!   data/random_tables.json, data/table_entries.json, data/table_entry_tags.json    (likewise; recent picks are never exported)
//!   data/name_presets.json    (likewise; a saved name generator setup, with table and tag ids inside)
//!   data/field_definitions.json, data/field_sets.json, data/field_set_members.json, data/item_field_sets.json,
//!   data/field_values.json    (likewise; fields and their values. A link field's value holds item ids)
//!   data/item_tabs.json    (likewise; a page's tabs: nested documents and embeds)
//!   data/smart_collections.json    (likewise; a saved query, with tag, folder, field and item ids inside)
//!   assets/cards/<id>.<ext>, assets/cards/<id>.thumb.<ext>   card pictures (one file each)
//!   assets/                  reserved for future use (images, ...)
//!
//! These types are deliberately separate from the database structs so changing
//! the database never silently changes the file format. Rules for evolving it:
//! - Adding an optional field is not a breaking change: readers ignore unknown
//!   fields and writers' new fields use `#[serde(default)]`.
//! - Anything breaking bumps `FORMAT_VERSION`, and the importer keeps reading
//!   every older version (the golden test pack guards this).

use serde::{Deserialize, Serialize};

pub const FORMAT: &str = "ttrpg-toolkit-pack";
pub const FORMAT_VERSION: u32 = 1;

pub const MANIFEST_FILE: &str = "manifest.json";
pub const FOLDERS_FILE: &str = "data/folders.json";
pub const ITEMS_FILE: &str = "data/items.json";
pub const TAGS_FILE: &str = "data/tags.json";
pub const ITEM_TAGS_FILE: &str = "data/item_tags.json";
pub const LINKS_FILE: &str = "data/links.json";
pub const DOCUMENTS_FILE: &str = "data/documents.json";
pub const SAVED_ROLLS_FILE: &str = "data/saved_rolls.json";
pub const FORMULAS_FILE: &str = "data/formulas.json";
pub const CARD_DETAILS_FILE: &str = "data/card_details.json";
pub const COLLECTION_MEMBERS_FILE: &str = "data/collection_members.json";
pub const CARD_IMAGES_FILE: &str = "data/card_images.json";
pub const SAVED_DRAWS_FILE: &str = "data/saved_draws.json";
pub const PLAY_DECKS_FILE: &str = "data/play_decks.json";
pub const SPREADS_FILE: &str = "data/spreads.json";
pub const SPREAD_POSITIONS_FILE: &str = "data/spread_positions.json";
pub const RANDOM_TABLES_FILE: &str = "data/random_tables.json";
pub const TABLE_ENTRIES_FILE: &str = "data/table_entries.json";
pub const TABLE_ENTRY_TAGS_FILE: &str = "data/table_entry_tags.json";
pub const NAME_PRESETS_FILE: &str = "data/name_presets.json";
pub const FIELD_DEFINITIONS_FILE: &str = "data/field_definitions.json";
pub const FIELD_SETS_FILE: &str = "data/field_sets.json";
pub const FIELD_SET_MEMBERS_FILE: &str = "data/field_set_members.json";
pub const ITEM_FIELD_SETS_FILE: &str = "data/item_field_sets.json";
pub const FIELD_VALUES_FILE: &str = "data/field_values.json";
pub const ITEM_TABS_FILE: &str = "data/item_tabs.json";
pub const SMART_COLLECTIONS_FILE: &str = "data/smart_collections.json";
/// Card picture files live under this folder inside the zip.
pub const CARD_ASSET_DIR: &str = "assets/cards/";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub format_version: u32,
    /// Identifies this export; imported items remember it as their origin.
    pub pack_id: String,
    pub app_version: String,
    /// The database schema version of the app that made the pack (informational).
    pub schema_version: u32,
    pub created_at: i64,
    pub campaign: CampaignInfo,
    #[serde(default)]
    pub counts: Counts,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CampaignInfo {
    pub name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Counts {
    pub folders: u32,
    pub items: u32,
    pub tags: u32,
    pub item_tags: u32,
    pub links: u32,
    pub documents: u32,
    pub saved_rolls: u32,
    pub formulas: u32,
    pub card_details: u32,
    pub collection_members: u32,
    pub card_images: u32,
    pub saved_draws: u32,
    pub play_decks: u32,
    pub spreads: u32,
    pub spread_positions: u32,
    pub random_tables: u32,
    pub table_entries: u32,
    pub table_entry_tags: u32,
    pub name_presets: u32,
    pub field_definitions: u32,
    pub field_sets: u32,
    pub field_set_members: u32,
    pub item_field_sets: u32,
    pub field_values: u32,
    pub item_tabs: u32,
    pub smart_collections: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRecord {
    pub id: String,
    pub library: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRecord {
    pub id: String,
    pub library: String,
    pub item_type: String,
    pub name: String,
    pub icon: Option<String>,
    pub folder_id: Option<String>,
    pub visibility: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRecord {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTagRecord {
    pub item_id: String,
    pub tag_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRecord {
    pub source_item_id: String,
    pub target_item_id: String,
    pub source_ref: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub item_id: String,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRollRecord {
    pub item_id: String,
    pub notation: String,
    pub seed: i64,
    pub text: String,
    /// The finished roll as a JSON text (kept as text so its shape can grow).
    pub result_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaRecord {
    pub item_id: String,
    pub notation: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDetailRecord {
    pub item_id: String,
    pub value: String,
    pub notes: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMemberRecord {
    pub collection_id: String,
    pub member_id: String,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// Says which files in `assets/cards/` hold a card's picture and thumbnail.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardImageRecord {
    pub item_id: String,
    pub mime: String,
    pub image_file: String,
    pub thumb_file: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDrawRecord {
    pub item_id: String,
    pub source_name: String,
    pub seed: i64,
    pub text: String,
    pub result_json: String,
    pub notes: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayDeckRecord {
    pub item_id: String,
    pub source_id: Option<String>,
    pub source_name: String,
    pub state_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadRecord {
    pub item_id: String,
    pub notes: String,
    pub reversals: bool,
    pub reversal_percent: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadPositionRecord {
    pub spread_id: String,
    pub position: i64,
    pub name: String,
    pub source_id: Option<String>,
    pub meaning: String,
}

/// A random table's settings (the table itself is an item).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomTableRecord {
    pub item_id: String,
    pub notes: String,
    pub die_size: Option<i64>,
    pub avoid_recent: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One entry of a table. Deleted entries are kept (with `deleted_at`) so a backup is complete.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableEntryRecord {
    pub id: String,
    pub table_id: String,
    pub position: i64,
    pub text: String,
    pub weight: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableEntryTagRecord {
    pub entry_id: String,
    pub tag_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// A saved name generator setup (the preset itself is an item). `setup_json` names tables and
/// tags by id; import points those at the imported copies.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamePresetRecord {
    pub item_id: String,
    pub setup_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A saved query (the smart collection itself is an item). `query_json` names tags, folders, fields
/// and items by id; import points those at the imported copies.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartCollectionRecord {
    pub item_id: String,
    pub query_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A field (its kind never changes). `config_json` holds the kind's settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDefinitionRecord {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "empty_object")]
    pub config_json: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

fn empty_object() -> String {
    "{}".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSetRecord {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSetMemberRecord {
    pub set_id: String,
    pub field_id: String,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemFieldSetRecord {
    pub item_id: String,
    pub set_id: String,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// What an item holds for a field. A link field's `value_json` is a list of item ids; import
/// points them at the imported copies.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldValueRecord {
    pub item_id: String,
    pub field_id: String,
    pub value_json: String,
    #[serde(default)]
    pub sort_num: Option<f64>,
    #[serde(default)]
    pub sort_text: Option<String>,
    #[serde(default)]
    pub search_text: String,
    #[serde(default)]
    pub secret: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// One tab of a page. A document tab's `child_id` is a document item of the pack; an embed tab's
/// `target_id` is the item it shows (none for an empty slot, which has a title).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTabRecord {
    pub id: String,
    pub parent_id: String,
    pub kind: String,
    pub position: i64,
    #[serde(default)]
    pub child_id: Option<String>,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}
