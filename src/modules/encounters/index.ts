import type { ModuleDefinition } from "../../registry/types";
import { encounterType } from "./encounterType";
import { EncountersScreen } from "./EncountersScreen";

/**
 * Encounters: a library of encounters you set up and run (rules in `lib/encounters`), plus the player display (a second
 * window, opened with `?display=1`). Under the project's ruleset: initiative, statuses and what shows in combat.
 */
export const encountersModule: ModuleDefinition = {
  id: "encounters",
  tools: [
    {
      id: "encounters",
      label: "Encounters",
      icon: "⚔️",
      order: 30,
      component: EncountersScreen,
    },
  ],
  itemTypes: [encounterType],
  commands: [
    {
      id: "encounters.open",
      label: "Go to Encounters",
      keywords: ["encounters", "encounter", "combat", "initiative", "fight", "turn order", "battle"],
      run: (ctx) => ctx.openTool("encounters"),
    },
  ],
};
