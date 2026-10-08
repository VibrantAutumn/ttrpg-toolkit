import { getSpread, resolveCollectionCards } from "../api/cards";
import { getItem } from "../api/library";
import type { DrawCard } from "../lib/cards/draw";
import { drawSpread, type PositionPool } from "../lib/cards/spread";
import { createRng, newSeed } from "../lib/dice/rng";
import type { DrawLogOutcome } from "../lib/results/rollLog";
import { bumpDataVersion } from "./dataVersion";
import { rollLog } from "./rollLog";

/**
 * Draws a whole spread: reads it fresh from the database, gets the cards each
 * position's source holds right now, applies the tested rules from
 * `lib/cards/spread.ts`, and logs the reading. Used by the spread's page, the
 * Draw tab and "Draw again" in the roll log, so they always agree.
 */
export async function drawSpreadById(spreadId: string): Promise<DrawLogOutcome> {
  try {
    const [spread, item] = await Promise.all([getSpread(spreadId), getItem(spreadId)]);

    const unchosen = spread.positions.filter((p) => !p.sourceId || p.sourceMissing).map((p) => `“${p.name}”`);
    if (unchosen.length > 0) {
      return { ok: false, message: `Choose a source to draw from for ${unchosen.join(", ")} first.` };
    }

    // Positions that share a source only need to ask for its cards once.
    const bySource = new Map<string, Promise<DrawCard[]>>();
    const cardsOf = (sourceId: string) => {
      let found = bySource.get(sourceId);
      if (!found) {
        found = resolveCollectionCards(sourceId).then((list) => list.map((c) => ({ id: c.id, name: c.name })));
        bySource.set(sourceId, found);
      }
      return found;
    };
    const pools: PositionPool[] = await Promise.all(
      spread.positions.map(async (p) => ({ name: p.name, meaning: p.meaning, cards: await cardsOf(p.sourceId!) })),
    );

    const seed = newSeed();
    const outcome = drawSpread(
      pools,
      { reversals: spread.reversals, reversalPercent: spread.reversalPercent },
      createRng(seed),
    );
    if (!outcome.ok) return outcome;

    const entry = rollLog.logDraw({
      sourceId: spreadId,
      sourceName: item.name,
      playId: null,
      spreadId,
      positions: outcome.cards.map((c) => c.position),
      options: {
        count: outcome.cards.length,
        repeats: false,
        reversals: spread.reversals,
        reversalPercent: spread.reversalPercent,
      },
      cards: outcome.cards,
      seed,
    });
    bumpDataVersion();
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
