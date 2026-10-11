import { describe, expect, it } from "vitest";
import type { EntitySource, RollableTable, TableWorld } from "../tables/roll";
import { outputPage } from "./document";
import { GENERATOR_VERSION, type GeneratorDef } from "./generator";
import { generate, lockableSlots, pickedDocuments, pickedEntries, reroll } from "./run";

const table = (name: string, ...texts: string[]): RollableTable => ({
  id: name.toLowerCase(),
  name,
  avoidRecent: 0,
  entries: texts.map((text, i) => ({ id: `${name}${i}`, text, weight: 1 })),
});

const people: EntitySource = { name: "Person", kind: "collection", items: [{ id: "ann", name: "Ann" }, { id: "bob", name: "Bob" }] };

function world(tables: RollableTable[], sources: EntitySource[] = [people]): TableWorld {
  return {
    findTable: (name) => tables.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null,
    findDeck: () => null,
    recent: () => [],
    findEntities: (name) => sources.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null,
  };
}

const def = (text: string): GeneratorDef => ({ version: GENERATOR_VERSION, text });

describe("generate", () => {
  it("fills every slot of the text, like a table entry", () => {
    const w = world([table("Faction", "The Harpers", "The Zhentarim")]);
    // the entry (1 of 1), the faction (1 of 2 = Harpers), then 2d4 = 3 + 3
    const r = generate(def("[Faction] sends [2d4] agents to attack the party."), "Raid", w, 1);
    // scripted rng isn't used by generate (it seeds its own), so only check the shape here
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.run.roll.text).toMatch(/^The (Harpers|Zhentarim) sends \d+ agents to attack the party\.$/);
    expect(r.run.seed).toBe(1);
  });

  it("gives the same output for the same seed while the tables are unchanged", () => {
    const w = world([table("Faction", "A", "B", "C", "D")]);
    const a = generate(def("[Faction] and [Faction] and [3d6]"), "G", w, 42);
    const b = generate(def("[Faction] and [Faction] and [3d6]"), "G", w, 42);
    expect(a.ok && b.ok && a.run.roll.text === b.run.roll.text).toBe(true);
  });

  it("says plainly when there is nothing to roll yet", () => {
    expect(generate(def("  "), "G", world([]), 1)).toEqual({ ok: false, message: "Write something to roll first." });
  });

  it("shows a warning for a slot that can't be rolled instead of failing", () => {
    const r = generate(def("Sent by [Nobody]"), "G", world([]), 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.run.roll.warnings.length).toBeGreaterThan(0);
  });
});

describe("reroll", () => {
  it("keeps locked slots and rolls the rest again", () => {
    const w = world([table("Faction", "A", "B", "C", "D", "E", "F")]);
    const first = generate(def("[Faction] / [Faction]"), "G", w, 5);
    if (!first.ok) throw new Error(first.message);
    const slots = lockableSlots(first.run);
    expect(slots.map((s) => s.index)).toHaveLength(2);
    const [left] = first.run.roll.text.split(" / ");
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const next = reroll(first.run, new Set([slots[0].index]), w, seed);
      if (!next.ok) throw new Error(next.message);
      const parts = next.run.roll.text.split(" / ");
      expect(parts[0]).toBe(left);
      seen.add(parts[1]);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("what a run picked", () => {
  it("lists documents picked by entity slots, and leaves the generator's own text out of the recent entries", () => {
    const w = world([table("Faction", "Harpers")]);
    const r = generate(def("[Faction] hired [entity:Person]"), "G", w, 3);
    if (!r.ok) throw new Error(r.message);
    const docs = pickedDocuments(r.run);
    expect(docs).toHaveLength(1);
    expect(["ann", "bob"]).toContain(docs[0].id);
    const entries = pickedEntries(r.run);
    expect(entries.every((e) => !e.tableId.startsWith("generator:"))).toBe(true);
    expect(entries.some((e) => e.tableId === "faction")).toBe(true);
  });
});

describe("outputPage", () => {
  it("writes the output as a page, with a mention wherever a document was picked", () => {
    const w = world([table("Faction", "The Harpers")]);
    const r = generate(def("[Faction] hired [entity:Person].\nSecond line."), "Hire", w, 2);
    if (!r.ok) throw new Error(r.message);
    const page = outputPage(r.run, "Hire");
    const picked = pickedDocuments(r.run)[0];
    expect(page.mentions).toEqual([picked.id]);
    expect(page.markdown).toContain(`(item:${picked.id})`);
    expect(page.markdown).toContain("Second line.");
    expect(page.name.startsWith("The Harpers hired")).toBe(true);
  });

  it("names the page after a long output by cutting it short", () => {
    const w = world([]);
    const r = generate(def("word ".repeat(40)), "Long", w, 1);
    if (!r.ok) throw new Error(r.message);
    expect(outputPage(r.run, "Long").name.length).toBeLessThanOrEqual(60);
  });
});

describe("a table entry that links a page", () => {
  it("gives the same page every time, so the generator's output links to it", () => {
    const id = "3f1c2a9e-5b7d-4e8a-9c01-2d4f6a8b0c1e";
    const w = world([table("Allies", `[link:${id} Syra Pyroc]`)]);
    const r = generate(def("[Allies] sends [2d4] agents."), "Raid", w, 4);
    if (!r.ok) throw new Error(r.message);
    expect(r.run.roll.text).toMatch(/^Syra Pyroc sends \d+ agents\.$/);
    expect(pickedDocuments(r.run)).toEqual([{ id, name: "Syra Pyroc" }]);
    const page = outputPage(r.run, "Raid");
    expect(page.mentions).toEqual([id]);
    expect(page.markdown).toContain(`[Syra Pyroc](item:${id})`);
  });
});

describe("a linked page that was renamed", () => {
  const id = "3f1c2a9e-5b7d-4e8a-9c01-2d4f6a8b0c1e";
  it("is rolled, shown and linked by its current name", () => {
    const base = world([table("Allies", `[link:${id} Syra Pyroc]`)]);
    const w: TableWorld = { ...base, itemName: (i) => (i === id ? "Syra Pyroc-Vale" : undefined) };
    const r = generate(def("[Allies] attacks"), "Raid", w, 1);
    if (!r.ok) throw new Error(r.message);
    expect(r.run.roll.text).toBe("Syra Pyroc-Vale attacks");
    expect(pickedDocuments(r.run)).toEqual([{ id, name: "Syra Pyroc-Vale" }]);
    expect(outputPage(r.run, "Raid").markdown).toContain(`[Syra Pyroc-Vale](item:${id})`);
  });
  it("keeps the name it was linked with when the page's name isn't known", () => {
    const w: TableWorld = { ...world([table("Allies", `[link:${id} Syra Pyroc]`)]), itemName: () => undefined };
    const r = generate(def("[Allies]"), "Raid", w, 1);
    expect(r.ok && r.run.roll.text).toBe("Syra Pyroc");
  });
});
