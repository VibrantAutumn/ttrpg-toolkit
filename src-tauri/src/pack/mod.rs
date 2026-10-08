//! Content packs: export a campaign to a file and import one as a new campaign.
//! See `format.rs` for the file layout and its evolution rules.

pub mod export;
pub mod format;
pub mod import;

#[cfg(test)]
mod tests;

use crate::db::error::DbError;
use std::fmt;

/// Everything that can go wrong with a pack. The `Display` text is shown to the
/// user as-is, so keep it plain and say what they can do.
#[derive(Debug)]
pub enum PackError {
    /// Not a pack at all (not a zip, no manifest, some other kind of zip).
    NotAPack(&'static str),
    /// Made by a newer version of the app than this one.
    TooNew { found: u32, supported: u32 },
    /// Looks like a pack, but its contents are damaged or inconsistent.
    Corrupt(String),
    /// Bigger than the safety limits allow.
    TooLarge,
    /// Building the pack failed.
    Failed(String),
    Db(DbError),
}

impl fmt::Display for PackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PackError::NotAPack(why) => {
                write!(f, "That file isn't a TTRPG Toolkit pack ({why}).")
            }
            PackError::TooNew { found, supported } => write!(
                f,
                "This pack was made by a newer version of the app (pack format {found}; this app reads up to {supported}). Update the app to import it."
            ),
            PackError::Corrupt(detail) => write!(f, "This pack looks damaged: {detail}"),
            PackError::TooLarge => write!(f, "This pack is too large to import safely."),
            PackError::Failed(detail) => write!(f, "Couldn't build the pack: {detail}"),
            PackError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PackError {}

impl From<DbError> for PackError {
    fn from(e: DbError) -> Self {
        PackError::Db(e)
    }
}

impl From<rusqlite::Error> for PackError {
    fn from(e: rusqlite::Error) -> Self {
        PackError::Db(DbError::Sqlite(e))
    }
}
