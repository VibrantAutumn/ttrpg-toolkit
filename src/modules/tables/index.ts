import type { ModuleDefinition } from "../../registry/types";
import { tableType } from "./tableType";
import { TablesScreen } from "./TablesScreen";

/** Random tables: entries with weights and ranges, rolled into the roll log (rules in `lib/tables`). */
export const tablesModule: ModuleDefinition = {
  id: "tables",
  tools: [
    {
      id: "tables",
      label: "Tables",
      icon: "📋",
      order: 25,
      component: TablesScreen,
    },
  ],
  itemTypes: [tableType],
  commands: [
    {
      id: "tables.open",
      label: "Go to Tables",
      keywords: ["tables", "random", "table", "roll", "rumors", "names", "generator"],
      run: (ctx) => ctx.openTool("tables"),
    },
  ],
};
