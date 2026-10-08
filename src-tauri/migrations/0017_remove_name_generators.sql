-- Name generators are no longer items with lists of their own. A generator is now
-- a single tool that draws its parts from ordinary tables, so migration 0016's
-- `name_generators` table and the `part` column on entries are removed here
-- (0016 itself is never edited: it has already run on databases).

-- Any generator items made while that design existed go, with their lists
-- (entries, entry tags and recent picks follow through ON DELETE CASCADE).
DELETE FROM items WHERE library = 'tables' AND item_type = 'name_generator';

DROP TRIGGER search_name_generator_insert;
DROP TRIGGER search_name_generator_update;
DROP TRIGGER search_table_entry_insert;
DROP TRIGGER search_table_entry_update;
DROP TRIGGER search_table_entry_delete;

DROP TABLE name_generators;
ALTER TABLE table_entries DROP COLUMN part;

-- The entry search triggers as migration 0015 made them (a table's notes plus its entries).
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
