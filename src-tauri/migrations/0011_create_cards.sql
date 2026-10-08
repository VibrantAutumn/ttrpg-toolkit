-- Cards tool. Cards, sets, decks and pools are all `items` rows (library =
-- 'cards'; item_type = 'card' | 'set' | 'deck' | 'pool'). The item governs the
-- lifetime of everything below (trash/restore); purging an item removes its rows.

-- A card's own data. A card with no row here simply has an empty value and notes.
CREATE TABLE card_details (
    item_id    TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    value      TEXT    NOT NULL DEFAULT '',
    notes      TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- A card's picture, kept apart from the details so lists never load pictures.
-- `image` is the full-size picture and `thumb` a small copy for lists (both are
-- made by the app before saving); `mime` is image/jpeg, image/png or image/webp.
CREATE TABLE card_images (
    item_id    TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    mime       TEXT    NOT NULL,
    image      BLOB    NOT NULL,
    thumb      BLOB    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- What is inside a set, deck or pool (which kinds may go inside which is checked
-- in code). Removal is soft (row kept, deleted_at set) so it can sync later;
-- adding again revives the row. `position` orders the members.
CREATE TABLE collection_members (
    collection_id TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    member_id     TEXT    NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER,
    PRIMARY KEY (collection_id, member_id),
    CHECK (collection_id <> member_id)
);

CREATE INDEX collection_members_by_member ON collection_members (member_id);

-- Make a card's value and notes searchable, through the search index's `body`
-- column (the row is created by the trigger on `items`).
CREATE TRIGGER search_card_insert AFTER INSERT ON card_details BEGIN
    UPDATE search_index SET body = trim(NEW.value || ' ' || NEW.notes) WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_card_update AFTER UPDATE OF value, notes ON card_details BEGIN
    UPDATE search_index SET body = trim(NEW.value || ' ' || NEW.notes) WHERE item_id = NEW.item_id;
END;
