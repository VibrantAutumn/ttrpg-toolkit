import type { ModuleDefinition } from "../../registry/types";
import { namePresetType } from "./namePresetType";
import { QuickNameWidget } from "./QuickNameWidget";
import { QuickTableWidget } from "./QuickTableWidget";
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
  itemTypes: [tableType, namePresetType],
  widgets: [
    { id: "tables.quick-roll", label: "Quick table roll", icon: "📋", order: 25, component: QuickTableWidget },
    { id: "tables.quick-name", label: "Quick name", icon: "🏷️", order: 26, component: QuickNameWidget },
  ],
  commands: [
    {
      id: "tables.open",
      label: "Go to Tables",
      keywords: ["tables", "random", "table", "roll", "rumors", "names", "generator"],
      run: (ctx) => ctx.openTool("tables"),
    },
  ],
};
