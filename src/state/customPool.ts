import { resolveCollectionCards } from "../api/cards";
import { getItem } from "../api/library";
import { runSmartCollection } from "../api/queries";
import { mergeCards } from "../lib/cards/customPool";
import type { DrawCard } from "../lib/cards/draw";

/**
 * The cards a custom pool reaches right now: each ticked set, deck or pool gives its distinct
 * cards and each filter set runs its query (cards only). A source that has gone is skipped.
 */
export async function resolveCustomPool(sourceIds: readonly string[]): Promise<DrawCard[]> {
  const lists = await Promise.all(
    sourceIds.map(async (id) => {
      try {
        const item = await getItem(id);
        if (item.deletedAt !== null) return [];
        const cards =
          item.itemType === "smart_collection"
            ? (await runSmartCollection(id, "card")).items
            : await resolveCollectionCards(id);
        return cards.map((c) => ({ id: c.id, name: c.name }));
      } catch {
        return [];
      }
    }),
  );
  return mergeCards(lists);
}
