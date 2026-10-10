import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "../dice/rng";
import { QUERY_LIMITS, RULE_KINDS, emptyQuery, isGroup, normalizeQuery, type FieldTest, type Group, type Node, type Query, type Rule } from "./query";

/** Random queries: whatever the reader accepts, it accepts again unchanged. */

const WORDS = ["wolf", "Ash", "  spaced  ", "é", "a\nb", "x".repeat(40), ""];
const IDS = ["a", "b", " c ", "id-1", ""];

const pick = <T>(rng: Rng, list: readonly T[]): T => list[rng.int(1, list.length) - 1];
const some = <T>(rng: Rng, make: () => T, max = 4): T[] => Array.from({ length: rng.int(0, max) }, make);

function randomTest(rng: Rng): FieldTest {
  switch (rng.int(1, 7)) {
    case 1:
      return { check: "contains", text: pick(rng, WORDS) };
    case 2:
      return { check: "equals", text: pick(rng, WORDS) };
    case 3:
      return { check: "number", cmp: pick(rng, ["=", "<", "<=", ">", ">="] as const), value: rng.int(-50, 50) / 4 };
    case 4:
      return { check: "between", min: rng.int(-9, 9), max: rng.int(-9, 9) };
    case 5:
      return { check: "choice", optionIds: some(rng, () => pick(rng, IDS)) };
    case 6:
      return { check: "links", itemId: pick(rng, IDS) };
    default:
      return { check: "empty" };
  }
}

function randomRule(rng: Rng): Rule {
  const not = rng.int(1, 3) === 1;
  switch (pick(rng, RULE_KINDS)) {
    case "itemType":
      return { kind: "itemType", types: some(rng, () => pick(rng, IDS)), not };
    case "library":
      return { kind: "library", libraries: some(rng, () => pick(rng, IDS)), not };
    case "folder":
      return { kind: "folder", folderId: pick(rng, IDS), subfolders: rng.int(1, 2) === 1, not };
    case "tag":
      return { kind: "tag", tagId: pick(rng, IDS), subtags: rng.int(1, 2) === 1, not };
    case "name":
      return { kind: "name", text: pick(rng, WORDS), not };
    case "text":
      return { kind: "text", text: pick(rng, WORDS), not };
    case "field":
      return { kind: "field", fieldId: pick(rng, IDS), test: randomTest(rng), not };
    case "linksTo":
      return { kind: "linksTo", itemId: pick(rng, IDS), not };
    case "linkedFrom":
      return { kind: "linkedFrom", itemId: pick(rng, IDS), not };
    default:
      return { kind: "changed", days: rng.int(1, 400), not };
  }
}

function randomGroup(rng: Rng, depth: number): Group {
  const rules: Node[] = some(rng, () => (depth < QUERY_LIMITS.depth && rng.int(1, 5) === 1 ? randomGroup(rng, depth + 1) : randomRule(rng)), 5);
  return { op: rng.int(1, 2) === 1 ? "all" : "any", not: rng.int(1, 4) === 1, rules };
}

function randomQuery(rng: Rng): Query {
  const sort: Query["sort"] = some(rng, () =>
    rng.int(1, 5) === 1
      ? { by: "field", fieldId: pick(rng, IDS), dir: rng.int(1, 2) === 1 ? "asc" : "desc" }
      : { by: pick(rng, ["name", "created", "updated", "type"] as const), dir: rng.int(1, 2) === 1 ? "asc" : "desc" },
  );
  return { ...emptyQuery(), where: randomGroup(rng, 1), sort };
}

describe("random queries", () => {
  it("are read back in one stable form, also after a trip through JSON", () => {
    let readable = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const q = randomQuery(createRng(seed));
      const first = normalizeQuery(q);
      if (!first.ok) continue; // e.g. an empty field id in a sort; refusing is fine, throwing is not
      readable++;
      expect(normalizeQuery(first.query), `seed ${seed}`).toEqual(first);
      expect(normalizeQuery(JSON.parse(JSON.stringify(first.query))), `seed ${seed}`).toEqual(first);
      const walk = (g: Group) => {
        for (const n of g.rules) {
          if (isGroup(n)) walk(n);
          else if (n.kind === "itemType") expect(new Set(n.types).size).toBe(n.types.length);
        }
      };
      walk(first.query.where);
    }
    expect(readable).toBeGreaterThan(1000);
  });

  it("never make the reader throw when they are garbage", () => {
    const junk: unknown[] = [0, "", null, [], {}, { version: 1, where: { op: "all", rules: [null] } }, { version: 1, where: { op: "all", rules: [[]] } }, { version: 1, where: { op: "all", rules: [{ kind: 5 }] } }, { version: "1" }];
    for (const raw of junk) expect(() => normalizeQuery(raw)).not.toThrow();
    for (let seed = 1; seed <= 300; seed++) {
      const rng = createRng(seed);
      const q = JSON.parse(JSON.stringify(randomQuery(rng))) as Record<string, unknown>;
      // damage it: drop or scramble one field somewhere at the top
      const keys = Object.keys(q);
      const key = pick(rng, keys);
      q[key] = pick(rng, [undefined, null, 7, "x", [], {}] as unknown[]);
      expect(() => normalizeQuery(q)).not.toThrow();
    }
  });
});
