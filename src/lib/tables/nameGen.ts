/**
 * Name generator: builds a name from lists of parts (a whole name, or a prefix
 * and suffix, or prefix + middle + suffix) and joins them by the generator's
 * rules. Pure logic: all randomness comes from an `Rng`, so a seed reproduces a
 * name, and parts can be locked and the rest drawn again.
 *
 * Order of randomness: one `rng.int(1, total weight)` per part that needs
 * drawing, in the order the parts are listed for the mode (a locked part uses none).
 */

import type { Rng } from "../dice/rng";

export type NameMode = "full" | "two" | "three";
export type PartKey = "full" | "first" | "middle" | "last";
export type Separator = "none" | "space" | "hyphen" | "apostrophe";
export type Capitalisation = "asTyped" | "firstLetter" | "everyPart";

export interface NameGenSettings {
  mode: NameMode;
  /** What goes between the first and second part. */
  join1: Separator;
  /** What goes between the second and third part (three-part names only). */
  join2: Separator;
  capitalisation: Capitalisation;
  /** Where parts are joined directly and one ends with the letter the next starts with, keep only one. */
  mergeDoubles: boolean;
}

export interface NameEntry {
  id: string;
  text: string;
  /** 0 means never picked. */
  weight: number;
}

export interface NameGenerator {
  id: string;
  name: string;
  settings: NameGenSettings;
  parts: Record<PartKey, NameEntry[]>;
}

export interface NamePick {
  part: PartKey;
  entryId: string;
  text: string;
}

export interface NameResult {
  name: string;
  picks: NamePick[];
}

export type GenerateOutcome = { ok: true; result: NameResult } | { ok: false; message: string };

/** Which lists a mode draws from, in drawing (and joining) order. */
export function partsOf(mode: NameMode): PartKey[] {
  switch (mode) {
    case "full":
      return ["full"];
    case "two":
      return ["first", "last"];
    case "three":
      return ["first", "middle", "last"];
  }
}

/** What each list is called to the person. */
export const PART_LABELS: Record<PartKey, string> = {
  full: "Names",
  first: "Prefixes",
  middle: "Middles",
  last: "Suffixes",
};

const SEPARATORS: Record<Separator, string> = { none: "", space: " ", hyphen: "-", apostrophe: "'" };

/** Trimmed, with any run of spaces or line breaks inside made a single space. */
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

const isLetter = (ch: string | undefined) => ch !== undefined && /\p{L}/u.test(ch);

function upperFirst(text: string): string {
  const [first, ...rest] = Array.from(text);
  return isLetter(first) ? first.toUpperCase() + rest.join("") : text;
}

/** Joins drawn parts into a name by the settings' capitalisation, separators and doubled-letter rule. */
export function joinName(texts: readonly string[], settings: NameGenSettings): string {
  let pieces = texts.map(clean);
  if (settings.capitalisation === "firstLetter") {
    pieces = pieces.map((p, i) => (i === 0 ? upperFirst(p) : p));
  } else if (settings.capitalisation === "everyPart") {
    pieces = pieces.map(upperFirst);
  }

  let name = pieces[0] ?? "";
  for (let i = 1; i < pieces.length; i++) {
    const separator = settings[i === 1 ? "join1" : "join2"];
    let piece = pieces[i];
    if (settings.mergeDoubles && separator === "none") {
      const last = Array.from(name).pop();
      const [first, ...rest] = Array.from(piece);
      if (isLetter(last) && isLetter(first) && last!.toLowerCase() === first.toLowerCase()) {
        piece = rest.join("");
      }
    }
    name += SEPARATORS[separator] + piece;
  }
  return name;
}

function drawEntry(entries: readonly NameEntry[], rng: Rng): NameEntry {
  const pool = entries.filter((e) => e.weight > 0);
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  let n = rng.int(1, total);
  for (const e of pool) {
    if (n <= e.weight) return e;
    n -= e.weight;
  }
  return pool[pool.length - 1]; // unreachable: n is within the total
}

/**
 * Generates a name. With `keep`, parts in `locked` stay exactly as in the earlier
 * picks (even if their entries have since been changed or removed) and only the
 * others are drawn. If a list has nothing to pick, nothing is drawn and the
 * message says which list needs entries.
 */
export function generateName(
  generator: NameGenerator,
  rng: Rng,
  keep?: { picks: readonly NamePick[]; locked: ReadonlySet<PartKey> },
): GenerateOutcome {
  const keys = partsOf(generator.settings.mode);
  const kept = (key: PartKey) => (keep?.locked.has(key) ? keep.picks.find((p) => p.part === key) : undefined);

  for (const key of keys) {
    if (!kept(key) && !generator.parts[key].some((e) => e.weight > 0)) {
      return { ok: false, message: `Add at least one entry (with a weight above 0) to ${PART_LABELS[key]}.` };
    }
  }

  const picks: NamePick[] = keys.map((key) => {
    const earlier = kept(key);
    if (earlier) return { ...earlier };
    const entry = drawEntry(generator.parts[key], rng);
    return { part: key, entryId: entry.id, text: clean(entry.text) };
  });
  return { ok: true, result: { name: joinName(picks.map((p) => p.text), generator.settings), picks } };
}
