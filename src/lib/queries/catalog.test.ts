import { describe, expect, it } from "vitest";
import { addNode, defaultRule, newGroup } from "./build";
import { itemIdsIn, pathLabel } from "./catalog";
import { emptyQuery, type Rule } from "./query";

describe("pathLabel", () => {
  const tags = [
    { id: "a", parentId: null, name: "Region" },
    { id: "b", parentId: "a", name: "Forest" },
    { id: "c", parentId: "b", name: "Deep" },
    { id: "loop1", parentId: "loop2", name: "X" },
    { id: "loop2", parentId: "loop1", name: "Y" },
  ];
  it("joins a nested name from the top down", () => {
    expect(pathLabel(tags, "c")).toBe("Region / Forest / Deep");
    expect(pathLabel(tags, "a")).toBe("Region");
  });
  it("gives nothing for an unknown id, and never loops forever", () => {
    expect(pathLabel(tags, "nope")).toBe("");
    expect(pathLabel(tags, "loop1").split(" / ").length).toBeLessThanOrEqual(20);
  });
});

describe("itemIdsIn", () => {
  it("finds the items a query names, once each, in nested groups too", () => {
    let q = emptyQuery();
    q = addNode(q, [], { ...defaultRule("linksTo"), itemId: "i1" } as Rule);
    q = addNode(q, [], newGroup("any"));
    q = addNode(q, [1], { ...defaultRule("linkedFrom"), itemId: "i2" } as Rule);
    q = addNode(q, [1], { kind: "field", fieldId: "f", test: { check: "links", itemId: "i1" }, not: false });
    q = addNode(q, [], defaultRule("linksTo")); // nothing chosen yet
    expect(itemIdsIn(q).sort()).toEqual(["i1", "i2"]);
  });
});
