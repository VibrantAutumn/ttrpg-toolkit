import type { ModuleDefinition } from "../../registry/types";
import { generatorType } from "./generatorType";
import { QuickTableWidget } from "./QuickTableWidget";
import { tableType } from "./tableType";
import { GeneratorsScreen } from "./GeneratorsScreen";

/**
 * Generators: random tables (entries with weights and ranges, rolled into the roll log; rules in `lib/tables`)
 * and generators that fill in new documents (rules in `lib/generators`). The library id stays `tables`,
 * so nothing stored changes; only the tool's own id and name do.
 */
export const tablesModule: ModuleDefinition = {
  id: "tables",
  tools: [
    {
      id: "generators",
      label: "Generators",
      icon: "✨",
      order: 25,
      component: GeneratorsScreen,
      libraryLabels: { tables: "Generators" },
    },
  ],
  itemTypes: [tableType, generatorType],
  widgets: [
    { id: "tables.quick-roll", label: "Quick table roll", icon: "📋", order: 25, component: QuickTableWidget },
  ],
  commands: [
    {
      id: "generators.open",
      label: "Go to Generators",
      keywords: ["generators", "generator", "tables", "random", "table", "roll", "rumors", "names"],
      run: (ctx) => ctx.openTool("generators"),
    },
  ],
};
