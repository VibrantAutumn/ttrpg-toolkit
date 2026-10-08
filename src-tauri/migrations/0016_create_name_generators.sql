-- Name generators. A generator is an `items` row (library = 'tables', item_type =
-- 'name_generator'); like a table, the item governs the lifetime of everything
-- here. Its lists of prefixes, middles, suffixes or whole names are `table_entries`
-- rows told apart by the new `part` column ('' for an ordinary table's entries;
-- 'full', 'first', 'middle' or 'last' for a generator's). The rules for building
-- a name from the lists are in the app's TypeScript (`src/lib/tables/nameGen.ts`).

ALTER TABLE table_entries ADD COLUMN part TEXT NOT NULL DEFAULT ''
    CHECK (part IN ('', 'full', 'first', 'middle', 'last'));

-- The generator's settings. A generator with no row here reads as the defaults
-- (two parts, joined directly, first letter capitalised).
CREATE TABLE name_generators (
    item_id        TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    notes          TEXT    NOT NULL DEFAULT '',
    mode           TEXT    NOT NULL DEFAULT 'two'
                           CHECK (mode IN ('full', 'two', 'three')),
    join1          TEXT    NOT NULL DEFAULT 'none'
                           CHECK (join1 IN ('none', 'space', 'hyphen', 'apostrophe')),
    join2          TEXT    NOT NULL DEFAULT 'none'
                           CHECK (join2 IN ('none', 'space', 'hyphen', 'apostrophe')),
    capitalisation TEXT    NOT NULL DEFAULT 'firstLetter'
                           CHECK (capitalisation IN ('asTyped', 'firstLetter', 'everyPart')),
    merge_doubles  INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

-- Searchable by notes and entries, like tables. The entry triggers from migration
-- 0015 only knew a table's notes, so they are replaced to know a generator's too.
DROP TRIGGER search_table_entry_insert;
DROP TRIGGER search_table_entry_update;
DROP TRIGGER search_table_entry_delete;

CREATE TRIGGER search_table_entry_insert AFTER INSERT ON table_entries BEGIN
    UPDATE search_index
    SET body = trim(COALESCE((SELECT notes FROM random_tables WHERE item_id = NEW.table_id),
                             (SELECT notes FROM name_generators WHERE item_id = NEW.table_id), '') || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = NEW.table_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = NEW.table_id;
END;

CREATE TRIGGER search_table_entry_update AFTER UPDATE OF text, deleted_at, position ON table_entries BEGIN
    UPDATE search_index
    SET body = trim(COALESCE((SELECT notes FROM random_tables WHERE item_id = NEW.table_id),
                             (SELECT notes FROM name_generators WHERE item_id = NEW.table_id), '') || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = NEW.table_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = NEW.table_id;
END;

CREATE TRIGGER search_table_entry_delete AFTER DELETE ON table_entries BEGIN
    UPDATE search_index
    SET body = trim(COALESCE((SELECT notes FROM random_tables WHERE item_id = OLD.table_id),
                             (SELECT notes FROM name_generators WHERE item_id = OLD.table_id), '') || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = OLD.table_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = OLD.table_id;
END;

CREATE TRIGGER search_name_generator_insert AFTER INSERT ON name_generators BEGIN
    UPDATE search_index
    SET body = trim(NEW.notes || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = NEW.item_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_name_generator_update AFTER UPDATE OF notes ON name_generators BEGIN
    UPDATE search_index
    SET body = trim(NEW.notes || ' ' ||
                    COALESCE((SELECT group_concat(text, ' ') FROM (
                        SELECT text FROM table_entries
                        WHERE table_id = NEW.item_id AND deleted_at IS NULL
                        ORDER BY position, created_at LIMIT 300)), ''))
    WHERE item_id = NEW.item_id;
END;
