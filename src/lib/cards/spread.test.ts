import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "../dice/rng";
import { scripted } from "../dice/testing";
import type { DrawCard } from "./draw";
import {
  MAX_POSITIONS,
  MIN_POSITIONS,
  checkPositions,
  drawSpread,
  formatSpreadResult,
  type PositionPool,
} from "./spread";

const card = (name: string): DrawCard => ({ id: `id-${name}`, name });
const cards = (...names: string[]) => names.map(card);
const pool = (name: string, ...names: string[]): PositionPool => ({ name, meaning: "", cards: cards(...names) });
const OFF = { reversals: false, reversalPercent: 50 };

/** Draw and expect success, returning "Position: Card" (a trailing * marks reversed). */
function drawn(positions: PositionPool[], options = OFF, rng: Rng = createRng(1)) {
  const out = drawSpread(positions, options, rng);
  if (!out.ok) throw new Error(out.message);
  return out.cards.map((c) => `${c.position}: ${c.name}${c.reversed ? "*" : ""}`);
}

describe("limits", () => {
  it("allows 3 to 10 positions", () => {
    expect([MIN_POSITIONS, MAX_POSITIONS]).toEqual([3, 10]);
  });
});

describe("drawSpread", () => {
  const spread = [pool("Past", "A", "B", "C", "D"), pool("Present", "E", "F", "G"), pool("Future", "H", "I", "J")];

  it("draws one card per position, in order, each from its own source", () => {
    // Without reversals only the picks use randomness: index 2 of [A..D] = C, 0 of [E,F,G] = E, 1 of [H,I,J] = I.
    const rng = scripted(2, 0, 1);
    expect(drawn(spread, OFF, rng)).toEqual(["Past: C", "Present: E", "Future: I"]);
    expect(rng.remaining()).toBe(0);
  });

  it("keeps each card's id and its position's name", () => {
    const out = drawSpread(spread, OFF, scripted(0, 0, 0));
    expect(out).toEqual({
      ok: true,
      cards: [
        { position: "Past", id: "id-A", name: "A", reversed: false },
        { position: "Present", id: "id-E", name: "E", reversed: false },
        { position: "Future", id: "id-H", name: "H", reversed: false },
      ],
    });
  });

  it("rolls reversal after each pick, as a simple draw does", () => {
    // pick A (0), roll 50 -> reversed; pick E (0), roll 51 -> upright; pick H (0), roll 1 -> reversed.
    const rng = scripted(0, 50, 0, 51, 0, 1);
    expect(drawn(spread, { reversals: true, reversalPercent: 50 }, rng)).toEqual([
      "Past: A*",
      "Present: E",
      "Future: H*",
    ]);
    expect(rng.remaining()).toBe(0);
  });

  it("never gives the same card to two positions, even when they share a source", () => {
    const shared = cards("X", "Y", "Z");
    const positions: PositionPool[] = [
      { name: "One", meaning: "", cards: shared },
      { name: "Two", meaning: "", cards: shared },
      { name: "Three", meaning: "", cards: shared },
    ];
    // One: index 0 -> X. Two: X is gone, so index 0 of [Y, Z] -> Y. Three: only Z is left.
    expect(drawn(positions, OFF, scripted(0, 0, 0))).toEqual(["One: X", "Two: Y", "Three: Z"]);
    // Over many random readings every card is used exactly once.
    const rng = createRng(4);
    for (let i = 0; i < 300; i++) {
      const names = drawn(positions, OFF, rng).map((s) => s.split(": ")[1]);
      expect(new Set(names).size).toBe(3);
    }
  });

  it("a card can be in two positions' sources and still only be drawn once overall", () => {
    const positions = [pool("A", "X", "Y"), pool("B", "X", "Y"), pool("C", "X", "Y", "Z")];
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const names = drawn(positions, OFF, rng).map((s) => s.split(": ")[1]);
      expect(new Set(names).size).toBe(3);
      expect(names[2]).toBe("Z"); // X and Y are always used up by the first two positions
    }
  });

  it("is repeatable: the same seed gives the same reading, another seed another", () => {
    const options = { reversals: true, reversalPercent: 40 };
    const a = drawSpread(spread, options, createRng(99));
    expect(drawSpread(spread, options, createRng(99))).toEqual(a);
    expect(drawSpread(spread, options, createRng(100))).not.toEqual(a);
  });

  it("gives every card of a position a fair chance", () => {
    const rng = createRng(3);
    const seen = new Map<string, number>();
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const first = drawn(spread, OFF, rng)[0].split(": ")[1];
      seen.set(first, (seen.get(first) ?? 0) + 1);
    }
    for (const name of ["A", "B", "C", "D"]) {
      expect(seen.get(name)!).toBeGreaterThan(n / 4 - 200);
      expect(seen.get(name)!).toBeLessThan(n / 4 + 200);
    }
  });

  it("does not change the lists it is given", () => {
    const before = JSON.stringify(spread);
    drawSpread(spread, OFF, createRng(1));
    expect(JSON.stringify(spread)).toBe(before);
  });
});

describe("drawSpread: refusing", () => {
  const refused = (positions: PositionPool[], options = OFF) => {
    // Earlier positions are drawn before a later one is refused, so this needs a real source.
    const out = drawSpread(positions, options, createRng(1));
    if (out.ok) throw new Error("should have been refused");
    return out.message;
  };

  it("needs 3 to 10 positions", () => {
    expect(refused([pool("A", "x"), pool("B", "y")])).toMatch(/3 and 10/);
    const eleven = Array.from({ length: 11 }, (_, i) => pool(`P${i}`, "a", "b", "c"));
    expect(refused(eleven)).toMatch(/3 and 10/);
  });

  it("says which position has no cards at all", () => {
    const msg = refused([pool("Past", "A"), pool("Present"), pool("Future", "C")]);
    expect(msg).toMatch(/“Present”/);
    expect(msg).toMatch(/no cards/i);
  });

  it("says which position ran out because earlier positions used its cards", () => {
    const shared = cards("X", "Y");
    const msg = refused([
      { name: "One", meaning: "", cards: shared },
      { name: "Two", meaning: "", cards: shared },
      { name: "Three", meaning: "", cards: shared },
    ]);
    expect(msg).toMatch(/“Three”/);
    expect(msg).toMatch(/earlier positions/i);
  });

  it("needs a whole reversal percentage from 0 to 100", () => {
    const three = [pool("A", "a"), pool("B", "b"), pool("C", "c")];
    for (const bad of [-1, 101, 2.5, NaN]) {
      expect(refused(three, { reversals: true, reversalPercent: bad }), String(bad)).toMatch(/0 and 100/);
    }
  });
});

describe("formatSpreadResult", () => {
  const cards = [
    { position: "Tome", id: "1", name: "The Raven", reversed: false },
    { position: "Icon", id: "2", name: "The Ghost", reversed: true },
    { position: "Enemy", id: "3", name: "The Darklord", reversed: false },
  ];

  it("lists each position with its card, marking reversed ones", () => {
    expect(formatSpreadResult("Strahd reading", cards)).toBe(
      "Strahd reading → Tome: The Raven; Icon: The Ghost (reversed); Enemy: The Darklord",
    );
  });

  it("copes with no cards", () => {
    expect(formatSpreadResult("Empty", [])).toBe("Empty → (no cards)");
  });
});

describe("checkPositions (before saving a spread)", () => {
  const ok = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `Position ${i + 1}`, sourceId: null, meaning: "" }));

  it("accepts 3 to 10 differently named positions, with or without sources", () => {
    expect(checkPositions(ok(3))).toBeNull();
    expect(checkPositions(ok(10))).toBeNull();
    expect(checkPositions([{ name: "A", sourceId: "s1", meaning: "m" }, ...ok(2).map((p, i) => ({ ...p, name: `B${i}` }))])).toBeNull();
  });

  it("refuses too few or too many", () => {
    expect(checkPositions(ok(2))).toMatch(/3 and 10/);
    expect(checkPositions(ok(11))).toMatch(/3 and 10/);
  });

  it("refuses blank, overlong and repeated names", () => {
    const base = ok(3);
    expect(checkPositions([{ ...base[0], name: "  " }, base[1], base[2]])).toMatch(/name/i);
    expect(checkPositions([{ ...base[0], name: "x".repeat(61) }, base[1], base[2]])).toMatch(/60/);
    expect(checkPositions([{ ...base[0], name: "Same" }, { ...base[1], name: "same" }, base[2]])).toMatch(/different/i);
  });
});
