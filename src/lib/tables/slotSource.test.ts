import { describe, expect, it } from "vitest";
import { rememberLinkNames } from "./linkNames";
import { MAX_PICKS, parseEntry, slotDisplay } from "./parse";
import { linkIdsIn } from "./world";
import { describeSlots, entryToModel, modelToEntry } from "./editorModel";
import { buildSlotSource, checkSlotChoice } from "./slotSource";
import type { SlotChoice } from "./slotSource";

/** Builds a slot, then asks the real parser what it means. */
function meaning(choice: SlotChoice, labelsBefore: string[] = []) {
  const before = labelsBefore.map((label) => ({ type: "slot" as const, source: `x:1 as ${label}` }));
  const nodes = [...before, { type: "slot" as const, source: buildSlotSource(choice) }];
  const described = describeSlots(nodes);
  return described[described.length - 1];
}

describe("buildSlotSource", () => {
  it("writes each kind in its explicit form", () => {
    expect(buildSlotSource({ type: "dice", notation: "2d4" })).toBe("dice:2d4");
    expect(buildSlotSource({ type: "table", name: "Rumors", count: 1, unique: false })).toBe("table:Rumors");
    expect(buildSlotSource({ type: "table", name: "Rumors", count: 3, unique: false })).toBe("table:3 Rumors");
    expect(buildSlotSource({ type: "table", name: "Rumors", count: 3, unique: true })).toBe("table:3 unique Rumors");
    expect(buildSlotSource({ type: "draw", source: "Tarokka", count: 2 })).toBe("draw:2 from Tarokka");
    expect(buildSlotSource({ type: "ref", label: "A" })).toBe("ref:A");
    expect(buildSlotSource({ type: "ref", label: "A", field: "Faction" })).toBe("ref:A.Faction");
  });

  it("adds a label to the kinds that can have one", () => {
    expect(buildSlotSource({ type: "dice", notation: "2d4", label: "N" })).toBe("dice:2d4 as N");
    expect(buildSlotSource({ type: "table", name: "Person", count: 1, unique: false, label: "A" })).toBe(
      "table:Person as A",
    );
    expect(buildSlotSource({ type: "draw", source: "Tarot", count: 1, label: "C" })).toBe("draw:1 from Tarot as C");
  });

  it("trims names", () => {
    expect(buildSlotSource({ type: "table", name: "  Rumors ", count: 1, unique: false })).toBe("table:Rumors");
  });

  it("makes slots the parser reads back as asked", () => {
    expect(meaning({ type: "dice", notation: "4d6kh3", label: "S" })).toMatchObject({
      ok: true,
      type: "dice",
      label: "S",
    });
    expect(meaning({ type: "table", name: "d6", count: 1, unique: false })).toMatchObject({
      ok: true,
      type: "table",
      display: "d6",
    });
    expect(meaning({ type: "table", name: "Rumors", count: 3, unique: true })).toMatchObject({
      ok: true,
      type: "table",
      display: "3 unique Rumors",
    });
    expect(meaning({ type: "draw", source: "Tarokka deck", count: 2 })).toMatchObject({
      ok: true,
      type: "draw",
      display: "draw 2 from Tarokka deck",
    });
    expect(meaning({ type: "ref", label: "A" }, ["A"])).toMatchObject({ ok: true, type: "ref", display: "A" });
    expect(meaning({ type: "ref", label: "A", field: "Faction" }, ["A"])).toMatchObject({
      ok: true,
      type: "ref",
      display: "A.Faction",
    });
  });

  it("survives names with brackets when the entry is written out and read back", () => {
    const source = buildSlotSource({ type: "table", name: "Odd [name]", count: 1, unique: false });
    const text = modelToEntry([{ type: "slot", source }]);
    const back = entryToModel(text);
    expect(back.ok && back.nodes).toEqual([{ type: "slot", source }]);
    expect(meaning({ type: "table", name: "Odd [name]", count: 1, unique: false })).toMatchObject({
      ok: true,
      display: "Odd [name]",
    });
  });
});

describe("checkSlotChoice", () => {
  it("accepts good choices", () => {
    expect(checkSlotChoice({ type: "dice", notation: "2d4" })).toBeNull();
    expect(checkSlotChoice({ type: "table", name: "Rumors", count: MAX_PICKS, unique: true, label: "R" })).toBeNull();
    expect(checkSlotChoice({ type: "draw", source: "Tarot", count: 10 })).toBeNull();
    expect(checkSlotChoice({ type: "ref", label: "A" })).toBeNull();
  });

  it("asks for what is missing", () => {
    expect(checkSlotChoice({ type: "dice", notation: "  " })).toMatch(/formula/i);
    expect(checkSlotChoice({ type: "table", name: " ", count: 1, unique: false })).toMatch(/table/i);
    expect(checkSlotChoice({ type: "draw", source: "", count: 1 })).toMatch(/deck|set|pool/i);
    expect(checkSlotChoice({ type: "ref", label: "" })).toMatch(/result/i);
  });

  it("explains a formula that doesn't parse", () => {
    expect(checkSlotChoice({ type: "dice", notation: "2d" })).toMatch(/dice|formula|die/i);
  });

  it("keeps counts in range", () => {
    expect(checkSlotChoice({ type: "table", name: "R", count: 0, unique: false })).toMatch(/at least 1/i);
    expect(checkSlotChoice({ type: "table", name: "R", count: MAX_PICKS + 1, unique: false })).toMatch(
      new RegExp(String(MAX_PICKS)),
    );
    expect(checkSlotChoice({ type: "table", name: "R", count: 1.5, unique: false })).toMatch(/whole number/i);
    expect(checkSlotChoice({ type: "draw", source: "T", count: 11 })).toMatch(/10/);
    expect(checkSlotChoice({ type: "draw", source: "T", count: 0 })).toMatch(/at least 1/i);
  });

  it("only allows labels that are simple names", () => {
    expect(checkSlotChoice({ type: "dice", notation: "d6", label: "2nd" })).toMatch(/label/i);
    expect(checkSlotChoice({ type: "dice", notation: "d6", label: "has space" })).toMatch(/label/i);
    expect(checkSlotChoice({ type: "dice", notation: "d6", label: "" })).toBeNull(); // empty = no label
  });
});

describe("entity slot choices", () => {
  it("build the explicit form and read back as an entity slot", () => {
    expect(buildSlotSource({ type: "entity", name: "Person", count: 1, unique: false })).toBe("entity:Person");
    expect(buildSlotSource({ type: "entity", name: " Town folk ", count: 3, unique: true, label: "F" })).toBe("entity:3 unique Town folk as F");
    const parsed = parseEntry(`[${buildSlotSource({ type: "entity", name: "Person", count: 2, unique: false })}]`);
    expect(parsed.ok && parsed.parts[0]).toMatchObject({ slot: { type: "entity", name: "Person", count: 2, unique: false } });
  });
  it("are checked", () => {
    expect(checkSlotChoice({ type: "entity", name: "Person", count: 1, unique: false })).toBeNull();
    expect(checkSlotChoice({ type: "entity", name: "  ", count: 1, unique: false })).toMatch(/filter set or a tag/);
    expect(checkSlotChoice({ type: "entity", name: "P", count: 0, unique: false })).not.toBeNull();
  });
});

describe("link slots", () => {
  const id = "3f1c2a9e-5b7d-4e8a-9c01-2d4f6a8b0c1e";
  it("builds the explicit form, escaping brackets in the name", () => {
    expect(buildSlotSource({ type: "link", itemId: id, name: " Syra Pyroc " })).toBe(`link:${id} Syra Pyroc`);
    expect(buildSlotSource({ type: "link", itemId: id, name: "The [Old] Inn" })).toBe(`link:${id} The \\[Old\\] Inn`);
  });
  it("needs a real page id", () => {
    expect(checkSlotChoice({ type: "link", itemId: "nope", name: "x" })).toBe("Choose a page.");
    expect(checkSlotChoice({ type: "link", itemId: id, name: "x" })).toBeNull();
  });
});

describe("link names", () => {
  const id = "3f1c2a9e-5b7d-4e8a-9c01-2d4f6a8b0c1e";
  it("finds the pages entries link to, once each", () => {
    expect(linkIdsIn([`[link:${id} A] and [link:${id.toUpperCase()} B]`, "no links", "[link:bad]"])).toEqual([id]);
  });
  it("shows a chip with the page's current name once it is known", () => {
    const text = `[link:${id} Old name]`;
    const chip = () => {
      const r = parseEntry(text);
      if (!r.ok || r.parts[0].kind !== "slot") throw new Error("should parse");
      return slotDisplay(r.parts[0]);
    };
    expect(chip()).toBe("Old name");
    expect(rememberLinkNames([[id, "New name"]])).toBe(true);
    expect(chip()).toBe("New name");
    expect(rememberLinkNames([[id, "New name"]])).toBe(false);
  });
});
