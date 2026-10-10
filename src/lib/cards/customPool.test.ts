import { describe, expect, it } from "vitest";
import { mergeCards } from "./customPool";

const c = (id: string) => ({ id, name: id.toUpperCase() });

describe("mergeCards", () => {
  it("joins lists in order and keeps each card once", () => {
    expect(mergeCards([[c("a"), c("b")], [c("b"), c("c")], []]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("gives nothing for nothing", () => {
    expect(mergeCards([])).toEqual([]);
  });
});
