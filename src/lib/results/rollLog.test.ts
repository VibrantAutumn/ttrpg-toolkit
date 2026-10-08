import { describe, expect, it } from "vitest";
import { createRng } from "../dice/rng";
import { rollNotation } from "../dice/roll";
import { DEFAULT_DRAW_OPTIONS, drawCards, type DrawCard } from "../cards/draw";
import { createRollLog } from "./rollLog";

function makeLog(capacity?: number) {
  let time = 1000;
  let n = 0;
  return createRollLog({ capacity, now: () => time++, newId: () => `id${++n}` });
}

describe("createRollLog", () => {
  it("starts empty", () => {
    expect(makeLog().entries()).toEqual([]);
  });

  it("puts the newest roll first and stamps id and time", () => {
    const log = makeLog();
    log.roll("1d6", 1);
    log.roll("1d8", 2);
    const entries = log.entries("dice");
    expect(entries.map((e) => e.notation)).toEqual(["1d8", "1d6"]);
    expect(entries.map((e) => e.id)).toEqual(["id2", "id1"]);
    expect(entries[0].createdAt).toBeGreaterThan(entries[1].createdAt);
    expect(entries[0]).toMatchObject({ kind: "dice", seed: 2, locked: [], savedItemId: null });
  });

  it("stores the result and its readable text", () => {
    const log = makeLog();
    const r = log.roll("2d6+3", 5);
    if (!r.ok) throw new Error("should parse");
    expect(r.entry.result.total).toBeGreaterThanOrEqual(5);
    expect(r.entry.text).toMatch(/^2d6\+3 → \[\d, \d\] \+ 3 = \d+$/);
  });

  it("gives the same result for the same seed (and matches a plain roll)", () => {
    const a = makeLog().roll("4d6!kh3", 99);
    const b = rollNotation("4d6!kh3", createRng(99));
    if (!a.ok || !b.ok) throw new Error("should parse");
    expect(a.entry.result).toEqual(b.result);
  });

  it("returns the parse error and adds nothing for bad notation", () => {
    const log = makeLog();
    const r = log.roll("2d", 1);
    expect(r.ok).toBe(false);
    expect(log.entries()).toEqual([]);
  });

  it("keeps only the newest `capacity` entries", () => {
    const log = makeLog(3);
    for (let i = 1; i <= 5; i++) log.roll("1d6", i);
    expect(log.entries().map((e) => e.seed)).toEqual([5, 4, 3]);
  });

  it("defaults to remembering 200 rolls", () => {
    const log = makeLog();
    for (let i = 0; i < 250; i++) log.roll("1d6", i);
    expect(log.entries()).toHaveLength(200);
  });

  it("can filter by kind", () => {
    const log = makeLog();
    log.roll("1d6", 1);
    expect(log.entries("dice")).toHaveLength(1);
    expect(log.entries("all")).toHaveLength(1);
  });

  it("clears", () => {
    const log = makeLog();
    log.roll("1d6", 1);
    log.clear();
    expect(log.entries()).toEqual([]);
  });

  it("tells subscribers about changes, and stops after unsubscribe", () => {
    const log = makeLog();
    let calls = 0;
    const off = log.subscribe(() => calls++);
    log.roll("1d6", 1);
    log.clear();
    expect(calls).toBe(2);
    off();
    log.roll("1d6", 2);
    expect(calls).toBe(2);
  });

  it("returns the same array until something changes (for React)", () => {
    const log = makeLog();
    log.roll("1d6", 1);
    const before = log.entries();
    expect(log.entries()).toBe(before);
    log.roll("1d6", 2);
    expect(log.entries()).not.toBe(before);
  });

  describe("labels (a formula's name)", () => {
    it("has no label unless one is given", () => {
      const log = makeLog();
      const r = log.roll("1d6", 1);
      if (!r.ok) throw new Error("should parse");
      expect(r.entry.label).toBeNull();
    });

    it("keeps the label on the entry and on rerolls of it", () => {
      const log = makeLog();
      const r = log.roll("1d20+5", 1, "Attack");
      if (!r.ok) throw new Error("should parse");
      expect(r.entry.label).toBe("Attack");
      expect(log.reroll(r.entry.id, 2)?.label).toBe("Attack");
    });
  });

  describe("locking and rerolling", () => {
    it("locks and unlocks a term of a result", () => {
      const log = makeLog();
      const r = log.roll("1d20+1d6", 3);
      if (!r.ok) throw new Error("should parse");
      log.toggleLock(r.entry.id, 0);
      expect(log.entries("dice")[0].locked).toEqual([0]);
      log.toggleLock(r.entry.id, 0);
      expect(log.entries("dice")[0].locked).toEqual([]);
    });

    it("ignores locks on terms that do not exist, and unknown entries", () => {
      const log = makeLog();
      const r = log.roll("1d20", 3);
      if (!r.ok) throw new Error("should parse");
      log.toggleLock(r.entry.id, 5);
      log.toggleLock("nope", 0);
      expect(log.entries("dice")[0].locked).toEqual([]);
    });

    it("rerolling adds a new entry on top, keeping locked terms and their locks", () => {
      const log = makeLog();
      const first = log.roll("1d20+1d6", 3);
      if (!first.ok) throw new Error("should parse");
      log.toggleLock(first.entry.id, 0);

      const again = log.reroll(first.entry.id, 8);
      if (!again) throw new Error("reroll should work");
      expect(log.entries()).toHaveLength(2);
      expect(log.entries()[0].id).toBe(again.id);
      expect(again.result.terms[0]).toEqual(first.entry.result.terms[0]);
      expect(again.locked).toEqual([0]);
      expect(again.notation).toBe("1d20+1d6");

      // The unlocked d6 is exactly what a fresh generator with that seed gives.
      const fresh = rollNotation("1d6", createRng(8));
      if (!fresh.ok || fresh.result.terms[0].kind !== "dice") throw new Error("bad");
      expect(again.result.terms[1].subtotal).toBe(fresh.result.terms[0].subtotal);
    });

    it("rerolling an unknown entry does nothing", () => {
      const log = makeLog();
      expect(log.reroll("nope", 1)).toBeNull();
      expect(log.entries()).toEqual([]);
    });
  });

  describe("saving", () => {
    it("remembers which library item a roll was saved as", () => {
      const log = makeLog();
      const r = log.roll("1d6", 1);
      if (!r.ok) throw new Error("should parse");
      log.markSaved(r.entry.id, "item-123");
      expect(log.entries()[0].savedItemId).toBe("item-123");
    });

    it("ignores unknown entries", () => {
      const log = makeLog();
      log.markSaved("nope", "x");
      expect(log.entries()).toEqual([]);
    });
  });
});

describe("createRollLog: draws", () => {
  const cards: DrawCard[] = ["A", "B", "C", "D", "E"].map((name) => ({ id: `id-${name}`, name }));
  const source = { id: "deck-1", name: "Tarot" };
  const options = { ...DEFAULT_DRAW_OPTIONS, count: 2 };

  it("adds a draw entry with its source, options, cards, seed and readable text", () => {
    const log = makeLog();
    const r = log.drawFrom(source, cards, options, 42);
    if (!r.ok) throw new Error(r.message);
    expect(r.entry).toMatchObject({
      kind: "draw",
      seed: 42,
      sourceId: "deck-1",
      sourceName: "Tarot",
      options,
      label: null,
      savedItemId: null,
    });
    expect(r.entry.cards).toHaveLength(2);
    expect(r.entry.text).toMatch(/^Tarot → .+, .+$/);
    expect(log.entries("draw")).toEqual([r.entry]);
  });

  it("is exactly the draw its seed describes", () => {
    const r = makeLog().drawFrom(source, cards, options, 7);
    const direct = drawCards(cards, options, createRng(7));
    if (!r.ok || !direct.ok) throw new Error("should draw");
    expect(r.entry.cards).toEqual(direct.cards);
  });

  it("reports a problem and adds nothing when the draw can't happen", () => {
    const log = makeLog();
    const r = log.drawFrom(source, [], options, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no cards/i);
    expect(log.drawFrom(source, cards, { ...options, count: 6 }, 1).ok).toBe(false);
    expect(log.entries()).toEqual([]);
  });

  it("shares the log with dice: one newest-first list, filterable by kind", () => {
    const log = makeLog();
    log.roll("1d6", 1);
    log.drawFrom(source, cards, options, 2);
    log.roll("1d8", 3);
    expect(log.entries().map((e) => e.kind)).toEqual(["dice", "draw", "dice"]);
    expect(log.entries("dice").map((e) => e.kind)).toEqual(["dice", "dice"]);
    expect(log.entries("draw").map((e) => e.kind)).toEqual(["draw"]);
    expect(log.entries("draw")).toBe(log.entries("draw")); // stable for React
  });

  it("counts draws toward the capacity", () => {
    const log = makeLog(3);
    log.roll("1d6", 1);
    for (let i = 0; i < 3; i++) log.drawFrom(source, cards, options, i);
    expect(log.entries().map((e) => e.kind)).toEqual(["draw", "draw", "draw"]);
  });

  it("can be marked saved, but cannot be locked or rerolled like dice", () => {
    const log = makeLog();
    const r = log.drawFrom(source, cards, options, 5);
    if (!r.ok) throw new Error(r.message);
    log.markSaved(r.entry.id, "item-9");
    expect(log.entries("draw")[0].savedItemId).toBe("item-9");
    const before = log.entries();
    log.toggleLock(r.entry.id, 0);
    expect(log.entries()).toBe(before); // nothing changed, nobody notified
    expect(log.reroll(r.entry.id, 1)).toBeNull();
  });

  it("tells subscribers about a new draw", () => {
    const log = makeLog();
    let calls = 0;
    log.subscribe(() => calls++);
    log.drawFrom(source, cards, options, 1);
    expect(calls).toBe(1);
  });
});

describe("createRollLog: draws from a deck in play", () => {
  const drawn = [
    { id: "a", name: "The Fool", reversed: false },
    { id: "b", name: "Two of Cups", reversed: true },
  ];
  const options = { ...DEFAULT_DRAW_OPTIONS, count: 2 };

  it("logs the cards a deck in play dealt, remembering which game it was", () => {
    const log = makeLog();
    const entry = log.logDraw({ sourceId: "play-1", sourceName: "Harrow deck", playId: "play-1", options, cards: drawn, seed: 9 });
    expect(entry).toMatchObject({
      kind: "draw",
      sourceId: "play-1",
      sourceName: "Harrow deck",
      playId: "play-1",
      seed: 9,
      label: null,
      savedItemId: null,
    });
    expect(entry.text).toBe("Harrow deck → The Fool, Two of Cups (reversed)");
    expect(log.entries("draw")).toEqual([entry]);
  });

  it("plain draws from a set, deck or pool have no game", () => {
    const log = makeLog();
    const r = log.drawFrom({ id: "deck-1", name: "Tarot" }, [{ id: "x", name: "X" }], { ...options, count: 1 }, 1);
    if (!r.ok) throw new Error(r.message);
    expect(r.entry.playId).toBeNull();
  });

  it("copies the cards it is given, so later changes to them don't alter the log", () => {
    const log = makeLog();
    const mine = drawn.map((c) => ({ ...c }));
    const entry = log.logDraw({ sourceId: "p", sourceName: "P", playId: "p", options, cards: mine, seed: 1 });
    mine[0].name = "changed";
    expect(entry.cards[0].name).toBe("The Fool");
  });

  it("notifies subscribers and shares the capacity like any other result", () => {
    const log = makeLog(2);
    let calls = 0;
    log.subscribe(() => calls++);
    log.roll("1d6", 1);
    log.logDraw({ sourceId: "p", sourceName: "P", playId: "p", options, cards: drawn, seed: 1 });
    log.logDraw({ sourceId: "p", sourceName: "P", playId: "p", options, cards: drawn, seed: 2 });
    expect(calls).toBe(3);
    expect(log.entries().map((e) => e.kind)).toEqual(["draw", "draw"]);
  });
});
