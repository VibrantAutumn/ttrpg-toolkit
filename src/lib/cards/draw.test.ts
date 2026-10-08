import { describe, expect, it } from "vitest";
import { createRng } from "../dice/rng";
import { scripted } from "../dice/testing";
import {
  DEFAULT_DRAW_OPTIONS,
  MAX_DRAW,
  drawCards,
  formatDrawResult,
  type DrawCard,
  type DrawOptions,
} from "./draw";

const deck: DrawCard[] = ["A", "B", "C", "D"].map((name) => ({ id: `id-${name}`, name }));
const opts = (change: Partial<DrawOptions> = {}): DrawOptions => ({ ...DEFAULT_DRAW_OPTIONS, ...change });

/** Draw and expect success, returning "Name" or "Name*" (reversed) for each card. */
function drawn(candidates: DrawCard[], options: DrawOptions, rng: ReturnType<typeof scripted>) {
  const out = drawCards(candidates, options, rng);
  if (!out.ok) throw new Error(out.message);
  return out.cards.map((c) => (c.reversed ? `${c.name}*` : c.name));
}

describe("drawCards: the defaults", () => {
  it("draws one card, no repeats, with reversals on at 50%", () => {
    expect(DEFAULT_DRAW_OPTIONS).toEqual({ count: 1, repeats: false, reversals: true, reversalPercent: 50 });
    expect(MAX_DRAW).toBe(10);
  });
});

describe("drawCards: picking cards", () => {
  it("picks by position among the cards left, and each card is taken out once drawn", () => {
    // Without reversals, only the picks use randomness: 2 -> C, then index 1 of [A, B, D] -> B.
    const rng = scripted(2, 1);
    expect(drawn(deck, opts({ count: 2, reversals: false }), rng)).toEqual(["C", "B"]);
    expect(rng.remaining()).toBe(0);
  });

  it("keeps the picked cards' ids and names", () => {
    const out = drawCards(deck, opts({ reversals: false }), scripted(3));
    expect(out).toEqual({ ok: true, cards: [{ id: "id-D", name: "D", reversed: false }] });
  });

  it("can draw every card in the deck without repeats", () => {
    const names = drawn(deck, opts({ count: 4, reversals: false }), scripted(0, 0, 0, 0));
    expect(names).toEqual(["A", "B", "C", "D"]);
  });

  it("with repeats, every pick is from the whole deck, so a card can come up again", () => {
    const rng = scripted(1, 1, 3);
    expect(drawn(deck, opts({ count: 3, repeats: true, reversals: false }), rng)).toEqual(["B", "B", "D"]);
  });

  it("with repeats you can draw more cards than the deck has", () => {
    const two = deck.slice(0, 2);
    const rng = scripted(0, 1, 0, 1, 0);
    expect(drawn(two, opts({ count: 5, repeats: true, reversals: false }), rng)).toHaveLength(5);
  });
});

describe("drawCards: reversals", () => {
  it("rolls 1-100 per card after picking it; at or under the percentage means reversed", () => {
    // pick C (2), roll 50 -> reversed; pick index 0 of [A, B, D] = A, roll 51 -> upright.
    const rng = scripted(2, 50, 0, 51);
    expect(drawn(deck, opts({ count: 2, reversalPercent: 50 }), rng)).toEqual(["C*", "A"]);
    expect(rng.remaining()).toBe(0);
  });

  it("0% never reverses and 100% always does (the roll still happens, so seeds stay simple)", () => {
    expect(drawn(deck, opts({ count: 2, reversalPercent: 0 }), scripted(0, 1, 0, 100))).toEqual(["A", "B"]);
    expect(drawn(deck, opts({ count: 2, reversalPercent: 100 }), scripted(0, 100, 0, 1))).toEqual(["A*", "B*"]);
  });

  it("with reversals off, nothing is reversed and no rolls are spent on it", () => {
    const rng = scripted(0, 0);
    expect(drawn(deck, opts({ count: 2, reversals: false, reversalPercent: 100 }), rng)).toEqual(["A", "B"]);
    expect(rng.remaining()).toBe(0);
  });
});

describe("drawCards: refusing bad requests", () => {
  const fails = (candidates: DrawCard[], options: DrawOptions) => {
    const out = drawCards(candidates, options, scripted());
    if (out.ok) throw new Error("should have been refused");
    return out.message;
  };

  it("refuses to draw from nothing", () => {
    expect(fails([], opts())).toMatch(/no cards/i);
  });

  it("refuses more cards than exist unless repeats are on", () => {
    expect(fails(deck, opts({ count: 5 }))).toMatch(/4 cards.*5/);
    expect(fails(deck.slice(0, 1), opts({ count: 2 }))).toMatch(/1 card\b/);
  });

  it("allows 1 to 10 cards only", () => {
    expect(fails(deck, opts({ count: 0 }))).toMatch(/1 and 10/);
    expect(fails(deck, opts({ count: 11, repeats: true }))).toMatch(/1 and 10/);
    expect(fails(deck, opts({ count: 1.5 }))).toMatch(/1 and 10/);
  });

  it("needs a whole reversal percentage from 0 to 100", () => {
    expect(fails(deck, opts({ reversalPercent: -1 }))).toMatch(/0 and 100/);
    expect(fails(deck, opts({ reversalPercent: 101 }))).toMatch(/0 and 100/);
    expect(fails(deck, opts({ reversalPercent: 12.5 }))).toMatch(/0 and 100/);
  });

  it("does not change the list it is given", () => {
    const copy = deck.map((c) => ({ ...c }));
    drawCards(deck, opts({ count: 3 }), createRng(1));
    expect(deck).toEqual(copy);
  });
});

describe("drawCards: seeded draws", () => {
  it("gives the same draw for the same seed and a different one for another", () => {
    const big: DrawCard[] = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, name: `Card ${i}` }));
    const options = opts({ count: 8 });
    const a = drawCards(big, options, createRng(77));
    const b = drawCards(big, options, createRng(77));
    const c = drawCards(big, options, createRng(78));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("never repeats a card without repeats, over many draws", () => {
    const big: DrawCard[] = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `Card ${i}` }));
    const rng = createRng(5);
    for (let i = 0; i < 300; i++) {
      const out = drawCards(big, opts({ count: 10 }), rng);
      if (!out.ok) throw new Error(out.message);
      expect(new Set(out.cards.map((c) => c.id)).size).toBe(10);
    }
  });

  it("gives every card a fair chance and reverses about the chosen share", () => {
    const rng = createRng(9);
    const seen = new Map<string, number>();
    let reversed = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const out = drawCards(deck, opts({ reversalPercent: 25 }), rng);
      if (!out.ok) throw new Error(out.message);
      seen.set(out.cards[0].name, (seen.get(out.cards[0].name) ?? 0) + 1);
      if (out.cards[0].reversed) reversed++;
    }
    for (const name of ["A", "B", "C", "D"]) {
      expect(seen.get(name)!).toBeGreaterThan(n / 4 - 250);
      expect(seen.get(name)!).toBeLessThan(n / 4 + 250);
    }
    expect(reversed / n).toBeGreaterThan(0.2);
    expect(reversed / n).toBeLessThan(0.3);
  });
});

describe("formatDrawResult", () => {
  const cards = [
    { id: "1", name: "The Fool", reversed: false },
    { id: "2", name: "Two of Cups", reversed: true },
  ];

  it("lists the source, then each card, marking reversed ones", () => {
    expect(formatDrawResult("Tarot", cards)).toBe("Tarot → The Fool, Two of Cups (reversed)");
  });

  it("copes with a single card and with no cards", () => {
    expect(formatDrawResult("Pool", [cards[0]])).toBe("Pool → The Fool");
    expect(formatDrawResult("Pool", [])).toBe("Pool → (no cards)");
  });
});
