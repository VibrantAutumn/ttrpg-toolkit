/**
 * Field definitions: what a field *is* (its name, kind and settings). Pure TypeScript, no
 * database; the values are in `value.ts`. A definition belongs to a project and is shared by
 * every item that uses the field; values are stored against the definition's id, so renaming a
 * field or one of a dropdown's choices never disturbs saved values.
 *
 * Kinds (the spec's list, minus one that waits for a later phase): text, number, bar (current
 * and maximum), dice formula, dropdown, list (entries with a title and a description), link
 * (to other items) and date (an in-world day or range of days; see `lib/calendar/`). The
 * map-location field needs maps (Phase 7).
 */

export type FieldKind = "text" | "number" | "bar" | "formula" | "dropdown" | "list" | "link" | "date";

export const FIELD_KINDS: readonly FieldKind[] = ["text", "number", "bar", "formula", "dropdown", "list", "link", "date"];

export const KIND_LABELS: Record<FieldKind, string> = {
  text: "Text",
  number: "Number",
  bar: "Bar (current / max)",
  formula: "Dice formula",
  dropdown: "Dropdown",
  list: "List",
  link: "Link",
  date: "Date",
};

/** Sizes everything is held to. The database checks the same limits. */
export const LIMITS = {
  name: 60,
  description: 300,
  options: 100,
  optionLabel: 60,
  decimals: 6,
  unit: 20,
  text: 500,
  longText: 10_000,
  listEntries: 200,
  listTitle: 100,
  listText: 5_000,
  linkTargets: 200,
  idLength: 64,
} as const;

export interface DropdownOption {
  /** Never changes, so a saved value keeps pointing at the choice when it is renamed. */
  id: string;
  label: string;
  /** `#rrggbb`, or none. */
  color: string | null;
}

export interface TextConfig {
  multiline: boolean;
}
export interface NumberConfig {
  min: number | null;
  max: number | null;
  decimals: number;
  unit: string;
}
export interface BarConfig {
  decimals: number;
}
export type FormulaConfig = Record<string, never>;
export interface DropdownConfig {
  options: DropdownOption[];
}
export type ListConfig = Record<string, never>;
export interface LinkConfig {
  /** One target or several. */
  many: boolean;
  /** Only items of this tool's library, if set (a tool id such as "worldbuilding"). */
  library: string | null;
  /** Only items of these types, if any are listed. */
  itemTypes: string[];
}

export interface DateConfig {
  /** Whether the property can hold a range (a start and an end) as well as a single day. */
  range: boolean;
}

interface Base {
  id: string;
  name: string;
  description: string;
}

export type FieldDefinition =
  | (Base & { kind: "text"; config: TextConfig })
  | (Base & { kind: "number"; config: NumberConfig })
  | (Base & { kind: "bar"; config: BarConfig })
  | (Base & { kind: "formula"; config: FormulaConfig })
  | (Base & { kind: "dropdown"; config: DropdownConfig })
  | (Base & { kind: "list"; config: ListConfig })
  | (Base & { kind: "link"; config: LinkConfig })
  | (Base & { kind: "date"; config: DateConfig });

export type ConfigOf<K extends FieldKind> = Extract<FieldDefinition, { kind: K }>["config"];

const COLOR = /^#[0-9a-fA-F]{6}$/;

export function defaultConfig<K extends FieldKind>(kind: K): ConfigOf<K>;
export function defaultConfig(kind: FieldKind): FieldDefinition["config"] {
  switch (kind) {
    case "text":
      return { multiline: false };
    case "number":
      return { min: null, max: null, decimals: 0, unit: "" };
    case "bar":
      return { decimals: 0 };
    case "dropdown":
      return { options: [] };
    case "link":
      return { many: false, library: null, itemTypes: [] };
    case "date":
      return { range: false };
    default:
      return {};
  }
}

/** A new definition with the plain settings for its kind. The name is kept as given (see `validateDefinition`). */
export function newDefinition(kind: FieldKind, id: string, name: string): FieldDefinition {
  return { id, name, kind, description: "", config: defaultConfig(kind) } as FieldDefinition;
}

// ---------------------------------------------------------------- checking

/** What is wrong with a definition, as sentences for people (empty if it is fine). */
export function validateDefinition(def: FieldDefinition): string[] {
  const problems: string[] = [];
  const name = def.name.trim();
  if (name === "") problems.push("Give the property a name.");
  else if (name.length > LIMITS.name) problems.push(`A field name can be at most ${LIMITS.name} characters.`);
  if (def.description.length > LIMITS.description) {
    problems.push(`A description can be at most ${LIMITS.description} characters.`);
  }

  if (def.kind === "number" || def.kind === "bar") {
    const { decimals } = def.config;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > LIMITS.decimals) {
      problems.push(`A number can have 0 to ${LIMITS.decimals} decimal places.`);
    }
  }
  if (def.kind === "number") {
    const { min, max } = def.config;
    if (min !== null && max !== null && min > max) problems.push("The smallest value can't be bigger than the largest.");
  }
  if (def.kind === "dropdown") {
    const { options } = def.config;
    if (options.length > LIMITS.options) problems.push(`A dropdown can have at most ${LIMITS.options} choices.`);
    if (options.some((o) => o.label.trim() === "")) problems.push("Every choice needs a name.");
    const seen = new Set<string>();
    for (const o of options) {
      const key = o.label.trim().toLowerCase();
      if (key === "") continue;
      if (seen.has(key)) {
        const message = `Two choices are called “${key}”.`;
        if (!problems.includes(message)) problems.push(message);
      }
      seen.add(key);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- reading what was stored

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const decimalsOf = (v: unknown) => {
  const n = finite(v);
  return n === null ? 0 : Math.min(LIMITS.decimals, Math.max(0, Math.round(n)));
};

function normalizeOptions(raw: unknown): DropdownOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const options: DropdownOption[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const id = str(item.id);
    const label = str(item.label).slice(0, LIMITS.optionLabel);
    if (id === "" || label === "" || seen.has(id)) continue;
    seen.add(id);
    const color = typeof item.color === "string" && COLOR.test(item.color) ? item.color.toLowerCase() : null;
    options.push({ id, label, color });
  }
  return options;
}

/**
 * Reads a definition from stored JSON: repairs what can be repaired (missing or odd settings
 * get their defaults) and gives null if it isn't a definition at all (no id or name, or a kind
 * this version doesn't know). Reading is stable: reading its own result changes nothing.
 */
export function normalizeDefinition(raw: unknown): FieldDefinition | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id).slice(0, LIMITS.idLength);
  const name = str(raw.name).slice(0, LIMITS.name);
  const kind = raw.kind as FieldKind;
  if (id === "" || name === "" || !FIELD_KINDS.includes(kind)) return null;
  const description = str(raw.description).slice(0, LIMITS.description);
  const config = isObject(raw.config) ? raw.config : {};
  const base = { id, name, description };

  switch (kind) {
    case "text":
      return { ...base, kind, config: { multiline: config.multiline === true } };
    case "number":
      return {
        ...base,
        kind,
        config: { min: finite(config.min), max: finite(config.max), decimals: decimalsOf(config.decimals), unit: str(config.unit).slice(0, LIMITS.unit) },
      };
    case "bar":
      return { ...base, kind, config: { decimals: decimalsOf(config.decimals) } };
    case "dropdown":
      return { ...base, kind, config: { options: normalizeOptions(config.options) } };
    case "link": {
      const types = Array.isArray(config.itemTypes) ? config.itemTypes.map(str).filter((t) => t !== "") : [];
      return {
        ...base,
        kind,
        config: { many: config.many === true, library: str(config.library) || null, itemTypes: [...new Set(types)] },
      };
    }
    case "date":
      return { ...base, kind, config: { range: config.range === true } };
    default:
      return { ...base, kind, config: {} } as FieldDefinition;
  }
}

// ---------------------------------------------------------------- dropdown choices

type DropdownDefinition = Extract<FieldDefinition, { kind: "dropdown" }>;

/** Applies a change to a dropdown's choices; any other kind of field comes back unchanged. */
function withOptions(def: FieldDefinition, change: (options: DropdownOption[]) => DropdownOption[]): FieldDefinition {
  if (def.kind !== "dropdown") return def;
  const next: DropdownDefinition = { ...def, config: { ...def.config, options: change(def.config.options.map((o) => ({ ...o }))) } };
  return next;
}

/** Adds a choice at the end. `id` is made by the caller (so this stays pure); an empty name adds nothing. */
export function addOption(def: FieldDefinition, label: string, id: string): FieldDefinition {
  const name = label.trim();
  if (name === "") return def;
  return withOptions(def, (options) => [...options, { id, label: name, color: null }]);
}

export function renameOption(def: FieldDefinition, id: string, label: string): FieldDefinition {
  return withOptions(def, (options) => options.map((o) => (o.id === id ? { ...o, label: label.trim() } : o)));
}

export function removeOption(def: FieldDefinition, id: string): FieldDefinition {
  return withOptions(def, (options) => options.filter((o) => o.id !== id));
}

/** Moves a choice up (negative) or down (positive); at the ends it stays where it is. */
export function moveOption(def: FieldDefinition, id: string, delta: number): FieldDefinition {
  return withOptions(def, (options) => {
    const from = options.findIndex((o) => o.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= options.length) return options;
    const [moved] = options.splice(from, 1);
    options.splice(to, 0, moved);
    return options;
  });
}

/** Sets a choice's colour (`#rrggbb`) or clears it (null). Anything else is not a colour and changes nothing. */
export function setOptionColor(def: FieldDefinition, id: string, color: string | null): FieldDefinition {
  if (color !== null && !COLOR.test(color)) return def;
  return withOptions(def, (options) => options.map((o) => (o.id === id ? { ...o, color: color === null ? null : color.toLowerCase() } : o)));
}
