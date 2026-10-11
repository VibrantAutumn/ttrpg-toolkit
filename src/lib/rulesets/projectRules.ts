import { normalizeRuleset, type Ruleset, type StatBlock } from "./ruleset";

/** What the database keeps of a project's copy of a ruleset (mirrors `ProjectRulesetRecord` in `api/rulesets.ts`). */
export interface ProjectRulesetStored {
  id: string;
  rulesetId: string | null;
  name: string;
  rulesJson: string;
  idsJson: string;
}

/**
 * A project's copy of a ruleset, read: the ruleset as it was when it was applied, and the project's own ids for
 * the properties and property sets it made or reused (found by the ruleset's keys).
 */
export interface ProjectRules {
  /** The id of the project's copy (not of the global ruleset). */
  id: string;
  rulesetId: string | null;
  name: string;
  ruleset: Ruleset;
  /** The ruleset's property key -> the project's property id. */
  fieldIds: Record<string, string>;
  /** The ruleset's stat block key -> the project's property set id. */
  setIds: Record<string, string>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readIdMap(raw: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  if (isObject(raw)) for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && v !== "") map[k] = v;
  return map;
}

/** Reads a stored copy. Never throws; a copy whose rules can't be read gives null (it is ignored, not guessed at). */
export function readProjectRules(stored: ProjectRulesetStored): ProjectRules | null {
  let rules: unknown;
  let ids: unknown;
  try {
    rules = JSON.parse(stored.rulesJson);
    ids = JSON.parse(stored.idsJson);
  } catch {
    return null;
  }
  const read = normalizeRuleset(rules);
  if (!read.ok) return null;
  const map = isObject(ids) ? ids : {};
  return { id: stored.id, rulesetId: stored.rulesetId, name: stored.name, ruleset: read.ruleset, fieldIds: readIdMap(map.fields), setIds: readIdMap(map.sets) };
}

/** A stat block of a project's ruleset, with the property set it became. */
export interface ProjectStatBlock {
  rulesName: string;
  block: StatBlock;
  /** The project's property set for it (null if it was lost, e.g. deleted and purged). */
  setId: string | null;
}

/** Every stat block of every ruleset the project uses, in order. */
export function projectStatBlocks(rules: readonly ProjectRules[]): ProjectStatBlock[] {
  return rules.flatMap((r) => r.ruleset.statBlocks.map((block) => ({ rulesName: r.name, block, setId: r.setIds[block.key] ?? null })));
}

/** The rules encounters use: those of the project's first (main) ruleset that has any; null when the project has none. */
export function mainRules(rules: readonly ProjectRules[]): ProjectRules | null {
  return rules[0] ?? null;
}
