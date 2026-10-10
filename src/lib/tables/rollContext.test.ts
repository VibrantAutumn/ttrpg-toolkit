import { describe, expect, it } from "vitest";
import { normalizeQuery } from "../queries/query";
import { MAX_CONTEXT_TAGS, contextQuery, narrowItems, parseContext, serializeContext, toggleContextTag } from "./rollContext";

describe("roll context storage", () => {
  it("round-trips a list of tag ids", () => {
    expect(parseContext(serializeContext(["a", "b", "a"]))).toEqual(["a", "b"]);
  });
  it("reads nothing, junk or the wrong shape as no context", () => {
    for (const text of [null, undefined, "", "nope", "{}", "5", '[1,2,""]']) expect(parseContext(text as string)).toEqual([]);
    expect(parseContext('["a", 3, "b"]')).toEqual(["a", "b"]);
  });
  it("keeps at most the allowed number of tags", () => {
    const many = Array.from({ length: MAX_CONTEXT_TAGS + 5 }, (_, i) => `t${i}`);
    expect(parseContext(serializeContext(many))).toHaveLength(MAX_CONTEXT_TAGS);
    expect(toggleContextTag(many.slice(0, MAX_CONTEXT_TAGS), "extra")).toHaveLength(MAX_CONTEXT_TAGS);
  });
  it("toggles a tag on and off", () => {
    expect(toggleContextTag([], "a")).toEqual(["a"]);
    expect(toggleContextTag(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("contextQuery", () => {
  it("is nothing without tags", () => {
    expect(contextQuery([])).toBeNull();
  });
  it("needs every tag, counting sub-tags, and is a query the engine accepts", () => {
    const q = contextQuery(["a", "b"]);
    expect(q?.where.op).toBe("all");
    expect(q?.where.rules).toEqual([
      { kind: "tag", tagId: "a", subtags: true, not: false },
      { kind: "tag", tagId: "b", subtags: true, not: false },
    ]);
    expect(normalizeQuery(q).ok).toBe(true);
  });
});

describe("narrowItems", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("keeps everything with no context and only the allowed ones with one", () => {
    expect(narrowItems(items, null)).toEqual(items);
    expect(narrowItems(items, new Set(["b", "x"]))).toEqual([{ id: "b" }]);
    expect(narrowItems(items, new Set())).toEqual([]);
  });
});
