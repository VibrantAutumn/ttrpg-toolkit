-- Links between items, in any tool. Backlinks are just the reverse query.
--
-- source_ref says where in the source item the link comes from: 'manual' (the
-- item's Links list) today; later 'body' (an @mention in text), 'field:<name>'
-- (a link field) and so on. The same pair can be linked from several places.
--
-- A removed link keeps its row (deleted_at set) so the removal can sync later;
-- adding it again clears deleted_at. Purging either item removes its links.
CREATE TABLE links (
    source_item_id TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    target_item_id TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source_ref     TEXT    NOT NULL DEFAULT 'manual',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted_at     INTEGER,
    PRIMARY KEY (source_item_id, target_item_id, source_ref)
);

CREATE INDEX links_by_target ON links (target_item_id);
