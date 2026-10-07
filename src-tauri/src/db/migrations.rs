//! Step-by-step schema migrations.
//!
//! Rules: migrations are append-only. Never edit one that has shipped; add a
//! new one with the next version number instead.

use rusqlite::Connection;
use std::fmt;

pub struct Migration {
    pub version: u32,
    #[allow(dead_code)] // human-readable label; shown in test failures
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "create_campaigns",
        sql: include_str!("../../migrations/0001_create_campaigns.sql"),
    },
    Migration {
        version: 2,
        name: "create_library",
        sql: include_str!("../../migrations/0002_create_library.sql"),
    },
    Migration {
        version: 3,
        name: "create_tags",
        sql: include_str!("../../migrations/0003_create_tags.sql"),
    },
    Migration {
        version: 4,
        name: "create_search",
        sql: include_str!("../../migrations/0004_create_search.sql"),
    },
    Migration {
        version: 5,
        name: "create_app_settings",
        sql: include_str!("../../migrations/0005_create_app_settings.sql"),
    },
];

#[derive(Debug)]
pub enum MigrationError {
    Sqlite(rusqlite::Error),
    /// The database was written by a newer version of the app.
    DatabaseTooNew { found: u32, supported: u32 },
}

impl fmt::Display for MigrationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MigrationError::Sqlite(e) => write!(f, "database error: {e}"),
            MigrationError::DatabaseTooNew { found, supported } => write!(
                f,
                "database is schema version {found}, but this app only supports up to {supported}; update the app"
            ),
        }
    }
}

impl std::error::Error for MigrationError {}

impl From<rusqlite::Error> for MigrationError {
    fn from(e: rusqlite::Error) -> Self {
        MigrationError::Sqlite(e)
    }
}

pub fn current_version(conn: &Connection) -> Result<u32, rusqlite::Error> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
}

/// Applies every migration newer than the database's version, each in its own
/// transaction (a failure rolls that migration back). Returns the final version.
pub fn migrate(conn: &mut Connection, migrations: &[Migration]) -> Result<u32, MigrationError> {
    let current = current_version(conn)?;
    let latest = migrations.last().map_or(0, |m| m.version);
    if current > latest {
        return Err(MigrationError::DatabaseTooNew {
            found: current,
            supported: latest,
        });
    }
    for m in migrations.iter().filter(|m| m.version > current) {
        let tx = conn.transaction()?;
        tx.execute_batch(m.sql)?;
        tx.pragma_update(None, "user_version", m.version)?;
        tx.commit()?;
    }
    Ok(latest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [name],
            |row| row.get::<_, u32>(0),
        )
        .unwrap()
            == 1
    }

    #[test]
    fn migration_versions_are_contiguous_from_one() {
        for (i, m) in MIGRATIONS.iter().enumerate() {
            assert_eq!(m.version as usize, i + 1, "migration '{}' is out of order", m.name);
        }
    }

    #[test]
    fn fresh_database_migrates_to_latest() {
        let mut conn = Connection::open_in_memory().unwrap();
        let version = migrate(&mut conn, MIGRATIONS).unwrap();
        assert_eq!(version, MIGRATIONS.last().unwrap().version);
        assert_eq!(current_version(&conn).unwrap(), version);
        assert!(table_exists(&conn, "campaigns"));
    }

    #[test]
    fn running_migrations_twice_is_harmless() {
        let mut conn = Connection::open_in_memory().unwrap();
        let first = migrate(&mut conn, MIGRATIONS).unwrap();
        let second = migrate(&mut conn, MIGRATIONS).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn only_newer_migrations_are_applied() {
        let mut conn = Connection::open_in_memory().unwrap();
        let v1 = [Migration { version: 1, name: "a", sql: "CREATE TABLE a (x INTEGER);" }];
        migrate(&mut conn, &v1).unwrap();
        conn.execute("INSERT INTO a (x) VALUES (42)", []).unwrap();

        let v2 = [
            Migration { version: 1, name: "a", sql: "CREATE TABLE a (x INTEGER);" },
            Migration { version: 2, name: "b", sql: "CREATE TABLE b (y INTEGER);" },
        ];
        assert_eq!(migrate(&mut conn, &v2).unwrap(), 2);
        // Migration 1 was not re-run, so the data survived.
        let x: i64 = conn.query_row("SELECT x FROM a", [], |r| r.get(0)).unwrap();
        assert_eq!(x, 42);
        assert!(table_exists(&conn, "b"));
    }

    #[test]
    fn failed_migration_rolls_back_and_keeps_old_version() {
        let mut conn = Connection::open_in_memory().unwrap();
        let bad = [Migration {
            version: 1,
            name: "bad",
            sql: "CREATE TABLE half_done (x INTEGER); THIS IS NOT SQL;",
        }];
        assert!(migrate(&mut conn, &bad).is_err());
        assert_eq!(current_version(&conn).unwrap(), 0);
        assert!(!table_exists(&conn, "half_done"));
    }

    #[test]
    fn database_from_a_newer_app_is_refused() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 999).unwrap();
        match migrate(&mut conn, MIGRATIONS) {
            Err(MigrationError::DatabaseTooNew { found: 999, .. }) => {}
            other => panic!("expected DatabaseTooNew, got {other:?}"),
        }
    }
}
