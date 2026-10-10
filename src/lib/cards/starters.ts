/**
 * Starter decks as plain data: what cards, sets, tags and deck to make. The
 * pictures are attached separately (`toBundle`), because loading or drawing
 * them needs the browser. Pure and tested; the Rust side (`db/starters.rs`)
 * writes the finished bundle into a project in one all-or-nothing step.
 */
import type { PreparedImage } from "./image";

export interface StarterTag {
  name: string;
  color: string | null;
}

export interface StarterCard {
  /** Unique inside the starter (also how its picture is found). */
  key: string;
  name: string;
  value: string;
  notes: string;
  /** Names of tags from the starter's `tags`. */
  tags: string[];
}

export interface StarterSet {
  name: string;
  /** Keys of cards, in order. */
  cards: string[];
}

export type StarterMember = { kind: "set" | "card"; ref: string };

export interface StarterDef {
  /** `starter:<name>`; remembered on everything made, so "already added" is known. */
  id: string;
  name: string;
  deckName: string;
  tags: StarterTag[];
  cards: StarterCard[];
  sets: StarterSet[];
  deck: StarterMember[];
}

/** What is sent to Rust (field names match `Bundle` in `db/starters.rs`). */
export interface BundleJson {
  id: string;
  name: string;
  deckName: string;
  tags: StarterTag[];
  cards: (StarterCard & { image: PreparedImage | null })[];
  sets: StarterSet[];
  deck: StarterMember[];
}

/** The finished bundle: the definition with each card's picture attached (cards without one get none). */
export function toBundle(def: StarterDef, images: ReadonlyMap<string, PreparedImage>): BundleJson {
  return {
    id: def.id,
    name: def.name,
    deckName: def.deckName,
    tags: def.tags.map((t) => ({ ...t })),
    cards: def.cards.map((c) => ({ ...c, tags: [...c.tags], image: images.get(c.key) ?? null })),
    sets: def.sets.map((s) => ({ name: s.name, cards: [...s.cards] })),
    deck: def.deck.map((m) => ({ ...m })),
  };
}

// ------------------------------------------------------------ playing cards

const PLAYING_SUITS = [
  { name: "Spades", color: "#495057" },
  { name: "Hearts", color: "#c92a2a" },
  { name: "Diamonds", color: "#c92a2a" },
  { name: "Clubs", color: "#495057" },
] as const;

const PLAYING_RANKS = [
  { value: "A", word: "Ace" },
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), word: String(n) })),
  { value: "J", word: "Jack" },
  { value: "Q", word: "Queen" },
  { value: "K", word: "King" },
] as const;

/** A standard deck: 52 cards in four suits, plus two jokers (in a set of their own). */
export function buildPlayingCards(): StarterDef {
  const cards: StarterCard[] = [];
  const sets: StarterSet[] = [];
  for (const suit of PLAYING_SUITS) {
    const keys: string[] = [];
    for (const rank of PLAYING_RANKS) {
      const key = `${suit.name.toLowerCase()}-${rank.value.toLowerCase()}`;
      cards.push({ key, name: `${rank.word} of ${suit.name}`, value: rank.value, notes: "", tags: [suit.name] });
      keys.push(key);
    }
    sets.push({ name: suit.name, cards: keys });
  }
  cards.push({ key: "joker-red", name: "Red Joker", value: "", notes: "", tags: [] });
  cards.push({ key: "joker-black", name: "Black Joker", value: "", notes: "", tags: [] });
  sets.push({ name: "Jokers", cards: ["joker-red", "joker-black"] });

  return {
    id: "starter:playing-cards",
    name: "Playing cards",
    deckName: "Playing cards",
    tags: PLAYING_SUITS.map((s) => ({ name: s.name, color: s.color })),
    cards,
    sets,
    // The deck is the 52 suit cards; add the Jokers set to it if a game needs them.
    deck: PLAYING_SUITS.map((s) => ({ kind: "set", ref: s.name })),
  };
}

// ------------------------------------------------------------------ Tarokka

/** The shape of `src/starter/tarokka/cards.json` (made once from the card pictures and meanings). */
export interface TarokkaData {
  suits: string[];
  cards: { key: string; name: string; suit: string; value: string; notes: string }[];
}

const TAROKKA_COLORS: Record<string, string> = {
  "High Deck": "#7048e8",
  Swords: "#e03131",
  Stars: "#1c7ed6",
  Coins: "#e8a317",
  Glyphs: "#2f9e44",
};

/** The Curse of Strahd Tarokka deck: a High Deck of 14 and four suits of 10, one set each. */
export function buildTarokka(data: TarokkaData): StarterDef {
  const sets: StarterSet[] = data.suits.map((suit) => ({
    name: suit,
    cards: data.cards.filter((c) => c.suit === suit).map((c) => c.key),
  }));
  return {
    id: "starter:tarokka",
    name: "Tarokka",
    deckName: "Tarokka deck",
    tags: data.suits.map((suit) => ({ name: suit, color: TAROKKA_COLORS[suit] ?? null })),
    cards: data.cards.map((c) => ({ key: c.key, name: c.name, value: c.value, notes: c.notes, tags: [c.suit] })),
    sets,
    deck: sets.map((s) => ({ kind: "set", ref: s.name })),
  };
}
