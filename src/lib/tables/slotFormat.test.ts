import { describe, expect, it } from "vitest";
import { createRng } from "../dice/rng";
import { scripted } from "../dice/testing";
import { applyFormat, splitFormat, withFormat } from "./slotFormat";
import { parseEntry, slotCanonical, slotDisplay } from "./parse";
import type { SlotPart } from "./parse";
import { entryToModel, modelToEntry } from "./editorModel";
import { rollTable } from "./roll";
import type { RollableTable, TableWorld } from "./roll";
import { rewriteTableName } from "./rename";

function slotOf(text: string): SlotPart {
  const r = parseEntry(text);
  if (!r.ok) throw new Error(r.error.message);
  const s = r.parts.find((p): p is SlotPart => p.kind === "slot");
  if (!s) throw new Error("no slot");
  return s;
}

describe("applyFormat", () => {
  it("writes each case", () => {
    expect(applyFormat("Syra of the Isles", "lower")).toBe("syra of the isles");
    expect(applyFormat("Syra of the Isles", "upper")).toBe("SYRA OF THE ISLES");
    expect(applyFormat("syra OF the isles", "title")).toBe("Syra Of The Isles");
    expect(applyFormat("the Dragon of Ash", "sentence")).toBe("The dragon of ash");
    expect(applyFormat("the Dragon's ash", "camel")).toBe("theDragon'sAsh");
    expect(applyFormat("as written", undefined)).toBe("as written");
  });

  it("copes with empty text, no letters and other alphabets", () => {
    for (const f of ["lower", "upper", "title", "sentence", "camel"] as const) expect(applyFormat("", f)).toBe("");
    expect(applyFormat("12 - 4", "sentence")).toBe("12 - 4");
    expect(applyFormat("élan vital", "title")).toBe("Élan Vital");
    expect(applyFormat("¿qué?", "sentence")).toBe("¿Qué?");
  });
});

describe("splitFormat / withFormat", () => {
  it("splits a trailing format and leaves other bars alone", () => {
    expect(splitFormat("Names | upper")).toEqual({ base: "Names", format: "upper" });
    expect(splitFormat("Names|TITLE")).toEqual({ base: "Names", format: "title" });
    expect(splitFormat("Names | shouty")).toEqual({ base: "Names | shouty" });
    expect(splitFormat("| upper")).toEqual({ base: "| upper" });
  });

  it("sets, replaces and removes a format, but leaves dice and draws alone", () => {
    expect(withFormat("Names", "upper")).toBe("Names | upper");
    expect(withFormat("Names | upper", "title")).toBe("Names | title");
    expect(withFormat("table:Names as A | upper", undefined)).toBe("table:Names as A");
    expect(withFormat("dice:2d4", "upper")).toBe("dice:2d4");
    expect(withFormat("draw:1 from Tarot", "upper")).toBe("draw:1 from Tarot");
  });
});

describe("parsing a format", () => {
  it("reads it on every wordy slot type, with and without a label", () => {
    expect(slotOf("[Names | upper]").format).toBe("upper");
    expect(slotOf("[Names | upper]").slot).toEqual({ type: "table", name: "Names", count: 1, unique: false });
    expect(slotOf("[table:2 unique Names as N | title]")).toMatchObject({ format: "title", label: "N" });
    expect(slotOf("[entity:Person | lower]").format).toBe("lower");
    expect(slotOf("[link:123e4567-e89b-12d3-a456-426614174000 Syra | upper]").format).toBe("upper");
    const r = parseEntry("[Person as A] [A.Faction | sentence] [ref:A | camel]");
    expect(r.ok && r.parts.filter((p) => p.kind === "slot").map((p) => (p as SlotPart).format)).toEqual([
      undefined,
      "sentence",
      "camel",
    ]);
  });

  it("refuses a format on dice and draws, and keeps it as text for unknown types", () => {
    expect(parseEntry("[2d4 | upper]").ok).toBe(false);
    expect(parseEntry("[draw 1 from Tarot | upper]").ok).toBe(false);
    expect(parseEntry("[dice:2d4 | upper]").ok).toBe(false); // the formula is "2d4 | upper"
    expect(slotOf("[mood:Calm | upper]").slot).toEqual({ type: "unknown", kind: "mood", args: "Calm | upper" });
  });

  it("entries without a format read exactly as before", () => {
    expect(slotOf("[Names]")).not.toHaveProperty("format");
    expect(slotOf("[Loot | rare]").slot).toMatchObject({ type: "table", name: "Loot | rare" });
  });

  it("writes it back in the explicit form and the chip text", () => {
    expect(slotCanonical(slotOf("[Names as N | upper]"))).toBe("table:Names as N | upper");
    expect(slotCanonical(slotOf("[Person as A] [A.Faction | title]".replace("[Person as A] ", "[Person as A]")))).toBeTruthy();
    expect(slotDisplay(slotOf("[3 Names | upper]"))).toBe("3 Names | upper");
    const ref = parseEntry("[Person as A][A | camel]");
    expect(ref.ok && slotCanonical(ref.parts[1] as SlotPart)).toBe("ref:A | camel");
    // what it writes reads back the same
    for (const text of ["[Names as N | upper]", "[entity:2 unique Person | lower]"]) {
      const first = slotOf(text);
      const again = slotOf(`[${slotCanonical(first)}]`);
      expect(again.slot).toEqual(first.slot);
      expect(again.format).toBe(first.format);
    }
  });

  it("survives the editor model unchanged", () => {
    const text = "Hello [Names | upper], meet [Person as A] ([A.Faction | title])";
    const m = entryToModel(text);
    expect(m.ok && modelToEntry(m.nodes)).toBe(text);
  });

  it("round-trips lots of random slots", () => {
    const rng = createRng(77);
    const formats = [undefined, "lower", "upper", "title", "sentence", "camel"] as const;
    const names = ["Names", "Loot", "A b", "x|y", "Foo | bar"];
    for (let n = 0; n < 500; n++) {
      const name = names[rng.int(0, names.length - 1)];
      const f = formats[rng.int(0, formats.length - 1)];
      const text = `[table:${name}${f ? ` | ${f}` : ""}]`;
      const first = slotOf(text);
      const again = slotOf(`[${slotCanonical(first)}]`);
      expect(again.slot, text).toEqual(first.slot);
      expect(again.format, text).toBe(first.format);
    }
  });
});

describe("rolling a format", () => {
  const names: RollableTable = {
    id: "names",
    name: "Names",
    avoidRecent: 0,
    entries: [{ id: "1", text: "syra of the isles", weight: 1 }],
  };
  const w: TableWorld = { findTable: (n) => (n.toLowerCase() === "names" ? names : null), findDeck: () => null, recent: () => [] };
  const host = (text: string): RollableTable => ({
    id: "host",
    name: "Host",
    avoidRecent: 0,
    entries: [{ id: "h", text, weight: 1 }],
  });
  const run = (text: string) => {
    const t = host(text);
    const r = rollTable(t, { ...w, findTable: (n) => (n.toLowerCase() === "host" ? t : w.findTable(n)) }, scripted(1, 1, 1));
    if (!r.ok) throw new Error(r.message);
    return r.roll;
  };

  it("changes the shown words and nothing else", () => {
    expect(run("Hail [Names | title]!").text).toBe("Hail Syra Of The Isles!");
    expect(run("[Names]").text).toBe("syra of the isles");
  });

  it("formats a reuse without touching the first result", () => {
    expect(run("[Names as N] / [N | upper]").text).toBe("syra of the isles / SYRA OF THE ISLES");
  });

  it("formats several picks as one text", () => {
    expect(run("[2 Names | upper]").text).toBe("SYRA OF THE ISLES, SYRA OF THE ISLES");
  });

  it("keeps the format when rerolling a saved entry", () => {
    const first = run("[Names | upper]");
    expect(first.entryText).toBe("[Names | upper]");
  });
});

describe("renaming a table keeps the format", () => {
  it("rewrites the name only", () => {
    const r = rewriteTableName("[3 unique Names as N | upper] and [Names | title]", "Names", "Titles");
    expect(r).toEqual({ kind: "rewritten", text: "[3 unique Titles as N | upper] and [Titles | title]", slots: 2 });
  });
});
