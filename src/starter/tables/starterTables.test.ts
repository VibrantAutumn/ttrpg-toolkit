import { describe, expect, it } from "vitest";
import { createRng } from "../../lib/dice/rng";
import { parseEntry } from "../../lib/tables/parse";
import { rollTable, type RollableTable } from "../../lib/tables/roll";
import type { TableStarterDef } from "../../lib/tables/starterTables";
import { buildWorld } from "../../lib/tables/world";
import { STARTER_TABLES } from ".";

// The limits the database enforces when a starter is installed (src-tauri/src/db/table_starters.rs).
const MAX_TABLES = 40;
const MAX_ENTRIES_PER_TABLE = 500;
const MAX_ENTRIES_TOTAL = 3_000;
const MAX_TAGS = 60;
const MAX_ENTRY_BYTES = 2_000;
const MAX_WEIGHT = 10_000;

const key = (text: string) => text.trim().toLowerCase();
const rollableOf = (def: TableStarterDef): RollableTable[] =>
  def.tables.map((t) => ({
    id: t.key,
    name: t.name,
    avoidRecent: t.avoidRecent ?? 0,
    entries: t.entries.map((e, i) => ({ id: `${t.key}-${i}`, text: e.text, weight: e.weight ?? 1 })),
  }));

describe("the starter tables as a whole", () => {
  it("has the four starters, with different ids and names", () => {
    expect(STARTER_TABLES.map((s) => s.id)).toEqual([
      "starter:fantasy-names",
      "starter:tavern-names",
      "starter:quirks-and-rumors",
      "starter:weather",
    ]);
    expect(new Set(STARTER_TABLES.map((s) => key(s.name))).size).toBe(STARTER_TABLES.length);
  });

  it("never makes two tables with the same name, so any starters can be added together", () => {
    const names = STARTER_TABLES.flatMap((s) => s.tables.map((t) => key(t.name)));
    expect(new Set(names).size).toBe(names.length);
  });
});

for (const def of STARTER_TABLES) {
  describe(`starter: ${def.name}`, () => {
    it("fits the installer's limits and has an id it accepts", () => {
      expect(def.id.startsWith("starter:")).toBe(true);
      expect(def.id.length).toBeLessThanOrEqual(64);
      expect(def.tables.length).toBeGreaterThan(0);
      expect(def.tables.length).toBeLessThanOrEqual(MAX_TABLES);
      expect(def.tags.length).toBeLessThanOrEqual(MAX_TAGS);
      expect(def.tables.reduce((n, t) => n + t.entries.length, 0)).toBeLessThanOrEqual(MAX_ENTRIES_TOTAL);
      expect(def.description.trim()).not.toBe("");
    });

    it("has unique keys, table names and tag names", () => {
      const unique = (values: string[]) => expect(new Set(values.map(key)).size).toBe(values.length);
      unique(def.tables.map((t) => t.key));
      unique(def.tables.map((t) => t.name));
      unique(def.tags.map((t) => t.name));
      for (const tag of def.tags) if (tag.color) expect(tag.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it("has sensible entries: not blank, trimmed, not repeated, with usable weights", () => {
      const tagNames = new Set(def.tags.map((t) => key(t.name)));
      for (const table of def.tables) {
        expect(table.entries.length, table.name).toBeGreaterThan(0);
        expect(table.entries.length, table.name).toBeLessThanOrEqual(MAX_ENTRIES_PER_TABLE);
        const seen = new Set<string>();
        for (const entry of table.entries) {
          const where = `${table.name}: ${entry.text}`;
          expect(entry.text.trim(), where).toBe(entry.text);
          expect(entry.text, where).not.toBe("");
          expect(new TextEncoder().encode(entry.text).length, where).toBeLessThanOrEqual(MAX_ENTRY_BYTES);
          expect(seen.has(key(entry.text)), `${where} is repeated`).toBe(false);
          seen.add(key(entry.text));
          const weight = entry.weight ?? 1;
          expect(Number.isInteger(weight) && weight >= 0 && weight <= MAX_WEIGHT, where).toBe(true);
          for (const tag of entry.tags ?? []) expect(tagNames.has(key(tag)), `${where} uses tag ${tag}`).toBe(true);
        }
        expect(table.entries.some((e) => (e.weight ?? 1) > 0), `${table.name} can be rolled`).toBe(true);
      }
    });

    it("has printed-die tables whose weights add up to the die", () => {
      for (const table of def.tables) {
        if (table.dieSize === undefined) continue;
        const total = table.entries.reduce((n, e) => n + (e.weight ?? 1), 0);
        expect(total, `${table.name} adds up to its d${table.dieSize}`).toBe(table.dieSize);
      }
    });

    it("only uses slots that read correctly and point at this starter's own tables", () => {
      const names = new Set(def.tables.map((t) => key(t.name)));
      for (const table of def.tables) {
        for (const entry of table.entries) {
          const parsed = parseEntry(entry.text);
          expect(parsed.ok, `${table.name}: ${entry.text}`).toBe(true);
          if (!parsed.ok) continue;
          for (const part of parsed.parts) {
            if (part.kind !== "slot") continue;
            const slot = part.slot;
            expect(["table", "dice", "ref"], `${entry.text}`).toContain(slot.type);
            if (slot.type === "table") {
              expect(names.has(key(slot.name)), `${entry.text} names the table “${slot.name}”`).toBe(true);
            }
          }
        }
      }
    });

    it("rolls every table hundreds of times with no warnings", () => {
      const tables = rollableOf(def);
      const world = buildWorld(
        tables.map((t) => ({ ...t, recent: [] })),
        [],
      );
      for (const table of tables) {
        for (let seed = 1; seed <= 300; seed++) {
          const result = rollTable(table, world, createRng(seed));
          if (!result.ok) throw new Error(`${table.name} (seed ${seed}): ${result.message}`);
          expect(result.roll.warnings, `${table.name} (seed ${seed})`).toEqual([]);
          expect(result.roll.text.trim(), `${table.name} (seed ${seed})`).not.toBe("");
          expect(result.roll.text).not.toContain("⚠");
        }
      }
    });
  });
}

describe("the fantasy names starter", () => {
  const def = STARTER_TABLES.find((s) => s.id === "starter:fantasy-names")!;

  it("gives every culture plenty of syllables to draw from", () => {
    for (const tag of def.tags) {
      for (const key of ["prefixes", "suffixes"]) {
        const table = def.tables.find((t) => t.key === key)!;
        expect(table.entries.filter((e) => e.tags?.includes(tag.name)).length, `${tag.name} ${key}`).toBeGreaterThanOrEqual(6);
      }
    }
  });
});

describe("the tavern names starter", () => {
  it("makes a tavern name from its table of patterns", () => {
    const def = STARTER_TABLES.find((s) => s.id === "starter:tavern-names")!;
    const tables = rollableOf(def);
    const world = buildWorld(tables.map((t) => ({ ...t, recent: [] })), []);
    const names = new Set<string>();
    const names_table = tables.find((t) => t.name === "Tavern names")!;
    for (let seed = 1; seed <= 100; seed++) {
      const r = rollTable(names_table, world, createRng(seed));
      if (r.ok) names.add(r.roll.text);
    }
    expect(names.size).toBeGreaterThan(30);
    expect([...names].every((n) => n.startsWith("The ") || n.includes("'s Rest"))).toBe(true);
  });
});
