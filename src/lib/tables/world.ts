import { parseEntry } from "./parse";
import type { RollableDeck, RollableEntry, RollableTable, TableWorld } from "./roll";

/** A table as loaded from the database: the roller's table plus its recent picks. */
export interface WorldTable extends RollableTable {
  /** Entry ids recently rolled from this table, newest first. */
  recent: readonly string[];
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * Turns loaded tables and decks into the lookups the roller uses. Names are
 * matched ignoring case; when two tables share a name the first in the list
 * wins (the database lists the oldest first).
 */
export function buildWorld(tables: readonly WorldTable[], decks: readonly RollableDeck[]): TableWorld {
  const byName = new Map<string, WorldTable>();
  const byId = new Map<string, WorldTable>();
  for (const t of tables) {
    if (!byName.has(key(t.name))) byName.set(key(t.name), t);
    byId.set(t.id, t);
  }
  const decksByName = new Map<string, RollableDeck>();
  for (const d of decks) if (!decksByName.has(key(d.name))) decksByName.set(key(d.name), d);

  return {
    findTable: (name) => byName.get(key(name)) ?? null,
    findDeck: (name) => decksByName.get(key(name)) ?? null,
    recent: (tableId) => byId.get(tableId)?.recent ?? [],
  };
}

/**
 * The names of the decks, sets and pools that any entry draws from, so only
 * their cards need loading before a roll. Entries that don't parse are skipped.
 */
export function neededDeckNames(tables: readonly { entries: readonly Pick<RollableEntry, "text">[] }[]): string[] {
  const seen = new Map<string, string>();
  for (const table of tables) {
    for (const entry of table.entries) {
      const parsed = parseEntry(entry.text);
      if (!parsed.ok) continue;
      for (const part of parsed.parts) {
        if (part.kind === "slot" && part.slot.type === "draw" && !seen.has(key(part.slot.source))) {
          seen.set(key(part.slot.source), part.slot.source);
        }
      }
    }
  }
  return [...seen.values()];
}
