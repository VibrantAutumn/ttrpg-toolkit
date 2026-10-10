import type { ItemTypeDefinition } from "../../registry/types";
import { SmartCollectionView } from "./SmartCollectionView";

/** A saved query: always up to date, and usable wherever a list of items is wanted (a card pool, for one). */
export const smartCollectionType: ItemTypeDefinition = {
  id: "smart_collection",
  label: "Smart collection",
  icon: "🔎",
  toolId: "worldbuilding",
  editor: SmartCollectionView,
};
