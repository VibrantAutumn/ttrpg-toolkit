import type { StarterRulesetDef } from "../../lib/rulesets/starterRulesets";
import { blankRuleset } from "./blank";
import { genericD20 } from "./genericD20";
import { genericNarrative } from "./genericNarrative";

/**
 * Every starter ruleset, in the order they are offered. To add one: write a `StarterRulesetDef` and list it
 * here (`starterRulesets.test.ts` checks it automatically).
 */
export const STARTER_RULESETS: readonly StarterRulesetDef[] = [genericD20, genericNarrative, blankRuleset];
