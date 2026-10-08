import { describe, expect, it } from "vitest";
import {
  drawFromPlay,
  parsePlayState,
  playSummary,
  restartWith,
  returnToDeck,
  reshuffleAll,
  serializePlayState,
  setReversals,
  shuffleCards,
  shuffleRemaining,
  startPlay,
  type PlayCard,
  type PlayState,
} from "./play";

const cards: PlayCard[] = Array.from({ length: 12 }, (_, i) => ({ id: `id-${i}`, name: `Card ${i}` }));
const names = (list: readonly PlayCard[]) => list.map((c) => c.name);
const ids = (list: readonly PlayCard[]) => list.map((c) => c.id).sort();
const start = (seed = 1, options = { reversals: false, reversalPercent: 50 }) => startPlay(cards, options, seed);

/** Draw and expect success. */
function draw(state: PlayState, count: number) {
  const out = drawFromPlay(state, count);
  if (!out.ok) throw new Error(out.message);
  return out;
}

describe("shuffleCards", () => {
  it("is a permutation of the cards and leaves the input alone", () => {
    const copy = cards.map((c) => ({ ...c }));
    const shuffled = shuffleCards(cards, 5);
    expect(ids(shuffled)).toEqual(ids(cards));
    expect(cards).toEqual(copy);
  });

  it("gives the same order for the same seed and another for a different seed", () => {
    expect(names(shuffleCards(cards, 5))).toEqual(names(shuffleCards(cards, 5)));
    expect(names(shuffleCards(cards, 5))).not.toEqual(names(shuffleCards(cards, 6)));
  });

  it("actually shuffles (not the original order) and puts each card in each place about equally", () => {
    expect(names(shuffleCards(cards, 1))).not.toEqual(names(cards));
    const small = cards.slice(0, 4);
    const firstPlace = new Map<string, number>();
    for (let seed = 0; seed < 2000; seed++) {
      const top = shuffleCards(small, seed)[0].name;
      firstPlace.set(top, (firstPlace.get(top) ?? 0) + 1);
    }
    for (const c of small) {
      expect(firstPlace.get(c.name)!).toBeGreaterThan(400);
      expect(firstPlace.get(c.name)!).toBeLessThan(600);
    }
  });

  it("copes with no cards and one card", () => {
    expect(shuffleCards([], 1)).toEqual([]);
    expect(shuffleCards(cards.slice(0, 1), 1)).toEqual(cards.slice(0, 1));
  });
});

describe("startPlay", () => {
  it("copies the cards, shuffled, with nothing drawn yet", () => {
    const s = start(7);
    expect(s).toMatchObject({ version: 1, seed: 7, shuffles: 1, counter: 0, reversals: false, reversalPercent: 50, drawn: [] });
    expect(names(s.deck)).toEqual(names(shuffleCards(cards, 7)));
    expect(playSummary(s)).toEqual({ remaining: 12, drawn: 0, total: 12 });
  });

  it("does not share objects with the list it was given", () => {
    const s = start(7);
    s.deck[0].name = "changed";
    expect(cards.some((c) => c.name === "changed")).toBe(false);
  });
});

describe("drawFromPlay", () => {
  it("takes cards from the top, one at a time, and moves them to the discard pile in order", () => {
    const s = start(3);
    const top = names(s.deck);
    const out = draw(s, 3);
    expect(names(out.cards)).toEqual(top.slice(0, 3));
    expect(names(out.state.deck)).toEqual(top.slice(3));
    expect(names(out.state.drawn)).toEqual(top.slice(0, 3));
    expect(playSummary(out.state)).toEqual({ remaining: 9, drawn: 3, total: 12 });
    // The state it was given is untouched.
    expect(playSummary(s)).toEqual({ remaining: 12, drawn: 0, total: 12 });
  });

  it("never draws the same card twice until a reshuffle", () => {
    let s = start(9);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const out = draw(s, 3);
      s = out.state;
      seen.push(...out.cards.map((c) => c.id));
    }
    expect(new Set(seen).size).toBe(12);
    const empty = drawFromPlay(s, 1);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toMatch(/no cards left/i);
  });

  it("drawing three times one at a time equals drawing three at once", () => {
    let one = start(11, { reversals: true, reversalPercent: 50 });
    const all = draw(one, 3);
    for (let i = 0; i < 3; i++) one = draw(one, 1).state;
    expect(one).toEqual(all.state);
  });

  it("refuses more cards than are left, and counts outside 1-10", () => {
    let s = start(2);
    s = draw(s, 10).state;
    const tooMany = drawFromPlay(s, 3);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.message).toMatch(/only 2 cards left/i);
    for (const bad of [0, 11, 1.5, NaN]) {
      const r = drawFromPlay(start(2), bad);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/1 and 10/);
    }
  });

  it("says 'only 1 card left' in the singular", () => {
    let s = startPlay(cards.slice(0, 2), { reversals: false, reversalPercent: 50 }, 1);
    s = draw(s, 1).state;
    const r = drawFromPlay(s, 2);
    if (r.ok) throw new Error("should refuse");
    expect(r.message).toMatch(/only 1 card left/i);
  });

  it("reverses nothing with reversals off, everything at 100% and nothing at 0%", () => {
    expect(draw(start(4, { reversals: false, reversalPercent: 100 }), 5).cards.some((c) => c.reversed)).toBe(false);
    expect(draw(start(4, { reversals: true, reversalPercent: 100 }), 5).cards.every((c) => c.reversed)).toBe(true);
    expect(draw(start(4, { reversals: true, reversalPercent: 0 }), 5).cards.some((c) => c.reversed)).toBe(false);
  });

  it("reverses about the chosen share over a whole deck, and the same seed gives the same reversals", () => {
    const big = Array.from({ length: 600 }, (_, i) => ({ id: `b${i}`, name: `B${i}` }));
    const s = startPlay(big, { reversals: true, reversalPercent: 25 }, 123);
    let state = s;
    let reversed = 0;
    for (let i = 0; i < 60; i++) {
      const out = draw(state, 10);
      state = out.state;
      reversed += out.cards.filter((c) => c.reversed).length;
    }
    expect(reversed / 600).toBeGreaterThan(0.2);
    expect(reversed / 600).toBeLessThan(0.3);
    const again = startPlay(big, { reversals: true, reversalPercent: 25 }, 123);
    expect(draw(again, 10).cards).toEqual(draw(s, 10).cards);
  });

  it("advances the counter by one per card drawn", () => {
    expect(draw(start(5), 4).state.counter).toBe(4);
  });

  it("is repeatable: the same seed always plays out the same game", () => {
    const play = () => {
      let s = start(77, { reversals: true, reversalPercent: 50 });
      s = draw(s, 4).state;
      return draw(s, 3).state;
    };
    expect(play()).toEqual(play());
  });
});

describe("returnToDeck", () => {
  it("puts a drawn card back on top, so it is drawn next, and clears its reversal", () => {
    let s = startPlay(cards, { reversals: true, reversalPercent: 100 }, 6);
    s = draw(s, 3).state;
    const second = s.drawn[1];
    const back = returnToDeck(s, 1, "top");
    if (!back) throw new Error("should return");
    expect(back.deck[0]).toEqual({ id: second.id, name: second.name }); // no 'reversed' flag in the deck
    expect(names(back.drawn)).toEqual([s.drawn[0].name, s.drawn[2].name]);
    expect(playSummary(back)).toEqual({ remaining: 10, drawn: 2, total: 12 });
    expect(draw(back, 1).cards[0].id).toBe(second.id);
  });

  it("can put it at the bottom, where it is drawn last", () => {
    let s = start(6);
    s = draw(s, 1).state;
    const back = returnToDeck(s, 0, "bottom");
    if (!back) throw new Error("should return");
    expect(back.deck[back.deck.length - 1].id).toBe(s.drawn[0].id);
  });

  it("can shuffle it in at a seeded position among the remaining cards", () => {
    let s = start(6);
    s = draw(s, 2).state;
    const a = returnToDeck(s, 0, "shuffle");
    const b = returnToDeck(s, 0, "shuffle");
    if (!a || !b) throw new Error("should return");
    expect(a).toEqual(b); // same state, same seed: same place
    expect(ids(a.deck)).toEqual(ids([...s.deck, { id: s.drawn[0].id, name: s.drawn[0].name }]));
    expect(a.counter).toBe(s.counter + 1);
    // Over many seeds it can land anywhere, including the very top and very bottom.
    const places = new Set<number>();
    for (let seed = 0; seed < 300; seed++) {
      const t = startPlay(cards, { reversals: false, reversalPercent: 50 }, seed);
      const dealt = draw(t, 1).state;
      const placed = returnToDeck(dealt, 0, "shuffle")!;
      places.add(placed.deck.findIndex((c) => c.id === dealt.drawn[0].id));
    }
    expect(places.has(0)).toBe(true);
    expect(places.has(11)).toBe(true);
  });

  it("does nothing for a position that isn't in the discard pile", () => {
    const s = draw(start(1), 2).state;
    expect(returnToDeck(s, 2, "top")).toBeNull();
    expect(returnToDeck(s, -1, "top")).toBeNull();
    expect(returnToDeck(s, 0.5, "top")).toBeNull();
  });
});

describe("reshuffling", () => {
  it("shuffleRemaining reorders only what is left and keeps the discard pile", () => {
    const s = draw(start(1), 3).state;
    const again = shuffleRemaining(s, 99);
    expect(ids(again.deck)).toEqual(ids(s.deck));
    expect(names(again.deck)).not.toEqual(names(s.deck));
    expect(again.drawn).toEqual(s.drawn);
    expect(again).toMatchObject({ seed: 99, counter: 0, shuffles: s.shuffles + 1 });
  });

  it("reshuffleAll gathers every card back, clears the discard pile and starts a new shuffle", () => {
    const s = draw(startPlay(cards, { reversals: true, reversalPercent: 100 }, 1), 5).state;
    const all = reshuffleAll(s, 42);
    expect(all.drawn).toEqual([]);
    expect(ids(all.deck)).toEqual(ids(cards));
    expect(all.deck.every((c) => !("reversed" in c))).toBe(true);
    // The order is the seeded shuffle of (cards left, then the discard pile).
    const gathered = [...s.deck, ...s.drawn.map((c) => ({ id: c.id, name: c.name }))];
    expect(all.deck).toEqual(shuffleCards(gathered, 42));
    expect(all).toMatchObject({ seed: 42, counter: 0, shuffles: s.shuffles + 1, reversals: true, reversalPercent: 100 });
  });

  it("the same seed reshuffles the same way", () => {
    const s = draw(start(1), 4).state;
    expect(reshuffleAll(s, 8)).toEqual(reshuffleAll(s, 8));
    expect(reshuffleAll(s, 8)).not.toEqual(reshuffleAll(s, 9));
  });

  it("restartWith copies a new list of cards, forgetting the old ones and keeping the options", () => {
    const s = draw(startPlay(cards, { reversals: true, reversalPercent: 30 }, 1), 5).state;
    const fresh: PlayCard[] = [{ id: "n1", name: "New 1" }, { id: "n2", name: "New 2" }, { id: "n3", name: "New 3" }];
    const again = restartWith(s, fresh, 5);
    expect(ids(again.deck)).toEqual(["n1", "n2", "n3"]);
    expect(again.drawn).toEqual([]);
    expect(again).toMatchObject({ seed: 5, counter: 0, shuffles: s.shuffles + 1, reversals: true, reversalPercent: 30 });
  });
});

describe("setReversals", () => {
  it("changes the options for later draws only", () => {
    const s = draw(startPlay(cards, { reversals: true, reversalPercent: 100 }, 1), 2).state;
    const r = setReversals(s, false, 10);
    if (!r.ok) throw new Error(r.message);
    expect(r.state).toMatchObject({ reversals: false, reversalPercent: 10 });
    expect(r.state.drawn).toEqual(s.drawn); // earlier draws keep how they came up
  });

  it("needs a whole percentage from 0 to 100", () => {
    for (const bad of [-1, 101, 2.5, NaN]) {
      const r = setReversals(start(1), true, bad);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/0 and 100/);
    }
  });
});

describe("saving and loading the state", () => {
  it("round-trips exactly through text", () => {
    const s = draw(startPlay(cards, { reversals: true, reversalPercent: 40 }, 3_000_000_000), 4).state;
    expect(parsePlayState(serializePlayState(s))).toEqual(s);
  });

  it("refuses anything that isn't a valid state instead of guessing", () => {
    const good = JSON.parse(serializePlayState(start(1)));
    const bad: unknown[] = [
      "not json at all",
      "[]",
      "null",
      { ...good, version: 2 },
      { ...good, seed: "x" },
      { ...good, seed: -1 },
      { ...good, shuffles: 1.5 },
      { ...good, counter: -3 },
      { ...good, reversals: "yes" },
      { ...good, reversalPercent: 101 },
      { ...good, deck: "no" },
      { ...good, deck: [{ id: 1, name: "x" }] },
      { ...good, deck: [{ id: "a" }] },
      { ...good, drawn: [{ id: "a", name: "x" }] }, // 'reversed' missing
      { ...good, drawn: [{ id: "a", name: "x", reversed: "no" }] },
    ];
    for (const value of bad) {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      expect(parsePlayState(text), text.slice(0, 60)).toBeNull();
    }
  });

  it("ignores unknown extra fields (a newer app's state still loads)", () => {
    const good = JSON.parse(serializePlayState(start(1)));
    expect(parsePlayState(JSON.stringify({ ...good, somethingNew: 1 }))).not.toBeNull();
  });
});
