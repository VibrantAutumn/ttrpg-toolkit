-- Saved name generator setups ("Elven name", "Place name"). A preset is an `items`
-- row (library = 'tables', item_type = 'name_preset'); its setup lives here,
-- keyed by the same id. The item's name is the preset's name, and the item
-- governs the row's lifetime (trash/restore); purging the item removes this row.
--
-- `setup_json` is the setup as JSON text: how many parts, the table (item id) each
-- part comes from, the tags to filter by (tag ids), and the joining rules. Its
-- shape is checked by the app (TypeScript), so it can grow without a migration;
-- the database only checks that it is a JSON object of reasonable size.
CREATE TABLE name_presets (
    item_id    TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    setup_json TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
