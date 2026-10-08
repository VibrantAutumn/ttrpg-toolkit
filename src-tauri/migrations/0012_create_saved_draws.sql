-- Saved card draws. A saved draw is an `items` row (library = 'cards',
-- item_type = 'draw'); what was drawn lives here, keyed by the same id. The
-- item governs the row's lifetime (trash/restore); purging the item removes it.
--
-- result_json is the finished draw as the app produced it (each card's id,
-- name and whether it was reversed, plus the options used), stored as opaque
-- JSON so its shape can grow without a migration. Card names are kept in it, so
-- a saved draw still reads correctly after a card is renamed or deleted.
-- `notes` are the player's own interpretation and can be edited later.
CREATE TABLE saved_draws (
    item_id     TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source_name TEXT    NOT NULL,
    seed        INTEGER NOT NULL,
    text        TEXT    NOT NULL,
    result_json TEXT    NOT NULL,
    notes       TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- Searchable by the card names and by the notes, through the search index's
-- `body` column (the row is created by the trigger on `items`).
CREATE TRIGGER search_saved_draw_insert AFTER INSERT ON saved_draws BEGIN
    UPDATE search_index SET body = trim(NEW.text || ' ' || NEW.notes) WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_saved_draw_update AFTER UPDATE OF text, notes ON saved_draws BEGIN
    UPDATE search_index SET body = trim(NEW.text || ' ' || NEW.notes) WHERE item_id = NEW.item_id;
END;
