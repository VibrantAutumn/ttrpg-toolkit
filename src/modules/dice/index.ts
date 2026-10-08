import type { ModuleDefinition } from "../../registry/types";
import { DiceScreen } from "./DiceScreen";
import { formulaType } from "./formulaType";
import { QuickRollerWidget } from "./QuickRollerWidget";
import { savedRollType } from "./savedRollType";

/** Rolling dice (the notation parser lives in `lib/dice`), the roll log, formulas and saved rolls. */
export const diceModule: ModuleDefinition = {
  id: "dice",
  tools: [
    {
      id: "dice",
      label: "Dice",
      icon: "🎲",
      order: 20,
      component: DiceScreen,
    },
  ],
  itemTypes: [formulaType, savedRollType],
  widgets: [
    { id: "dice.quick-roller", label: "Quick roller", icon: "🎲", order: 10, component: QuickRollerWidget },
  ],
  commands: [
    {
      id: "dice.open",
      label: "Roll dice",
      keywords: ["dice", "d20", "random", "roll", "saved"],
      run: (ctx) => ctx.openTool("dice"),
    },
  ],
};
