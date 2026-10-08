import { describe, expect, it } from "vitest";
import { parseEntry } from "./parse";
import { planRename, rewriteTableName } from "./rename";

/** Rewrites and expects a changed entry. */
function rewritten(text: string, from: string, to: string) {
  const r = rewriteTableName(text, from, to);
  if (r.kind !== "rewritten") throw new Error(`"${text}" should be rewritten but was ${r.kind}`);
  return r;
}

describe("rewriteTableName", () => {
  it("renames a table slot and leaves everything else exactly as it was", () => {
    const r = rewritten("Hear [Rumors] now,\n  and then some.", "Rumors", "Gossip");
    expect(r.text).toBe("Hear [Gossip] now,\n  and then some.");
    expect(r.slots).toBe(1);
  });

  it("matches the name ignoring case and spaces, as the roller does", () => {
    expect(rewritten("[rumors]", "Rumors", "Gossip").text).toBe("[Gossip]");
    expect(rewritten("[ RUMORS ]", " rumors ", "Gossip").text).toBe("[Gossip]");
  });

  it("keeps a count, unique, a label and the explicit form", () => {
    expect(rewritten("[3 unique Rumors]", "Rumors", "Gossip").text).toBe("[3 unique Gossip]");
    expect(rewritten("[2 Rumors]", "Rumors", "Gossip").text).toBe("[2 Gossip]");
    expect(rewritten("[Rumors as R] and [R]", "Rumors", "Gossip").text).toBe("[Gossip as R] and [R]");
    expect(rewritten("[table:Rumors]", "Rumors", "Gossip").text).toBe("[table:Gossip]");
    expect(rewritten("[table:3 unique Rumors as R]", "Rumors", "Gossip").text).toBe("[table:3 unique Gossip as R]");
  });

  it("renames every matching slot and counts them", () => {
    const r = rewritten("[Rumors] and [Names] and [2 Rumors]", "Rumors", "Gossip");
    expect(r.text).toBe("[Gossip] and [Names] and [2 Gossip]");
    expect(r.slots).toBe(2);
  });

  it("does not touch dice, card draws, other tables or plain text with the same words", () => {
    expect(rewriteTableName("Rumors [2d4] [draw 1 from Rumors] [Names] Rumors", "Rumors", "Gossip").kind).toBe(
      "unchanged",
    );
  });

  it("keeps escapes in the text around the slots", () => {
    expect(rewritten("a \\[b\\] \\\\ [Rumors]", "Rumors", "Gossip").text).toBe("a \\[b\\] \\\\ [Gossip]");
  });

  it("escapes brackets in the new name", () => {
    const r = rewritten("[Rumors]", "Rumors", "Odd [name]");
    expect(r.text).toBe("[Odd \\[name\\]]");
    const parsed = parseEntry(r.text);
    expect(parsed.ok && parsed.parts[0]).toMatchObject({ slot: { type: "table", name: "Odd [name]" } });
  });

  it("switches to the explicit form when the new name would be read as something else", () => {
    expect(rewritten("[Rumors]", "Rumors", "d6").text).toBe("[table:d6]");
    expect(rewritten("[Rumors]", "Rumors", "draw 1 from Tarot").text).toBe("[table:draw 1 from Tarot]");
    // A name that is a label set earlier in the entry would become a reference.
    expect(rewritten("[Person as Hero] [Rumors]", "Rumors", "Hero").text).toBe("[Person as Hero] [table:Hero]");
  });

  it("gives up (for the person to fix) when no way of writing the new name works", () => {
    // Nothing can write a table called "3 Cats": it always reads as three picks of "Cats".
    expect(rewriteTableName("[Rumors]", "Rumors", "3 Cats").kind).toBe("manual");
  });

  it("does nothing when only the capitalisation of the name changes", () => {
    expect(rewriteTableName("[Rumors]", "Rumors", "RUMORS").kind).toBe("unchanged");
  });

  it("leaves entries that don't parse alone (they are rolled as plain text anyway)", () => {
    expect(rewriteTableName("oops [Rumors", "Rumors", "Gossip").kind).toBe("unchanged");
  });

  it("ends up with the same entry apart from the name", () => {
    const original = "[Rumors as R] told by [2 unique People], then [R], [draw 1 from Tarot] [1d4]";
    const r = rewritten(original, "Rumors", "Gossip");
    const strip = (text: string) => {
      const p = parseEntry(text);
      if (!p.ok) throw new Error("should parse");
      return p.parts.map((part) =>
        part.kind === "text" ? part.text : { slot: part.slot, label: part.label ?? null },
      );
    };
    const before = JSON.parse(JSON.stringify(strip(original)).replace(/Rumors/g, "Gossip"));
    expect(strip(r.text)).toEqual(before);
  });
});

describe("planRename", () => {
  const entries = [
    { entryId: "a", text: "Hear [Rumors]" },
    { entryId: "b", text: "[Rumors] and [Rumors]" },
    { entryId: "c", text: "Nothing to do with it, only the word Rumors" },
    { entryId: "d", text: "[Rumors]" },
  ];

  it("lists the new text of each entry that changes, with totals", () => {
    const plan = planRename(entries, "Rumors", "Gossip");
    expect(plan.updates).toEqual([
      { entryId: "a", text: "Hear [Gossip]" },
      { entryId: "b", text: "[Gossip] and [Gossip]" },
      { entryId: "d", text: "[Gossip]" },
    ]);
    expect(plan.entries).toBe(3);
    expect(plan.slots).toBe(4);
    expect(plan.manual).toEqual([]);
  });

  it("lists entries that can't be fixed automatically, and leaves them out of the updates", () => {
    const plan = planRename(entries, "Rumors", "3 Cats");
    expect(plan.updates).toEqual([]);
    expect(plan.manual.map((m) => m.entryId)).toEqual(["a", "b", "d"]);
  });

  it("finds nothing to do when no entry uses the name", () => {
    expect(planRename([{ entryId: "x", text: "[Names]" }], "Rumors", "Gossip")).toEqual({
      updates: [],
      entries: 0,
      slots: 0,
      manual: [],
    });
  });
});
