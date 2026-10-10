-- Generators: named sets of rolls that fill in a new document. A generator is an `items` row
-- (library = 'tables', item_type = 'generator'); its definition lives here, keyed by the same id.
-- The item's name is the generator's name, and the item governs the row's lifetime (trash/restore);
-- purging the item removes this row. A generator with no row yet reads as an empty one.
--
-- `definition_json` is the generator as JSON text: the template new documents are made from (an
-- item id) and the rows (a label, what to fill: the name, a field (a field id) or the text, the
-- rolls in table-entry syntax, and an optional fallback table name). Its shape is checked by the app
-- (TypeScript `src/lib/generators/generator.ts`); the database only checks that it is a JSON object
-- of reasonable size. Packs rewrite the item and field ids inside it on import.
CREATE TABLE generators (
    item_id         TEXT    PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    definition_json TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
