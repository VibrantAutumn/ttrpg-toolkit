import type { ItemTypeDefinition } from "../../registry/types";
import { SavedRollView } from "./SavedRollView";

export const savedRollType: ItemTypeDefinition = {
  id: "saved_roll",
  label: "Saved roll",
  icon: "🎲",
  toolId: "dice",
  editor: SavedRollView,
};
