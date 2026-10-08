/**
 * Spreads: a reading with named positions ("Past", "Present", "Future"), each
 * drawing one card from its own source. Pure rules; the random source is passed
 * in, so a seed reproduces a reading exactly.
 */
import type { Rng } from "../dice/rng";
import { drawCards, type DrawCard, type DrawnCard } from "./draw";

export const MIN_POSITIONS = 3;
export const MAX_POSITIONS = 10;
export const MAX_POSITION_NAME = 60;

/** One position with the cards its source holds right now. */
export interface PositionPool {
  name: string;
  meaning: string;
  cards: readonly DrawCard[];
}

/** A card drawn for a position. */
export interface SpreadCard extends DrawnCard {
  position: string;
}

export interface SpreadOptions {
  reversals: boolean;
  /** Chance (whole percent, 0 to 100) that a card is reversed, when reversals are on. */
  reversalPercent: number;
}

export type SpreadOutcome = { ok: true; cards: SpreadCard[] } | { ok: false; message: string };

const COUNT_MESSAGE = `A spread needs between ${MIN_POSITIONS} and ${MAX_POSITIONS} positions.`;

/**
 * Draws one card for each position, in order. A card drawn for an earlier
 * position is not available to a later one, even if both positions share a
 * source, so a reading never shows the same card twice.
 *
 * Order of randomness, for each position in turn: its card's place among the
 * cards still available to it, then (only with reversals on) a 1-100 roll where
 * a result at or under the percentage means reversed. This is exactly a
 * one-card draw (`drawCards`) for each position.
 */
export function drawSpread(positions: readonly PositionPool[], options: SpreadOptions, rng: Rng): SpreadOutcome {
  if (positions.length < MIN_POSITIONS || positions.length > MAX_POSITIONS) {
    return { ok: false, message: COUNT_MESSAGE };
  }
  const { reversals, reversalPercent } = options;
  if (!Number.isInteger(reversalPercent) || reversalPercent < 0 || reversalPercent > 100) {
    return { ok: false, message: "The reversal chance must be a whole number between 0 and 100." };
  }

  const used = new Set<string>();
  const cards: SpreadCard[] = [];
  for (const position of positions) {
    if (position.cards.length === 0) {
      return { ok: false, message: `“${position.name}” has no cards to draw from.` };
    }
    const available = position.cards.filter((c) => !used.has(c.id));
    if (available.length === 0) {
      return {
        ok: false,
        message: `Nothing is left to draw for “${position.name}”: earlier positions used all of its cards.`,
      };
    }
    const drawn = drawCards(available, { count: 1, repeats: false, reversals, reversalPercent }, rng);
    if (!drawn.ok) return drawn; // can't happen: the options were checked above
    used.add(drawn.cards[0].id);
    cards.push({ position: position.name, ...drawn.cards[0] });
  }
  return { ok: true, cards };
}

/** A reading as one readable line, e.g. `Strahd reading → Tome: The Raven; Icon: The Ghost (reversed)`. */
export function formatSpreadResult(spreadName: string, cards: readonly SpreadCard[]): string {
  const list =
    cards.length === 0
      ? "(no cards)"
      : cards.map((c) => `${c.position}: ${c.name}${c.reversed ? " (reversed)" : ""}`).join("; ");
  return `${spreadName} → ${list}`;
}

/** What a position looks like while it is being edited. */
export interface PositionDraft {
  name: string;
  sourceId: string | null;
  meaning: string;
}

/** Checks a spread's positions before saving them; null if they are fine, else what to fix. */
export function checkPositions(positions: readonly PositionDraft[]): string | null {
  if (positions.length < MIN_POSITIONS || positions.length > MAX_POSITIONS) return COUNT_MESSAGE;
  const seen = new Set<string>();
  for (const p of positions) {
    const name = p.name.trim();
    if (name === "") return "Every position needs a name.";
    if (name.length > MAX_POSITION_NAME) return `A position's name can be at most ${MAX_POSITION_NAME} characters long.`;
    const key = name.toLowerCase();
    if (seen.has(key)) return "Positions need different names.";
    seen.add(key);
  }
  return null;
}
