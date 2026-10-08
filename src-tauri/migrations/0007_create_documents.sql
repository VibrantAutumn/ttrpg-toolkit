-- Document text. A document is an `items` row (item_type = 'document'); its
-- Markdown body lives here, keyed by the same id. The item governs the row's
-- lifetime (trash/restore), so there is no deleted_at here; purging the item
-- removes this row.
CREATE TABLE document_content (
    item_id    TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    body       TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Make document text searchable: rebuild the index with a `body` column
-- (FTS5 tables can't be altered). The triggers from migration 0004 keep working
-- because they only touch the item_id, name and tags columns.
DROP TABLE search_index;

CREATE VIRTUAL TABLE search_index USING fts5(
    item_id UNINDEXED,
    name,
    tags,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO search_index (item_id, name, tags, body)
SELECT i.id, i.name,
       COALESCE((SELECT group_concat(t.name, ' ')
                 FROM item_tags it JOIN tags t ON t.id = it.tag_id
                 WHERE it.item_id = i.id AND it.deleted_at IS NULL AND t.deleted_at IS NULL), ''),
       COALESCE((SELECT d.body FROM document_content d WHERE d.item_id = i.id), '')
FROM items i;

CREATE TRIGGER search_body_insert AFTER INSERT ON document_content BEGIN
    UPDATE search_index SET body = NEW.body WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_body_update AFTER UPDATE OF body ON document_content BEGIN
    UPDATE search_index SET body = NEW.body WHERE item_id = NEW.item_id;
END;
