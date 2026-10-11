import { buildRuleset, type StarterRulesetDef } from "../../lib/rulesets/starterRulesets";

/** Nothing in it but the plain defaults: a place to start building your own system. */
export const blankRuleset: StarterRulesetDef = {
  id: "starter:blank",
  name: "Blank",
  description: "An empty ruleset to build from: no stat blocks, no statuses, a plain d20 initiative.",
  ruleset: buildRuleset({}),
};
