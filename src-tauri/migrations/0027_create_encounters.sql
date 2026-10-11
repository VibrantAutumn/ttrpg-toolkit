-- Encounters (Phase 5): an `items` row (library = 'encounters', item_type = 'encounter') whose running state
-- lives here, keyed by the same id. `state_json` is the whole encounter as JSON text (combatants, turn, round, log
-- and undo history); its shape and every rule are the app's TypeScript (`src/lib/encounters/`), the database only
-- checks that it is a JSON object of reasonable size. An encounter with no row yet is a new one, which the app fills in
-- from the project's ruleset the first time it is opened. The item governs the row's lifetime (trash/restore;
-- purging the item removes this row).
CREATE TABLE encounters (
    item_id    TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    state_json TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
