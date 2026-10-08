import { invoke } from "@tauri-apps/api/core";
import type { NameMode, NameGenSettings, PartKey } from "../lib/tables/nameGen";
import type { EntryInput, TableEntry } from "./tables";

/**
 * Name generators. Editing, deleting, moving and tagging a generator's entries
 * use the table entry functions in `./tables` (they work on any entry); these
 * are the generator-only calls.
 */

/** Mirrors the Rust `GeneratorDetail`. */
export interface GeneratorDetail {
  itemId: string;
  notes: string;
  settings: NameGenSettings;
  /** The generator's lists. A mode uses some of them; the others are kept but ignored. */
  parts: Record<PartKey, TableEntry[]>;
}

/** Mirrors the Rust `GeneratorSummary`. */
export interface GeneratorSummary {
  itemId: string;
  name: string;
  mode: NameMode;
  entries: number;
  /** Every list its mode uses has an entry that can be picked. */
  ready: boolean;
}

/** Mirrors the Rust `RollableGenerator`: what `generateName` needs. */
export interface RollableGeneratorData {
  id: string;
  name: string;
  settings: NameGenSettings;
  parts: Record<PartKey, { id: string; text: string; weight: number }[]>;
}

export const getNameGenerator = (itemId: string) => invoke<GeneratorDetail>("get_name_generator", { itemId });
export const setNameGeneratorNotes = (itemId: string, notes: string) =>
  invoke<void>("set_name_generator_notes", { itemId, notes });
export const setNameGeneratorSettings = (itemId: string, settings: NameGenSettings) =>
  invoke<void>("set_name_generator_settings", { itemId, settings });

/** Adds entries to the end of one of the generator's lists, all or nothing. */
export const addNameGeneratorEntries = (itemId: string, part: PartKey, entries: EntryInput[]) =>
  invoke<TableEntry[]>("add_name_generator_entries", { itemId, part, entries });

export const listNameGenerators = (campaignId: string) =>
  invoke<GeneratorSummary[]>("list_name_generators", { campaignId });
/** Every generator with its settings and lists, ready to make names. */
export const loadNameGenerators = (campaignId: string) =>
  invoke<RollableGeneratorData[]>("load_name_generators", { campaignId });
