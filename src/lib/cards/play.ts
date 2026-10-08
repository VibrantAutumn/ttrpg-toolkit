/**
 * Decks in play: a copy of some cards that is shuffled once, then dealt from
 * the top. Drawn cards stay out (in a discard pile) until they are returned or
 * the deck is reshuffled. Pure rules, no hidden randomness: the shuffle order
 * comes from `seed`, and every later random choice (a card coming up reversed,
 * a card shuffled back in) from `seed` and a counter, so a game played from
 * the same starting state always turns out the same way.
 */
import { createRng } from "../dice/rng";
import { MAX_DRAW } from "./draw";

export const PLAY_STATE_VERSION = 1;

/** A card as the game remembers it: a copy, so it survives the card being renamed or deleted. */
export interface PlayCard {
  id: string;
  name: string;
}

export interface PlayDrawnCard extends PlayCard {
  reversed: boolean;
}

export interface PlayState {
  version: 1;
  /** Seed of the current shuffle. */
  seed: number;
  /** How many times the deck has been shuffled (1 right after starting). */
  shuffles: number;
  /** Counts random choices made since the last shuffle, so each gets its own roll. */
  counter: number;
  reversals: boolean;
  reversalPercent: number;
  /** Cards still in the deck, top first. */
  deck: PlayCard[];
  /** The discard pile, in the order cards were drawn (latest last). */
  drawn: PlayDrawnCard[];
}

export interface PlayOptions {
  reversals: boolean;
  reversalPercent: number;
}

export type PlayDrawOutcome =
  | { ok: true; state: PlayState; cards: PlayDrawnCard[] }
  | { ok: false; message: string };

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const copy = (c: PlayCard): PlayCard => ({ id: c.id, name: c.name });

/** A seed for the n-th random choice since a shuffle. */
function mixSeed(seed: number, counter: number): number {
  return (seed ^ Math.imul(counter + 1, 0x9e3779b1)) >>> 0;
}

function validPercent(percent: number): boolean {
  return Number.isInteger(percent) && percent >= 0 && percent <= 100;
}

const BAD_PERCENT = "The reversal chance must be a whole number between 0 and 100.";

/** The cards in a seeded random order (a Fisher-Yates shuffle). The input is not changed. */
export function shuffleCards(cards: readonly PlayCard[], seed: number): PlayCard[] {
  const out = cards.map(copy);
  const rng = createRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Starts a game: copies the cards and shuffles them. */
export function startPlay(cards: readonly PlayCard[], options: PlayOptions, seed: number, shuffles = 1): PlayState {
  return {
    version: PLAY_STATE_VERSION,
    seed,
    shuffles,
    counter: 0,
    reversals: options.reversals,
    reversalPercent: options.reversalPercent,
    deck: shuffleCards(cards, seed),
    drawn: [],
  };
}

export function playSummary(state: PlayState): { remaining: number; drawn: number; total: number } {
  return {
    remaining: state.deck.length,
    drawn: state.drawn.length,
    total: state.deck.length + state.drawn.length,
  };
}

/** Deals `count` cards from the top of the deck to the discard pile. */
export function drawFromPlay(state: PlayState, count: number): PlayDrawOutcome {
  if (!Number.isInteger(count) || count < 1 || count > MAX_DRAW) {
    return { ok: false, message: `You can draw between 1 and ${MAX_DRAW} cards at a time.` };
  }
  if (state.deck.length === 0) {
    return { ok: false, message: "There are no cards left in the deck. Return some cards or reshuffle." };
  }
  if (count > state.deck.length) {
    return {
      ok: false,
      message: `Only ${plural(state.deck.length, "card")} left in the deck, so you can't draw ${count}.`,
    };
  }

  const dealt = state.deck.slice(0, count);
  const cards: PlayDrawnCard[] = dealt.map((card, i) => {
    const reversed = state.reversals
      ? createRng(mixSeed(state.seed, state.counter + i)).int(1, 100) <= state.reversalPercent
      : false;
    return { id: card.id, name: card.name, reversed };
  });
  return {
    ok: true,
    cards,
    state: {
      ...state,
      counter: state.counter + count,
      deck: state.deck.slice(count),
      drawn: [...state.drawn, ...cards],
    },
  };
}

/**
 * Puts a card from the discard pile back into the deck: on top (drawn next), at
 * the bottom (drawn last), or shuffled in at a seeded position. Returns null if
 * there is no card at that place in the discard pile.
 */
export function returnToDeck(
  state: PlayState,
  drawnIndex: number,
  place: "top" | "bottom" | "shuffle",
): PlayState | null {
  if (!Number.isInteger(drawnIndex) || drawnIndex < 0 || drawnIndex >= state.drawn.length) return null;
  const card = copy(state.drawn[drawnIndex]);
  const drawn = state.drawn.filter((_, i) => i !== drawnIndex);
  const deck = state.deck.slice();
  let counter = state.counter;
  if (place === "top") {
    deck.unshift(card);
  } else if (place === "bottom") {
    deck.push(card);
  } else {
    deck.splice(createRng(mixSeed(state.seed, counter)).int(0, deck.length), 0, card);
    counter += 1;
  }
  return { ...state, deck, drawn, counter };
}

/** Reshuffles only the cards still in the deck; the discard pile stays as it is. */
export function shuffleRemaining(state: PlayState, seed: number): PlayState {
  return { ...state, seed, counter: 0, shuffles: state.shuffles + 1, deck: shuffleCards(state.deck, seed) };
}

/** Gathers every card back (deck and discard pile) and shuffles them all. */
export function reshuffleAll(state: PlayState, seed: number): PlayState {
  const all = [...state.deck, ...state.drawn].map(copy);
  return { ...state, seed, counter: 0, shuffles: state.shuffles + 1, deck: shuffleCards(all, seed), drawn: [] };
}

/** Starts over with a new list of cards (e.g. the source's cards as they are now), keeping the options. */
export function restartWith(state: PlayState, cards: readonly PlayCard[], seed: number): PlayState {
  return startPlay(cards, state, seed, state.shuffles + 1);
}

/** Changes the reversal settings for later draws; cards already drawn keep how they came up. */
export function setReversals(
  state: PlayState,
  reversals: boolean,
  reversalPercent: number,
): { ok: true; state: PlayState } | { ok: false; message: string } {
  if (!validPercent(reversalPercent)) return { ok: false, message: BAD_PERCENT };
  return { ok: true, state: { ...state, reversals, reversalPercent } };
}

// ------------------------------------------------------------ saving and loading

export function serializePlayState(state: PlayState): string {
  return JSON.stringify(state);
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const isCard = (c: unknown): c is PlayCard =>
  typeof c === "object" &&
  c !== null &&
  typeof (c as PlayCard).id === "string" &&
  typeof (c as PlayCard).name === "string";

/**
 * Reads a saved state. Anything that isn't a valid state gives null rather than
 * a guess; unknown extra fields (from a newer app) are ignored.
 */
export function parsePlayState(text: string): PlayState | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    v.version !== PLAY_STATE_VERSION ||
    !isCount(v.seed) ||
    !isCount(v.shuffles) ||
    !isCount(v.counter) ||
    typeof v.reversals !== "boolean" ||
    typeof v.reversalPercent !== "number" ||
    !validPercent(v.reversalPercent) ||
    !Array.isArray(v.deck) ||
    !v.deck.every(isCard) ||
    !Array.isArray(v.drawn) ||
    !v.drawn.every((c) => isCard(c) && typeof (c as PlayDrawnCard).reversed === "boolean")
  ) {
    return null;
  }
  return {
    version: PLAY_STATE_VERSION,
    seed: v.seed,
    shuffles: v.shuffles,
    counter: v.counter,
    reversals: v.reversals,
    reversalPercent: v.reversalPercent,
    deck: (v.deck as PlayCard[]).map(copy),
    drawn: (v.drawn as PlayDrawnCard[]).map((c) => ({ id: c.id, name: c.name, reversed: c.reversed })),
  };
}
