import type { Rng } from "../dice/rng";

/** Most cards one simple draw may take. */
export const MAX_DRAW = 10;

/** A card that can be drawn: just what a result needs to remember. */
export interface DrawCard {
  id: string;
  name: string;
}

export interface DrawnCard extends DrawCard {
  reversed: boolean;
}

export interface DrawOptions {
  /** How many cards to draw, 1 to MAX_DRAW. */
  count: number;
  /** Whether a card may come up more than once in the same draw. */
  repeats: boolean;
  /** Whether cards can come up reversed. */
  reversals: boolean;
  /** Chance (whole percent, 0 to 100) that a card is reversed, when reversals are on. */
  reversalPercent: number;
}

export const DEFAULT_DRAW_OPTIONS: DrawOptions = {
  count: 1,
  repeats: false,
  reversals: true,
  reversalPercent: 50,
};

export type DrawOutcome = { ok: true; cards: DrawnCard[] } | { ok: false; message: string };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Draws cards from `candidates` (the distinct cards of a set, deck or pool, in
 * their order). Pure apart from the random source, so a seed reproduces a draw.
 *
 * Order of randomness, for each card in turn: its position among the cards
 * still available, then (only when reversals are on) a 1-100 roll where a
 * result at or under the percentage means reversed. Without repeats a drawn
 * card is taken out of the remaining cards, keeping the others in order.
 */
export function drawCards(candidates: readonly DrawCard[], options: DrawOptions, rng: Rng): DrawOutcome {
  const { count, repeats, reversals, reversalPercent } = options;
  if (!Number.isInteger(count) || count < 1 || count > MAX_DRAW) {
    return { ok: false, message: `You can draw between 1 and ${MAX_DRAW} cards at a time.` };
  }
  if (!Number.isInteger(reversalPercent) || reversalPercent < 0 || reversalPercent > 100) {
    return { ok: false, message: "The reversal chance must be a whole number between 0 and 100." };
  }
  if (candidates.length === 0) {
    return { ok: false, message: "There are no cards to draw from." };
  }
  if (!repeats && count > candidates.length) {
    return {
      ok: false,
      message: `There are only ${plural(candidates.length, "card")} to draw from, so you can't draw ${count} without repeats.`,
    };
  }

  const remaining = candidates.slice();
  const cards: DrawnCard[] = [];
  for (let n = 0; n < count; n++) {
    const index = rng.int(0, remaining.length - 1);
    const picked = repeats ? remaining[index] : remaining.splice(index, 1)[0];
    const reversed = reversals ? rng.int(1, 100) <= reversalPercent : false;
    cards.push({ id: picked.id, name: picked.name, reversed });
  }
  return { ok: true, cards };
}

/** A draw as one readable line, e.g. `Tarot → The Fool, Two of Cups (reversed)`. */
export function formatDrawResult(sourceName: string, cards: readonly DrawnCard[]): string {
  const list = cards.length === 0 ? "(no cards)" : cards.map((c) => (c.reversed ? `${c.name} (reversed)` : c.name)).join(", ");
  return `${sourceName} → ${list}`;
}
