/**
 * Starter tables: ready-made tables that come with the app.
 * A starter is plain data (`TableStarterDef`) that the app turns into the bundle
 * the database installs in one all-or-nothing step. Pure data and logic.
 */

export interface StarterTag {
  name: string;
  color?: string | null;
}

export interface StarterEntry {
  text: string;
  /** How many places the entry takes in the roll (default 1). */
  weight?: number;
  /** Names of tags from the starter's `tags`. */
  tags?: string[];
}

export interface StarterTable {
  /** Unique inside the starter. */
  key: string;
  name: string;
  notes?: string;
  /** The printed die the entry weights add up to, if the table is a printed-style one. */
  dieSize?: number;
  avoidRecent?: number;
  entries: StarterEntry[];
}

export interface TableStarterDef {
  /** Starts with `starter:`; remembered on everything it makes. */
  id: string;
  /** Shown in the list, and the name of the folder everything is put in. */
  name: string;
  description: string;
  tags: StarterTag[];
  tables: StarterTable[];
}

/** What the database reads (field names must match `TableBundle` in Rust). */
export interface TableBundleJson {
  id: string;
  name: string;
  tags: { name: string; color: string | null }[];
  tables: {
    key: string;
    name: string;
    notes: string;
    dieSize: number | null;
    avoidRecent: number;
    entries: { text: string; weight: number; tags: string[] }[];
  }[];
}

export function toTableBundle(def: TableStarterDef): TableBundleJson {
  return {
    id: def.id,
    name: def.name,
    tags: def.tags.map((t) => ({ name: t.name, color: t.color ?? null })),
    tables: def.tables.map((t) => ({
      key: t.key,
      name: t.name,
      notes: t.notes ?? "",
      dieSize: t.dieSize ?? null,
      avoidRecent: t.avoidRecent ?? 0,
      entries: t.entries.map((e) => ({ text: e.text, weight: e.weight ?? 1, tags: e.tags ?? [] })),
    })),
  };
}
