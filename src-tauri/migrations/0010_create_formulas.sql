-- Saved dice formulas ("Attack: 1d20+5"). A formula is an `items` row
-- (library = 'dice', item_type = 'formula'); its notation lives here, keyed by
-- the same id. The item's name is the formula's name. The item governs the
-- row's lifetime (trash/restore); purging the item removes this row.
--
-- The notation is checked by the app's dice parser (TypeScript) before it is
-- saved; the database only keeps it. A formula that no longer parses (for
-- example from a pack made by a newer app) is reported when it is rolled.
CREATE TABLE formulas (
    item_id    TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    notation   TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Make the notation searchable (typing "d20" finds formulas that use it),
-- through the search index's `body` column.
CREATE TRIGGER search_formula_insert AFTER INSERT ON formulas BEGIN
    UPDATE search_index SET body = NEW.notation WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER search_formula_update AFTER UPDATE OF notation ON formulas BEGIN
    UPDATE search_index SET body = NEW.notation WHERE item_id = NEW.item_id;
END;
