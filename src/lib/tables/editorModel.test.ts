import { describe, expect, it } from "vitest";
import { createRng } from "../dice/rng";
import { parseEntry } from "./parse";
import { describeSlots, entryToModel, modelToEntry } from "./editorModel";
import type { InlineNode } from "./editorModel";

const text = (t: string): InlineNode => ({ type: "text", text: t });
const slot = (source: string): InlineNode => ({ type: "slot", source });
const br: InlineNode = { type: "break" };

function model(entry: string): InlineNode[] {
  const result = entryToModel(entry);
  if (!result.ok) throw new Error(`"${entry}" should convert: ${result.error.message}`);
  return result.nodes;
}

/** What an entry means: its text and slots, without positions. */
function meaning(entry: string) {
  const parsed = parseEntry(entry);
  if (!parsed.ok) return null;
  return parsed.parts.map((p) =>
    p.kind === "text" ? { text: p.text } : { slot: p.slot, label: p.label ?? null, source: p.source },
  );
}

describe("entryToModel", () => {
  it("makes plain text one text node, and nothing for empty text", () => {
    expect(model("A rusty sword")).toEqual([text("A rusty sword")]);
    expect(model("")).toEqual([]);
  });

  it("turns line endings into break nodes", () => {
    expect(model("one\ntwo")).toEqual([text("one"), br, text("two")]);
    expect(model("one\r\ntwo")).toEqual([text("one"), br, text("two")]);
    expect(model("\nend\n")).toEqual([br, text("end"), br]);
    expect(model("a\n\nb")).toEqual([text("a"), br, br, text("b")]);
  });

  it("turns slots into slot nodes holding what was typed between the brackets", () => {
    expect(model("Meet [2d4] [Goblins] now")).toEqual([
      text("Meet "),
      slot("2d4"),
      text(" "),
      slot("Goblins"),
      text(" now"),
    ]);
    expect(model("[Person as A]")).toEqual([slot("Person as A")]);
    expect(model("[ spaced ]")).toEqual([slot("spaced")]);
  });

  it("keeps slot text with a newline-free source and breaks in the text around it", () => {
    expect(model("a\n[Rumors]\nb")).toEqual([text("a"), br, slot("Rumors"), br, text("b")]);
  });

  it("reads escapes into plain characters", () => {
    expect(model("a \\[not a slot\\] b \\\\ c")).toEqual([text("a [not a slot] b \\ c")]);
    expect(model("[Odd \\[name\\]]")).toEqual([slot("Odd [name]")]);
  });

  it("refuses text that doesn't parse, giving the parser's error", () => {
    const result = entryToModel("hello [Rumors");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/\]/);
      expect(result.error.position).toBe(6);
    }
  });
});

describe("modelToEntry", () => {
  it("writes text, breaks and slots back as entry text", () => {
    expect(modelToEntry([text("Meet "), slot("2d4"), br, text("now")])).toBe("Meet [2d4]\nnow");
    expect(modelToEntry([])).toBe("");
  });

  it("escapes brackets and backslashes in text", () => {
    expect(modelToEntry([text("a [b] \\ c")])).toBe("a \\[b\\] \\\\ c");
  });

  it("escapes brackets and backslashes inside a slot", () => {
    expect(modelToEntry([slot("Odd [name]")])).toBe("[Odd \\[name\\]]");
  });

  it("joins neighbouring text nodes", () => {
    expect(modelToEntry([text("a"), text("b"), slot("X"), text("c")])).toBe("ab[X]c");
  });
});

describe("converting there and back", () => {
  const samples = [
    "",
    "plain",
    "  spaced  out  ",
    "line one\nline two\n",
    "[2d4] goblins",
    "[Person as A] meets [A], who has [A.Faction]",
    "[3 unique Rumors] and [draw 2 from Tarot]",
    "[table:d6][dice:1d6]",
    "[mood:Calm as P]",
    "a \\[b\\] c \\\\ d",
    "path\\n here",
    "end\\",
    "[Odd \\[name\\]]",
    "tab\there",
    "emoji 🎲 [Rumors] ✓",
  ];

  it("never changes what an entry means", () => {
    for (const sample of samples) {
      const again = modelToEntry(model(sample));
      expect(meaning(again), `${JSON.stringify(sample)} became ${JSON.stringify(again)}`).toEqual(meaning(sample));
    }
  });

  it("settles after one trip: the text it writes converts to the same model", () => {
    for (const sample of samples) {
      const first = model(sample);
      expect(model(modelToEntry(first))).toEqual(first);
    }
  });

  it("holds for lots of random text made of awkward characters", () => {
    const alphabet = ["a", " ", "[", "]", "\\", "\n", "2", "d", "4", ":", "A", "s", "u", "n", "i", "q", "e"];
    const rng = createRng(2024);
    let converted = 0;
    for (let n = 0; n < 2000; n++) {
      const length = rng.int(0, 14);
      let entry = "";
      for (let i = 0; i < length; i++) entry += alphabet[rng.int(0, alphabet.length - 1)];
      const result = entryToModel(entry);
      expect(result.ok, JSON.stringify(entry)).toBe(parseEntry(entry).ok);
      if (!result.ok) continue;
      converted += 1;
      const again = modelToEntry(result.nodes);
      expect(meaning(again), JSON.stringify(entry)).toEqual(meaning(entry));
      expect(entryToModel(again)).toEqual(result);
    }
    expect(converted).toBeGreaterThan(200); // the test really exercised valid text
  });
});

describe("describeSlots", () => {
  const describe1 = (...nodes: InlineNode[]) => describeSlots(nodes);

  it("gives nothing for text and breaks, and one entry per node otherwise", () => {
    const result = describe1(text("a"), slot("2d4"), br, slot("Rumors"));
    expect(result).toHaveLength(4);
    expect(result[0]).toBeNull();
    expect(result[2]).toBeNull();
    expect(result[1]).toMatchObject({ ok: true, type: "dice", display: "2d4" });
    expect(result[3]).toMatchObject({ ok: true, type: "table", display: "Rumors" });
  });

  it("describes each kind of slot", () => {
    const [table, count, draw, unknown, explicit] = describe1(
      slot("Goblins"),
      slot("3 unique Rumors"),
      slot("draw 1 from Tarokka"),
      slot("mood:Calm"),
      slot("table:d6"),
    );
    expect(table).toMatchObject({ ok: true, type: "table", display: "Goblins" });
    expect(count).toMatchObject({ ok: true, type: "table", display: "3 unique Rumors" });
    expect(draw).toMatchObject({ ok: true, type: "draw", display: "draw 1 from Tarokka" });
    expect(unknown).toMatchObject({ ok: true, type: "unknown", display: "mood: Calm" });
    expect(explicit).toMatchObject({ ok: true, type: "table", display: "d6" });
  });

  it("reports a slot that doesn't make sense, and carries on with the rest", () => {
    const [bad, good] = describe1(slot("draw:"), slot("2d4"));
    expect(bad).toMatchObject({ ok: false });
    if (bad && !bad.ok) expect(bad.message).toMatch(/from/i);
    expect(good).toMatchObject({ ok: true, type: "dice" });
  });

  it("knows which names are labels set by earlier chips", () => {
    const [first, ref, field, notYet] = describe1(slot("Person as A"), slot("A"), slot("A.Faction"), slot("B"));
    expect(first).toMatchObject({ ok: true, type: "table", label: "A" });
    expect(ref).toMatchObject({ ok: true, type: "ref", display: "A" });
    expect(field).toMatchObject({ ok: true, type: "ref", display: "A.Faction" });
    expect(notYet).toMatchObject({ ok: true, type: "table", display: "B" });
  });

  it("a name only counts as a label after the chip that sets it", () => {
    const [before, setter, after] = describe1(slot("A"), slot("Person as A"), slot("A"));
    expect(before).toMatchObject({ type: "table" });
    expect(setter).toMatchObject({ type: "table", label: "A" });
    expect(after).toMatchObject({ type: "ref" });
  });

  it("refuses the same label twice", () => {
    const [, second] = describe1(slot("Person as A"), slot("Object as a"));
    expect(second).toMatchObject({ ok: false });
    if (second && !second.ok) expect(second.message).toMatch(/already/i);
  });

  it("a chip with a broken label doesn't set it", () => {
    const [broken, later] = describe1(slot("Person as 2nd"), slot("2nd"));
    expect(broken).toMatchObject({ ok: false });
    expect(later).toMatchObject({ ok: true, type: "table" });
  });
});
