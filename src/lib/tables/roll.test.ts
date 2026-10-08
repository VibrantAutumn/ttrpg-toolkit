import { describe, expect, it } from "vitest";
import { createRng } from "../dice/rng";
import { scripted } from "../dice/testing";
import { MAX_DEPTH, MAX_EVALUATIONS, rerollTable, rollTable } from "./roll";
import type { RollableDeck, RollableEntry, RollableTable, SlotOutcome, TableRoll, TableWorld } from "./roll";

const entry = (id: string, text: string, weight = 1): RollableEntry => ({ id, text, weight });

/** A table whose id is its lowercase name. */
const table = (name: string, entries: RollableEntry[], avoidRecent = 0): RollableTable => ({
  id: name.toLowerCase(),
  name,
  entries,
  avoidRecent,
});

/** Plain entries "a", "b"... with ids equal to their text. */
const plain = (...texts: string[]): RollableEntry[] => texts.map((t) => entry(t, t));

function world(
  tables: RollableTable[],
  decks: RollableDeck[] = [],
  recent: Record<string, string[]> = {},
): TableWorld {
  return {
    findTable: (name) => tables.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null,
    findDeck: (name) => decks.find((d) => d.name.toLowerCase() === name.toLowerCase()) ?? null,
    recent: (tableId) => recent[tableId] ?? [],
  };
}

/** Roll and expect success. */
function roll(w: TableWorld, name: string, rng: Parameters<typeof rollTable>[2]): TableRoll {
  const t = w.findTable(name);
  if (!t) throw new Error(`no table ${name}`);
  const result = rollTable(t, w, rng);
  if (!result.ok) throw new Error(`rolling ${name} failed: ${result.message}`);
  return result.roll;
}

/** The outcome of the slot at part index `i`. */
function outcomeAt(r: TableRoll, i: number): SlotOutcome {
  const part = r.parts[i];
  if (part.kind !== "slot") throw new Error(`part ${i} is text`);
  return part.outcome;
}

describe("rollTable: picking an entry", () => {
  const w = world([table("T", [entry("a", "A", 1), entry("b", "B", 1), entry("c", "C", 2)])]);

  it("picks by weight: the roll walks along the entries in order", () => {
    expect(roll(w, "T", scripted(1)).text).toBe("A");
    expect(roll(w, "T", scripted(2)).text).toBe("B");
    expect(roll(w, "T", scripted(3)).text).toBe("C");
    expect(roll(w, "T", scripted(4)).text).toBe("C");
  });

  it("asks the random source for a number from 1 to the total weight", () => {
    // scripted() fails if a value is outside the asked range, so 4 passing above and 5 failing proves the range.
    expect(() => roll(w, "T", scripted(5))).toThrow(/outside the asked range/);
  });

  it("reports the table, the entry and the entry's own text", () => {
    const r = roll(w, "T", scripted(2));
    expect(r).toMatchObject({ tableId: "t", tableName: "T", entryId: "b", entryText: "B", text: "B" });
  });

  it("never picks an entry with weight 0", () => {
    const w0 = world([table("T", [entry("a", "A", 0), entry("b", "B", 1)])]);
    expect(roll(w0, "T", scripted(1)).text).toBe("B");
  });

  it("refuses a table with nothing that can be picked", () => {
    const empty = table("T", []);
    const result = rollTable(empty, world([empty]), scripted(1));
    expect(result).toMatchObject({ ok: false });
    const zero = table("Z", [entry("a", "A", 0)]);
    expect(rollTable(zero, world([zero]), scripted(1))).toMatchObject({ ok: false });
  });

  it("is reproducible from a seed", () => {
    const big = world([table("T", plain("a", "b", "c", "d", "e", "f"))]);
    expect(roll(big, "T", createRng(42)).text).toBe(roll(big, "T", createRng(42)).text);
  });

  it("keeps newlines and spacing in entry text", () => {
    const wn = world([table("T", [entry("a", "line one\n  line two")])]);
    expect(roll(wn, "T", scripted(1)).text).toBe("line one\n  line two");
  });
});

describe("rollTable: dice slots", () => {
  it("rolls dice after the entry is picked and writes the total", () => {
    const w = world([table("T", [entry("a", "[2d4] goblins")])]);
    const r = roll(w, "T", scripted(1, 3, 2));
    expect(r.text).toBe("5 goblins");
    const outcome = outcomeAt(r, 0);
    expect(outcome.type).toBe("dice");
    if (outcome.type === "dice") expect(outcome.result.total).toBe(5);
  });

  it("rolls several slots left to right", () => {
    const w = world([table("T", [entry("a", "[1d6] and [1d6]")])]);
    expect(roll(w, "T", scripted(1, 4, 2)).text).toBe("4 and 2");
  });
});

describe("rollTable: table slots and nesting", () => {
  it("rolls another table, found by name ignoring case", () => {
    const w = world([table("Outer", [entry("o", "Seen: [inner]")]), table("Inner", plain("x", "y"))]);
    expect(roll(w, "Outer", scripted(1, 2)).text).toBe("Seen: y");
  });

  it("records what the nested table picked", () => {
    const w = world([table("Outer", [entry("o", "[Inner]")]), table("Inner", plain("x", "y"))]);
    const outcome = outcomeAt(roll(w, "Outer", scripted(1, 2)), 0);
    expect(outcome).toMatchObject({ type: "table", tableName: "Inner" });
    if (outcome.type === "table") {
      expect(outcome.picks).toHaveLength(1);
      expect(outcome.picks[0]).toMatchObject({ entryId: "y", text: "y" });
    }
  });

  it("nests more than one level", () => {
    const w = world([
      table("A", [entry("a", "a>[B]")]),
      table("B", [entry("b", "b>[C]")]),
      table("C", [entry("c", "c")]),
    ]);
    expect(roll(w, "A", scripted(1, 1, 1)).text).toBe("a>b>c");
  });

  it("a count rolls several times and may repeat", () => {
    const w = world([table("T", [entry("t", "[3 X]")]), table("X", plain("a", "b"))]);
    expect(roll(w, "T", scripted(1, 1, 1, 2)).text).toBe("a, a, b");
  });

  it("unique picks never repeat inside one slot, using the weights that remain", () => {
    const w = world([table("T", [entry("t", "[3 unique X]")]), table("X", plain("a", "b", "c", "d"))]);
    expect(roll(w, "T", scripted(1, 2, 2, 2)).text).toBe("b, c, d");
  });

  it("gives as many unique picks as exist and says so", () => {
    const w = world([table("T", [entry("t", "[5 unique X]")]), table("X", plain("a", "b"))]);
    const r = roll(w, "T", scripted(1, 2, 1));
    expect(r.text).toBe("b, a");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/unique/i);
  });

  it("shows a warning in place of a table that can't be found, and carries on", () => {
    const w = world([table("T", [entry("t", "Hear [Rumors] now")])]);
    const r = roll(w, "T", scripted(1));
    expect(r.text).toContain("⚠ Rumors");
    expect(r.text.startsWith("Hear ")).toBe(true);
    expect(r.text.endsWith(" now")).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(outcomeAt(r, 1)).toMatchObject({ type: "missing", name: "Rumors" });
  });

  it("shows a warning for a nested table that has nothing to pick", () => {
    const w = world([table("T", [entry("t", "[Empty]")]), table("Empty", [])]);
    const r = roll(w, "T", scripted(1));
    expect(r.text).toContain("⚠ Empty");
    expect(r.warnings).toHaveLength(1);
  });

  it("stops a table that contains itself instead of looping forever", () => {
    const w = world([table("Loop", [entry("l", "[Loop]")])]);
    const r = roll(w, "Loop", createRng(1));
    expect(r.text).toContain("⚠");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it(`allows nesting ${MAX_DEPTH} levels deep but not more`, () => {
    const chain = (levels: number) => {
      const tables: RollableTable[] = [];
      for (let i = 0; i <= levels; i++) {
        tables.push(table(`C${i}`, [entry(`c${i}`, i === levels ? "end" : `[C${i + 1}]`)]));
      }
      return world(tables);
    };
    const ok = roll(chain(MAX_DEPTH), "C0", createRng(1));
    expect(ok.text).toBe("end");
    expect(ok.warnings).toEqual([]);
    const tooDeep = roll(chain(MAX_DEPTH + 1), "C0", createRng(1));
    expect(tooDeep.text).toContain("⚠");
    expect(tooDeep.warnings.length).toBeGreaterThan(0);
  });

  it("stops a roll that explodes into too many rolls, without hanging", () => {
    const thirty = (next: string) => entry(next, Array(30).fill(`[${next}]`).join(""));
    const w = world([
      table("A", [thirty("B")]),
      table("B", [thirty("C")]),
      table("C", [thirty("D")]),
      table("D", [entry("d", "x")]),
    ]);
    const r = roll(w, "A", createRng(1));
    expect(r.warnings.some((m) => /too many/i.test(m))).toBe(true);
    expect(MAX_EVALUATIONS).toBeGreaterThan(0);
  });
});

describe("rollTable: card draws", () => {
  const tarot: RollableDeck = {
    id: "tarot",
    name: "Tarot",
    cards: [
      { id: "fool", name: "The Fool" },
      { id: "mage", name: "The Mage" },
      { id: "star", name: "The Star" },
    ],
  };
  const w = world([table("T", [entry("t", "[draw 2 from Tarot]")])], [tarot]);

  it("draws cards, with reversals, in the order drawCards uses", () => {
    // entry pick; card 1: position 0, reversal roll 100 (not reversed); card 2: position 1 of the rest, roll 10 (reversed)
    const r = roll(w, "T", scripted(1, 0, 100, 1, 10));
    expect(r.text).toBe("The Fool, The Star (reversed)");
    const outcome = outcomeAt(r, 0);
    expect(outcome).toMatchObject({ type: "draw", sourceId: "tarot", sourceName: "Tarot" });
    if (outcome.type === "draw") expect(outcome.cards).toHaveLength(2);
  });

  it("shows a warning when the deck can't be found", () => {
    const none = world([table("T", [entry("t", "[draw 1 from Nowhere]")])]);
    const r = roll(none, "T", scripted(1));
    expect(r.text).toContain("⚠ Nowhere");
    expect(r.warnings).toHaveLength(1);
  });

  it("shows a warning when the deck has too few cards", () => {
    const few = world([table("T", [entry("t", "[draw 5 from Tarot]")])], [tarot]);
    const r = roll(few, "T", scripted(1));
    expect(r.text).toContain("⚠");
    expect(r.warnings).toHaveLength(1);
  });
});

describe("rollTable: labels and references", () => {
  const people = table("Person", plain("Ann", "Bob"));

  it("reuses a labelled result without rolling again", () => {
    const w = world([table("T", [entry("t", "[Person as A] meets [A]")]), people]);
    expect(roll(w, "T", scripted(1, 2)).text).toBe("Bob meets Bob");
  });

  it("joins several results of a labelled slot", () => {
    const w = world([table("T", [entry("t", "[2 unique Person as A] / [A]")]), people]);
    expect(roll(w, "T", scripted(1, 2, 1)).text).toBe("Bob, Ann / Bob, Ann");
  });

  it("reuses a dice total", () => {
    const w = world([table("T", [entry("t", "[2d4 as N] and [N]")])]);
    expect(roll(w, "T", scripted(1, 3, 2)).text).toBe("5 and 5");
  });

  it("a field reference shows a warning until fields exist", () => {
    const w = world([table("T", [entry("t", "[Person as A] of [A.Faction]")]), people]);
    const r = roll(w, "T", scripted(1, 1));
    expect(r.text).toContain("A.Faction");
    expect(r.text.startsWith("Ann of ")).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it("labels belong to one entry: a nested entry can't see the outer label", () => {
    const w = world([
      table("T", [entry("t", "[Person as A] [Inner]")]),
      table("Inner", [entry("i", "[A]")]),
      people,
    ]);
    // Inside Inner, [A] is a table name, and there is no table A.
    const r = roll(w, "T", scripted(1, 1, 1));
    expect(r.text).toContain("⚠ A");
  });
});

describe("rollTable: unknown slots and bad entries", () => {
  it("shows a warning for a slot type this version doesn't know", () => {
    const w = world([table("T", [entry("t", "Meet [entity:Person]")])]);
    const r = roll(w, "T", scripted(1));
    expect(r.text).toContain("entity:Person");
    expect(r.warnings).toHaveLength(1);
    expect(outcomeAt(r, 1)).toMatchObject({ type: "unknown" });
  });

  it("shows an entry that doesn't parse as plain text, with a warning", () => {
    const w = world([table("T", [entry("t", "oops [Rumors")])]);
    const r = roll(w, "T", scripted(1));
    expect(r.text).toBe("oops [Rumors");
    expect(r.warnings).toHaveLength(1);
  });
});

describe("rollTable: avoiding recent results", () => {
  it("skips the last N entries rolled from the table", () => {
    const w = world([table("T", plain("a", "b", "c"), 2)], [], { t: ["a", "b"] });
    expect(roll(w, "T", scripted(1)).text).toBe("c");
  });

  it("looks only at the most recent N of the list (newest first)", () => {
    const w = world([table("T", plain("a", "b", "c"), 1)], [], { t: ["a", "b", "c"] });
    expect(roll(w, "T", scripted(1)).text).toBe("b");
    expect(roll(w, "T", scripted(2)).text).toBe("c");
  });

  it("does nothing when the setting is 0", () => {
    const w = world([table("T", plain("a", "b"), 0)], [], { t: ["a"] });
    expect(roll(w, "T", scripted(1)).text).toBe("a");
  });

  it("relaxes the rule when every entry is recent, and says so", () => {
    const w = world([table("T", plain("a", "b"), 3)], [], { t: ["a", "b"] });
    const r = roll(w, "T", scripted(2));
    expect(r.text).toBe("b");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/recent/i);
  });

  it("counts picks made earlier in the same roll, nested tables included", () => {
    const w = world([table("T", [entry("t", "[X] [X]")]), table("X", plain("a", "b"), 1)]);
    expect(roll(w, "T", scripted(1, 1, 1)).text).toBe("a b");
  });

  it("an entry with weight 0 doesn't count as available when deciding to relax", () => {
    const w = world([table("T", [entry("a", "A"), entry("b", "B", 0)], 1)], [], { t: ["a"] });
    const r = roll(w, "T", scripted(1));
    expect(r.text).toBe("A");
    expect(r.warnings).toHaveLength(1);
  });
});

describe("rollTable: what was picked", () => {
  it("lists every pick in order, outer table first, so the caller can remember them", () => {
    const w = world([table("T", [entry("t", "[X] [X]")]), table("X", plain("a", "b"), 1)]);
    const r = roll(w, "T", scripted(1, 1, 1));
    expect(r.picked).toEqual([
      { tableId: "t", entryId: "t" },
      { tableId: "x", entryId: "a" },
      { tableId: "x", entryId: "b" },
    ]);
  });
});

describe("rerollTable", () => {
  const people = table("Person", plain("Ann", "Bob", "Cy"));
  const w = world([table("T", [entry("t", "[Person] met [Person]")]), people]);

  it("rerolls the slots that aren't locked and keeps the entry", () => {
    const first = roll(w, "T", scripted(1, 1, 3));
    expect(first.text).toBe("Ann met Cy");
    const result = rerollTable(first, new Set([0]), w, scripted(2));
    if (!result.ok) throw new Error(result.message);
    expect(result.roll.text).toBe("Ann met Bob");
    expect(result.roll.entryId).toBe("t");
  });

  it("rerolls every slot when none is locked", () => {
    const first = roll(w, "T", scripted(1, 1, 3));
    const result = rerollTable(first, new Set(), w, scripted(2, 2));
    if (!result.ok) throw new Error(result.message);
    expect(result.roll.text).toBe("Bob met Bob");
  });

  it("ignores locks on parts that are plain text", () => {
    const first = roll(w, "T", scripted(1, 1, 3));
    const result = rerollTable(first, new Set([1]), w, scripted(2, 2));
    if (!result.ok) throw new Error(result.message);
    expect(result.roll.text).toBe("Bob met Bob");
  });

  it("keeps a locked slot exactly, including its dice", () => {
    const wd = world([table("T", [entry("t", "[2d6] and [1d6]")])]);
    const first = roll(wd, "T", scripted(1, 3, 4, 5));
    expect(first.text).toBe("7 and 5");
    const result = rerollTable(first, new Set([0]), wd, scripted(2));
    if (!result.ok) throw new Error(result.message);
    expect(result.roll.text).toBe("7 and 2");
  });

  it("makes references follow their label, whether it was rerolled or locked", () => {
    const wl = world([table("T", [entry("t", "[Person as A] is [A]")]), people]);
    const first = roll(wl, "T", scripted(1, 1));
    expect(first.text).toBe("Ann is Ann");
    const rerolled = rerollTable(first, new Set(), wl, scripted(2));
    if (!rerolled.ok) throw new Error(rerolled.message);
    expect(rerolled.roll.text).toBe("Bob is Bob");
    const locked = rerollTable(first, new Set([0]), wl, scripted());
    if (!locked.ok) throw new Error(locked.message);
    expect(locked.roll.text).toBe("Ann is Ann");
  });

  it("lists only the picks made by the reroll", () => {
    const first = roll(w, "T", scripted(1, 1, 3));
    const result = rerollTable(first, new Set([0]), w, scripted(2));
    if (!result.ok) throw new Error(result.message);
    expect(result.roll.picked).toEqual([{ tableId: "person", entryId: "Bob" }]);
  });

  it("still works if the table or its entry was changed or deleted since", () => {
    const first = roll(w, "T", scripted(1, 1, 3));
    const later = world([people]); // table T is gone
    const result = rerollTable(first, new Set([0]), later, scripted(2));
    if (!result.ok) throw new Error(result.message);
    expect(result.roll.text).toBe("Ann met Bob");
  });

  it("can be rerolled again and again", () => {
    const first = roll(w, "T", scripted(1, 1, 3));
    const second = rerollTable(first, new Set([0]), w, scripted(2));
    if (!second.ok) throw new Error(second.message);
    const third = rerollTable(second.roll, new Set([0]), w, scripted(3));
    if (!third.ok) throw new Error(third.message);
    expect(third.roll.text).toBe("Ann met Cy");
  });
});
