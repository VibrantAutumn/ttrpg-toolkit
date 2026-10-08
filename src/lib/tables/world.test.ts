import { describe, expect, it } from "vitest";
import { buildWorld, neededDeckNames } from "./world";
import type { RollableTableData } from "../../api/tables";

const data = (name: string, entries: string[], recent: string[] = [], avoidRecent = 0): RollableTableData => ({
  id: name.toLowerCase(),
  name,
  avoidRecent,
  entries: entries.map((text, i) => ({ id: `${name}-${i}`, text, weight: 1 })),
  recent,
});

describe("buildWorld", () => {
  const world = buildWorld(
    [data("Rumors", ["a"], ["Rumors-0"], 2), data("Names", ["n"])],
    [{ id: "tarot", name: "Tarot", cards: [{ id: "c1", name: "The Fool" }] }],
  );

  it("finds a table by name, ignoring case", () => {
    expect(world.findTable("rumors")).toMatchObject({ id: "rumors", name: "Rumors", avoidRecent: 2 });
    expect(world.findTable("  NAMES ")?.id).toBe("names");
    expect(world.findTable("Nowhere")).toBeNull();
  });

  it("gives a table's entries to the roller as they are", () => {
    expect(world.findTable("Rumors")?.entries).toEqual([{ id: "Rumors-0", text: "a", weight: 1 }]);
  });

  it("finds the first table when two share a name (the list is oldest first)", () => {
    const w = buildWorld([data("Same", ["old"]), { ...data("same", ["new"]), id: "other" }], []);
    expect(w.findTable("SAME")?.entries[0].text).toBe("old");
  });

  it("finds a deck, set or pool by name, ignoring case", () => {
    expect(world.findDeck("TAROT")?.cards).toHaveLength(1);
    expect(world.findDeck("Nowhere")).toBeNull();
  });

  it("remembers each table's recent picks, newest first, and has none for unknown tables", () => {
    expect(world.recent("rumors")).toEqual(["Rumors-0"]);
    expect(world.recent("names")).toEqual([]);
    expect(world.recent("nope")).toEqual([]);
  });
});

describe("neededDeckNames", () => {
  it("lists the decks named by draw slots in any entry, once each", () => {
    const tables = [
      data("A", ["[draw 1 from Tarot]", "plain", "[draw:2 from Omens]"]),
      data("B", ["x [draw 3 from tarot] y", "[Rumors]"]),
    ];
    expect(neededDeckNames(tables).sort()).toEqual(["Omens", "Tarot"]);
  });

  it("ignores entries that don't parse, and tables without draws", () => {
    expect(neededDeckNames([data("A", ["broken [draw 1 from Tarot", "[2d4]"])])).toEqual([]);
  });
});
