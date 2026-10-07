-- Library framework: folders and the shared items table.
-- Every library item (document, map, deck, ...) is a row in `items`; types that
-- need more data get their own detail table keyed by the same id.
-- `library` is the owning tool's id (e.g. 'worldbuilding'); folders and items
-- only mix within the same library.

CREATE TABLE folders (
    id          TEXT    PRIMARY KEY NOT NULL,
    campaign_id TEXT    NOT NULL REFERENCES campaigns(id),
    library     TEXT    NOT NULL,
    parent_id   TEXT    REFERENCES folders(id),
    name        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
);

CREATE INDEX folders_by_library ON folders (campaign_id, library, parent_id);

CREATE TABLE items (
    id          TEXT    PRIMARY KEY NOT NULL,
    campaign_id TEXT    NOT NULL REFERENCES campaigns(id),
    library     TEXT    NOT NULL,
    item_type   TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    icon        TEXT,
    folder_id   TEXT    REFERENCES folders(id),
    -- 'default' follows the tool's visibility default from campaign settings.
    visibility  TEXT    NOT NULL DEFAULT 'default'
                CHECK (visibility IN ('default', 'visible', 'secret')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
);

CREATE INDEX items_by_library ON items (campaign_id, library, folder_id, deleted_at);
CREATE INDEX items_by_type ON items (campaign_id, item_type, deleted_at);
