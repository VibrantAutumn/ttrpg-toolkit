import { parseEntry } from "./parse";
import type { EntitySource, FieldLookup } from "./roll";

/**
 * Entity slots (`[Person]`, `[entity:Person]`) pick documents or other items, and `[A.Faction]` reads a
 * field of a picked item. This file works out what a roll needs to load for them, and turns what was
 * loaded into the lookups the roller uses. Pure logic; the loading is in `state/entityWorld.ts`.
 */

const key = (name: string) => name.trim().toLowerCase();

interface TableLike {
  name: string;
  entries: readonly { text: string }[];
}

/**
 * The names that entity slots may refer to: explicit `[entity:Name]` slots, and table slots whose name is
 * not a table (those are tried as entities when rolled). Entries that don't parse are skipped.
 */
export function neededEntityNames(tables: readonly TableLike[]): string[] {
  const tableNames = new Set(tables.map((t) => key(t.name)));
  const seen = new Map<string, string>();
  for (const table of tables) {
    for (const entry of table.entries) {
      const parsed = parseEntry(entry.text);
      if (!parsed.ok) continue;
      for (const part of parsed.parts) {
        if (part.kind !== "slot") continue;
        const { slot } = part;
        const wanted = slot.type === "entity" || (slot.type === "table" && !tableNames.has(key(slot.name)));
        if (wanted && !seen.has(key(slot.name))) seen.set(key(slot.name), slot.name);
      }
    }
  }
  return [...seen.values()];
}

/** The field names that `[A.Field]` references use anywhere in the tables, as first written. */
export function neededFieldNames(tables: readonly TableLike[]): string[] {
  const seen = new Map<string, string>();
  for (const table of tables) {
    for (const entry of table.entries) {
      const parsed = parseEntry(entry.text);
      if (!parsed.ok) continue;
      for (const part of parsed.parts) {
        if (part.kind === "slot" && part.slot.type === "ref" && part.slot.field !== undefined && !seen.has(key(part.slot.field))) {
          seen.set(key(part.slot.field), part.slot.field);
        }
      }
    }
  }
  return [...seen.values()];
}

/** The loaded value of one field, already written as text, for each item that has one. */
export interface LoadedField {
  name: string;
  text: ReadonlyMap<string, string>;
}

export interface EntityData {
  sources: readonly EntitySource[];
  fields: readonly LoadedField[];
}

/** What an item with no value for a field shows. */
export const NO_VALUE = "(none)";

export function buildEntityLookups(data: EntityData): {
  findEntities(name: string): EntitySource | null;
  entityField(itemId: string, field: string): FieldLookup;
} {
  const sources = new Map<string, EntitySource>();
  for (const s of data.sources) if (!sources.has(key(s.name))) sources.set(key(s.name), s);
  const fields = new Map<string, LoadedField>();
  for (const f of data.fields) if (!fields.has(key(f.name))) fields.set(key(f.name), f);
  return {
    findEntities: (name) => sources.get(key(name)) ?? null,
    entityField: (itemId, field) => {
      const loaded = fields.get(key(field));
      if (!loaded) return { ok: false, message: `There is no property called “${field}”.` };
      return { ok: true, text: loaded.text.get(itemId) ?? NO_VALUE };
    },
  };
}
