pub mod migrations;

use migrations::MigrationError;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

/// The app's one database connection, shared through Tauri's managed state.
pub struct Db(pub Mutex<Connection>);

/// Opens (creating if needed) the database file and brings its schema up to date.
pub fn open(path: &Path) -> Result<Connection, MigrationError> {
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    migrations::migrate(&mut conn, migrations::MIGRATIONS)?;
    Ok(conn)
}
