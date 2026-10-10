import type { Item } from "../../api/library";
import { registry } from "../../registry";

/** The item's own icon, else its type's icon, else a generic one. */
export function itemIcon(item: Item): string {
  return item.icon ?? registry.getItemType(item.itemType)?.icon ?? "📄";
}

/** e.g. "Document". */
export function itemTypeLabel(item: Item): string {
  return registry.getItemType(item.itemType)?.label ?? item.itemType;
}

/** The name of the tool whose library holds the item, e.g. "Worldbuilding". */
export function libraryLabel(item: Item): string {
  return registry.getLibraryLabel(item.library);
}
