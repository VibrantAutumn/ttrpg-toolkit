/**
 * Starter tables: ready-made tables and saved name setups that come with the app.
 * A starter is plain data (`TableStarterDef`) that the app turns into the bundle
 * the database installs in one all-or-nothing step. The setups inside refer to the
 * starter's own tables and tags with placeholders (`table:<key>`, `tag:<name>`),
 * which the installer replaces with the ids it makes. Pure data and logic.
 */

import type { NameSetup } from "./nameSetup";
import { serializeSetup } from "./nameSetup";

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

/** A saved name setup. `sources` use table keys and `tags` use tag names; the installer swaps in the real ids. */
export interface StarterPreset {
  name: string;
  setup: Omit<NameSetup, "sources" | "tagIds"> & {
    /** The key (from `StarterTable.key`) of the table each part comes from. */
    sources: Partial<Record<"full" | "first" | "middle" | "last", string>>;
    /** Names of tags from the starter's `tags`. */
    tags: string[];
  };
}

export interface TableStarterDef {
  /** Starts with `starter:`; remembered on everything it makes. */
  id: string;
  /** Shown in the list, and the name of the folder everything is put in. */
  name: string;
  description: string;
  tags: StarterTag[];
  tables: StarterTable[];
  presets: StarterPreset[];
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
  presets: { name: string; setupJson: string }[];
}

/** The text that stands for a starter table inside a setup, until it is installed. */
export const tablePlaceholder = (key: string) => `table:${key}`;
/** The text that stands for a starter tag inside a setup, until it is installed. */
export const tagPlaceholder = (name: string) => `tag:${name}`;

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
    presets: def.presets.map((p) => {
      const sources: Partial<Record<"full" | "first" | "middle" | "last", string>> = {};
      for (const [part, key] of Object.entries(p.setup.sources)) {
        if (key) sources[part as keyof typeof sources] = tablePlaceholder(key);
      }
      const { tags, ...rest } = p.setup;
      const setup: NameSetup = { ...rest, sources, tagIds: tags.map(tagPlaceholder) };
      return { name: p.name, setupJson: serializeSetup(setup) };
    }),
  };
}
