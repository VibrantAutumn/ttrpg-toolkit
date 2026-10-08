/**
 * The name generator's setup: how many parts a name has, which table each part
 * comes from, which tags the entries must carry, and how the parts are joined.
 * This file turns a setup plus the campaign's tables into something
 * `generateName` can draw from, and reads and writes a setup as text (a saved
 * preset keeps it). Pure logic: nothing here touches the database.
 */

import type { NameEntry, NameGenerator, NameGenSettings, NameMode, PartKey, Capitalisation, Separator } from "./nameGen";
import { partsOf } from "./nameGen";

/** Just what the tag filter needs to know about a tag. */
export interface TagInfo {
  id: string;
  name: string;
  parentId: string | null;
}

export type TagMatch = "all" | "any";

/**
 * Whether an entry's tags satisfy the wanted tags: every one of them (`all`) or at
 * least one (`any`). A tag nested under a wanted tag counts as that tag, so wanting
 * "Region" also finds entries tagged "Forest". A wanted tag that no longer exists
 * matches nothing. No wanted tags means every entry matches.
 */
export function entryMatchesTags(
  entryTagIds: readonly string[],
  wanted: readonly string[],
  match: TagMatch,
  tags: readonly TagInfo[],
): boolean {
  if (wanted.length === 0) return true;
  const children = new Map<string, string[]>();
  for (const t of tags) {
    if (t.parentId !== null) children.set(t.parentId, [...(children.get(t.parentId) ?? []), t.id]);
  }
  const known = new Set(tags.map((t) => t.id));
  const has = new Set(entryTagIds);

  const satisfied = (tagId: string): boolean => {
    if (!known.has(tagId)) return false;
    const seen = new Set<string>();
    const queue = [tagId];
    while (queue.length > 0) {
      const next = queue.pop() as string;
      if (seen.has(next)) continue; // also stops a loop in the tag tree
      seen.add(next);
      if (has.has(next)) return true;
      queue.push(...(children.get(next) ?? []));
    }
    return false;
  };
  return match === "all" ? wanted.every(satisfied) : wanted.some(satisfied);
}

/** The entries that satisfy the wanted tags, in their order. */
export function filterByTags<T extends { tagIds: readonly string[] }>(
  entries: readonly T[],
  wanted: readonly string[],
  match: TagMatch,
  tags: readonly TagInfo[],
): T[] {
  return entries.filter((e) => entryMatchesTags(e.tagIds, wanted, match, tags));
}

export interface NameSetup {
  mode: NameMode;
  /** The table (its item id) each part comes from; only the parts the mode uses matter. */
  sources: Partial<Record<PartKey, string>>;
  /** Only entries with these tags are used (none = all entries). */
  tagIds: string[];
  tagMatch: TagMatch;
  join1: Separator;
  join2: Separator;
  capitalisation: Capitalisation;
  mergeDoubles: boolean;
}

export const DEFAULT_SETUP: NameSetup = {
  mode: "two",
  sources: {},
  tagIds: [],
  tagMatch: "all",
  join1: "none",
  join2: "none",
  capitalisation: "firstLetter",
  mergeDoubles: false,
};

/** What each part is called when asking for its table. */
export const SOURCE_LABELS: Record<PartKey, string> = {
  full: "whole name",
  first: "first part",
  middle: "middle part",
  last: "last part",
};

const SETUP_VERSION = 1;
const MODES: readonly string[] = ["full", "two", "three"];
const SEPARATORS: readonly string[] = ["none", "space", "hyphen", "apostrophe"];
const CAPITALISATIONS: readonly string[] = ["asTyped", "firstLetter", "everyPart"];
const MATCHES: readonly string[] = ["all", "any"];
const PART_KEYS: readonly PartKey[] = ["full", "first", "middle", "last"];

export function serializeSetup(setup: NameSetup): string {
  return JSON.stringify({ version: SETUP_VERSION, ...setup });
}

/**
 * Reads a setup from text. Anything missing gets its default and anything unknown
 * is ignored, but a value that is the wrong kind, or a setup from a newer version,
 * gives null: never a guess.
 */
export function parseSetup(text: string): NameSetup | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== undefined && (typeof o.version !== "number" || o.version > SETUP_VERSION)) return null;

  const choice = <T extends string>(value: unknown, allowed: readonly string[], fallback: T): T | null => {
    if (value === undefined) return fallback;
    return typeof value === "string" && allowed.includes(value) ? (value as T) : null;
  };
  const mode = choice<NameMode>(o.mode, MODES, DEFAULT_SETUP.mode);
  const join1 = choice<Separator>(o.join1, SEPARATORS, DEFAULT_SETUP.join1);
  const join2 = choice<Separator>(o.join2, SEPARATORS, DEFAULT_SETUP.join2);
  const capitalisation = choice<Capitalisation>(o.capitalisation, CAPITALISATIONS, DEFAULT_SETUP.capitalisation);
  const tagMatch = choice<TagMatch>(o.tagMatch, MATCHES, DEFAULT_SETUP.tagMatch);
  if (!mode || !join1 || !join2 || !capitalisation || !tagMatch) return null;

  let mergeDoubles = DEFAULT_SETUP.mergeDoubles;
  if (o.mergeDoubles !== undefined) {
    if (typeof o.mergeDoubles !== "boolean") return null;
    mergeDoubles = o.mergeDoubles;
  }

  let tagIds: string[] = [];
  if (o.tagIds !== undefined) {
    if (!Array.isArray(o.tagIds) || !o.tagIds.every((t) => typeof t === "string")) return null;
    tagIds = o.tagIds as string[];
  }

  const sources: Partial<Record<PartKey, string>> = {};
  if (o.sources !== undefined) {
    if (typeof o.sources !== "object" || o.sources === null || Array.isArray(o.sources)) return null;
    const given = o.sources as Record<string, unknown>;
    for (const key of PART_KEYS) {
      if (given[key] === undefined) continue;
      if (typeof given[key] !== "string") return null;
      sources[key] = given[key] as string;
    }
  }
  return { mode, sources, tagIds, tagMatch, join1, join2, capitalisation, mergeDoubles };
}

/**
 * The last setup used is only a convenience kept in the browser's storage on this
 * device: it can be missing or blocked (a private window, cleared site data), and
 * then the generator simply starts from the defaults.
 */
export const LAST_SETUP_KEY = "names.lastSetup";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** The setup last used here, or the defaults if there is none or it can't be read. */
export function loadLastSetup(storage: ReadableStorage | undefined): NameSetup {
  try {
    const raw = storage?.getItem(LAST_SETUP_KEY);
    return (raw ? parseSetup(raw) : null) ?? DEFAULT_SETUP;
  } catch {
    return DEFAULT_SETUP;
  }
}

/** Remembers the setup. Returns false (never throws) if the storage refuses. */
export function saveLastSetup(storage: WritableStorage | undefined, setup: NameSetup): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LAST_SETUP_KEY, serializeSetup(setup));
    return true;
  } catch {
    return false;
  }
}

/** A table as the generator needs it: its entries, each with its tags. */
export interface SourceTable {
  id: string;
  name: string;
  entries: readonly { id: string; text: string; weight: number; tagIds: readonly string[] }[];
}

export type BuildOutcome = { ok: true; generator: NameGenerator } | { ok: false; message: string };

/**
 * Gathers the entries each part draws from (its table's entries that have the
 * wanted tags) into a generator. If something is missing, says what.
 */
export function buildGenerator(
  setup: NameSetup,
  tables: readonly SourceTable[],
  tags: readonly TagInfo[],
): BuildOutcome {
  const fail = (message: string): BuildOutcome => ({ ok: false, message });
  if (setup.tagIds.some((id) => !tags.some((t) => t.id === id))) {
    return fail("A tag chosen for the filter no longer exists. Remove it from the filter.");
  }
  const tagNames = setup.tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? id);

  const parts: Record<PartKey, NameEntry[]> = { full: [], first: [], middle: [], last: [] };
  for (const key of partsOf(setup.mode)) {
    const tableId = setup.sources[key];
    if (!tableId) return fail(`Choose a table for the ${SOURCE_LABELS[key]}.`);
    const table = tables.find((t) => t.id === tableId);
    if (!table) return fail(`The table for the ${SOURCE_LABELS[key]} is gone: choose another.`);

    if (table.entries.length === 0) return fail(`“${table.name}” has no entries.`);
    const pickable = table.entries.filter((e) => e.weight > 0);
    if (pickable.length === 0) return fail(`“${table.name}” has no entries with a weight above 0.`);
    const matching = filterByTags(table.entries, setup.tagIds, setup.tagMatch, tags);
    if (!matching.some((e) => e.weight > 0)) {
      const joiner = setup.tagMatch === "all" ? " and " : " or ";
      return fail(`“${table.name}” has no entries tagged ${tagNames.join(joiner)}.`);
    }
    parts[key] = matching.map((e) => ({ id: e.id, text: e.text, weight: e.weight }));
  }

  const settings: NameGenSettings = {
    mode: setup.mode,
    join1: setup.join1,
    join2: setup.join2,
    capitalisation: setup.capitalisation,
    mergeDoubles: setup.mergeDoubles,
  };
  return { ok: true, generator: { id: "names", name: "Names", settings, parts } };
}
