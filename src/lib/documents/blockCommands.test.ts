import { describe, expect, it } from "vitest";
import { BLOCK_COMMANDS, filterBlockCommands } from "./blockCommands";

const ids = (query: string) => filterBlockCommands(query).map((c) => c.id);

describe("filterBlockCommands", () => {
  it("lists every block, in the order they are defined, for an empty query", () => {
    expect(filterBlockCommands("")).toEqual(BLOCK_COMMANDS);
    expect(filterBlockCommands("   ")).toEqual(BLOCK_COMMANDS);
  });

  it("has unique ids", () => {
    expect(new Set(BLOCK_COMMANDS.map((c) => c.id)).size).toBe(BLOCK_COMMANDS.length);
  });

  it("matches the start of the label, case-insensitively", () => {
    expect(ids("QUO")).toEqual(["quote"]);
  });

  it("matches the start of any word of the label", () => {
    expect(ids("list")).toEqual(expect.arrayContaining(["bullet", "ordered"]));
  });

  it("matches keywords people would type", () => {
    expect(ids("ul")).toContain("bullet");
    expect(ids("hr")).toContain("divider");
    expect(ids("title")).toContain("h1");
  });

  it("puts a label match before a keyword match", () => {
    // "heading" is the start of three labels and is only a keyword of none of them.
    expect(ids("heading").slice(0, 3)).toEqual(["h1", "h2", "h3"]);
  });

  it("needs every typed word to match", () => {
    expect(ids("heading 2")).toEqual(["h2"]);
    expect(ids("heading zzz")).toEqual([]);
  });

  it("gives nothing for text that matches nothing", () => {
    expect(ids("zzzz")).toEqual([]);
  });
});
