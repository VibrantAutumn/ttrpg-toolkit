import { describe, expect, it } from "vitest";
import type { CommandDefinition } from "../registry/types";
import { matchCommands } from "./palette";

function cmd(id: string, label: string, keywords?: string[]): CommandDefinition {
  return { id, label, keywords, run: () => {} };
}

const commands = [
  cmd("campaigns", "Go to Campaigns", ["switch", "list"]),
  cmd("world", "Go to Worldbuilding", ["documents", "notes", "lore"]),
  cmd("roll", "Roll dice", ["d20", "random"]),
  cmd("new-doc", "Create document", ["new", "note"]),
];

const ids = (list: CommandDefinition[]) => list.map((c) => c.id);

describe("matchCommands", () => {
  it("returns every command alphabetically for an empty query", () => {
    expect(ids(matchCommands(commands, ""))).toEqual(["new-doc", "campaigns", "world", "roll"]);
    expect(ids(matchCommands(commands, "   "))).toHaveLength(4);
  });

  it("ignores case", () => {
    expect(ids(matchCommands(commands, "ROLL"))).toEqual(["roll"]);
  });

  it("ranks the start of the label above the start of a later word, above the middle", () => {
    const list = [
      cmd("c", "Recreate map"), // "rec" at the start
      cmd("b", "Open record"), // "rec" at the start of a later word
      cmd("a", "Direct"), // "rec" inside a word
    ];
    expect(ids(matchCommands(list, "rec"))).toEqual(["c", "b", "a"]);
  });

  it("matches keywords, ranked below label matches", () => {
    expect(ids(matchCommands(commands, "lore"))).toEqual(["world"]);
    const list = [cmd("k", "Zebra", ["dragon"]), cmd("l", "Dragon list")];
    expect(ids(matchCommands(list, "dragon"))).toEqual(["l", "k"]);
  });

  it("requires every typed word to match", () => {
    expect(ids(matchCommands(commands, "go world"))).toEqual(["world"]);
    expect(matchCommands(commands, "go dice")).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(matchCommands(commands, "zzz")).toEqual([]);
  });

  it("breaks ties alphabetically", () => {
    const list = [cmd("2", "Go to Beta"), cmd("1", "Go to Alpha")];
    expect(ids(matchCommands(list, "go"))).toEqual(["1", "2"]);
  });
});
