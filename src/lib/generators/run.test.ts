import { describe, expect, it } from "vitest";
import { scripted } from "../dice/testing";
import type { EntitySource, RollableTable, TableWorld } from "../tables/roll";
import { emptyGenerator, newRow, type GeneratorDef } from "./generator";
import { generate, pickedEntries, rerollRows, rollRow, rowValue, setOverride } from "./run";

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

function def(...rows: { label: string; source: string; fallback?: string }[]): GeneratorDef {
  const g = emptyGenerator();
  for (const r of rows) g.rows.push({ ...newRow(g), label: r.label, source: r.source, fallback: r.fallback ?? "" });
  return g;
}

describe("rollRow", () => {
  it("rolls the row's text like a table entry", () => {
    const g = def({ label: "Name", source: "[Names] the [2d4]" });
    const w = world([table("Names", "Ann", "Bob")]);
    // entry pick (1 of 1) -> table slot pick (2 of 2 = Bob) -> dice (3 + 4)
    const row = rollRow(g.rows[0], w, scripted(1, 2, 3, 4));
    expect(row.roll?.text).toBe("Bob the 7");
    expect(rowValue(row)).toBe("Bob the 7");
    expect(row.usedFallback).toBe(false);
  });
  it("skips a row with nothing to roll", () => {
    const row = rollRow({ ...newRow(emptyGenerator()), source: "  " }, world([]), scripted());
    expect(row.roll).toBeNull();
    expect(row.message).toMatch(/Nothing to roll/);
    expect(rowValue(row)).toBe("");
  });
  it("rolls the fallback table when the slots found nothing", () => {
    const g = def({ label: "Friend", source: "[entity:Nobody]", fallback: "Plain names" });
    const w = world([table("Plain names", "Pat")]);
    const row = rollRow(g.rows[0], w, scripted(1, 1));
    expect(row.usedFallback).toBe(true);
    expect(row.roll?.text).toBe("Pat");
  });
  it("keeps the warning when there is no fallback, or the fallback table is missing", () => {
    for (const fallback of ["", "No such table"]) {
      const g = def({ label: "Friend", source: "[entity:Nobody]", fallback });
      const row = rollRow(g.rows[0], world([]), scripted(1));
      expect(row.usedFallback).toBe(false);
      expect(row.roll?.text).toBe("⚠ Nobody");
      expect(row.roll?.warnings).toHaveLength(1);
    }
  });
  it("does not use the fallback when the row worked", () => {
    const g = def({ label: "Friend", source: "[entity:Person]", fallback: "Plain names" });
    const row = rollRow(g.rows[0], world([table("Plain names", "Pat")]), scripted(1, 2));
    expect(row.roll?.text).toBe("Bob");
    expect(row.usedFallback).toBe(false);
  });
});

describe("generate and rerollRows", () => {
  const g = def({ label: "A", source: "[Names]" }, { label: "B", source: "[Names]" }, { label: "C", source: "[Names]" });
  const w = world([table("Names", "Ann", "Bob", "Cy", "Di")]);

  it("rolls every row, the same every time for one seed", () => {
    const one = generate(g, w, 42);
    const two = generate(g, w, 42);
    expect(one.rows.map(rowValue)).toEqual(two.rows.map(rowValue));
    expect(one.rows).toHaveLength(3);
    expect(one.seed).toBe(42);
  });
  it("rerolls only the rows that are not kept, and leaves kept rows untouched", () => {
    const first = generate(g, w, 1);
    const typed = setOverride(first, g.rows[1].id, "Typed");
    let changed = false;
    for (let seed = 2; seed < 40 && !changed; seed++) {
      const next = rerollRows(g, typed, new Set([g.rows[0].id, g.rows[1].id]), w, seed);
      expect(rowValue(next.rows[0])).toBe(rowValue(first.rows[0]));
      expect(rowValue(next.rows[1])).toBe("Typed");
      if (rowValue(next.rows[2]) !== rowValue(first.rows[2])) changed = true;
    }
    expect(changed).toBe(true);
  });
  it("rolls rows that were added since, even if the run is older", () => {
    const first = generate(g, w, 1);
    const bigger = { ...g, rows: [...g.rows, { ...newRow(g), label: "D", source: "[Names]" }] };
    const next = rerollRows(bigger, first, new Set(g.rows.map((r) => r.id)), w, 5);
    expect(next.rows).toHaveLength(4);
    expect(rowValue(next.rows[3])).not.toBe("");
  });
  it("drops a row's typed value with null, and reports the entries picked", () => {
    const run = generate(g, w, 1);
    const typed = setOverride(run, g.rows[0].id, "X");
    expect(rowValue(typed.rows[0])).toBe("X");
    expect(rowValue(setOverride(typed, g.rows[0].id, null).rows[0])).toBe(rowValue(run.rows[0]));
    // each row picks from "Names"; the synthetic row table is not reported
    expect(pickedEntries(run).every((p) => p.tableId === "names")).toBe(true);
    expect(pickedEntries(run)).toHaveLength(3);
  });
});
