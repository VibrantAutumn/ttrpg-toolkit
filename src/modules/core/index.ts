import type { ModuleDefinition } from "../../registry/types";
import { CampaignsScreen } from "./CampaignsScreen";

/** App-level features that exist in every campaign setup. */
export const coreModule: ModuleDefinition = {
  id: "core",
  tools: [
    {
      id: "campaigns",
      label: "Campaigns",
      icon: "🏕️",
      order: 0,
      component: CampaignsScreen,
    },
  ],
  commands: [
    {
      id: "core.open-campaigns",
      label: "Go to Campaigns",
      keywords: ["campaign", "switch", "list"],
      run: (ctx) => ctx.openTool("campaigns"),
    },
  ],
};
