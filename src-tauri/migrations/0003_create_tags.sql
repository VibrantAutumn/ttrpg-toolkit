-- Tags: shared across every tool in a campaign, with optional colour and nesting
-- (e.g. Region / Sword Coast). Soft-deleted like everything else.

CREATE TABLE tags (
    id          TEXT    PRIMARY KEY NOT NULL,
    campaign_id TEXT    NOT NULL REFERENCES campaigns(id),
    parent_id   TEXT    REFERENCES tags(id),
    name        TEXT    NOT NULL,
    color       TEXT,                 -- '#rrggbb' or NULL
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
);

-- Live sibling tags must have different names (ignoring case).
CREATE UNIQUE INDEX tags_unique_sibling_name
    ON tags (campaign_id, IFNULL(parent_id, ''), name COLLATE NOCASE)
    WHERE deleted_at IS NULL;

-- Which tags are on which item. A removed link keeps its row (deleted_at set)
-- so the removal can sync later; re-adding clears deleted_at.
-- Purging an item or tag removes its links outright.
CREATE TABLE item_tags (
    item_id    TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id     TEXT    NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    PRIMARY KEY (item_id, tag_id)
);

CREATE INDEX item_tags_by_tag ON item_tags (tag_id);
