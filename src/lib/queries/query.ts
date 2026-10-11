import type { FieldKind } from "../fields/definition";

/**
 * Queries: a saved question about the items in a project ("every document tagged NPC whose
 * Status is Alive"). A query is plain data, so it can be stored as JSON, carried in content packs
 * and run by the database (`src-tauri/src/db/query.rs`). Pure TypeScript.
 *
 * Shape: `where` is a group of rules joined with "all" (and) or "any" (or); a group can hold
 * further groups, and any rule or group can be turned around with `not`. `sort` says how the
 * answer is ordered. Meaning that both sides must agree on (the golden file in
 * `src-tauri/tests/fixtures/queries.json` is read by both):
 *  - An **incomplete** rule (nothing chosen yet, or empty text) and an **empty group** are ignored,
 *    in "all" and "any" alike, so a query still being built shows everything instead of nothing.
 *  - A rule that names a tag, folder or field that was deleted matches nothing (and "not" of it
 *    matches everything), so a deleted tag never silently widens a collection.
 *  - Trashed items, and documents that live inside another page's tabs, are never in an answer.
 */

export const QUERY_VERSION = 1;

export const QUERY_LIMITS = {
  /** Groups inside groups, counting the first. */
  depth: 4,
  /** Rules and groups in one query. */
  nodes: 100,
  text: 200,
  /** Entries in one list inside a rule. */
  ids: 50,
  days: 3650,
  sortKeys: 3,
} as const;

export type Comparison = "=" | "<" | "<=" | ">" | ">=";
export const COMPARISONS: readonly Comparison[] = ["=", "<", "<=", ">", ">="];

/** What to ask of one field. */
export type FieldTest =
  | { check: "contains"; text: string }
  | { check: "equals"; text: string }
  | { check: "number"; cmp: Comparison; value: number }
  | { check: "between"; min: number; max: number }
  | { check: "choice"; optionIds: string[] }
  | { check: "links"; itemId: string }
  | { check: "empty" };

export type FieldCheck = FieldTest["check"];

export type RuleBody =
  | { kind: "itemType"; types: string[] }
  | { kind: "library"; libraries: string[] }
  | { kind: "folder"; folderId: string; subfolders: boolean }
  | { kind: "tag"; tagId: string; subtags: boolean }
  | { kind: "name"; text: string }
  /** The text appears in the name, a document's body, or any field's text. */
  | { kind: "text"; text: string }
  | { kind: "field"; fieldId: string; test: FieldTest }
  /** The item has a link (of any kind) to this item. */
  | { kind: "linksTo"; itemId: string }
  /** This item has a link to the item. */
  | { kind: "linkedFrom"; itemId: string }
  /** Changed in the last so many days. */
  | { kind: "changed"; days: number };

export type RuleKind = RuleBody["kind"];
export const RULE_KINDS: readonly RuleKind[] = ["itemType", "library", "folder", "tag", "name", "text", "field", "linksTo", "linkedFrom", "changed"];

export type Rule = RuleBody & { not: boolean };
export interface Group {
  op: "all" | "any";
  not: boolean;
  rules: (Rule | Group)[];
}
export type Node = Rule | Group;

export type SortKey = { by: "name" | "created" | "updated" | "type"; dir: "asc" | "desc" } | { by: "field"; fieldId: string; dir: "asc" | "desc" };

/** A column of the table view, after the always-present name column. */
export type Column = { by: "type" | "created" | "updated" } | { by: "field"; fieldId: string };

/** How a smart collection is shown. The engine ignores it; it is saved with the query. */
export interface View {
  mode: "list" | "table";
  columns: Column[];
}

export const MAX_COLUMNS = 12;

export interface Query {
  version: number;
  where: Group;
  sort: SortKey[];
  /** Left out until someone chooses a view (then the list is used). */
  view?: View;
}

export const isGroup = (node: Node): node is Group => "op" in node;

export const DEFAULT_SORT: SortKey[] = [{ by: "name", dir: "asc" }];

export function emptyQuery(): Query {
  return { version: QUERY_VERSION, where: { op: "all", not: false, rules: [] }, sort: DEFAULT_SORT.map((k) => ({ ...k })) };
}

/** The tests that make sense for each kind of field, in the order they are offered. */
export function testsForKind(kind: FieldKind): FieldCheck[] {
  switch (kind) {
    case "text":
    case "formula":
      return ["contains", "equals", "empty"];
    case "number":
    case "bar":
    case "date":
      return ["number", "between", "empty"];
    case "dropdown":
      return ["choice", "empty"];
    case "list":
      return ["contains", "empty"];
    case "link":
      return ["links", "empty"];
  }
}

/** Whether a rule has everything it needs to be run (incomplete rules are ignored when running). */
export function isRuleComplete(rule: Rule): boolean {
  switch (rule.kind) {
    case "itemType":
      return rule.types.length > 0;
    case "library":
      return rule.libraries.length > 0;
    case "folder":
      return rule.folderId !== "";
    case "tag":
      return rule.tagId !== "";
    case "name":
    case "text":
      return rule.text.trim() !== "";
    case "linksTo":
    case "linkedFrom":
      return rule.itemId !== "";
    case "changed":
      return rule.days >= 1;
    case "field": {
      if (rule.fieldId === "") return false;
      const t = rule.test;
      switch (t.check) {
        case "contains":
        case "equals":
          return t.text.trim() !== "";
        case "choice":
          return t.optionIds.length > 0;
        case "links":
          return t.itemId !== "";
        default:
          return true;
      }
    }
  }
}

// ---------------------------------------------------------------- reading

export type NormalizeResult = { ok: true; query: Query } | { ok: false; error: string };

class Bad extends Error {}
const bad = (message: string): never => {
  throw new Bad(message);
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function text(v: unknown, what: string, allowMissing = false): string {
  if (v === undefined || v === null) return allowMissing ? "" : bad(`${what} is missing.`);
  if (typeof v !== "string") return bad(`${what} has to be text.`);
  const t = v.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (t.length > QUERY_LIMITS.text) return bad(`${what} can be at most ${QUERY_LIMITS.text} characters.`);
  return t;
}

function strings(v: unknown, what: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return bad(`${what} has to be a list.`);
  const out: string[] = [];
  for (const item of v) {
    const t = text(item, what);
    if (t !== "" && !out.includes(t)) out.push(t);
  }
  if (out.length > QUERY_LIMITS.ids) return bad(`${what} can have at most ${QUERY_LIMITS.ids} entries.`);
  return out;
}

function finite(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return bad(`${what} has to be a number.`);
  return Object.is(v, -0) ? 0 : v;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function readTest(raw: unknown): FieldTest {
  if (!isObject(raw)) return bad("A property rule needs a test.");
  switch (raw.check) {
    case "contains":
    case "equals":
      return { check: raw.check, text: text(raw.text, "The text", true) };
    case "number": {
      if (typeof raw.cmp !== "string" || !COMPARISONS.includes(raw.cmp as Comparison)) return bad("That comparison isn't one of =, <, <=, > or >=.");
      return { check: "number", cmp: raw.cmp as Comparison, value: finite(raw.value, "The value") };
    }
    case "between": {
      const a = finite(raw.min, "The lowest value");
      const b = finite(raw.max, "The highest value");
      return { check: "between", min: Math.min(a, b), max: Math.max(a, b) };
    }
    case "choice":
      return { check: "choice", optionIds: strings(raw.optionIds, "The choices") };
    case "links":
      return { check: "links", itemId: text(raw.itemId, "The item", true) };
    case "empty":
      return { check: "empty" };
    default:
      return bad(`I don't know a property test called “${String(raw.check)}”.`);
  }
}

function readRule(raw: Record<string, unknown>): Rule {
  const not = bool(raw.not, false);
  switch (raw.kind) {
    case "itemType":
      return { kind: "itemType", types: strings(raw.types, "The types"), not };
    case "library":
      return { kind: "library", libraries: strings(raw.libraries, "The libraries"), not };
    case "folder":
      return { kind: "folder", folderId: text(raw.folderId, "The folder", true), subfolders: bool(raw.subfolders, true), not };
    case "tag":
      return { kind: "tag", tagId: text(raw.tagId, "The tag", true), subtags: bool(raw.subtags, true), not };
    case "name":
    case "text":
      return { kind: raw.kind, text: text(raw.text, "The text", true), not };
    case "field":
      return { kind: "field", fieldId: text(raw.fieldId, "The field", true), test: readTest(raw.test), not };
    case "linksTo":
    case "linkedFrom":
      return { kind: raw.kind, itemId: text(raw.itemId, "The item", true), not };
    case "changed": {
      const days = Math.round(finite(raw.days, "The number of days"));
      if (days < 1 || days > QUERY_LIMITS.days) return bad(`The number of days has to be from 1 to ${QUERY_LIMITS.days}.`);
      return { kind: "changed", days, not };
    }
    default:
      return bad(`I don't know a rule called “${String(raw.kind)}”. It may come from a newer version of the app.`);
  }
}

function readGroup(raw: unknown, depth: number, counter: { n: number }): Group {
  if (!isObject(raw)) return bad("A group has to be an object.");
  if (depth > QUERY_LIMITS.depth) return bad(`Groups can be nested at most ${QUERY_LIMITS.depth} deep.`);
  if (raw.op !== "all" && raw.op !== "any") return bad("A group has to match “all” or “any” of its rules.");
  const list = raw.rules === undefined || raw.rules === null ? [] : raw.rules;
  if (!Array.isArray(list)) return bad("A group's rules have to be a list.");
  const rules: Node[] = [];
  for (const entry of list) {
    if (!isObject(entry)) return bad("A rule has to be an object.");
    if (++counter.n > QUERY_LIMITS.nodes) return bad(`There are too many rules (at most ${QUERY_LIMITS.nodes}).`);
    rules.push("op" in entry ? readGroup(entry, depth + 1, counter) : readRule(entry));
  }
  return { op: raw.op, not: bool(raw.not, false), rules };
}

function readSort(raw: unknown): SortKey[] {
  if (raw === undefined || raw === null) return DEFAULT_SORT.map((k) => ({ ...k }));
  if (!Array.isArray(raw)) return bad("The sort has to be a list.");
  const keys: SortKey[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isObject(entry)) return bad("A sort key has to be an object.");
    const dir = entry.dir === "desc" ? "desc" : "asc";
    let key: SortKey;
    if (entry.by === "name" || entry.by === "created" || entry.by === "updated" || entry.by === "type") {
      key = { by: entry.by, dir };
    } else if (entry.by === "field") {
      const fieldId = text(entry.fieldId, "The sort property", true);
      if (fieldId === "") return bad("A sort by property needs a property.");
      key = { by: "field", fieldId, dir };
    } else {
      return bad(`I can't sort by “${String(entry.by)}”.`);
    }
    const id = key.by === "field" ? `field:${key.fieldId}` : key.by;
    if (seen.has(id) || keys.length >= QUERY_LIMITS.sortKeys) continue;
    seen.add(id);
    keys.push(key);
  }
  return keys.length > 0 ? keys : DEFAULT_SORT.map((k) => ({ ...k }));
}

function readView(raw: unknown): View | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) return bad("The view has to be an object.");
  const list = raw.columns === undefined || raw.columns === null ? [] : raw.columns;
  if (!Array.isArray(list)) return bad("The columns have to be a list.");
  const columns: Column[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!isObject(entry)) return bad("A column has to be an object.");
    let column: Column;
    if (entry.by === "type" || entry.by === "created" || entry.by === "updated") {
      column = { by: entry.by };
    } else if (entry.by === "field") {
      const fieldId = text(entry.fieldId, "The column's property", true);
      if (fieldId === "") return bad("A property column needs a property.");
      column = { by: "field", fieldId };
    } else {
      return bad(`I don't know a column called “${String(entry.by)}”.`);
    }
    const id = column.by === "field" ? `field:${column.fieldId}` : column.by;
    if (seen.has(id)) continue;
    seen.add(id);
    columns.push(column);
  }
  if (columns.length > MAX_COLUMNS) return bad(`A table can have at most ${MAX_COLUMNS} columns.`);
  return { mode: raw.mode === "table" ? "table" : "list", columns };
}

/**
 * The one gate every query goes through (built in the editor, read back from the database or
 * arriving in a content pack). Returns the query in its one proper form, or says in a sentence
 * what is wrong. Never throws, and never guesses: a rule it doesn't know is an error, because
 * dropping it would quietly change what the query means.
 */
export function normalizeQuery(raw: unknown): NormalizeResult {
  try {
    if (!isObject(raw)) return { ok: false, error: "This isn't a query." };
    if (typeof raw.version === "number" && raw.version > QUERY_VERSION) {
      return { ok: false, error: "This query was made by a newer version of the app." };
    }
    if (raw.version !== QUERY_VERSION) return { ok: false, error: "This isn't a query." };
    const where = readGroup(raw.where, 1, { n: 0 });
    const view = readView(raw.view);
    const query: Query = { version: QUERY_VERSION, where, sort: readSort(raw.sort) };
    if (view) query.view = view;
    return { ok: true, query };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    return { ok: false, error: "This isn't a query." };
  }
}

/** Reads a query stored as JSON text. */
export function parseQuery(json: string): NormalizeResult {
  try {
    return normalizeQuery(JSON.parse(json));
  } catch {
    return { ok: false, error: "This isn't a query." };
  }
}
