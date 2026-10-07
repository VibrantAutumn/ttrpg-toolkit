use std::fmt;

/// Errors from the data layer. The `Display` text is shown to the user as-is,
/// so keep it plain and helpful.
#[derive(Debug)]
pub enum DbError {
    EmptyName,
    NotFound,
    /// The request itself doesn't make sense (e.g. moving a folder into itself).
    Invalid(&'static str),
    Sqlite(rusqlite::Error),
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::EmptyName => write!(f, "A name is required."),
            DbError::NotFound => write!(f, "That item no longer exists."),
            DbError::Invalid(why) => write!(f, "{why}"),
            DbError::Sqlite(e) => write!(f, "database error: {e}"),
        }
    }
}

impl std::error::Error for DbError {}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sqlite(e)
    }
}

/// Trims a name and rejects blank ones.
pub fn clean_name(name: &str) -> Result<&str, DbError> {
    let name = name.trim();
    if name.is_empty() {
        Err(DbError::EmptyName)
    } else {
        Ok(name)
    }
}
