import { normalizeRuleset, type Ruleset } from "./ruleset";

/**
 * Starter rulesets: ready-made game systems that come with the app. A starter is plain data;
 * adding one makes an ordinary global ruleset (editable, deletable) remembering its `id` in
 * `origin_id`, which is how "already added" is known. All the text is original to this app.
 */
export interface StarterRulesetDef {
  /** Starts with `starter:`. */
  id: string;
  name: string;
  description: string;
  ruleset: Ruleset;
}

/**
 * Reads hand-written ruleset data through the one reader. A starter that needs repairing is a
 * mistake in the starter, so this refuses it loudly (the tests also check every starter).
 */
export function buildRuleset(raw: unknown): Ruleset {
  const read = normalizeRuleset(raw);
  if (!read.ok) throw new Error(read.error);
  if (read.warnings.length > 0) throw new Error(`A starter ruleset needed repairs: ${read.warnings.join(" ")}`);
  return read.ruleset;
}

/** A number property (a score, a rating). */
export const num = (key: string, name: string, description = "", config: Record<string, unknown> = {}) => ({ key, name, kind: "number", description, config });
/** A bar property (current / maximum). */
export const bar = (key: string, name: string, description = "") => ({ key, name, kind: "bar", description, config: { decimals: 0 } });
/** A single-line or multi-line text property. */
export const text = (key: string, name: string, description = "", multiline = false) => ({ key, name, kind: "text", description, config: { multiline } });
/** A list property (entries with a title and a description). */
export const list = (key: string, name: string, description = "") => ({ key, name, kind: "list", description, config: {} });
/** A dice formula property. */
export const formula = (key: string, name: string, description = "") => ({ key, name, kind: "formula", description, config: {} });

export const status = (name: string, notes: string, duration: number | null = null, color: string | null = null) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  name,
  notes,
  duration,
  color,
});
