-- Card spreads: a reading with named positions ("Past", "Present"...), each
-- drawing one card from one source. A spread is an `items` row (library =
-- 'cards', item_type = 'spread'); the item governs the lifetime of everything
-- here (trash/restore); purging it removes these rows.

-- The spread's own settings. A spread with no row here has empty notes and the
-- default reversal settings (on, 50%).
CREATE TABLE spreads (
    item_id          TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    notes            TEXT    NOT NULL DEFAULT '',
    reversals        INTEGER NOT NULL DEFAULT 1,
    reversal_percent INTEGER NOT NULL DEFAULT 50,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

-- The positions, in order. `source_id` is the set, deck or pool that position
-- draws from. If that item is deleted for good the position keeps its place and
-- just has no source (the app asks for a new one before drawing); a source that
-- is only in the trash stays referenced, so restoring it fixes the spread.
CREATE TABLE spread_positions (
    spread_id TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    name      TEXT    NOT NULL,
    source_id TEXT    REFERENCES items(id) ON DELETE SET NULL,
    meaning   TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (spread_id, position)
);

CREATE INDEX spread_positions_by_source ON spread_positions (source_id);

-- Searchable by the notes and the position names, through the search index's
-- `body` column (the row is created by the trigger on `items`).
CREATE TRIGGER search_spread_insert AFTER INSERT ON spreads BEGIN
    UPDATE search_index
    SET body = trim(NEW.notes || ' ' ||
                    COALESCE((SELECT group_concat(name, ' ') FROM spread_positions WHERE spread_id = NEW.item_id), ''))
    WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_spread_update AFTER UPDATE OF notes ON spreads BEGIN
    UPDATE search_index
    SET body = trim(NEW.notes || ' ' ||
                    COALESCE((SELECT group_concat(name, ' ') FROM spread_positions WHERE spread_id = NEW.item_id), ''))
    WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_spread_position_insert AFTER INSERT ON spread_positions BEGIN
    UPDATE search_index
    SET body = trim(COALESCE((SELECT notes FROM spreads WHERE item_id = NEW.spread_id), '') || ' ' ||
                    COALESCE((SELECT group_concat(name, ' ') FROM spread_positions WHERE spread_id = NEW.spread_id), ''))
    WHERE item_id = NEW.spread_id;
END;

CREATE TRIGGER search_spread_position_delete AFTER DELETE ON spread_positions BEGIN
    UPDATE search_index
    SET body = trim(COALESCE((SELECT notes FROM spreads WHERE item_id = OLD.spread_id), '') || ' ' ||
                    COALESCE((SELECT group_concat(name, ' ') FROM spread_positions WHERE spread_id = OLD.spread_id), ''))
    WHERE item_id = OLD.spread_id;
END;
