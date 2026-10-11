import type { ModuleDefinition } from "../../registry/types";
import { RulesetsScreen } from "./RulesetsScreen";

/**
 * Rulesets: global definitions of a game system (rules in `lib/rulesets`). Using one in a project copies its
 * stat blocks and dice in; encounters follow the encounter rules of the project's copy.
 */
export const rulesetsModule: ModuleDefinition = {
  id: "rulesets",
  tools: [
    {
      id: "rulesets",
      label: "Rulesets",
      icon: "📖",
      order: 35,
      component: RulesetsScreen,
    },
  ],
  commands: [
    {
      id: "rulesets.open",
      label: "Go to Rulesets",
      keywords: ["rulesets", "ruleset", "system", "stat block", "initiative", "statuses", "rules"],
      run: (ctx) => ctx.openTool("rulesets"),
    },
  ],
};
