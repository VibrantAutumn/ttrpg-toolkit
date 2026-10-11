import { parseEntry } from "../tables/parse";

/**
 * Generators: one piece of text with slots, written exactly like a table entry, for example
 * `[Faction] sends [2d4] agents to attack the party.` Rolling it fills every slot (tables, dice, card
 * draws, documents) and gives the finished sentence. Stored as JSON text on a generator item; this file
 * is the one gate every stored generator is read through. Pure logic.
 *
 * Version 1 generators (a list of rows that filled in a new document) are read as text: each row
 * becomes a line, `Label: what it rolled`. Their template, properties and fallback tables are dropped.
 */

export const GENERATOR_VERSION = 2;

/** Same size as a table entry. */
export const GENERATOR_LIMITS = { text: 2000 } as const;

export interface GeneratorDef {
  version: number;
  /** What to roll, in the syntax of a table entry. */
  text: string;
}

export function emptyGenerator(): GeneratorDef {
  return { version: GENERATOR_VERSION, text: "" };
}

export type ReadResult = { ok: true; def: GeneratorDef } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The old rows as lines of text. */
function textFromRows(rows: unknown): string {
  if (!Array.isArray(rows)) return "";
  return rows
    .flatMap((row) => {
      if (!isObject(row) || typeof row.source !== "string" || row.source.trim() === "") return [];
      const label = typeof row.label === "string" ? row.label.trim() : "";
      return [label === "" ? row.source.trim() : `${label}: ${row.source.trim()}`];
    })
    .join("\n");
}

/**
 * The one gate every generator goes through. Returns it in its one proper form (text trimmed), or says
 * in a sentence what is wrong. Never throws; a newer version is refused rather than guessed at.
 */
export function normalizeGenerator(raw: unknown): ReadResult {
  if (!isObject(raw)) return { ok: false, error: "This isn't a generator." };
  if (typeof raw.version === "number" && raw.version > GENERATOR_VERSION) {
    return { ok: false, error: "This generator was made by a newer version of the app." };
  }
  let text: string;
  if (raw.version === 1) text = textFromRows(raw.rows);
  else if (raw.version === GENERATOR_VERSION) {
    if (raw.text !== undefined && raw.text !== null && typeof raw.text !== "string") return { ok: false, error: "The text has to be text." };
    text = typeof raw.text === "string" ? raw.text : "";
  } else return { ok: false, error: "This isn't a generator." };
  text = text.trim();
  if (text.length > GENERATOR_LIMITS.text) return { ok: false, error: `A generator can be at most ${GENERATOR_LIMITS.text} characters.` };
  return { ok: true, def: { version: GENERATOR_VERSION, text } };
}

export function parseGenerator(json: string): ReadResult {
  try {
    return normalizeGenerator(JSON.parse(json));
  } catch {
    return { ok: false, error: "This isn't a generator." };
  }
}

/** Whether there is anything to roll yet. */
export const isComplete = (def: GeneratorDef) => def.text.trim() !== "";

/** Says what is wrong with the text (the slot syntax), or null when it is fine. */
export function checkGenerator(def: GeneratorDef): string | null {
  if (def.text.trim() === "") return null;
  const parsed = parseEntry(def.text);
  return parsed.ok ? null : parsed.error.message;
}
