-- Search now looks inside field values too. Any item can have fields, and every item type
-- already feeds its own text to the `body` column, so field text gets a column of its own:
-- `fields` holds the searchable text of the item's live values (a text field's text, a
-- dropdown's choice label, a list's entries...), kept in step by triggers on `field_values`
-- and `field_definitions`. FTS5 tables can't be altered, so the index is rebuilt (the way
-- migration 0007 added `body`), keeping the existing columns as they are.

CREATE TEMP TABLE search_old AS SELECT item_id, name, tags, body FROM search_index;

DROP TABLE search_index;

CREATE VIRTUAL TABLE search_index USING fts5(
    item_id UNINDEXED,
    name,
    tags,
    body,
    fields,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO search_index (item_id, name, tags, body, fields)
SELECT o.item_id, o.name, o.tags, o.body,
       COALESCE((SELECT group_concat(v.search_text, ' ')
                 FROM field_values v JOIN field_definitions d ON d.id = v.field_id
                 WHERE v.item_id = o.item_id AND v.deleted_at IS NULL AND d.deleted_at IS NULL AND v.search_text <> ''), '')
FROM search_old o;

DROP TABLE search_old;

CREATE TRIGGER search_field_values_insert AFTER INSERT ON field_values BEGIN
    UPDATE search_index SET fields = COALESCE(
        (SELECT group_concat(v.search_text, ' ')
         FROM field_values v JOIN field_definitions d ON d.id = v.field_id
         WHERE v.item_id = NEW.item_id AND v.deleted_at IS NULL AND d.deleted_at IS NULL AND v.search_text <> ''), '')
    WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_field_values_update AFTER UPDATE ON field_values BEGIN
    UPDATE search_index SET fields = COALESCE(
        (SELECT group_concat(v.search_text, ' ')
         FROM field_values v JOIN field_definitions d ON d.id = v.field_id
         WHERE v.item_id = NEW.item_id AND v.deleted_at IS NULL AND d.deleted_at IS NULL AND v.search_text <> ''), '')
    WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_field_values_delete AFTER DELETE ON field_values BEGIN
    UPDATE search_index SET fields = COALESCE(
        (SELECT group_concat(v.search_text, ' ')
         FROM field_values v JOIN field_definitions d ON d.id = v.field_id
         WHERE v.item_id = OLD.item_id AND v.deleted_at IS NULL AND d.deleted_at IS NULL AND v.search_text <> ''), '')
    WHERE item_id = OLD.item_id;
END;

-- A field deleted or restored: recompute every item that has a value for it.
CREATE TRIGGER search_field_definitions_change AFTER UPDATE OF deleted_at ON field_definitions BEGIN
    UPDATE search_index SET fields = COALESCE(
        (SELECT group_concat(v.search_text, ' ')
         FROM field_values v JOIN field_definitions d ON d.id = v.field_id
         WHERE v.item_id = search_index.item_id AND v.deleted_at IS NULL AND d.deleted_at IS NULL AND v.search_text <> ''), '')
    WHERE item_id IN (SELECT item_id FROM field_values WHERE field_id = NEW.id);
END;
