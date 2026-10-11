import { invoke } from "@tauri-apps/api/core";
import { normalizeRuleset, toBundle, type Ruleset } from "../lib/rulesets/ruleset";

/** Mirrors the Rust `Ruleset`. `definitionJson` is read with `parseRuleset` (`lib/rulesets/ruleset.ts`). */
export interface RulesetRecord {
  id: string;
  name: string;
  description: string;
  definitionJson: string;
  originId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `ProjectRuleset`: a project's copy of a ruleset. */
export interface ProjectRulesetRecord {
  id: string;
  projectId: string;
  rulesetId: string | null;
  name: string;
  rulesJson: string;
  idsJson: string;
  position: number;
}

/** Mirrors the Rust `ApplyResult`. */
export interface ApplyResult {
  projectRuleset: ProjectRulesetRecord;
  fieldsMade: number;
  setsMade: number;
  formulasMade: number;
}

export const listRulesets = () => invoke<RulesetRecord[]>("list_rulesets");
export const listDeletedRulesets = () => invoke<RulesetRecord[]>("list_deleted_rulesets");
export const getRuleset = (id: string) => invoke<RulesetRecord>("get_ruleset", { id });
export const createRuleset = (name: string, description: string, ruleset: Ruleset, originId: string | null = null) =>
  invoke<RulesetRecord>("create_ruleset", { name, description, definitionJson: JSON.stringify(ruleset), originId });
export const updateRuleset = (id: string, name: string, description: string, ruleset: Ruleset) =>
  invoke<RulesetRecord>("update_ruleset", { id, name, description, definitionJson: JSON.stringify(ruleset) });
export const deleteRuleset = (id: string) => invoke<void>("delete_ruleset", { id });
export const restoreRuleset = (id: string) => invoke<RulesetRecord>("restore_ruleset", { id });
export const purgeRuleset = (id: string) => invoke<void>("purge_ruleset", { id });

/** The ids (like `starter:d20`) of the starter rulesets that have been added. */
export const listInstalledRulesetStarters = () => invoke<string[]>("list_installed_ruleset_starters");

/**
 * Copies a ruleset into a project: its properties, stat block sets and formulas are made there
 * (or the ones with the same names are used) and its encounter rules are kept with the project.
 * All or nothing.
 */
export const applyRuleset = (projectId: string, rulesetId: string, ruleset: Ruleset) =>
  invoke<ApplyResult>("apply_ruleset", { projectId, rulesetId, bundleJson: JSON.stringify(toBundle(ruleset)) });

export const listProjectRulesets = (projectId: string) => invoke<ProjectRulesetRecord[]>("list_project_rulesets", { projectId });
export const removeProjectRuleset = (projectRulesetId: string) => invoke<void>("remove_project_ruleset", { projectRulesetId });

/** A ruleset record read into its parts; a ruleset that can't be read comes back empty with an error. */
export function readRuleset(record: RulesetRecord): { ruleset: Ruleset; warnings: string[]; error: string | null } {
  let raw: unknown = null;
  try {
    raw = JSON.parse(record.definitionJson);
  } catch {
    /* handled below */
  }
  const read = normalizeRuleset(raw);
  if (read.ok) return { ruleset: read.ruleset, warnings: read.warnings, error: null };
  const empty = normalizeRuleset({});
  return { ruleset: empty.ok ? empty.ruleset : ({} as Ruleset), warnings: [], error: read.error };
}
