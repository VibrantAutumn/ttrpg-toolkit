import type { Item } from "../../api/library";
import { registry } from "../../registry";
import { ItemFieldsPanel } from "../fields/ItemFieldsPanel";
import { itemTypeLabel } from "./itemDisplay";
import { LinkedFrom } from "./LinkedFrom";

/**
 * What one item shows below its title: its Properties, its editor and, when other things link to it, a "Linked from" list. It is the body of a page's Main tab and of each document tab.
 */
export function ItemBody({ item }: { item: Item }) {
  // Each item type can bring its own editor (registered by its module).
  const Editor = registry.getItemType(item.itemType)?.editor;
  const trashed = item.deletedAt != null;

  return (
    <>
      {/* Properties sit right under the title (like Notion's page properties), then the text. */}
      {!trashed && <ItemFieldsPanel item={item} />}

      {trashed ? null : Editor ? (
        <Editor key={item.id} itemId={item.id} />
      ) : (
        <p className="empty">This {itemTypeLabel(item).toLowerCase()} has nothing to edit yet.</p>
      )}

      {!trashed && <LinkedFrom itemId={item.id} />}
    </>
  );
}
