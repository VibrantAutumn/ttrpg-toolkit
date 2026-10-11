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

  it("keeps each group together, so the menu's headings are not repeated", () => {
    const seen: string[] = [];
    for (const c of BLOCK_COMMANDS) {
      if (seen[seen.length - 1] !== c.group) {
        expect(seen).not.toContain(c.group);
        seen.push(c.group);
      }
    }
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

  it("finds tables and columns", () => {
    expect(ids("table")).toEqual(["table"]);
    expect(ids("col")).toEqual(["columns2", "columns3"]);
    expect(ids("3 col")).toEqual(["columns3"]);
  });

  it("finds callouts, toggles and secret blocks", () => {
    expect(ids("secret")).toEqual(["secret"]);
    expect(ids("toggle")).toEqual(["toggle"]);
    expect(ids("callout")).toEqual(["callout", "warning"]);
    expect(ids("danger")).toEqual(["warning"]);
    expect(ids("accordion")).toEqual(["toggle"]);
  });

  it("gives nothing for text that matches nothing", () => {
    expect(ids("zzzz")).toEqual([]);
  });
});

describe("filterBlockCommands with extra items", () => {
  const extra = [{ id: "statblock:s1" as const, setId: "s1", label: "Stat block: Monster", hint: "", group: "Stat blocks", keywords: ["stat", "monster"] }];

  it("lists extras after the blocks, and finds them by their words", () => {
    const all = filterBlockCommands("", extra);
    expect(all[all.length - 1].id).toBe("statblock:s1");
    expect(filterBlockCommands("stat", extra).map((c) => c.id)).toEqual(["statblock:s1"]);
    expect(filterBlockCommands("monster", extra)[0].setId).toBe("s1");
  });

  it("leaves the plain list alone when there are none", () => {
    expect(filterBlockCommands("stat")).toEqual([]);
  });
});
