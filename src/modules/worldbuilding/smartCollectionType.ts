import type { ItemTypeDefinition } from "../../registry/types";
import { SmartCollectionView } from "./SmartCollectionView";

/**
 * A filter set (stored as `smart_collection`): a saved query, always up to date, usable wherever a list of
 * items is wanted (a card pool, a generator slot). Not made from the library's "New item" list; the
 * Worldbuilding Filter sets tab and the places that use one make them.
 */
export const smartCollectionType: ItemTypeDefinition = {
  id: "smart_collection",
  label: "Filter set",
  creatable: false,
  icon: "🔎",
  toolId: "worldbuilding",
  editor: SmartCollectionView,
};
