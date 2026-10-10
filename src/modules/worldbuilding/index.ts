import type { ModuleDefinition } from "../../registry/types";
import { documentType } from "./documentType";
import { HomeScreen } from "./HomeScreen";
import { PagesTrash } from "./PagesTrash";
import { smartCollectionType } from "./smartCollectionType";
import { templateType } from "./templateType";
import { WorldbuildingTree } from "./WorldbuildingTree";

/**
 * Pages (documents in folders) and templates. The sidebar's Home button carries the pages tree and
 * the Templates section; Trash lists what was deleted. (The library id stays `worldbuilding`.)
 */
export const worldbuildingModule: ModuleDefinition = {
  id: "worldbuilding",
  tools: [
    {
      id: "home",
      label: "Home",
      icon: "🏠",
      order: 10,
      component: HomeScreen,
      sidebar: WorldbuildingTree,
      libraryLabels: { worldbuilding: "Pages" },
    },
    {
      id: "pages-trash",
      label: "Trash",
      icon: "🗑️",
      order: 90,
      component: PagesTrash,
      placement: "bottom",
    },
  ],
  itemTypes: [documentType, templateType, smartCollectionType],
  commands: [
    {
      id: "worldbuilding.home",
      label: "Go to Home",
      keywords: ["home", "pages", "documents", "notes", "lore", "world", "dashboard"],
      run: (ctx) => ctx.openTool("home"),
    },
    {
      id: "worldbuilding.trash",
      label: "Open the trash",
      keywords: ["trash", "deleted", "restore", "bin"],
      run: (ctx) => ctx.openTool("pages-trash"),
    },
  ],
};
