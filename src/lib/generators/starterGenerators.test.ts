import { describe, expect, it } from "vitest";
import { STARTER_GENERATORS } from "../../starter/generators";
import { STARTER_TABLES } from "../../starter/tables";
import { parseEntry } from "../tables/parse";
import { buildWorld } from "../tables/world";
import { checkGenerator, normalizeGenerator } from "./generator";
import { generate } from "./run";
import { toDefinition } from "./starterGenerators";

const key = (s: string) => s.trim().toLowerCase();
const tables = STARTER_TABLES.flatMap((s) => s.tables);

describe("every starter generator", () => {
  it("has unique names and descriptions", () => {
    const names = STARTER_GENERATORS.map((g) => key(g.name));
    expect(new Set(names).size).toBe(names.length);
    for (const g of STARTER_GENERATORS) expect(g.description.trim()).not.toBe("");
  });

  for (const starter of STARTER_GENERATORS) {
    describe(starter.name, () => {
      const def = toDefinition(starter);

      it("becomes a generator the reader accepts, unchanged", () => {
        const read = normalizeGenerator(JSON.parse(JSON.stringify(def)));
        expect(read.ok && read.def).toEqual(def);
        expect(checkGenerator(def)).toBeNull();
      });

      it("rolls only starter tables", () => {
        const known = new Set(tables.map((t) => key(t.name)));
        const parsed = parseEntry(def.text);
        if (!parsed.ok) throw new Error(parsed.error.message);
        for (const part of parsed.parts) {
          if (part.kind === "slot" && part.slot.type === "table") expect(known.has(key(part.slot.name)), part.slot.name).toBe(true);
        }
      });

      it("rolls 200 times against the starter tables, with documents missing or not", () => {
        const world = buildWorld(
          tables.map((t, i) => ({ id: `t${i}`, name: t.name, avoidRecent: 0, recent: [], entries: t.entries.map((e, j) => ({ id: `e${i}-${j}`, text: e.text, weight: e.weight ?? 1 })) })),
          [],
          { sources: [], fields: [] },
        );
        for (let seed = 1; seed <= 200; seed++) {
          const result = generate(def, starter.name, world, seed);
          if (!result.ok) throw new Error(result.message);
          expect(result.run.roll.text.trim(), `seed ${seed}`).not.toBe("");
        }
      });
    });
  }
});
