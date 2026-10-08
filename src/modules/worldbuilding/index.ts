import type { ModuleDefinition } from "../../registry/types";
import { documentType } from "./documentType";
import { WorldbuildingScreen } from "./WorldbuildingScreen";

/** Documents organised in folders. The rich editor and tabs arrive in Phase 4. */
export const worldbuildingModule: ModuleDefinition = {
  id: "worldbuilding",
  tools: [
    {
      id: "worldbuilding",
      label: "Worldbuilding",
      icon: "📚",
      order: 10,
      component: WorldbuildingScreen,
    },
  ],
  itemTypes: [documentType],
  commands: [
    {
      id: "worldbuilding.open",
      label: "Go to Worldbuilding",
      keywords: ["documents", "notes", "lore", "world"],
      run: (ctx) => ctx.openTool("worldbuilding"),
    },
  ],
};
