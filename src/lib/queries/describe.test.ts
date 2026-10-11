import { describe, expect, it } from "vitest";
import { addNode, defaultRule, newGroup, updateRule } from "./build";
import { describeQuery, describeRule, type QueryNames } from "./describe";
import { emptyQuery, type Query, type Rule } from "./query";

const names: QueryNames = {
  tag: (id) => ({ npc: "NPC", elf: "Elf" })[id],
  folder: (id) => ({ f1: "Characters" })[id],
  field: (id) => ({ status: "Status", level: "Level", home: "Home" })[id],
  item: (id) => ({ ash: "Ashgrove" })[id],
  choice: (field, option) => (field === "status" ? ({ alive: "Alive", dead: "Dead" } as Record<string, string>)[option] : undefined),
  itemType: (id) => (id === "document" ? "Document" : id),
  library: (id) => (id === "cards" ? "Cards" : id),
};

const rule = (r: Partial<Rule> & { kind: Rule["kind"] }): Rule => ({ ...defaultRule(r.kind), ...r }) as Rule;
const describeOne = (r: Rule) => describeRule(r, names);

describe("describeRule", () => {
  it("says what each rule asks", () => {
    expect(describeOne(rule({ kind: "itemType", types: ["document"] }))).toBe("is a document");
    expect(describeOne(rule({ kind: "itemType", types: ["card", "document"] }))).toBe("is a card or a document");
    expect(describeOne(rule({ kind: "library", libraries: ["cards"] }))).toBe("is in Cards");
    expect(describeOne(rule({ kind: "folder", folderId: "f1" }))).toBe("is in the folder Characters or its folders");
    expect(describeOne(rule({ kind: "folder", folderId: "f1", subfolders: false }))).toBe("is in the folder Characters");
    expect(describeOne(rule({ kind: "tag", tagId: "npc" }))).toBe("is tagged NPC");
    expect(describeOne(rule({ kind: "tag", tagId: "npc", subtags: false }))).toBe("is tagged NPC itself");
    expect(describeOne(rule({ kind: "name", text: " wolf " }))).toBe("name contains “wolf”");
    expect(describeOne(rule({ kind: "text", text: "wolf" }))).toBe("mentions “wolf”");
    expect(describeOne(rule({ kind: "linksTo", itemId: "ash" }))).toBe("links to Ashgrove");
    expect(describeOne(rule({ kind: "linkedFrom", itemId: "ash" }))).toBe("is linked from Ashgrove");
    expect(describeOne(rule({ kind: "changed", days: 7 }))).toBe("was changed in the last 7 days");
    expect(describeOne(rule({ kind: "changed", days: 1 }))).toBe("was changed in the last day");
  });

  it("says what each field test asks", () => {
    const f = (fieldId: string, test: Extract<Rule, { kind: "field" }>["test"], not = false) => describeOne(rule({ kind: "field", fieldId, test, not }));
    expect(f("status", { check: "choice", optionIds: ["alive"] })).toBe("Status is Alive");
    expect(f("status", { check: "choice", optionIds: ["alive", "dead"] }, true)).toBe("Status isn't Alive or Dead");
    expect(f("level", { check: "number", cmp: ">=", value: 5 })).toBe("Level is at least 5");
    expect(f("level", { check: "number", cmp: "=", value: 5 }, true)).toBe("Level isn't 5");
    expect(f("level", { check: "between", min: 1, max: 4 })).toBe("Level is between 1 and 4");
    expect(f("status", { check: "empty" })).toBe("Status is empty");
    expect(f("status", { check: "empty" }, true)).toBe("Status has a value");
    expect(f("home", { check: "links", itemId: "ash" })).toBe("Home links to Ashgrove");
    expect(f("status", { check: "contains", text: "al" }, true)).toBe("Status doesn't contain “al”");
  });

  it("shows what has gone missing and what is not finished", () => {
    expect(describeOne(rule({ kind: "tag", tagId: "gone" }))).toBe("is tagged (missing)");
    expect(describeOne(rule({ kind: "field", fieldId: "x", test: { check: "choice", optionIds: ["q"] } }))).toBe("(missing) is (missing)");
    expect(describeOne(defaultRule("tag"))).toBe("(choose a tag)");
    expect(describeOne(defaultRule("name"))).toBe("(type some text)");
  });
});

describe("describeQuery", () => {
  const build = (op: "all" | "any", ...rules: Rule[]): Query => {
    let q = { ...emptyQuery(), where: { ...emptyQuery().where, op } };
    for (const r of rules) q = addNode(q, [], r);
    return q;
  };

  it("says Everything when there is nothing to ask", () => {
    expect(describeQuery(emptyQuery(), names)).toBe("Everything");
    expect(describeQuery(build("all", defaultRule("tag")), names)).toBe("Everything");
  });

  it("joins rules with and / or, and leaves unfinished ones out", () => {
    const q = build("all", rule({ kind: "tag", tagId: "npc" }), defaultRule("name"), rule({ kind: "field", fieldId: "status", test: { check: "choice", optionIds: ["alive"] } }));
    expect(describeQuery(q, names)).toBe("Is tagged NPC and Status is Alive");
    expect(describeQuery({ ...q, where: { ...q.where, op: "any" } }, names)).toBe("Is tagged NPC or Status is Alive");
  });

  it("puts nested groups in brackets and says not", () => {
    let q = build("all", rule({ kind: "tag", tagId: "npc" }));
    q = addNode(q, [], newGroup("any"));
    q = addNode(q, [1], rule({ kind: "tag", tagId: "elf" }));
    q = addNode(q, [1], rule({ kind: "changed", days: 3 }));
    expect(describeQuery(q, names)).toBe("Is tagged NPC and (is tagged Elf or was changed in the last 3 days)");
    q = updateRule(q, [0], { not: true });
    expect(describeQuery(q, names)).toBe("Isn't tagged NPC and (is tagged Elf or was changed in the last 3 days)");
    q = { ...q, where: { ...q.where, not: true } };
    expect(describeQuery(q, names)).toBe("Not (isn't tagged NPC and (is tagged Elf or was changed in the last 3 days))");
  });

  it("skips a nested group that has nothing in it", () => {
    let q = build("all", rule({ kind: "tag", tagId: "npc" }));
    q = addNode(q, [], newGroup("any"));
    expect(describeQuery(q, names)).toBe("Is tagged NPC");
  });
});

describe("describing date tests", () => {
  const dateNames: QueryNames = { ...names, field: (id) => (id === "born" ? "Born" : undefined), fieldKind: (id) => (id === "born" ? "date" : undefined) };
  const one = (test: Extract<Rule, { kind: "field" }>["test"], not = false) =>
    describeRule({ kind: "field", fieldId: "born", test, not } as Rule, dateNames);
  it("says dates in words, as day numbers when no calendar is set", () => {
    expect(one({ check: "number", cmp: "<", value: 12 })).toBe("Born is before Day 12");
    expect(one({ check: "number", cmp: ">=", value: 3 }, true)).toBe("Born isn't on or after Day 3");
    expect(one({ check: "between", min: 1, max: 9 })).toBe("Born is between Day 1 and Day 9");
  });
});
