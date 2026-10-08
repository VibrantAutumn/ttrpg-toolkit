-- Random tables. A table is an `items` row (library = 'tables', item_type =
-- 'table'); the item governs the lifetime of everything here (trash/restore),
-- and purging it removes these rows. Entries are NOT items: they belong to one
-- table, are ordered, and are soft-deleted so a deletion can be undone.
-- The slot syntax inside an entry's text (`[2d4]`, `[Rumors]`...) is read by the
-- app's TypeScript; this only stores text.

-- The table's own settings. A table with no row here has empty notes, no die
-- size and "avoid recent" off.
CREATE TABLE random_tables (
    item_id      TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    notes        TEXT    NOT NULL DEFAULT '',
    -- Optional printed-table die (d20, d100...) the entry ranges are shown against.
    die_size     INTEGER CHECK (die_size IS NULL OR die_size BETWEEN 2 AND 1000),
    -- Skip the last N entries rolled from this table (0 = off).
    avoid_recent INTEGER NOT NULL DEFAULT 0 CHECK (avoid_recent BETWEEN 0 AND 50),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

-- The entries. `weight` is how many places an entry takes up in the roll (its
-- range is worked out from the weights in order); 0 means never picked.
-- `position` orders live entries; ties fall back to creation time.
CREATE TABLE table_entries (
    id         TEXT    PRIMARY KEY NOT NULL,
    table_id   TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    text       TEXT    NOT NULL,
    weight     INTEGER NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0 AND 10000),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

CREATE INDEX table_entries_by_table ON table_entries (table_id, position);

-- Which campaign tags are on which entry (the same tags as everywhere else; a
-- later phase filters rolls by them). A removed link keeps its row with
-- deleted_at set, and adding it again revives it, like `item_tags`.
CREATE TABLE table_entry_tags (
    entry_id   TEXT    NOT NULL REFERENCES table_entries(id) ON DELETE CASCADE,
    tag_id     TEXT    NOT NULL REFERENCES tags(id)          ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    PRIMARY KEY (entry_id, tag_id)
);

CREATE INDEX table_entry_tags_by_tag ON table_entry_tags (tag_id);

-- Entries recently rolled from a table, for "avoid recent". This is per-device
-- memory, not content: it is never put in content packs. The app keeps only the
-- newest 50 rows per table.
CREATE TABLE table_recent (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id  TEXT    NOT NULL REFERENCES items(id)         ON DELETE CASCADE,
    entry_id  TEXT    NOT NULL REFERENCES table_entries(id) ON DELETE CASCADE,
    rolled_at INTEGER NOT NULL
);

CREATE INDEX table_recent_by_table ON table_recent (table_id, id);

-- Make the notes and the entries' text searchable, through the search index's
-- `body` column (the row is created by the trigger on `items`). Only the first
-- 300 live entries are indexed, so adding entries to a huge table stays fast.
CREATE TRIGGER search_random_table_insert AFTER INSERT ON random_tables BEGIN
    UPDATE search_index
    SET body = trim(NEW.notes || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = NEW.item_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_random_table_update AFTER UPDATE OF notes ON random_tables BEGIN
    UPDATE search_index
    SET body = trim(NEW.notes || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = NEW.item_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_table_entry_insert AFTER INSERT ON table_entries BEGIN
    UPDATE search_index
    SET body = trim(COALESCE((SELECT notes FROM random_tables WHERE item_id = NEW.table_id), '') || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = NEW.table_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = NEW.table_id;
END;

CREATE TRIGGER search_table_entry_update AFTER UPDATE OF text, deleted_at, position ON table_entries BEGIN
    UPDATE search_index
    SET body = trim(COALESCE((SELECT notes FROM random_tables WHERE item_id = NEW.table_id), '') || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = NEW.table_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = NEW.table_id;
END;

CREATE TRIGGER search_table_entry_delete AFTER DELETE ON table_entries BEGIN
    UPDATE search_index
    SET body = trim(COALESCE((SELECT notes FROM random_tables WHERE item_id = OLD.table_id), '') || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = OLD.table_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = OLD.table_id;
END;
