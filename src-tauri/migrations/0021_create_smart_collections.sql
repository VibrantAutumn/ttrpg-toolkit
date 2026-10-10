-- Smart collections: saved queries. A smart collection is an `items` row
-- (library = 'worldbuilding', item_type = 'smart_collection'); its query lives here,
-- keyed by the same id. The item's name is the collection's name, and the item governs
-- the row's lifetime (trash/restore); purging the item removes this row. A smart
-- collection with no row yet reads as the empty query (everything).
--
-- `query_json` is the query as JSON text. Its shape, and what it means, belongs to the
-- app (TypeScript `src/lib/queries/query.ts`, Rust `db/query.rs`); the database only keeps it.
-- It holds ids of tags, folders, fields and items, so packs rewrite those on import.
CREATE TABLE smart_collections (
    item_id    TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    query_json TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
