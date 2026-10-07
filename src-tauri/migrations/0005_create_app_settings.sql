-- Per-device preferences, such as which campaign is currently open.
-- These belong to this installation and must NOT be synced between devices.
CREATE TABLE app_settings (
    key        TEXT    PRIMARY KEY NOT NULL,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
);
