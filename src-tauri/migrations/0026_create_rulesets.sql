-- Rulesets (Phase 5). A ruleset is a GLOBAL definition of a game system, not part of any project:
-- the properties its stat blocks use, the stat blocks, saved dice formulas and the rules encounters
-- follow. `definition_json` is that data as JSON text; its shape is read and repaired by the app
-- (TypeScript `src/lib/rulesets/ruleset.ts`), the database only checks that it is a JSON object of
-- reasonable size. `origin_id` is set for rulesets that come with the app (`starter:d20`...), which
-- is how "already added" is known. Rulesets are soft-deleted like everything else.
CREATE TABLE rulesets (
    id              TEXT    PRIMARY KEY NOT NULL,
    name            TEXT    NOT NULL,
    description     TEXT    NOT NULL DEFAULT '',
    definition_json TEXT    NOT NULL,
    origin_id       TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    deleted_at      INTEGER
);

-- Picking a ruleset for a project COPIES it in: the properties and property sets are made in the
-- project (or the ones with the same name are used), and the encounter rules are kept here.
-- `ruleset_id` says where the copy came from (not a hard link: the copy keeps working if the
-- global ruleset is deleted for good, hence SET NULL). `ids_json` maps the ruleset's keys to the
-- project's own ids ({"fields": {key: field id}, "sets": {key: set id}}). A project can use
-- several rulesets; `position` orders them (the first is the main one).
CREATE TABLE project_rulesets (
    id          TEXT    PRIMARY KEY NOT NULL,
    project_id  TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ruleset_id  TEXT    REFERENCES rulesets(id) ON DELETE SET NULL,
    name        TEXT    NOT NULL,
    rules_json  TEXT    NOT NULL,
    ids_json    TEXT    NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
);
CREATE INDEX project_rulesets_project ON project_rulesets (project_id);
