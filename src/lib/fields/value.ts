import { checkFormula } from "../dice/formula";
import { LIMITS, type FieldDefinition } from "./definition";

/**
 * Field values: what an item holds for a field. Pure TypeScript. What kind of value a field
 * takes is decided by its definition; `coerceValue` is the one gate every value goes through
 * (typed by a person, read back from the database, or arriving in a content pack), so a
 * stored value is always one the field accepts.
 */

export interface BarValue {
  current: number;
  max: number;
}
export interface ListEntry {
  title: string;
  text: string;
}

/**
 * text and formula: string · number: number or null · bar: BarValue or null ·
 * dropdown: a choice's id or null · list: entries · link: item ids.
 */
export type FieldValue = string | number | null | BarValue | ListEntry[] | string[];

export type CoerceResult = { ok: true; value: FieldValue } | { ok: false; error: string };

const fail = (error: string): CoerceResult => ({ ok: false, error });
const done = (value: FieldValue): CoerceResult => ({ ok: true, value });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function emptyValue(def: FieldDefinition): FieldValue {
  switch (def.kind) {
    case "text":
    case "formula":
      return "";
    case "list":
    case "link":
      return [];
    default:
      return null;
  }
}

export function isEmpty(def: FieldDefinition, value: FieldValue): boolean {
  switch (def.kind) {
    case "text":
    case "formula":
      return value === "";
    case "list":
    case "link":
      return Array.isArray(value) && value.length === 0;
    default:
      return value === null;
  }
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  const rounded = Math.round(n * f) / f;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Checks a value against its field and returns it in its one proper form (text on one line,
 * numbers rounded, entries trimmed...), or says in a sentence why it doesn't fit. Never throws.
 */
export function coerceValue(def: FieldDefinition, raw: unknown): CoerceResult {
  switch (def.kind) {
    case "text": {
      if (raw === null || raw === undefined) return done("");
      if (typeof raw !== "string") return fail("Expected text.");
      const multiline = def.config.multiline;
      const text = multiline ? raw.replace(/\r\n?/g, "\n") : raw.replace(/\s*[\r\n]+\s*/g, " ");
      const limit = multiline ? LIMITS.longText : LIMITS.text;
      if (text.length > limit) return fail(`Text can be at most ${limit.toLocaleString("en-US")} characters.`);
      return done(text);
    }

    case "number": {
      if (raw === null || raw === undefined) return done(null);
      if (typeof raw !== "number" || !Number.isFinite(raw)) return fail("Expected a number.");
      const n = round(raw, def.config.decimals);
      if (def.config.min !== null && n < def.config.min) return fail(`Must be at least ${def.config.min}.`);
      if (def.config.max !== null && n > def.config.max) return fail(`Must be at most ${def.config.max}.`);
      return done(n);
    }

    case "bar": {
      if (raw === null || raw === undefined) return done(null);
      if (!isObject(raw) || typeof raw.current !== "number" || typeof raw.max !== "number" || !Number.isFinite(raw.current) || !Number.isFinite(raw.max)) {
        return fail("Expected a bar like 22/30.");
      }
      if (raw.max < 0) return fail("The maximum can't be negative.");
      return done({ current: round(raw.current, def.config.decimals), max: round(raw.max, def.config.decimals) });
    }

    case "formula": {
      if (raw === null || raw === undefined) return done("");
      if (typeof raw !== "string") return fail("Expected a dice formula.");
      if (raw.trim() === "") return done("");
      const checked = checkFormula(raw);
      return checked.ok ? done(checked.notation) : fail(checked.message);
    }

    case "dropdown": {
      if (raw === null || raw === undefined || raw === "") return done(null);
      if (typeof raw !== "string") return fail("Expected one of the choices.");
      return def.config.options.some((o) => o.id === raw) ? done(raw) : fail("That choice is not in the list.");
    }

    case "list": {
      if (raw === null || raw === undefined) return done([]);
      if (!Array.isArray(raw)) return fail("Expected a list of entries.");
      const entries: ListEntry[] = [];
      for (const item of raw) {
        if (!isObject(item)) return fail("Expected a list of entries.");
        const title = item.title === undefined || item.title === null ? "" : item.title;
        const text = item.text === undefined || item.text === null ? "" : item.text;
        if (typeof title !== "string" || typeof text !== "string") return fail("Expected a list of entries.");
        const entry = { title: title.trim(), text: text.trim() };
        if (entry.title === "" && entry.text === "") continue;
        if (entry.title.length > LIMITS.listTitle) return fail(`An entry's title can be at most ${LIMITS.listTitle} characters.`);
        if (entry.text.length > LIMITS.listText) return fail(`An entry's text can be at most ${LIMITS.listText.toLocaleString("en-US")} characters.`);
        entries.push(entry);
      }
      if (entries.length > LIMITS.listEntries) return fail(`A list can have at most ${LIMITS.listEntries} entries.`);
      return done(entries);
    }

    case "link": {
      if (raw === null || raw === undefined) return done([]);
      const list = typeof raw === "string" ? [raw] : raw;
      if (!Array.isArray(list) || list.some((id) => typeof id !== "string" || id.trim() === "")) return fail("Expected items to link to.");
      const ids = [...new Set((list as string[]).map((id) => id.trim()))];
      if (!def.config.many && ids.length > 1) return fail("This property links to one item only.");
      if (ids.length > LIMITS.linkTargets) return fail(`A field can link to at most ${LIMITS.linkTargets} items.`);
      return done(ids);
    }
  }
}

// ---------------------------------------------------------------- showing

export interface FormatContext {
  /** The name of the item with this id, or undefined if it can't be found. */
  itemName?: (id: string) => string | undefined;
}

const SNIPPET = 20;
const snippet = (text: string) => (text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text);

/** A value as one line of text, for lists, tables and the page. */
export function formatValue(def: FieldDefinition, value: FieldValue, context: FormatContext = {}): string {
  switch (def.kind) {
    case "text":
    case "formula":
      return typeof value === "string" ? value : "";
    case "number": {
      if (typeof value !== "number") return "";
      const shown = String(Number(value.toFixed(def.config.decimals)));
      return def.config.unit ? `${shown} ${def.config.unit}` : shown;
    }
    case "bar": {
      const bar = value as BarValue | null;
      return bar ? `${bar.current}/${bar.max}` : "";
    }
    case "dropdown":
      return def.config.options.find((o) => o.id === value)?.label ?? "";
    case "list":
      return (value as ListEntry[]).map((e) => (e.title !== "" ? e.title : snippet(e.text))).join(", ");
    case "link": {
      const ids = value as string[];
      if (ids.length === 0) return "";
      if (!context.itemName) return ids.length === 1 ? "1 item" : `${ids.length} items`;
      return ids.map((id) => context.itemName?.(id) ?? "(missing)").join(", ");
    }
  }
}

// ---------------------------------------------------------------- ordering and searching

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** What the database keeps beside a value so it can sort, filter and search without reading the value itself. */
export interface ValueIndex {
  sortNum: number | null;
  sortText: string | null;
  searchText: string;
}

export function indexValue(def: FieldDefinition, value: FieldValue): ValueIndex {
  const none: ValueIndex = { sortNum: null, sortText: null, searchText: "" };
  if (isEmpty(def, value)) return none;
  switch (def.kind) {
    case "text":
    case "formula": {
      const text = value as string;
      return { sortNum: null, sortText: text.trim().toLowerCase() || null, searchText: text };
    }
    case "number":
      return { sortNum: value as number, sortText: null, searchText: String(value) };
    case "bar": {
      const bar = value as BarValue;
      return { sortNum: bar.current, sortText: null, searchText: `${bar.current}/${bar.max}` };
    }
    case "dropdown": {
      const index = def.config.options.findIndex((o) => o.id === value);
      if (index < 0) return none;
      const label = def.config.options[index].label;
      return { sortNum: index, sortText: label.toLowerCase(), searchText: label };
    }
    case "list": {
      const entries = value as ListEntry[];
      const lines = entries.flatMap((e) => [e.title, e.text].filter((t) => t !== ""));
      return { sortNum: entries.length, sortText: (entries[0].title || entries[0].text).toLowerCase(), searchText: lines.join("\n") };
    }
    case "link":
      return { sortNum: (value as string[]).length, sortText: null, searchText: "" };
  }
}

/**
 * Orders two values of one field. Empty values come last whichever way the order runs, so a
 * sorted table never starts with a screenful of blanks.
 */
export function compareValues(def: FieldDefinition, a: FieldValue, b: FieldValue, direction: "asc" | "desc" = "asc"): number {
  const aEmpty = isEmpty(def, a);
  const bEmpty = isEmpty(def, b);
  if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
  const sign = direction === "asc" ? 1 : -1;
  const x = indexValue(def, a);
  const y = indexValue(def, b);
  switch (def.kind) {
    case "text":
    case "formula":
      return sign * natural(a as string, b as string);
    case "list": {
      const byTitle = natural(x.sortText ?? "", y.sortText ?? "");
      return sign * (byTitle !== 0 ? byTitle : (x.sortNum ?? 0) - (y.sortNum ?? 0));
    }
    case "dropdown": {
      // A choice that no longer exists sorts after the ones that do.
      const last = def.config.options.length;
      return sign * ((x.sortNum ?? last) - (y.sortNum ?? last));
    }
    default:
      return sign * ((x.sortNum ?? 0) - (y.sortNum ?? 0));
  }
}
