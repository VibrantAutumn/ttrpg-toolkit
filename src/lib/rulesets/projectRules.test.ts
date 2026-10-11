import { describe, expect, it } from "vitest";
import { mainRules, projectStatBlocks, readProjectRules } from "./projectRules";

const stored = (over: Record<string, unknown> = {}) => ({
  id: "pr1",
  rulesetId: "r1",
  name: "D20",
  rulesJson: JSON.stringify({
    fields: [{ key: "hp", name: "HP", kind: "bar" }],
    statBlocks: [{ key: "monster", name: "Monster", fields: ["hp"] }, { key: "pc", name: "Character", fields: ["hp"] }],
  }),
  idsJson: JSON.stringify({ fields: { hp: "f-1" }, sets: { monster: "s-1" } }),
  ...over,
});

describe("readProjectRules", () => {
  it("reads the rules and the project's ids", () => {
    const r = readProjectRules(stored())!;
    expect(r.name).toBe("D20");
    expect(r.fieldIds).toEqual({ hp: "f-1" });
    expect(r.setIds).toEqual({ monster: "s-1" });
    expect(r.ruleset.statBlocks).toHaveLength(2);
  });

  it("gives null for rules that can't be read, and copes with odd id maps", () => {
    expect(readProjectRules(stored({ rulesJson: "nope" }))).toBeNull();
    expect(readProjectRules(stored({ rulesJson: "[]" }))).toBeNull();
    expect(readProjectRules(stored({ rulesJson: '{"version":99}' }))).toBeNull();
    const odd = readProjectRules(stored({ idsJson: '{"fields":{"hp":5,"x":""},"sets":[]}' }))!;
    expect(odd.fieldIds).toEqual({});
    expect(odd.setIds).toEqual({});
    expect(readProjectRules(stored({ idsJson: "garbage" }))).toBeNull();
  });
});

describe("projectStatBlocks and mainRules", () => {
  it("lists stat blocks with their property sets, null when lost", () => {
    const rules = [readProjectRules(stored())!];
    expect(projectStatBlocks(rules).map((b) => [b.block.name, b.setId])).toEqual([["Monster", "s-1"], ["Character", null]]);
  });

  it("the main rules are the first ruleset's", () => {
    expect(mainRules([])).toBeNull();
    const a = readProjectRules(stored())!;
    const b = readProjectRules(stored({ id: "pr2" }))!;
    expect(mainRules([a, b])?.id).toBe("pr1");
  });
});
