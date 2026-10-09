-- Fields (Phase 4). Definitions and field sets belong to a campaign; any item can hold values.
-- What a field's settings and values MEAN (the seven kinds, their rules) belongs to the app's
-- TypeScript (src/lib/fields/); this only stores them, like saved rolls and name presets.

-- A field: its name, kind and settings. The kind never changes after creation (make a new field
-- instead), so stored values always fit it. `config_json` is the kind's settings as a JSON object.
CREATE TABLE field_definitions (
    id          TEXT    PRIMARY KEY NOT NULL,
    campaign_id TEXT    NOT NULL REFERENCES campaigns(id),
    name        TEXT    NOT NULL,
    kind        TEXT    NOT NULL CHECK (kind IN ('text','number','bar','formula','dropdown','list','link')),
    description TEXT    NOT NULL DEFAULT '',
    config_json TEXT    NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
);

-- Fields are found by name (queries, table slots like [A.Faction]), so live names are unique
-- within a campaign, ignoring case.
CREATE UNIQUE INDEX field_definitions_live_name
    ON field_definitions (campaign_id, name COLLATE NOCASE)
    WHERE deleted_at IS NULL;

-- A reusable group of fields ("NPC", a ruleset's stat block).
CREATE TABLE field_sets (
    id          TEXT    PRIMARY KEY NOT NULL,
    campaign_id TEXT    NOT NULL REFERENCES campaigns(id),
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
);

CREATE UNIQUE INDEX field_sets_live_name
    ON field_sets (campaign_id, name COLLATE NOCASE)
    WHERE deleted_at IS NULL;

-- Which fields are in a set, in order. A removed member keeps its row (deleted_at set) and
-- adding it again revives it, like tag links.
CREATE TABLE field_set_members (
    set_id     TEXT    NOT NULL REFERENCES field_sets(id)        ON DELETE CASCADE,
    field_id   TEXT    NOT NULL REFERENCES field_definitions(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    PRIMARY KEY (set_id, field_id)
);

CREATE INDEX field_set_members_by_field ON field_set_members (field_id);

-- Which sets are applied to an item, in the order they were applied.
CREATE TABLE item_field_sets (
    item_id    TEXT    NOT NULL REFERENCES items(id)      ON DELETE CASCADE,
    set_id     TEXT    NOT NULL REFERENCES field_sets(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    PRIMARY KEY (item_id, set_id)
);

CREATE INDEX item_field_sets_by_set ON item_field_sets (set_id);

-- What an item holds for a field. `value_json` is the value itself; beside it the app keeps what
-- the database needs to sort, filter and search without reading it (a number to sort by, text to
-- sort by, and the text to search). `secret` marks the value GM-only: it is stored now, and
-- sharing (Phase 9) is what keeps it off players' devices. Clearing a value keeps its row.
CREATE TABLE field_values (
    item_id     TEXT    NOT NULL REFERENCES items(id)             ON DELETE CASCADE,
    field_id    TEXT    NOT NULL REFERENCES field_definitions(id) ON DELETE CASCADE,
    value_json  TEXT    NOT NULL,
    sort_num    REAL,
    sort_text   TEXT,
    search_text TEXT    NOT NULL DEFAULT '',
    secret      INTEGER NOT NULL DEFAULT 0 CHECK (secret IN (0, 1)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    PRIMARY KEY (item_id, field_id)
);

CREATE INDEX field_values_by_field_num  ON field_values (field_id, sort_num);
CREATE INDEX field_values_by_field_text ON field_values (field_id, sort_text);
