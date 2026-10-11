-- Time (Phase 6). Calendars, events, dated notes, sessions and timelines are `items` rows (libraries
-- 'calendar' and 'worldbuilding'); the tables here are their detail rows, keyed by the same item id, and the
-- item governs the row's lifetime (trash/restore; purging the item removes the row). The project's "now" and
-- the weather per day belong to the project.
--
-- Dates are absolute day numbers (integers shared by every calendar of a project) plus an optional minute of the
-- day; a calendar only says how those days are grouped into years, months and weeks (TypeScript `src/lib/calendar/`).

-- A calendar: its definition as JSON text (the app's TypeScript reads and repairs it; the database only checks
-- that it is an object of reasonable size).
CREATE TABLE calendars (
    item_id       TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    calendar_json TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);

-- A timeline: which items it shows (a query), how it makes lanes and how far it is zoomed, as JSON text.
-- It holds ids of tags, folders and fields, so packs rewrite those on import (like smart collections).
CREATE TABLE timelines (
    item_id     TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    config_json TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- A quick event (item_type 'event') or a dated DM note (item_type 'note', GM-only through the item's visibility).
-- One day or a range; `recurrence_json` makes it repeat (rules in TypeScript `src/lib/calendar/recurrence.ts`),
-- `until_day` ends the repeating.
CREATE TABLE calendar_events (
    item_id         TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    start_day       INTEGER NOT NULL,
    start_minute    INTEGER,
    end_day         INTEGER,
    end_minute      INTEGER,
    recurrence_json TEXT,
    until_day       INTEGER,
    body            TEXT    NOT NULL DEFAULT '',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_calendar_events_start ON calendar_events (start_day);

-- A session (item_type 'session', a page in the Pages library with tabs, one of which is its log).
-- `real_date` is the real-world day it was played (YYYY-MM-DD); the in-game start and end are day + minute.
CREATE TABLE sessions (
    item_id      TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    real_date    TEXT,
    start_day    INTEGER,
    start_minute INTEGER,
    end_day      INTEGER,
    end_minute   INTEGER,
    status       TEXT    NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'running', 'ended')),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

-- The project's shared "now": the main calendar, the in-game moment, the current session and the table weather is rolled
-- from (the party's climate; regions replace it in Phase 7). A project with
-- no row has defaults (day 0, midnight, nothing chosen). The party's location arrives with maps (Phase 7).
CREATE TABLE project_state (
    project_id       TEXT    PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    main_calendar_id TEXT    REFERENCES items(id) ON DELETE SET NULL,
    now_day          INTEGER NOT NULL DEFAULT 0,
    now_minute       INTEGER NOT NULL DEFAULT 0,
    session_id       TEXT    REFERENCES items(id) ON DELETE SET NULL,
    weather_table_id TEXT    REFERENCES items(id) ON DELETE SET NULL,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

-- Weather for a day (an absolute day number): rolled once and kept, so a day's weather doesn't change when
-- the project is reopened. `weather_json` is a small object the app reads (text, season, climate, rolled parts).
CREATE TABLE weather_days (
    project_id   TEXT    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    day          INTEGER NOT NULL,
    weather_json TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (project_id, day)
);
