-- Tabs (Phase 4). A page (a document or template) can have tabs under its title. A tab is either
--   * a nested DOCUMENT: a real document item of its own (child_id), shown as a tab of the parent,
--     with its own text, fields, tags and links; or
--   * an EMBED: a live view of any other item (target_id), or an empty slot waiting to be filled
--     (target_id NULL) with a title.
-- A child document is hidden from the library's folder lists (it lives in its parent) but is found
-- by search and links like any item; opening one opens the parent with that tab selected.
-- Tabs go one level deep: a child document cannot have tabs of its own (checked in code).

CREATE TABLE item_tabs (
    id         TEXT    PRIMARY KEY NOT NULL,
    parent_id  TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL CHECK (kind IN ('document', 'embed')),
    position   INTEGER NOT NULL,
    -- A document tab's child. Purging the child removes the tab.
    child_id   TEXT    REFERENCES items(id) ON DELETE CASCADE,
    -- An embed tab's item. If that item is purged for good the tab stays, as an empty slot.
    target_id  TEXT    REFERENCES items(id) ON DELETE SET NULL,
    -- An embed tab's name (a document tab is named by its child).
    title      TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    -- Only embed tabs are ever removed this way; removing a document tab trashes the child document
    -- (so it can be restored, and the tab comes back with it).
    deleted_at INTEGER,
    CHECK ((kind = 'document' AND child_id IS NOT NULL AND target_id IS NULL)
        OR (kind = 'embed' AND child_id IS NULL))
);

CREATE INDEX item_tabs_by_parent ON item_tabs (parent_id, position);

-- A document is the tab of at most one page.
CREATE UNIQUE INDEX item_tabs_one_parent ON item_tabs (child_id) WHERE child_id IS NOT NULL;

-- Child documents follow their page through the trash, however it got there (deleted on its own or
-- with its folder) and back, and are removed with it for good. Children trashed together with the
-- page carry the page's timestamp, so restoring the page brings back only those, not ones that
-- were trashed earlier on their own.
CREATE TRIGGER item_tabs_trash_children AFTER UPDATE OF deleted_at ON items
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
    UPDATE items SET deleted_at = NEW.deleted_at, updated_at = NEW.deleted_at
    WHERE deleted_at IS NULL
      AND id IN (SELECT child_id FROM item_tabs WHERE parent_id = NEW.id AND kind = 'document');
END;

CREATE TRIGGER item_tabs_restore_children AFTER UPDATE OF deleted_at ON items
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
    UPDATE items SET deleted_at = NULL, updated_at = NEW.updated_at
    WHERE deleted_at = OLD.deleted_at
      AND id IN (SELECT child_id FROM item_tabs WHERE parent_id = NEW.id AND kind = 'document');
END;

CREATE TRIGGER item_tabs_purge_children BEFORE DELETE ON items
BEGIN
    DELETE FROM items
    WHERE id IN (SELECT child_id FROM item_tabs WHERE parent_id = OLD.id AND kind = 'document');
END;
