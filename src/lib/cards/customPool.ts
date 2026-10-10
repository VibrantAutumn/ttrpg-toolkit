import type { DrawCard } from "./draw";

/**
 * The cards of a custom pool: every list joined in order, each card once (a card that
 * sits in two ticked sets counts once, like a saved pool does).
 */
export function mergeCards(lists: readonly (readonly DrawCard[])[]): DrawCard[] {
  const seen = new Set<string>();
  const out: DrawCard[] = [];
  for (const list of lists) {
    for (const card of list) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      out.push({ id: card.id, name: card.name });
    }
  }
  return out;
}
