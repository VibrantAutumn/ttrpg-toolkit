import { createPlayDeck, getPlayDeck, resolveCollectionCards, setPlayDeckState } from "../api/cards";
import { getItem, type Item } from "../api/library";
import { DEFAULT_DRAW_OPTIONS } from "../lib/cards/draw";
import {
  drawFromPlay,
  parsePlayState,
  serializePlayState,
  startPlay,
  type PlayState,
} from "../lib/cards/play";
import { newSeed } from "../lib/dice/rng";
import type { DrawLogOutcome } from "../lib/results/rollLog";
import { bumpDataVersion } from "./dataVersion";
import { rollLog } from "./rollLog";

/**
 * Everything that changes a deck in play goes through here. Each action reads
 * the game fresh from the database, applies one of the tested rules from
 * `lib/cards/play.ts`, saves the result, and tells the rest of the app (so
 * every open screen shows the new state). Nothing is kept in memory between
 * actions, so two screens can never disagree about the game.
 */

/** Starts a deck in play with a copy of the cards a set, deck or pool holds right now. */
export async function startPlayDeck(
  source: { id: string; name: string; campaignId: string },
  name: string,
): Promise<Item> {
  const cards = (await resolveCollectionCards(source.id)).map((c) => ({ id: c.id, name: c.name }));
  if (cards.length === 0) throw new Error("There are no cards to play with yet. Add some cards first.");
  const state = startPlay(
    cards,
    { reversals: DEFAULT_DRAW_OPTIONS.reversals, reversalPercent: DEFAULT_DRAW_OPTIONS.reversalPercent },
    newSeed(),
  );
  const item = await createPlayDeck(source.campaignId, name, null, source.id, source.name, serializePlayState(state));
  bumpDataVersion();
  return item;
}

/** A deck in play as stored: its game, and where the cards were copied from. */
export interface LoadedPlay {
  state: PlayState;
  name: string;
  sourceId: string | null;
  sourceName: string;
  createdAt: number;
}

export async function loadPlay(playId: string): Promise<LoadedPlay> {
  const [deck, item] = await Promise.all([getPlayDeck(playId), getItem(playId)]);
  const state = parsePlayState(deck.stateJson);
  if (!state) throw new Error("This game's saved state couldn't be read, so it can't be played.");
  return { state, name: item.name, sourceId: deck.sourceId, sourceName: deck.sourceName, createdAt: deck.createdAt };
}

export type PlayChange = { ok: true } | { ok: false; message: string };

/**
 * Applies one rule (a function from the current game to the next) and saves it.
 * The rule may refuse by returning `{ error }`, and then nothing is saved.
 */
export async function changePlay(
  playId: string,
  rule: (state: PlayState) => PlayState | null | { error: string },
): Promise<PlayChange> {
  try {
    const { state } = await loadPlay(playId);
    const next = rule(state);
    if (next === null) return { ok: false, message: "That can't be done now." };
    if ("error" in next) return { ok: false, message: next.error };
    await setPlayDeckState(playId, serializePlayState(next));
    bumpDataVersion();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Deals cards from a deck in play, saves the game, and logs the draw in the roll log. */
export async function drawFromPlayDeck(playId: string, count: number): Promise<DrawLogOutcome> {
  try {
    const { state, name } = await loadPlay(playId);
    const outcome = drawFromPlay(state, count);
    if (!outcome.ok) return outcome;
    await setPlayDeckState(playId, serializePlayState(outcome.state));
    const entry = rollLog.logDraw({
      sourceId: playId,
      sourceName: name,
      playId,
      options: { count, repeats: false, reversals: state.reversals, reversalPercent: state.reversalPercent },
      cards: outcome.cards,
      seed: state.seed,
    });
    bumpDataVersion();
    return { ok: true, entry };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
