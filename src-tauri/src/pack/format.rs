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
