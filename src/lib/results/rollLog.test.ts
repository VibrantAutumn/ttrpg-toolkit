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

describe("createRollLog: spread readings", () => {
  const options = { ...DEFAULT_DRAW_OPTIONS, count: 3, reversals: false };
  const cards = [
    { id: "a", name: "The Raven", reversed: false },
    { id: "b", name: "The Ghost", reversed: true },
    { id: "c", name: "The Darklord", reversed: false },
  ];

  it("logs a reading with each card's position name, in the text and on the entry", () => {
    const log = makeLog();
    const entry = log.logDraw({
      sourceId: "spread-1",
      sourceName: "Strahd reading",
      playId: null,
      spreadId: "spread-1",
      positions: ["Tome", "Icon", "Enemy"],
      options,
      cards,
      seed: 5,
    });
    expect(entry).toMatchObject({ kind: "draw", spreadId: "spread-1", positions: ["Tome", "Icon", "Enemy"] });
    expect(entry.text).toBe("Strahd reading → Tome: The Raven; Icon: The Ghost (reversed); Enemy: The Darklord");
  });

  it("plain draws and games have no positions or spread", () => {
    const log = makeLog();
    const entry = log.logDraw({ sourceId: "p", sourceName: "P", playId: "p", options, cards, seed: 1 });
    expect(entry.positions).toBeNull();
    expect(entry.spreadId).toBeNull();
    const r = log.drawFrom({ id: "d", name: "D" }, [{ id: "x", name: "X" }], { ...options, count: 1 }, 1);
    if (!r.ok) throw new Error(r.message);
    expect([r.entry.positions, r.entry.spreadId]).toEqual([null, null]);
  });

  it("ignores position names that don't line up with the cards", () => {
    const entry = makeLog().logDraw({
      sourceId: "s",
      sourceName: "S",
      playId: null,
      spreadId: "s",
      positions: ["Only one"],
      options,
      cards,
      seed: 1,
    });
    expect(entry.positions).toBeNull();
    expect(entry.text).toBe("S → The Raven, The Ghost (reversed), The Darklord");
  });
});

describe("table results in the log", () => {
  const people = {
    id: "person",
    name: "Person",
    avoidRecent: 0,
    entries: [
      { id: "ann", text: "Ann", weight: 1 },
      { id: "bob", text: "Bob", weight: 1 },
      { id: "cy", text: "Cy", weight: 1 },
    ],
  };
  const quests = {
    id: "quests",
    name: "Quests",
    avoidRecent: 0,
    entries: [{ id: "q", text: "[Person] meets [Person]", weight: 1 }],
  };
  const world = {
    findTable: (name: string) => [people, quests].find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null,
    findDeck: () => null,
    recent: () => [] as string[],
  };

  it("logs a table roll with its name, text and seed, newest first", () => {
    const log = makeLog();
    log.roll("1d6", 1);
    const r = log.rollTable(quests, world, 7);
    if (!r.ok) throw new Error(r.message);
    expect(r.entry).toMatchObject({
      kind: "table",
      tableId: "quests",
      tableName: "Quests",
      seed: 7,
      locked: [],
      savedItemId: null,
      label: null,
    });
    expect(r.entry.text).toMatch(/^Quests → (Ann|Bob|Cy) meets (Ann|Bob|Cy)$/);
    expect(r.entry.roll.picked[0]).toEqual({ tableId: "quests", entryId: "q" });
    expect(log.entries()[0]).toBe(r.entry);
    expect(log.entries("table")).toEqual([r.entry]);
    expect(log.entries("dice")).toHaveLength(1);
  });

  it("is reproducible from its seed", () => {
    const a = makeLog().rollTable(quests, world, 42);
    const b = makeLog().rollTable(quests, world, 42);
    if (!a.ok || !b.ok) throw new Error("should roll");
    expect(a.entry.text).toBe(b.entry.text);
  });

  it("logs nothing and says why when the table can't be rolled", () => {
    const log = makeLog();
    const empty = { id: "e", name: "Empty", avoidRecent: 0, entries: [] };
    const r = log.rollTable(empty, world, 1);
    expect(r.ok).toBe(false);
    expect(log.entries()).toEqual([]);
  });

  it("rerolls the unlocked slots as a new entry, keeping the locks and the entry", () => {
    const log = makeLog();
    const first = log.rollTable(quests, world, 3);
    if (!first.ok) throw new Error(first.message);
    log.toggleLock(first.entry.id, 0);
    const locked = log.entries("table")[0];
    expect(locked.locked).toEqual([0]);

    const again = log.rerollTable(first.entry.id, world, 9);
    if (!again) throw new Error("should reroll");
    expect(again.id).not.toBe(first.entry.id);
    expect(again.locked).toEqual([0]);
    expect(again.seed).toBe(9);
    expect(again.roll.entryId).toBe("q");
    // The locked slot (part 0) is exactly what it was.
    expect(again.roll.parts[0]).toEqual(first.entry.roll.parts[0]);
    expect(log.entries()[0]).toBe(again);
    expect(log.entries("table")).toHaveLength(2);
  });

  it("only picks slots as lockable: not text, not references, not unknown parts", () => {
    const log = makeLog();
    const labelled = { ...quests, entries: [{ id: "q", text: "[Person as A] is [A]", weight: 1 }] };
    const r = log.rollTable(labelled, world, 1);
    if (!r.ok) throw new Error(r.message);
    const id = r.entry.id;
    log.toggleLock(id, 1); // the text " is "
    log.toggleLock(id, 2); // the reference [A]
    log.toggleLock(id, 9); // nothing there
    log.toggleLock(id, -1);
    expect(log.entries("table")[0].locked).toEqual([]);
    log.toggleLock(id, 0);
    expect(log.entries("table")[0].locked).toEqual([0]);
    log.toggleLock(id, 0); // toggles back off
    expect(log.entries("table")[0].locked).toEqual([]);
  });

  it("returns null when asked to reroll something that isn't a table result", () => {
    const log = makeLog();
    const d = log.roll("1d6", 1);
    if (!d.ok) throw new Error("should parse");
    expect(log.rerollTable(d.entry.id, world)).toBeNull();
    expect(log.rerollTable("nope", world)).toBeNull();
  });

  it("can be marked saved like any entry", () => {
    const log = makeLog();
    const r = log.rollTable(quests, world, 1);
    if (!r.ok) throw new Error(r.message);
    log.markSaved(r.entry.id, "item-1");
    expect(log.entries("table")[0].savedItemId).toBe("item-1");
  });
});

describe("name results in the log", () => {
  const entries = (...texts: string[]) => texts.map((text, i) => ({ id: `${text}-${i}`, text, weight: 1 }));
  const generator = {
    id: "names",
    name: "Names",
    settings: {
      mode: "two" as const,
      join1: "none" as const,
      join2: "none" as const,
      capitalisation: "firstLetter" as const,
      mergeDoubles: false,
    },
    parts: { full: [], first: entries("ael", "cal"), middle: [], last: entries("wen", "dor") },
  };

  it("logs a generated name with its seed, newest first", () => {
    const log = makeLog();
    log.roll("1d6", 1);
    const r = log.generateName(generator, 7);
    if (!r.ok) throw new Error(r.message);
    expect(r.entry).toMatchObject({ kind: "name", seed: 7, locked: [], savedItemId: null, label: null });
    expect(r.entry.text).toMatch(/^Name → (Ael|Cal)(wen|dor)$/);
    expect(r.entry.name).toMatch(/^(Ael|Cal)(wen|dor)$/);
    expect(r.entry.picks.map((p) => p.part)).toEqual(["first", "last"]);
    expect(log.entries()[0]).toBe(r.entry);
    expect(log.entries("name")).toEqual([r.entry]);
    expect(log.entries("dice")).toHaveLength(1);
  });

  it("calls the result by the setup's name when it has one", () => {
    const r = makeLog().generateName(generator, 3, "Elven name");
    if (!r.ok) throw new Error(r.message);
    expect(r.entry.label).toBe("Elven name");
    expect(r.entry.text.startsWith("Elven name → ")).toBe(true);
  });

  it("is reproducible from its seed", () => {
    const a = makeLog().generateName(generator, 42);
    const b = makeLog().generateName(generator, 42);
    if (!a.ok || !b.ok) throw new Error("should generate");
    expect(a.entry.name).toBe(b.entry.name);
  });

  it("logs nothing and says why when a list is empty", () => {
    const log = makeLog();
    const r = log.generateName({ ...generator, parts: { ...generator.parts, last: [] } }, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/suffix/i);
    expect(log.entries()).toEqual([]);
  });

  it("locks and unlocks a part by its place in the name", () => {
    const log = makeLog();
    const r = log.generateName(generator, 1);
    if (!r.ok) throw new Error(r.message);
    log.toggleLock(r.entry.id, 1);
    expect(log.entries("name")[0].locked).toEqual(["last"]);
    log.toggleLock(r.entry.id, 0);
    expect(log.entries("name")[0].locked).toEqual(["first", "last"]); // in the order of the parts
    log.toggleLock(r.entry.id, 1);
    expect(log.entries("name")[0].locked).toEqual(["first"]);
    log.toggleLock(r.entry.id, 5); // no such part
    log.toggleLock(r.entry.id, -1);
    expect(log.entries("name")[0].locked).toEqual(["first"]);
  });

  it("rerolls the parts that aren't locked as a new entry, from the same lists", () => {
    const log = makeLog();
    const first = log.generateName(generator, 3, "Elven name");
    if (!first.ok) throw new Error(first.message);
    log.toggleLock(first.entry.id, 0);

    // Many rerolls: the locked first part never changes, and the name always uses the entry's own lists.
    let again = first.entry;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const next = log.rerollName(first.entry.id, seed);
      if (!next) throw new Error("should reroll");
      expect(next.picks[0]).toEqual(first.entry.picks[0]);
      expect(next.locked).toEqual(["first"]);
      expect(next.label).toBe("Elven name");
      expect(next.seed).toBe(seed);
      expect(next.id).not.toBe(first.entry.id);
      seen.add(next.picks[1].text);
      again = next;
    }
    expect(seen).toEqual(new Set(["wen", "dor"]));
    expect(log.entries()[0]).toBe(again);
    expect(log.entries("name")).toHaveLength(31);
  });

  it("rerolls everything when nothing is locked", () => {
    const log = makeLog();
    const first = log.generateName(generator, 1);
    if (!first.ok) throw new Error(first.message);
    const names = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) names.add(log.rerollName(first.entry.id, seed)!.name);
    expect(names.size).toBe(4);
  });

  it("returns null when asked to reroll something that isn't a name", () => {
    const log = makeLog();
    const d = log.roll("1d6", 1);
    if (!d.ok) throw new Error("should parse");
    expect(log.rerollName(d.entry.id)).toBeNull();
    expect(log.rerollName("nope")).toBeNull();
  });
});
