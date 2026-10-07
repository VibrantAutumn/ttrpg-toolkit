-- Full-text search over item names and the names of their tags (SQLite FTS5).
-- Triggers keep the index in step with items, item_tags and tags, so no
-- application code can forget to update it. Whether an item is deleted is
-- NOT stored here; searches join `items` and filter on deleted_at.
--
-- Rows are matched by item_id (an unindexed column), which costs a scan of the
-- index per update. That is fine at campaign scale; revisit if it ever isn't.
-- (items has no INTEGER PRIMARY KEY, so rowids are not stable across VACUUM and
-- can't be used as the link.)

CREATE VIRTUAL TABLE search_index USING fts5(
    item_id UNINDEXED,
    name,
    tags,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Fill from existing data.
INSERT INTO search_index (item_id, name, tags)
SELECT i.id, i.name,
       COALESCE((SELECT group_concat(t.name, ' ')
                 FROM item_tags it JOIN tags t ON t.id = it.tag_id
                 WHERE it.item_id = i.id AND it.deleted_at IS NULL AND t.deleted_at IS NULL), '')
FROM items i;

-- Items
CREATE TRIGGER search_items_insert AFTER INSERT ON items BEGIN
    INSERT INTO search_index (item_id, name, tags) VALUES (NEW.id, NEW.name, '');
END;

CREATE TRIGGER search_items_rename AFTER UPDATE OF name ON items BEGIN
    UPDATE search_index SET name = NEW.name WHERE item_id = NEW.id;
END;

CREATE TRIGGER search_items_delete AFTER DELETE ON items BEGIN
    DELETE FROM search_index WHERE item_id = OLD.id;
END;

-- Tag links: recompute the item's tag text.
CREATE TRIGGER search_item_tags_insert AFTER INSERT ON item_tags BEGIN
    UPDATE search_index SET tags = COALESCE(
        (SELECT group_concat(t.name, ' ')
         FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id = NEW.item_id AND it.deleted_at IS NULL AND t.deleted_at IS NULL), '')
    WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_item_tags_update AFTER UPDATE ON item_tags BEGIN
    UPDATE search_index SET tags = COALESCE(
        (SELECT group_concat(t.name, ' ')
         FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id = NEW.item_id AND it.deleted_at IS NULL AND t.deleted_at IS NULL), '')
    WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_item_tags_delete AFTER DELETE ON item_tags BEGIN
    UPDATE search_index SET tags = COALESCE(
        (SELECT group_concat(t.name, ' ')
         FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id = OLD.item_id AND it.deleted_at IS NULL AND t.deleted_at IS NULL), '')
    WHERE item_id = OLD.item_id;
END;

-- Tags renamed, trashed or restored: recompute every item that carries the tag.
CREATE TRIGGER search_tags_change AFTER UPDATE OF name, deleted_at ON tags BEGIN
    UPDATE search_index SET tags = COALESCE(
        (SELECT group_concat(t.name, ' ')
         FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id = search_index.item_id AND it.deleted_at IS NULL AND t.deleted_at IS NULL), '')
    WHERE item_id IN (SELECT item_id FROM item_tags WHERE tag_id = NEW.id);
END;
