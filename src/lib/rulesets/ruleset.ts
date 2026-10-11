import { normalizeDefinition, validateDefinition, type FieldKind } from "../fields/definition";
import { checkFormula } from "../dice/formula";

/**
 * Rulesets: a global definition of a game system. Pure TypeScript, no database.
 *
 * A ruleset is plain data: the properties its stat blocks use, the stat blocks themselves (each
 * becomes a property set in a project), saved dice formulas, and the rules encounters follow
 * (how initiative works, which statuses exist, which properties show in combat).
 *
 * Rulesets are global, properties are per project, so **picking a ruleset for a project copies
 * it in** (the database side does that; see `db/rulesets.rs`): the properties and sets are made
 * in the project (or the ones with the same name are used), and the encounter rules are copied
 * to the project. Later edits to the global ruleset change nothing until it is applied again.
 *
 * Inside a ruleset properties are found by a `key` (unique in the ruleset); the project's own
 * ids are worked out when it is applied.
 */

export const RULESET_VERSION = 1;

export const LIMITS = {
  name: 60,
  description: 500,
  fields: 80,
  statBlocks: 20,
  formulas: 40,
  statuses: 40,
  combatFields: 12,
  key: 40,
  statusNotes: 300,
} as const;

export type InitiativeType = "individual" | "group" | "popcorn";

export const INITIATIVE_LABELS: Record<InitiativeType, string> = {
  individual: "Individual (everyone rolls)",
  group: "Group (sides alternate)",
  popcorn: "Popcorn (whoever just went picks next)",
};

/** A property a stat block uses. `config` is the property kind's own settings (see `lib/fields/definition.ts`). */
export interface RulesetField {
  key: string;
  name: string;
  kind: FieldKind;
  description: string;
  config: Record<string, unknown>;
}

/** A stat block: a named group of the ruleset's properties (a character, a monster, a vehicle...). */
export interface StatBlock {
  key: string;
  name: string;
  description: string;
  /** Keys of the ruleset's fields, in order. */
  fields: string[];
}

export interface RulesetFormula {
  name: string;
  notation: string;
}

/** A condition a combatant can have (Poisoned, Prone...). */
export interface StatusType {
  id: string;
  name: string;
  /** What it does, shown as a reminder. */
  notes: string;
  /** Rounds it lasts when added, or null if it lasts until removed. */
  duration: number | null;
  /** `#rrggbb`, or none. */
  color: string | null;
}

export interface InitiativeRules {
  type: InitiativeType;
  /** Dice notation rolled for each combatant (e.g. `1d20`); blank means turn order is entered by hand. */
  formula: string;
  /** Key of a number property added to the roll (e.g. a Dexterity modifier), or null. */
  bonusField: string | null;
  /** Whether the highest or the lowest result goes first. */
  order: "high" | "low";
}

export interface EncounterRules {
  initiative: InitiativeRules;
  statuses: StatusType[];
  /** Key of the bar property that is a combatant's health, or null (no health bar). */
  healthField: string | null;
  /** Keys of the number or text properties shown on each combatant's row in combat. */
  combatFields: string[];
}

export interface Ruleset {
  version: typeof RULESET_VERSION;
  fields: RulesetField[];
  statBlocks: StatBlock[];
  formulas: RulesetFormula[];
  encounter: EncounterRules;
}

export function emptyEncounterRules(): EncounterRules {
  return { initiative: { type: "individual", formula: "1d20", bonusField: null, order: "high" }, statuses: [], healthField: null, combatFields: [] };
}

export function emptyRuleset(): Ruleset {
  return { version: RULESET_VERSION, fields: [], statBlocks: [], formulas: [], encounter: emptyEncounterRules() };
}

// ---------------------------------------------------------------- reading what was stored

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const COLOR = /^#[0-9a-fA-F]{6}$/;

export type RulesetRead = { ok: true; ruleset: Ruleset; warnings: string[] } | { ok: false; error: string };

/**
 * The one gate every ruleset passes through. Never throws. Repairs what can be repaired and says
 * what it dropped (`warnings`); refuses only what it cannot read at all (not an object, or made
 * by a newer version of the app). Reading its own result changes nothing.
 */
export function normalizeRuleset(raw: unknown): RulesetRead {
  if (!isObject(raw)) return { ok: false, error: "That isn't a ruleset." };
  if (typeof raw.version === "number" && raw.version > RULESET_VERSION) {
    return { ok: false, error: "That ruleset was made by a newer version of the app. Update the app to use it." };
  }
  const warnings: string[] = [];

  // Properties.
  const fields: RulesetField[] = [];
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const item of Array.isArray(raw.fields) ? raw.fields : []) {
    if (!isObject(item)) continue;
    const key = str(item.key).slice(0, LIMITS.key);
    const def = normalizeDefinition({ id: key, name: item.name, kind: item.kind, description: item.description, config: item.config });
    if (key === "" || !def) {
      warnings.push("A property that couldn't be read was left out.");
      continue;
    }
    if (keys.has(key) || names.has(def.name.toLowerCase())) {
      warnings.push(`A second property called “${def.name}” was left out.`);
      continue;
    }
    if (validateDefinition(def).length > 0) {
      warnings.push(`The property “${def.name}” has a problem and was left out.`);
      continue;
    }
    if (fields.length >= LIMITS.fields) {
      warnings.push(`A ruleset can have at most ${LIMITS.fields} properties; the rest were left out.`);
      break;
    }
    keys.add(key);
    names.add(def.name.toLowerCase());
    fields.push({ key, name: def.name, kind: def.kind, description: def.description, config: { ...def.config } });
  }
  const kindOf = new Map(fields.map((f) => [f.key, f.kind]));

  // Stat blocks.
  const statBlocks: StatBlock[] = [];
  const blockKeys = new Set<string>();
  const blockNames = new Set<string>();
  for (const item of Array.isArray(raw.statBlocks) ? raw.statBlocks : []) {
    if (!isObject(item)) continue;
    const key = str(item.key).slice(0, LIMITS.key);
    const name = str(item.name).slice(0, LIMITS.name);
    if (key === "" || name === "" || blockKeys.has(key) || blockNames.has(name.toLowerCase())) {
      warnings.push("A stat block that couldn't be read, or had a repeated name, was left out.");
      continue;
    }
    if (statBlocks.length >= LIMITS.statBlocks) {
      warnings.push(`A ruleset can have at most ${LIMITS.statBlocks} stat blocks; the rest were left out.`);
      break;
    }
    const used = new Set<string>();
    const blockFields: string[] = [];
    for (const k of Array.isArray(item.fields) ? item.fields : []) {
      const fieldKey = str(k);
      if (!kindOf.has(fieldKey)) {
        warnings.push(`The stat block “${name}” named a property that doesn't exist; it was dropped.`);
        continue;
      }
      if (used.has(fieldKey)) continue;
      used.add(fieldKey);
      blockFields.push(fieldKey);
    }
    blockKeys.add(key);
    blockNames.add(name.toLowerCase());
    statBlocks.push({ key, name, description: str(item.description).slice(0, LIMITS.description), fields: blockFields });
  }

  // Dice.
  const formulas: RulesetFormula[] = [];
  const formulaNames = new Set<string>();
  for (const item of Array.isArray(raw.formulas) ? raw.formulas : []) {
    if (!isObject(item)) continue;
    const name = str(item.name).slice(0, LIMITS.name);
    const check = checkFormula(str(item.notation));
    if (name === "" || !check.ok || formulaNames.has(name.toLowerCase())) {
      warnings.push(`The formula “${name || "(no name)"}” couldn't be used and was left out.`);
      continue;
    }
    if (formulas.length >= LIMITS.formulas) {
      warnings.push(`A ruleset can have at most ${LIMITS.formulas} formulas; the rest were left out.`);
      break;
    }
    formulaNames.add(name.toLowerCase());
    formulas.push({ name, notation: check.notation });
  }

  // Encounter rules.
  const enc = isObject(raw.encounter) ? raw.encounter : {};
  const rawInit = isObject(enc.initiative) ? enc.initiative : {};
  const type: InitiativeType = rawInit.type === "group" || rawInit.type === "popcorn" ? rawInit.type : "individual";
  let formula = typeof rawInit.formula === "string" ? rawInit.formula.trim() : "1d20";
  if (formula !== "") {
    const check = checkFormula(formula);
    if (check.ok) formula = check.notation;
    else {
      warnings.push("The initiative formula couldn't be read, so it was reset to 1d20.");
      formula = "1d20";
    }
  }
  let bonusField: string | null = str(rawInit.bonusField) || null;
  if (bonusField !== null && kindOf.get(bonusField) !== "number") {
    warnings.push("The initiative bonus has to be a number property; it was cleared.");
    bonusField = null;
  }
  const initiative: InitiativeRules = { type, formula, bonusField, order: rawInit.order === "low" ? "low" : "high" };

  const statuses: StatusType[] = [];
  const statusIds = new Set<string>();
  const statusNames = new Set<string>();
  for (const item of Array.isArray(enc.statuses) ? enc.statuses : []) {
    if (!isObject(item)) continue;
    const id = str(item.id).slice(0, LIMITS.key);
    const name = str(item.name).slice(0, LIMITS.name);
    if (id === "" || name === "" || statusIds.has(id) || statusNames.has(name.toLowerCase())) {
      warnings.push("A status that couldn't be read, or had a repeated name, was left out.");
      continue;
    }
    if (statuses.length >= LIMITS.statuses) {
      warnings.push(`A ruleset can have at most ${LIMITS.statuses} statuses; the rest were left out.`);
      break;
    }
    const d = typeof item.duration === "number" && Number.isFinite(item.duration) ? Math.round(item.duration) : null;
    statusIds.add(id);
    statusNames.add(name.toLowerCase());
    statuses.push({
      id,
      name,
      notes: str(item.notes).slice(0, LIMITS.statusNotes),
      duration: d !== null && d >= 1 && d <= 1000 ? d : null,
      color: typeof item.color === "string" && COLOR.test(item.color) ? item.color.toLowerCase() : null,
    });
  }

  let healthField: string | null = str(enc.healthField) || null;
  if (healthField !== null && kindOf.get(healthField) !== "bar") {
    warnings.push("The health property has to be a bar; it was cleared.");
    healthField = null;
  }
  const combatFields: string[] = [];
  for (const k of Array.isArray(enc.combatFields) ? enc.combatFields : []) {
    const key = str(k);
    const kind = kindOf.get(key);
    if (kind === undefined || combatFields.includes(key) || key === healthField) continue;
    if (combatFields.length >= LIMITS.combatFields) break;
    combatFields.push(key);
  }

  return { ok: true, ruleset: { version: RULESET_VERSION, fields, statBlocks, formulas, encounter: { initiative, statuses, healthField, combatFields } }, warnings };
}

/** Reads stored text. Anything that isn't JSON, or isn't a ruleset, gives an error sentence. */
export function parseRuleset(text: string): RulesetRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That ruleset's data couldn't be read." };
  }
  return normalizeRuleset(raw);
}

/** What is wrong with a ruleset that the person should fix (empty if it is usable). */
export function problemsWith(name: string, ruleset: Ruleset): string[] {
  const problems: string[] = [];
  if (name.trim() === "") problems.push("Give the ruleset a name.");
  else if (name.trim().length > LIMITS.name) problems.push(`A name can be at most ${LIMITS.name} characters.`);
  for (const block of ruleset.statBlocks) {
    if (block.fields.length === 0) problems.push(`The stat block “${block.name}” has no properties yet.`);
  }
  return problems;
}

// ---------------------------------------------------------------- editing (immutable)

/** Makes a key that no field, stat block or status of this kind already uses, from a name. */
export function uniqueKey(name: string, taken: Iterable<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "item";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}-${n}`;
    if (!used.has(key)) return key;
  }
}

/** Removes a property everywhere it is used, so the ruleset stays consistent. */
export function removeField(ruleset: Ruleset, key: string): Ruleset {
  const { initiative } = ruleset.encounter;
  return {
    ...ruleset,
    fields: ruleset.fields.filter((f) => f.key !== key),
    statBlocks: ruleset.statBlocks.map((b) => ({ ...b, fields: b.fields.filter((k) => k !== key) })),
    encounter: {
      ...ruleset.encounter,
      initiative: { ...initiative, bonusField: initiative.bonusField === key ? null : initiative.bonusField },
      healthField: ruleset.encounter.healthField === key ? null : ruleset.encounter.healthField,
      combatFields: ruleset.encounter.combatFields.filter((k) => k !== key),
    },
  };
}

// ---------------------------------------------------------------- applying to a project

/** What the database installs into a project (field names must match `RulesetBundle` in Rust). */
export interface RulesetBundleJson {
  fields: { key: string; name: string; kind: string; description: string; configJson: string }[];
  sets: { key: string; name: string; description: string; fieldKeys: string[] }[];
  formulas: { name: string; notation: string }[];
}

/** The part of a ruleset that becomes project data: properties, property sets (one per stat block) and formulas. */
export function toBundle(ruleset: Ruleset): RulesetBundleJson {
  // Only properties a stat block, the health bar, a combat column or the initiative bonus uses are installed; the
  // editor lists properties in one place, but a property nothing uses would only clutter the project.
  const used = new Set<string>();
  for (const block of ruleset.statBlocks) block.fields.forEach((k) => used.add(k));
  const { healthField, combatFields, initiative } = ruleset.encounter;
  if (healthField) used.add(healthField);
  combatFields.forEach((k) => used.add(k));
  if (initiative.bonusField) used.add(initiative.bonusField);
  return {
    fields: ruleset.fields
      .filter((f) => used.has(f.key))
      .map((f) => ({ key: f.key, name: f.name, kind: f.kind, description: f.description, configJson: JSON.stringify(f.config) })),
    sets: ruleset.statBlocks.map((b) => ({ key: b.key, name: b.name, description: b.description, fieldKeys: b.fields })),
    formulas: ruleset.formulas.map((f) => ({ name: f.name, notation: f.notation })),
  };
}
