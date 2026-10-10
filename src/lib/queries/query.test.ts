import { describe, expect, it } from "vitest";
import {
  QUERY_LIMITS,
  QUERY_VERSION,
  emptyQuery,
  isGroup,
  isRuleComplete,
  normalizeQuery,
  testsForKind,
  type Group,
  type Query,
  type Rule,
} from "./query";

const tagRule = (tagId: string, extra: Partial<Rule> = {}): Rule => ({ kind: "tag", tagId, subtags: true, not: false, ...extra } as Rule);
const queryOf = (...rules: (Rule | Group)[]): Query => ({
  ...emptyQuery(),
  where: { op: "all", not: false, rules },
});
const ok = (raw: unknown) => {
  const r = normalizeQuery(raw);
  if (!r.ok) throw new Error(r.error);
  return r.query;
};
const error = (raw: unknown) => {
  const r = normalizeQuery(raw);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("emptyQuery", () => {
  it("matches everything and sorts by name", () => {
    const q = emptyQuery();
    expect(q.version).toBe(QUERY_VERSION);
    expect(q.where).toEqual({ op: "all", not: false, rules: [] });
    expect(q.sort).toEqual([{ by: "name", dir: "asc" }]);
  });
  it("is already in its proper form", () => {
    expect(ok(emptyQuery())).toEqual(emptyQuery());
  });
});

describe("normalizeQuery", () => {
  it("keeps a good query exactly as it is", () => {
    const q = queryOf(
      { kind: "itemType", types: ["document"], not: false },
      tagRule("t1"),
      { kind: "field", fieldId: "f1", test: { check: "contains", text: "wolf" }, not: true },
      { op: "any", not: false, rules: [{ kind: "name", text: "Ash", not: false }, { kind: "changed", days: 7, not: false }] },
    );
    expect(ok(JSON.parse(JSON.stringify(q)))).toEqual(q);
  });

  it("refuses things that are not queries, with a sentence, and never throws", () => {
    for (const raw of [null, undefined, 5, "x", [], {}, { version: 1 }, { version: 1, where: 3 }]) {
      expect(error(raw).length).toBeGreaterThan(0);
    }
  });

  it("refuses a query from a newer version of the app", () => {
    expect(error({ ...emptyQuery(), version: 2 })).toMatch(/newer/i);
  });

  it("refuses a rule it does not know instead of guessing", () => {
    const raw = { ...emptyQuery(), where: { op: "all", not: false, rules: [{ kind: "weather", not: false }] } };
    expect(error(raw)).toMatch(/weather/);
  });

  it("refuses a group with an operator it does not know", () => {
    expect(error({ ...emptyQuery(), where: { op: "xor", not: false, rules: [] } })).toMatch(/all.*any/i);
  });

  it("fills in what is missing: not defaults to false, sort to by name", () => {
    const q = ok({ version: 1, where: { op: "any", rules: [{ kind: "tag", tagId: "a" }] } });
    expect(q.where.not).toBe(false);
    expect(q.where.rules[0]).toEqual({ kind: "tag", tagId: "a", subtags: true, not: false });
    expect(q.sort).toEqual([{ by: "name", dir: "asc" }]);
  });

  it("trims text and ids, and keeps incomplete rules (they are work in progress)", () => {
    const q = ok(queryOf({ kind: "name", text: "  Ash  ", not: false }, { kind: "tag", tagId: "", subtags: true, not: false }));
    expect(q.where.rules[0]).toMatchObject({ text: "Ash" });
    expect(q.where.rules[1]).toMatchObject({ tagId: "" });
  });

  it("removes repeated ids from lists and keeps their order", () => {
    const q = ok(queryOf({ kind: "itemType", types: ["card", "document", "card", " document "], not: false }));
    expect(q.where.rules[0]).toMatchObject({ types: ["card", "document"] });
  });

  it("keeps a number test's value finite and puts between's ends the right way round", () => {
    const q = ok(queryOf({ kind: "field", fieldId: "f", test: { check: "between", min: 9, max: 2 }, not: false }));
    expect(q.where.rules[0]).toMatchObject({ test: { check: "between", min: 2, max: 9 } });
    expect(error(queryOf({ kind: "field", fieldId: "f", test: { check: "number", cmp: "=", value: Infinity }, not: false }))).toMatch(/number/i);
    expect(error(queryOf({ kind: "field", fieldId: "f", test: { check: "number", cmp: "~" as never, value: 1 }, not: false }))).toMatch(/comparison/i);
  });

  it("limits days to a whole number from 1 to the maximum", () => {
    expect(ok(queryOf({ kind: "changed", days: 2.7, not: false })).where.rules[0]).toMatchObject({ days: 3 });
    expect(error(queryOf({ kind: "changed", days: 0, not: false }))).toMatch(/days/i);
    expect(error(queryOf({ kind: "changed", days: QUERY_LIMITS.days + 1, not: false }))).toMatch(/days/i);
  });

  it("enforces size limits", () => {
    expect(error(queryOf({ kind: "name", text: "x".repeat(QUERY_LIMITS.text + 1), not: false }))).toMatch(/characters/);
    const many = Array.from({ length: QUERY_LIMITS.ids + 1 }, (_, i) => `t${i}`);
    expect(error(queryOf({ kind: "itemType", types: many, not: false }))).toMatch(/at most/);
    const rules = Array.from({ length: QUERY_LIMITS.nodes + 1 }, () => tagRule("a"));
    expect(error(queryOf(...rules))).toMatch(/too many/i);
    let deep: Group = { op: "all", not: false, rules: [] };
    for (let i = 0; i < QUERY_LIMITS.depth; i++) deep = { op: "all", not: false, rules: [deep] };
    expect(error({ ...emptyQuery(), where: deep })).toMatch(/nested/i);
  });

  it("repairs the sort: drops repeats, caps the number of keys, defaults to by name", () => {
    const q = ok({
      ...emptyQuery(),
      sort: [
        { by: "updated", dir: "desc" },
        { by: "updated", dir: "asc" },
        { by: "field", fieldId: "f", dir: "asc" },
        { by: "type" },
        { by: "created", dir: "asc" },
      ],
    });
    expect(q.sort).toEqual([
      { by: "updated", dir: "desc" },
      { by: "field", fieldId: "f", dir: "asc" },
      { by: "type", dir: "asc" },
    ]);
    expect(ok({ ...emptyQuery(), sort: [] }).sort).toEqual([{ by: "name", dir: "asc" }]);
    expect(error({ ...emptyQuery(), sort: [{ by: "mood", dir: "asc" }] })).toMatch(/sort/i);
  });
});

describe("isGroup and isRuleComplete", () => {
  it("tells groups from rules", () => {
    expect(isGroup({ op: "all", not: false, rules: [] })).toBe(true);
    expect(isGroup(tagRule("a"))).toBe(false);
  });
  it("knows a rule with nothing chosen yet is incomplete", () => {
    expect(isRuleComplete(tagRule("a"))).toBe(true);
    expect(isRuleComplete(tagRule(""))).toBe(false);
    expect(isRuleComplete({ kind: "name", text: "", not: false })).toBe(false);
    expect(isRuleComplete({ kind: "itemType", types: [], not: false })).toBe(false);
    expect(isRuleComplete({ kind: "field", fieldId: "f", test: { check: "empty" }, not: false })).toBe(true);
    expect(isRuleComplete({ kind: "field", fieldId: "f", test: { check: "contains", text: " " }, not: false })).toBe(false);
    expect(isRuleComplete({ kind: "field", fieldId: "f", test: { check: "choice", optionIds: [] }, not: false })).toBe(false);
    expect(isRuleComplete({ kind: "field", fieldId: "", test: { check: "empty" }, not: false })).toBe(false);
    expect(isRuleComplete({ kind: "changed", days: 3, not: false })).toBe(true);
  });
});

describe("testsForKind", () => {
  it("offers each kind of field the tests that make sense for it", () => {
    expect(testsForKind("text")).toEqual(["contains", "equals", "empty"]);
    expect(testsForKind("formula")).toEqual(["contains", "equals", "empty"]);
    expect(testsForKind("number")).toEqual(["number", "between", "empty"]);
    expect(testsForKind("bar")).toEqual(["number", "between", "empty"]);
    expect(testsForKind("dropdown")).toEqual(["choice", "empty"]);
    expect(testsForKind("list")).toEqual(["contains", "empty"]);
    expect(testsForKind("link")).toEqual(["links", "empty"]);
  });
});

describe("the file both sides read", () => {
  // The same file is read by a Rust test (db/query_tests.rs), which parses every query and writes
  // it back unchanged, so the TypeScript and Rust ideas of a query can't drift apart. Change the
  // shape and this fails until the file is updated (`npx vitest run -u src/lib/queries`).
  const samples: Query[] = [
    emptyQuery(),
    queryOf({ kind: "itemType", types: ["document", "template"], not: false }, { kind: "library", libraries: ["worldbuilding"], not: true }),
    queryOf(tagRule("t1"), tagRule("t2", { subtags: false, not: true } as Partial<Rule>)),
    queryOf({ kind: "folder", folderId: "f1", subfolders: false, not: false }, { kind: "name", text: "Ash", not: false }, { kind: "text", text: "wolf", not: true }),
    queryOf({ kind: "linksTo", itemId: "i1", not: false }, { kind: "linkedFrom", itemId: "i2", not: true }, { kind: "changed", days: 14, not: false }),
    queryOf(
      { kind: "field", fieldId: "a", test: { check: "contains", text: "x" }, not: false },
      { kind: "field", fieldId: "b", test: { check: "equals", text: "y" }, not: false },
      { kind: "field", fieldId: "c", test: { check: "number", cmp: ">=", value: 2.5 }, not: false },
      { kind: "field", fieldId: "d", test: { check: "between", min: 1, max: 9 }, not: true },
      { kind: "field", fieldId: "e", test: { check: "choice", optionIds: ["x", "y"] }, not: false },
      { kind: "field", fieldId: "f", test: { check: "links", itemId: "i3" }, not: false },
      { kind: "field", fieldId: "g", test: { check: "empty" }, not: true },
    ),
    {
      ...emptyQuery(),
      where: { op: "any", not: true, rules: [tagRule("a"), { op: "all", not: false, rules: [{ kind: "name", text: "b", not: false }, tagRule("")] }, { op: "all", not: false, rules: [] }] },
      sort: [
        { by: "updated", dir: "desc" },
        { by: "field", fieldId: "c", dir: "asc" },
        { by: "type", dir: "asc" },
      ],
    },
    {
      ...emptyQuery(),
      view: { mode: "table", columns: [{ by: "type" }, { by: "updated" }, { by: "field", fieldId: "c" }] },
    },
  ];

  it("holds queries that are already in their proper form", () => {
    for (const q of samples) expect(ok(JSON.parse(JSON.stringify(q)))).toEqual(q);
  });

  it("matches the golden file the Rust engine is tested with", async () => {
    await expect(JSON.stringify(samples, null, 2) + "\n").toMatchFileSnapshot("../../../src-tauri/tests/fixtures/queries.json");
  });
});
