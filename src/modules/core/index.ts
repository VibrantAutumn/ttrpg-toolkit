import type { ModuleDefinition } from "../../registry/types";
import { ProjectsScreen } from "./ProjectsScreen";
import { SettingsScreen } from "./SettingsScreen";

/** App-level features that exist in every project setup. */
export const coreModule: ModuleDefinition = {
  id: "core",
  tools: [
    {
      id: "projects",
      label: "Projects",
      icon: "🏕️",
      order: 0,
      component: ProjectsScreen,
      inSidebar: false, // reached from the project switcher at the top of the sidebar
    },
    {
      id: "settings",
      label: "Settings",
      icon: "⚙️",
      order: 99,
      component: SettingsScreen,
      placement: "bottom",
    },
  ],
  commands: [
    {
      id: "core.open-projects",
      label: "Go to Projects",
      keywords: ["project", "switch", "list"],
      run: (ctx) => ctx.openTool("projects"),
    },
    {
      id: "core.quick-tools",
      label: "Open quick tools",
      keywords: ["quick", "panel", "widgets", "roll", "draw", "tools"],
      run: (ctx) => ctx.openQuickTools(),
    },
  ],
};
