-- Decks in play. A deck in play is an `items` row (library = 'cards',
-- item_type = 'play'); its game lives here, keyed by the same id. The item
-- governs the row's lifetime (trash/restore); purging the item removes it.
--
-- state_json is the whole game as the app produced it: the cards left in the
-- deck (top first), the discard pile, the shuffle seed and the reversal
-- settings. The cards are COPIES made when the game started, so the game goes
-- on unchanged if the source is edited or deleted. It is stored as opaque JSON
-- so the rules can grow without a migration. `source_id` says where the cards
-- came from (for "restart from the current cards"); it is deliberately not a
-- foreign key, because the source may be deleted while the game goes on.
CREATE TABLE play_decks (
    item_id     TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source_id   TEXT,
    source_name TEXT    NOT NULL,
    state_json  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- Findable by the name of what it was started from (its own name is already indexed).
CREATE TRIGGER search_play_deck_insert AFTER INSERT ON play_decks BEGIN
    UPDATE search_index SET body = NEW.source_name WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_play_deck_update AFTER UPDATE OF source_name ON play_decks BEGIN
    UPDATE search_index SET body = NEW.source_name WHERE item_id = NEW.item_id;
END;
