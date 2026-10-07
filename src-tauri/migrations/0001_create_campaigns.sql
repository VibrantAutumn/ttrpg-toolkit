-- Template for every library table: UUID id, timestamps, soft delete.
-- Timestamps are milliseconds since the Unix epoch (UTC).
-- deleted_at is NULL for live rows; a value means "in the trash since then".
CREATE TABLE campaigns (
    id         TEXT    PRIMARY KEY NOT NULL,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);
