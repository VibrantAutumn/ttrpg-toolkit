import { describe, expect, it } from "vitest";
import { STARTER_GENERATORS } from "../../starter/generators";
import { STARTER_TABLES } from "../../starter/tables";
import { createRng } from "../dice/rng";
import { parseEntry } from "../tables/parse";
import { buildWorld } from "../tables/world";
import { checkRow, normalizeGenerator } from "./generator";
import { generate, rowValue } from "./run";
import { toDefinition, type Lookup } from "./starterGenerators";

const key = (s: string) => s.trim().toLowerCase();
const tables = STARTER_TABLES.flatMap((s) => s.tables);

const lookup: Lookup = {
  templateIdByName: (n) => (n === "NPC" ? "template-npc" : null),
  fieldIdByName: (n) => (n === "Role" ? "field-role" : null),
};

describe("every starter generator", () => {
  it("has unique names and descriptions", () => {
    const names = STARTER_GENERATORS.map((g) => key(g.name));
    expect(new Set(names).size).toBe(names.length);
    for (const g of STARTER_GENERATORS) expect(g.description.trim()).not.toBe("");
  });

  for (const starter of STARTER_GENERATORS) {
    describe(starter.name, () => {
      const def = toDefinition(starter, lookup);

      it("becomes a generator the reader accepts, unchanged", () => {
        const read = normalizeGenerator(JSON.parse(JSON.stringify(def)));
        expect(read.ok && read.def).toEqual(def);
        expect(def.rows.length).toBeGreaterThan(0);
        expect(def.rows.some((r) => r.target.kind === "name")).toBe(true);
      });

      it("has labelled rows whose rolls parse", () => {
        for (const row of def.rows) {
          expect(row.label.trim(), starter.name).not.toBe("");
          expect(checkRow(row), row.label).toBeNull();
        }
      });

      it("rolls only starter tables, and every fallback is one too", () => {
        const known = new Set(tables.map((t) => key(t.name)));
        for (const row of def.rows) {
          const parsed = parseEntry(row.source);
          if (!parsed.ok) throw new Error(parsed.error.message);
          for (const part of parsed.parts) {
            if (part.kind === "slot" && part.slot.type === "table") expect(known.has(key(part.slot.name)), `${row.label}: ${part.slot.name}`).toBe(true);
          }
          if (row.fallback) expect(known.has(key(row.fallback)), `${row.label} fallback`).toBe(true);
        }
      });

      it("rolls 200 times against the starter tables with no document to pick, without a warning left over", () => {
        const world = buildWorld(
          tables.map((t, i) => ({ id: `t${i}`, name: t.name, avoidRecent: 0, recent: [], entries: t.entries.map((e, j) => ({ id: `e${i}-${j}`, text: e.text, weight: e.weight ?? 1 })) })),
          [],
          { sources: [], fields: [] },
        );
        for (let seed = 1; seed <= 200; seed++) {
          const run = generate(def, world, seed);
          for (const row of run.rows) {
            expect(row.roll, `${row.label} seed ${seed}`).not.toBeNull();
            if (row.roll && !row.usedFallback) expect(row.roll.warnings, `${row.label} seed ${seed}`).toEqual([]);
            expect(rowValue(row).trim(), `${row.label} seed ${seed}`).not.toBe("");
            expect(rowValue(row)).not.toContain("⚠");
          }
        }
        void createRng;
      });
    });
  }

  it("leaves out a template or field the campaign doesn't have", () => {
    const none = toDefinition({ name: "X", description: "d", templateName: "Missing", rows: [{ label: "R", target: { kind: "field", fieldName: "Nope" }, source: "x" }] }, lookup);
    expect(none.templateId).toBeNull();
    expect(none.rows[0].target).toEqual({ kind: "text" });
    const found = toDefinition({ name: "X", description: "d", templateName: "NPC", rows: [{ label: "R", target: { kind: "field", fieldName: "Role" }, source: "x" }] }, lookup);
    expect(found.templateId).toBe("template-npc");
    expect(found.rows[0].target).toEqual({ kind: "field", fieldId: "field-role" });
  });
});
