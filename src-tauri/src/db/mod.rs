pub mod campaigns;
pub mod documents;
pub mod error;
pub mod folders;
pub mod formulas;
pub mod items;
pub mod links;
pub mod migrations;
pub mod saved_rolls;
pub mod search;
pub mod settings;
pub mod tags;
pub mod trash;

use migrations::MigrationError;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Current time as milliseconds since the Unix epoch (UTC), the app's timestamp format.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The app's one database connection, shared through Tauri's managed state.
pub struct Db(pub Mutex<Connection>);

/// Opens (creating if needed) the database file and brings its schema up to date.
pub fn open(path: &Path) -> Result<Connection, MigrationError> {
    init(Connection::open(path)?)
}

/// Settings and migrations every connection gets, real or test.
fn init(mut conn: Connection) -> Result<Connection, MigrationError> {
    conn.pragma_update(None, "foreign_keys", true)?;
    migrations::migrate(&mut conn, migrations::MIGRATIONS)?;
    Ok(conn)
}

/// A fresh in-memory database set up exactly like the real one, for tests.
#[cfg(test)]
pub fn open_in_memory() -> Connection {
    init(Connection::open_in_memory().unwrap()).unwrap()
}
