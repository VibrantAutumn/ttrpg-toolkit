import { parseEntry } from "../tables/parse";

/**
 * Generators: a named set of rolls that fills in a new document. Each row has a label, a place in the
 * document it fills (the name, one of its fields, or its text), and what to roll: entry text with slots,
 * written exactly like a table entry (`[Fantasy first names] [Fantasy last names]`, `[entity:Faction]`).
 * A row may name a plain table to roll instead when its slots find nothing. Stored as JSON text on a
 * generator item; this file is the one gate every stored generator is read through. Pure logic.
 */

export const GENERATOR_VERSION = 1;

export const GENERATOR_LIMITS = { rows: 20, label: 60, source: 2000, fallback: 200 } as const;

export type RowTarget = { kind: "name" } | { kind: "field"; fieldId: string } | { kind: "text" };

export interface GeneratorRow {
  /** Stable inside the generator, so a preview can keep a row locked while others reroll. */
  id: string;
  label: string;
  target: RowTarget;
  /** What to roll, in the syntax of a table entry. */
  source: string;
  /** The name of a table to roll instead when `source` finds nothing (empty = none). */
  fallback: string;
}

export interface GeneratorDef {
  version: number;
  /** The template the new document is made from (its field sets, tags and tabs). */
  templateId: string | null;
  rows: GeneratorRow[];
}

export function emptyGenerator(): GeneratorDef {
  return { version: GENERATOR_VERSION, templateId: null, rows: [] };
}

export type ReadResult = { ok: true; def: GeneratorDef } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

class Bad extends Error {}
const bad = (message: string): never => {
  throw new Bad(message);
};

function str(v: unknown, what: string, max: number): string {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return bad(`${what} has to be text.`);
  const t = v.trim();
  if (t.length > max) return bad(`${what} can be at most ${max} characters.`);
  return t;
}

function readTarget(raw: unknown): RowTarget {
  if (!isObject(raw)) return { kind: "text" };
  if (raw.kind === "name") return { kind: "name" };
  if (raw.kind === "field") return { kind: "field", fieldId: str(raw.fieldId, "A field", 200) };
  if (raw.kind === "text") return { kind: "text" };
  return bad(`I don't know a row target called “${String(raw.kind)}”.`);
}

/**
 * The one gate every generator goes through. Returns it in its one proper form (rows get unique ids,
 * text is trimmed), or says in a sentence what is wrong. Never throws; a newer version is refused
 * rather than guessed at.
 */
export function normalizeGenerator(raw: unknown): ReadResult {
  try {
    if (!isObject(raw)) return { ok: false, error: "This isn't a generator." };
    if (typeof raw.version === "number" && raw.version > GENERATOR_VERSION) {
      return { ok: false, error: "This generator was made by a newer version of the app." };
    }
    if (raw.version !== GENERATOR_VERSION) return { ok: false, error: "This isn't a generator." };
    const templateId = raw.templateId === undefined || raw.templateId === null || raw.templateId === "" ? null : str(raw.templateId, "The template", 200) || null;
    const list = raw.rows === undefined || raw.rows === null ? [] : raw.rows;
    if (!Array.isArray(list)) return bad("The rows have to be a list.");
    if (list.length > GENERATOR_LIMITS.rows) return bad(`A generator can have at most ${GENERATOR_LIMITS.rows} rows.`);
    const rows: GeneratorRow[] = [];
    const used = new Set<string>();
    for (const entry of list) {
      if (!isObject(entry)) return bad("A row has to be an object.");
      let id = str(entry.id, "A row id", 60);
      if (id === "" || used.has(id)) id = newRowId(used);
      used.add(id);
      rows.push({
        id,
        label: str(entry.label, "A row's label", GENERATOR_LIMITS.label),
        target: readTarget(entry.target),
        source: str(entry.source, "A row's rolls", GENERATOR_LIMITS.source),
        fallback: str(entry.fallback, "A row's fallback table", GENERATOR_LIMITS.fallback),
      });
    }
    return { ok: true, def: { version: GENERATOR_VERSION, templateId, rows } };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    return { ok: false, error: "This isn't a generator." };
  }
}

export function parseGenerator(json: string): ReadResult {
  try {
    return normalizeGenerator(JSON.parse(json));
  } catch {
    return { ok: false, error: "This isn't a generator." };
  }
}

/** A row id not in `used`: r1, r2... */
export function newRowId(used: ReadonlySet<string>): string {
  for (let n = 1; ; n++) if (!used.has(`r${n}`)) return `r${n}`;
}

export function newRow(def: GeneratorDef): GeneratorRow {
  return { id: newRowId(new Set(def.rows.map((r) => r.id))), label: "", target: { kind: "text" }, source: "", fallback: "" };
}

/** A row with nothing to roll yet is skipped when generating. */
export const isRowComplete = (row: GeneratorRow) => row.source.trim() !== "";

/** Says what is wrong with a row's rolls (the slot syntax), or null when it is fine. */
export function checkRow(row: GeneratorRow): string | null {
  if (row.source.trim() === "") return null;
  const parsed = parseEntry(row.source);
  return parsed.ok ? null : parsed.error.message;
}
