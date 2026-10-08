-- Saved dice rolls. A saved roll is an `items` row (library = 'dice',
-- item_type = 'saved_roll'); what was rolled lives here, keyed by the same id.
-- The item governs the row's lifetime (trash/restore), so there is no
-- deleted_at here; purging the item removes this row.
--
-- result_json is the finished roll exactly as the app produced it (every die,
-- kept or dropped...). It is stored as opaque JSON so the roll's shape can grow
-- without a migration; `text` is the readable one-line form.
CREATE TABLE saved_rolls (
    item_id     TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    notation    TEXT    NOT NULL,
    seed        INTEGER NOT NULL,
    text        TEXT    NOT NULL,
    result_json TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- Make the readable text searchable through the existing `body` column of the
-- search index (the row is created by the trigger on `items`).
CREATE TRIGGER search_saved_roll_insert AFTER INSERT ON saved_rolls BEGIN
    UPDATE search_index SET body = NEW.text WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_saved_roll_update AFTER UPDATE OF text ON saved_rolls BEGIN
    UPDATE search_index SET body = NEW.text WHERE item_id = NEW.item_id;
END;
