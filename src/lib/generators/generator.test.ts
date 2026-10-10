import { describe, expect, it } from "vitest";
import {
  GENERATOR_LIMITS,
  checkRow,
  emptyGenerator,
  isRowComplete,
  newRow,
  newRowId,
  normalizeGenerator,
  parseGenerator,
  type GeneratorDef,
} from "./generator";

const def = (rows: unknown[] = [], extra: Record<string, unknown> = {}) => ({ version: 1, templateId: null, rows, ...extra });
const ok = (raw: unknown) => {
  const r = normalizeGenerator(raw);
  if (!r.ok) throw new Error(r.error);
  return r.def;
};
const error = (raw: unknown) => {
  const r = normalizeGenerator(raw);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("normalizeGenerator", () => {
  it("keeps a good generator as it is", () => {
    const good: GeneratorDef = {
      version: 1,
      templateId: "t1",
      rows: [
        { id: "r1", label: "Name", target: { kind: "name" }, source: "[Fantasy names]", fallback: "" },
        { id: "r2", label: "Race", target: { kind: "field", fieldId: "f1" }, source: "[Races]", fallback: "Plain races" },
        { id: "r3", label: "Quirk", target: { kind: "text" }, source: "[Quirks]", fallback: "" },
      ],
    };
    expect(ok(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(emptyGenerator()).toEqual(ok(emptyGenerator()));
  });
  it("refuses what isn't a generator, and a newer version, with a sentence", () => {
    for (const raw of [null, 5, "x", [], {}, { version: 1, rows: 3 }]) expect(error(raw).length).toBeGreaterThan(0);
    expect(error(def([], { version: 2 }))).toMatch(/newer/);
  });
  it("trims text and treats a blank template as none", () => {
    const g = ok(def([{ id: " a ", label: "  Name ", source: "  [X] ", target: { kind: "name" } }], { templateId: "  " }));
    expect(g.templateId).toBeNull();
    expect(g.rows[0]).toMatchObject({ id: "a", label: "Name", source: "[X]", fallback: "" });
  });
  it("gives missing or repeated row ids new unique ones", () => {
    const g = ok(def([{ id: "r1" }, { id: "r1" }, {}, { id: "r2" }]));
    const ids = g.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe("r1");
  });
  it("defaults a missing target to text and refuses an unknown one", () => {
    expect(ok(def([{ label: "x" }])).rows[0].target).toEqual({ kind: "text" });
    expect(error(def([{ target: { kind: "moon" } }]))).toMatch(/moon/);
  });
  it("enforces limits", () => {
    expect(error(def(Array.from({ length: GENERATOR_LIMITS.rows + 1 }, () => ({}))))).toMatch(/at most/);
    expect(error(def([{ label: "x".repeat(GENERATOR_LIMITS.label + 1) }]))).toMatch(/characters/);
    expect(error(def([{ source: "x".repeat(GENERATOR_LIMITS.source + 1) }]))).toMatch(/characters/);
  });
  it("reads stored text, and never throws on junk", () => {
    expect(parseGenerator(JSON.stringify(def())).ok).toBe(true);
    expect(parseGenerator("not json").ok).toBe(false);
  });
});

describe("rows", () => {
  it("makes unique ids", () => {
    expect(newRowId(new Set(["r1", "r2"]))).toBe("r3");
    const g = emptyGenerator();
    g.rows.push(newRow(g));
    expect(newRow(g).id).toBe("r2");
  });
  it("knows when a row has nothing to roll, and checks the slot syntax", () => {
    const row = { ...newRow(emptyGenerator()), source: "  " };
    expect(isRowComplete(row)).toBe(false);
    expect(checkRow(row)).toBeNull();
    expect(checkRow({ ...row, source: "[Names] and [2d4]" })).toBeNull();
    expect(checkRow({ ...row, source: "oops [Names" })).toMatch(/closing/);
  });
});
