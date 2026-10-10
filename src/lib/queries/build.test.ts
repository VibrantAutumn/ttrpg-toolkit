import { describe, expect, it } from "vitest";
import {
  addNode,
  canAdd,
  countNodes,
  defaultRule,
  defaultTest,
  getNode,
  isSimple,
  moveNode,
  newGroup,
  removeNode,
  replaceNode,
  updateGroup,
  updateRule,
} from "./build";
import { QUERY_LIMITS, RULE_KINDS, emptyQuery, isGroup, isRuleComplete, normalizeQuery, type Group, type Query, type Rule } from "./query";

const tag = (id: string): Rule => ({ kind: "tag", tagId: id, subtags: true, not: false });
const rulesOf = (g: Group) => g.rules.map((r) => (isGroup(r) ? "group" : r.kind === "tag" ? r.tagId : r.kind));

describe("defaultRule and defaultTest", () => {
  it("make every kind of rule, all incomplete except the ones with a sensible start, and all readable", () => {
    for (const kind of RULE_KINDS) {
      const rule = defaultRule(kind);
      expect(rule.kind).toBe(kind);
      const q: Query = { ...emptyQuery(), where: { op: "all", not: false, rules: [rule] } };
      expect(normalizeQuery(q).ok, kind).toBe(true);
    }
    expect(isRuleComplete(defaultRule("tag"))).toBe(false);
    expect(isRuleComplete(defaultRule("changed"))).toBe(true);
  });
  it("makes every kind of test in a form the reader accepts", () => {
    for (const check of ["contains", "equals", "number", "between", "choice", "links", "empty"] as const) {
      const rule: Rule = { kind: "field", fieldId: "f", test: defaultTest(check), not: false };
      expect(normalizeQuery({ ...emptyQuery(), where: { op: "all", not: false, rules: [rule] } }).ok, check).toBe(true);
    }
  });
});

describe("editing", () => {
  const base = addNode(addNode(emptyQuery(), [], tag("a")), [], tag("b"));

  it("adds, finds and removes nodes without touching the original", () => {
    expect(rulesOf(base.where)).toEqual(["a", "b"]);
    expect(getNode(base, [1])).toMatchObject({ tagId: "b" });
    expect(rulesOf(removeNode(base, [0]).where)).toEqual(["b"]);
    expect(rulesOf(base.where)).toEqual(["a", "b"]);
    expect(getNode(base, [5])).toBeNull();
    expect(getNode(base, [0, 0])).toBeNull();
  });

  it("works inside nested groups", () => {
    let q = addNode(base, [], newGroup("any"));
    q = addNode(q, [2], tag("c"));
    q = addNode(q, [2], tag("d"));
    expect(rulesOf((getNode(q, [2]) as Group))).toEqual(["c", "d"]);
    q = moveNode(q, [2, 1], -1);
    expect(rulesOf((getNode(q, [2]) as Group))).toEqual(["d", "c"]);
    q = updateGroup(q, [2], { op: "all", not: true });
    expect(getNode(q, [2])).toMatchObject({ op: "all", not: true });
    q = removeNode(q, [2, 0]);
    expect(rulesOf((getNode(q, [2]) as Group))).toEqual(["c"]);
  });

  it("changes a rule, and ignores a change aimed at a group or at nothing", () => {
    const q = updateRule(base, [0], { not: true });
    expect(getNode(q, [0])).toMatchObject({ tagId: "a", not: true });
    expect(updateRule(base, [9], { not: true })).toEqual(base);
    const withGroup = addNode(base, [], newGroup());
    expect(updateRule(withGroup, [2], { not: true })).toEqual(withGroup);
    expect(getNode(updateRule(base, [1], (r) => ({ ...r, not: true }) as Rule), [1])).toMatchObject({ not: true });
  });

  it("moves within bounds only", () => {
    expect(rulesOf(moveNode(base, [0], -1).where)).toEqual(["a", "b"]);
    expect(rulesOf(moveNode(base, [1], 1).where)).toEqual(["a", "b"]);
    expect(rulesOf(moveNode(base, [0], 1).where)).toEqual(["b", "a"]);
    expect(moveNode(base, [], 1)).toEqual(base);
  });

  it("replaces a node, but never turns the first group into a rule", () => {
    expect(getNode(replaceNode(base, [0], tag("z")), [0])).toMatchObject({ tagId: "z" });
    expect(replaceNode(base, [], tag("z"))).toEqual(base);
    expect(replaceNode(base, [], { op: "any", not: false, rules: [] }).where.op).toBe("any");
  });

  it("refuses to add inside a rule, past the depth limit or past the size limit", () => {
    expect(canAdd(base, [0], tag("x"))).toBe(false);
    let q = emptyQuery();
    let path: number[] = [];
    for (let depth = 2; depth <= QUERY_LIMITS.depth; depth++) {
      expect(canAdd(q, path, newGroup())).toBe(true);
      q = addNode(q, path, newGroup());
      path = [...path, 0];
    }
    expect(canAdd(q, path, newGroup())).toBe(false);
    expect(addNode(q, path, newGroup())).toEqual(q);
    expect(canAdd(q, path, tag("x"))).toBe(true);

    let full = emptyQuery();
    for (let i = 0; i < QUERY_LIMITS.nodes; i++) full = addNode(full, [], tag("t"));
    expect(countNodes(full.where)).toBe(QUERY_LIMITS.nodes);
    expect(canAdd(full, [], tag("x"))).toBe(false);
    expect(normalizeQuery(full).ok).toBe(true);
  });

  it("counts every rule and group", () => {
    const q = addNode(addNode(base, [], newGroup()), [2], tag("c"));
    expect(countNodes(q.where)).toBe(4);
  });

  it("knows which queries the simple builder can show", () => {
    expect(isSimple(base)).toBe(true);
    expect(isSimple(addNode(base, [], newGroup()))).toBe(false);
    expect(isSimple(updateGroup(base, [], { not: true }))).toBe(false);
  });
});
