import { describe, expect, it } from "vitest";
import tarokkaData from "../../starter/tarokka/cards.json";
import type { PreparedImage } from "./image";
import { buildPlayingCards, buildTarokka, toBundle, type StarterDef } from "./starters";

/** Every picture file that is bundled, by card key (the file name without .webp). */
const pictureFiles = import.meta.glob("../../starter/tarokka/images/*.webp", { query: "?url", import: "default", eager: true });
const pictureKeys = Object.keys(pictureFiles).map((path) => path.split("/").pop()!.replace(/\.webp$/, ""));

const keysOf = (def: StarterDef) => def.cards.map((c) => c.key);
const nameOf = (def: StarterDef, key: string) => def.cards.find((c) => c.key === key)!.name;

/** Every definition must hang together: unique keys, and sets/deck/tags that refer to real things. */
function expectConsistent(def: StarterDef) {
  expect(def.id).toMatch(/^starter:[a-z0-9-]+$/);
  const keys = keysOf(def);
  expect(new Set(keys).size).toBe(keys.length);
  const tagNames = new Set(def.tags.map((t) => t.name));
  expect(tagNames.size).toBe(def.tags.length);
  for (const card of def.cards) {
    expect(card.name.trim()).not.toBe("");
    for (const t of card.tags) expect(tagNames.has(t), `${card.key} uses unknown tag ${t}`).toBe(true);
  }
  const setNames = new Set(def.sets.map((s) => s.name));
  expect(setNames.size).toBe(def.sets.length);
  for (const set of def.sets) for (const k of set.cards) expect(keys).toContain(k);
  for (const m of def.deck) {
    expect(m.kind === "set" ? setNames.has(m.ref) : keys.includes(m.ref), `${m.kind} ${m.ref}`).toBe(true);
  }
}

describe("buildPlayingCards", () => {
  const def = buildPlayingCards();

  it("is a consistent starter", () => {
    expectConsistent(def);
    expect(def).toMatchObject({ id: "starter:playing-cards", name: "Playing cards", deckName: "Playing cards" });
  });

  it("has 52 cards plus 2 jokers", () => {
    expect(def.cards).toHaveLength(54);
    expect(def.cards.filter((c) => c.key.startsWith("joker"))).toHaveLength(2);
  });

  it("names and values every rank in every suit", () => {
    expect(nameOf(def, "spades-a")).toBe("Ace of Spades");
    expect(nameOf(def, "hearts-10")).toBe("10 of Hearts");
    expect(nameOf(def, "clubs-j")).toBe("Jack of Clubs");
    expect(nameOf(def, "diamonds-q")).toBe("Queen of Diamonds");
    expect(nameOf(def, "spades-k")).toBe("King of Spades");
    expect(nameOf(def, "diamonds-2")).toBe("2 of Diamonds");
    const values = def.cards.filter((c) => c.key.startsWith("hearts-")).map((c) => c.value);
    expect(values).toEqual(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);
  });

  it("tags each suit card with its suit, and colours red suits red", () => {
    for (const suit of ["Spades", "Hearts", "Diamonds", "Clubs"]) {
      const cards = def.cards.filter((c) => c.tags.includes(suit));
      expect(cards, suit).toHaveLength(13);
    }
    const colour = (name: string) => def.tags.find((t) => t.name === name)!.color;
    expect(colour("Hearts")).toBe(colour("Diamonds"));
    expect(colour("Spades")).toBe(colour("Clubs"));
    expect(colour("Hearts")).not.toBe(colour("Spades"));
    for (const t of def.tags) expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("has a set per suit, in rank order, plus the jokers", () => {
    expect(def.sets.map((s) => [s.name, s.cards.length])).toEqual([
      ["Spades", 13],
      ["Hearts", 13],
      ["Diamonds", 13],
      ["Clubs", 13],
      ["Jokers", 2],
    ]);
    expect(def.sets[0].cards[0]).toBe("spades-a");
    expect(def.sets[0].cards[12]).toBe("spades-k");
  });

  it("makes the deck the four suits (52 cards); the jokers are there to add if wanted", () => {
    expect(def.deck).toEqual([
      { kind: "set", ref: "Spades" },
      { kind: "set", ref: "Hearts" },
      { kind: "set", ref: "Diamonds" },
      { kind: "set", ref: "Clubs" },
    ]);
  });
});

describe("buildTarokka", () => {
  const def = buildTarokka(tarokkaData);

  it("is a consistent starter", () => {
    expectConsistent(def);
    expect(def).toMatchObject({ id: "starter:tarokka", name: "Tarokka", deckName: "Tarokka deck" });
  });

  it("has all 54 cards: 14 in the High Deck and 10 in each of four suits", () => {
    expect(def.cards).toHaveLength(54);
    expect(def.sets.map((s) => [s.name, s.cards.length])).toEqual([
      ["High Deck", 14],
      ["Swords", 10],
      ["Stars", 10],
      ["Coins", 10],
      ["Glyphs", 10],
    ]);
  });

  it("puts the five sets in the deck, High Deck first", () => {
    expect(def.deck).toEqual(def.sets.map((s) => ({ kind: "set", ref: s.name })));
  });

  it("tags every card with exactly its suit", () => {
    for (const set of def.sets) {
      for (const key of set.cards) {
        expect(def.cards.find((c) => c.key === key)!.tags).toEqual([set.name]);
      }
    }
  });

  it("names every card 'The ...', with its meaning as the notes", () => {
    for (const card of def.cards) {
      expect(card.name).toMatch(/^The \S/);
      expect(card.notes.length, card.name).toBeGreaterThan(20);
    }
    expect(def.cards.find((c) => c.name === "The Raven")!.notes).toMatch(/hidden source of information/i);
  });

  it("gives the suit cards the rank printed on them: Master first, then 1 to 9", () => {
    const swords = def.sets.find((s) => s.name === "Swords")!.cards.map((k) => def.cards.find((c) => c.key === k)!);
    expect(swords.map((c) => c.value)).toEqual(["Master", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(swords[0].name).toBe("The Warrior");
    expect(swords[9].name).toBe("The Torturer");
    for (const c of def.cards.filter((c) => c.tags[0] === "High Deck")) expect(c.value).toBe("");
  });

  it("has a picture file for every card, and no spare pictures", () => {
    expect(pictureKeys.slice().sort()).toEqual(keysOf(def).slice().sort());
  });
});

describe("toBundle", () => {
  const def = buildPlayingCards();
  const picture = (n: number): PreparedImage => ({ mime: "image/webp", image: `full${n}`, thumb: `thumb${n}` });

  it("uses the field names the Rust side reads", () => {
    const bundle = JSON.parse(JSON.stringify(toBundle(def, new Map())));
    expect(Object.keys(bundle).sort()).toEqual(["cards", "deck", "deckName", "id", "name", "sets", "tags"]);
    expect(bundle.deck[0]).toEqual({ kind: "set", ref: "Spades" });
    expect(bundle.cards[0]).toEqual({
      key: "spades-a",
      name: "Ace of Spades",
      value: "A",
      notes: "",
      tags: ["Spades"],
      image: null,
    });
    expect(bundle.sets[0]).toEqual({ name: "Spades", cards: expect.any(Array) });
  });

  it("attaches each card's picture by key and leaves the others without one", () => {
    const bundle = toBundle(def, new Map([["spades-a", picture(1)], ["joker-red", picture(2)]]));
    expect(bundle.cards.find((c) => c.key === "spades-a")!.image).toEqual(picture(1));
    expect(bundle.cards.find((c) => c.key === "joker-red")!.image).toEqual(picture(2));
    expect(bundle.cards.filter((c) => c.image !== null)).toHaveLength(2);
  });

  it("does not change the definition it was given", () => {
    const before = JSON.stringify(def);
    toBundle(def, new Map([["spades-a", picture(1)]]));
    expect(JSON.stringify(def)).toBe(before);
  });
});
