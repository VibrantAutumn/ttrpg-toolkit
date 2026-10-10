import { describe, expect, it } from "vitest";
import { MAX_PICKS, MAX_SLOTS, parseEntry, slotCanonical, slotDisplay } from "./parse";
import type { SlotPart } from "./parse";

/** Parse and expect success, returning the parts. */
function ok(text: string) {
  const result = parseEntry(text);
  if (!result.ok) throw new Error(`"${text}" should parse but failed: ${result.error.message}`);
  return result.parts;
}

/** Parse and expect failure, returning the error. */
function bad(text: string) {
  const result = parseEntry(text);
  if (result.ok) throw new Error(`"${text}" should NOT parse`);
  return result.error;
}

/** Parse text that holds exactly one slot and return it. */
function oneSlot(text: string): SlotPart {
  const slots = ok(text).filter((p): p is SlotPart => p.kind === "slot");
  expect(slots).toHaveLength(1);
  return slots[0];
}

describe("parseEntry: plain text", () => {
  it("keeps plain text as one text part", () => {
    expect(ok("A rusty sword")).toEqual([{ kind: "text", text: "A rusty sword" }]);
  });

  it("gives no parts for empty text", () => {
    expect(ok("")).toEqual([]);
  });

  it("keeps whitespace and newlines exactly", () => {
    expect(ok("  two  spaces\nand a line  ")).toEqual([
      { kind: "text", text: "  two  spaces\nand a line  " },
    ]);
  });

  it("splits text around a slot", () => {
    const parts = ok("Meet [Rumors] today");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ kind: "text", text: "Meet " });
    expect(parts[1]).toMatchObject({ kind: "slot" });
    expect(parts[2]).toEqual({ kind: "text", text: " today" });
  });

  it("handles a slot at the very start and end with no empty text parts", () => {
    const parts = ok("[Rumors][Names]");
    expect(parts.map((p) => p.kind)).toEqual(["slot", "slot"]);
  });
});

describe("parseEntry: escapes", () => {
  it("turns \\[ \\] and \\\\ into literal characters", () => {
    expect(ok("a \\[not a slot\\] b \\\\ c")).toEqual([
      { kind: "text", text: "a [not a slot] b \\ c" },
    ]);
  });

  it("keeps a backslash before any other character as it is", () => {
    expect(ok("path\\n here")).toEqual([{ kind: "text", text: "path\\n here" }]);
  });

  it("merges escaped characters into the surrounding text", () => {
    const parts = ok("see \\[1\\] then [Rumors]");
    expect(parts[0]).toEqual({ kind: "text", text: "see [1] then " });
  });

  it("a trailing lone backslash is just a backslash", () => {
    expect(ok("end\\")).toEqual([{ kind: "text", text: "end\\" }]);
  });
});

describe("parseEntry: positions of slots", () => {
  it("records where each slot starts and ends in the original text", () => {
    const slot = oneSlot("ab [Rumors] cd");
    expect(slot.start).toBe(3);
    expect(slot.end).toBe(11);
    expect("ab [Rumors] cd".slice(slot.start, slot.end)).toBe("[Rumors]");
  });

  it("counts escapes when positioning later slots", () => {
    const text = "\\[x\\] [Rumors]";
    const slot = oneSlot(text);
    expect(text.slice(slot.start, slot.end)).toBe("[Rumors]");
  });

  it("keeps the raw text inside the brackets", () => {
    expect(oneSlot("[ 3 unique Rumors ]").source).toBe("3 unique Rumors");
  });
});

describe("parseEntry: table slots", () => {
  it("reads a bare name as a table", () => {
    expect(oneSlot("[Rumors]").slot).toEqual({ type: "table", name: "Rumors", count: 1, unique: false });
  });

  it("allows spaces and punctuation inside a table name", () => {
    expect(oneSlot("[Tavern names (north)]").slot).toMatchObject({ type: "table", name: "Tavern names (north)" });
  });

  it("trims spaces inside the brackets", () => {
    expect(oneSlot("[  Rumors  ]").slot).toMatchObject({ name: "Rumors" });
  });

  it("reads a count: three rolls that may repeat", () => {
    expect(oneSlot("[3 Rumors]").slot).toEqual({ type: "table", name: "Rumors", count: 3, unique: false });
  });

  it("reads unique picks", () => {
    expect(oneSlot("[3 unique Rumors]").slot).toEqual({ type: "table", name: "Rumors", count: 3, unique: true });
  });

  it("ignores letter case of the word unique", () => {
    expect(oneSlot("[2 Unique Rumors]").slot).toMatchObject({ count: 2, unique: true });
  });

  it("refuses unique without a count", () => {
    expect(bad("[unique Rumors]").message).toMatch(/how many/i);
  });

  it("refuses a count of zero", () => {
    expect(bad("[0 Rumors]").message).toMatch(/at least 1/i);
  });

  it("refuses a count above the limit", () => {
    expect(bad(`[${MAX_PICKS + 1} Rumors]`).message).toMatch(new RegExp(String(MAX_PICKS)));
  });

  it("accepts the largest allowed count", () => {
    expect(oneSlot(`[${MAX_PICKS} Rumors]`).slot).toMatchObject({ count: MAX_PICKS });
  });

  it("treats a plain number alone as a table name, not as dice", () => {
    expect(oneSlot("[5]").slot).toMatchObject({ type: "table", name: "5" });
  });

  it("reads the explicit form", () => {
    expect(oneSlot("[table:Rumors]").slot).toEqual({ type: "table", name: "Rumors", count: 1, unique: false });
  });

  it("reads count and unique in the explicit form", () => {
    expect(oneSlot("[table:3 unique Rumors]").slot).toEqual({ type: "table", name: "Rumors", count: 3, unique: true });
  });

  it("lets the explicit form name a table that looks like dice", () => {
    expect(oneSlot("[table:d6]").slot).toMatchObject({ type: "table", name: "d6" });
  });

  it("lets the explicit form name a table that looks like a draw", () => {
    expect(oneSlot("[table:draw 1 from Tarot]").slot).toMatchObject({ type: "table", name: "draw 1 from Tarot" });
  });

  it("refuses an explicit table with no name", () => {
    expect(bad("[table:]").message).toMatch(/name/i);
  });
});

describe("parseEntry: dice slots", () => {
  it("reads dice shorthand", () => {
    expect(oneSlot("[2d4]").slot).toEqual({ type: "dice", notation: "2d4" });
  });

  it("reads a larger formula and normalises it", () => {
    expect(oneSlot("[4d6 kh3 + 2]").slot).toEqual({ type: "dice", notation: "4d6kh3+2" });
  });

  it("reads the explicit form", () => {
    expect(oneSlot("[dice:2d4]").slot).toEqual({ type: "dice", notation: "2d4" });
  });

  it("reads d6 as dice, not as a table", () => {
    expect(oneSlot("[d6]").slot).toEqual({ type: "dice", notation: "d6" });
  });

  it("reports a bad explicit formula with the dice parser's message", () => {
    const error = bad("[dice:2d]");
    expect(error.message).toMatch(/dice/i);
  });

  it("puts the error position of a bad formula inside the slot", () => {
    const text = "ab [dice:2d] cd";
    const error = bad(text);
    expect(error.position).toBeGreaterThanOrEqual(3);
    expect(error.position).toBeLessThan(12);
  });

  it("refuses an empty explicit formula", () => {
    expect(bad("[dice:]").message).toMatch(/formula/i);
  });
});

describe("parseEntry: draw slots", () => {
  it("reads the shorthand", () => {
    expect(oneSlot("[draw 1 from Tarot]").slot).toEqual({ type: "draw", count: 1, source: "Tarot" });
  });

  it("reads the explicit form", () => {
    expect(oneSlot("[draw:3 from Tarokka deck]").slot).toEqual({ type: "draw", count: 3, source: "Tarokka deck" });
  });

  it("ignores letter case of draw and from", () => {
    expect(oneSlot("[Draw 2 FROM Tarot]").slot).toEqual({ type: "draw", count: 2, source: "Tarot" });
  });

  it("refuses a count of zero or above the limit", () => {
    expect(bad("[draw 0 from Tarot]").message).toMatch(/at least 1/i);
    expect(bad("[draw 11 from Tarot]").message).toMatch(/10/);
  });

  it("refuses an explicit draw without a source", () => {
    expect(bad("[draw:2]").message).toMatch(/from/i);
  });

  it("refuses an explicit draw with an empty source", () => {
    expect(bad("[draw:2 from ]").message).toMatch(/from/i);
  });
});

describe("parseEntry: labels and references", () => {
  it("binds a label to a table slot", () => {
    expect(oneSlot("[Person as A]")).toMatchObject({
      slot: { type: "table", name: "Person" },
      label: "A",
    });
  });

  it("binds a label to dice and draws", () => {
    expect(oneSlot("[2d4 as N]")).toMatchObject({ slot: { type: "dice" }, label: "N" });
    expect(oneSlot("[draw 1 from Tarot as C]")).toMatchObject({ slot: { type: "draw" }, label: "C" });
  });

  it("binds a label in the explicit form too", () => {
    expect(oneSlot("[table:Rumors as R]")).toMatchObject({ slot: { type: "table", name: "Rumors" }, label: "R" });
  });

  it("ignores letter case of the word as", () => {
    expect(oneSlot("[Person AS A]").label).toBe("A");
  });

  it("reuses a label set earlier in the same entry", () => {
    const parts = ok("[Person as A] met [A]");
    const slots = parts.filter((p): p is SlotPart => p.kind === "slot");
    expect(slots[1].slot).toEqual({ type: "ref", label: "A" });
  });

  it("matches a reused label ignoring case and keeps the label's spelling", () => {
    const parts = ok("[Person as Hero] and [hero]");
    const slots = parts.filter((p): p is SlotPart => p.kind === "slot");
    expect(slots[1].slot).toEqual({ type: "ref", label: "Hero" });
  });

  it("reads a field reference on a known label", () => {
    const parts = ok("[Person as A] of [A.Faction]");
    const slots = parts.filter((p): p is SlotPart => p.kind === "slot");
    expect(slots[1].slot).toEqual({ type: "ref", label: "A", field: "Faction" });
  });

  it("treats a name that is not a label as a table", () => {
    expect(oneSlot("[A]").slot).toMatchObject({ type: "table", name: "A" });
  });

  it("does not use a label before it is set", () => {
    const parts = ok("[A] then [Person as A]");
    const slots = parts.filter((p): p is SlotPart => p.kind === "slot");
    expect(slots[0].slot).toMatchObject({ type: "table", name: "A" });
  });

  it("the explicit ref form needs a label set earlier", () => {
    expect(bad("[ref:A]").message).toMatch(/label/i);
    const parts = ok("[Person as A][ref:A]");
    const slots = parts.filter((p): p is SlotPart => p.kind === "slot");
    expect(slots[1].slot).toEqual({ type: "ref", label: "A" });
  });

  it("lets the explicit table form name a table that is also a label", () => {
    const parts = ok("[Person as A][table:A]");
    const slots = parts.filter((p): p is SlotPart => p.kind === "slot");
    expect(slots[1].slot).toMatchObject({ type: "table", name: "A" });
  });

  it("refuses the same label twice", () => {
    expect(bad("[Person as A] [Object as a]").message).toMatch(/already/i);
  });

  it("refuses a label that is not a simple name", () => {
    expect(bad("[Person as 2nd]").message).toMatch(/label/i);
    expect(bad("[Person as ]").message).toMatch(/label/i);
  });

  it("refuses a label on a reference", () => {
    expect(bad("[Person as A] [A as B]").message).toMatch(/label/i);
  });
});

describe("parseEntry: entity slots", () => {
  it("reads an explicit entity slot, with a count and unique like a table slot", () => {
    expect(oneSlot("[entity:Person]").slot).toEqual({ type: "entity", name: "Person", count: 1, unique: false });
    expect(oneSlot("[entity:3 unique Person]").slot).toEqual({ type: "entity", name: "Person", count: 3, unique: true });
    expect(oneSlot("[entity:2 Town folk as F]")).toMatchObject({ slot: { type: "entity", name: "Town folk", count: 2, unique: false }, label: "F" });
  });
  it("has no shorthand: [Person] is still a table slot until it is rolled", () => {
    expect(oneSlot("[Person]").slot).toEqual({ type: "table", name: "Person", count: 1, unique: false });
  });
  it("refuses an entity slot with no name or a bad count", () => {
    for (const text of ["[entity:]", "[entity:0 Person]", "[entity:99 Person]"]) {
      expect(parseEntry(text).ok, text).toBe(false);
    }
  });
  it("writes itself back in the explicit form and shows a short name", () => {
    expect(slotCanonical(oneSlot("[entity:Person]"))).toBe("entity:Person");
    expect(slotCanonical(oneSlot("[entity:2 unique Person as P]"))).toBe("entity:2 unique Person as P");
    expect(slotDisplay(oneSlot("[entity:2 unique Person]"))).toBe("2 unique Person");
    for (const text of ["[entity:Person]", "[entity:3 unique Town folk as F]"]) {
      expect(oneSlot(`[${slotCanonical(oneSlot(text))}]`).slot).toEqual(oneSlot(text).slot);
    }
  });
});

describe("parseEntry: unknown slot types", () => {
  it("keeps an unknown explicit type instead of failing", () => {
    expect(oneSlot("[mood:Calm]").slot).toEqual({ type: "unknown", kind: "mood", args: "Calm" });
  });

  it("still allows a label on an unknown type", () => {
    expect(oneSlot("[mood:Calm as P]")).toMatchObject({
      slot: { type: "unknown", kind: "mood", args: "Calm" },
      label: "P",
    });
  });

  it("only lowercase text before a colon counts as a type, so names with colons still work", () => {
    expect(oneSlot("[Loot: rare]").slot).toMatchObject({ type: "table", name: "Loot: rare" });
  });

  it("needs the colon straight after the type", () => {
    expect(oneSlot("[loot : rare]").slot).toMatchObject({ type: "table" });
  });
});

describe("parseEntry: errors", () => {
  it("refuses an unclosed bracket and points at it", () => {
    const error = bad("hello [Rumors");
    expect(error.message).toMatch(/\]/);
    expect(error.position).toBe(6);
  });

  it("refuses a stray closing bracket and points at it", () => {
    const error = bad("hello ] there");
    expect(error.message).toMatch(/\\\]/);
    expect(error.position).toBe(6);
  });

  it("refuses an empty slot", () => {
    const error = bad("a [] b");
    expect(error.message).toMatch(/empty/i);
    expect(error.position).toBe(2);
  });

  it("refuses a slot with only spaces", () => {
    expect(bad("[   ]").message).toMatch(/empty/i);
  });

  it("refuses a bracket inside a slot and points at it", () => {
    const error = bad("[Rumors [x]]");
    expect(error.message).toMatch(/inside/i);
    expect(error.position).toBe(8);
  });

  it("allows an escaped bracket inside a slot name", () => {
    expect(oneSlot("[Odd \\[name\\]]").slot).toMatchObject({ type: "table", name: "Odd [name]" });
  });

  it("refuses too many slots", () => {
    const text = "[Rumors]".repeat(MAX_SLOTS + 1);
    expect(bad(text).message).toMatch(new RegExp(String(MAX_SLOTS)));
  });

  it("accepts exactly the largest number of slots", () => {
    expect(ok("[Rumors]".repeat(MAX_SLOTS))).toHaveLength(MAX_SLOTS);
  });

  it("never throws, whatever the input", () => {
    const nasty = ["[", "]", "[[", "]]", "\\", "[\\", "[a as", "[:]", "[a:b:c]", "[ as A]", "[draw", "[draw:]", "\u0000[", "[table:\\]"];
    for (const text of nasty) expect(() => parseEntry(text)).not.toThrow();
  });
});

describe("slotCanonical and slotDisplay", () => {
  const first = (text: string) => oneSlot(text);

  it("writes the explicit form for every kind of slot", () => {
    expect(slotCanonical(first("[2d4]"))).toBe("dice:2d4");
    expect(slotCanonical(first("[Rumors]"))).toBe("table:Rumors");
    expect(slotCanonical(first("[3 unique Rumors]"))).toBe("table:3 unique Rumors");
    expect(slotCanonical(first("[3 Rumors]"))).toBe("table:3 Rumors");
    expect(slotCanonical(first("[draw 1 from Tarot]"))).toBe("draw:1 from Tarot");
    expect(slotCanonical(first("[mood:Calm]"))).toBe("mood:Calm");
  });

  it("includes the label", () => {
    expect(slotCanonical(first("[Person as A]"))).toBe("table:Person as A");
  });

  it("writes references", () => {
    const parts = ok("[Person as A] [A] [A.Faction]").filter((p): p is SlotPart => p.kind === "slot");
    expect(slotCanonical(parts[1])).toBe("ref:A");
    expect(slotCanonical(parts[2])).toBe("ref:A.Faction");
  });

  it("round-trips: the explicit form parses back to the same slot", () => {
    for (const text of ["[2d4]", "[Rumors]", "[3 unique Rumors]", "[draw 2 from Tarot]", "[Person as A]", "[table:d6]", "[mood:Calm]"]) {
      const slot = oneSlot(text);
      const again = oneSlot(`[${slotCanonical(slot)}]`);
      expect(again.slot).toEqual(slot.slot);
      expect(again.label).toEqual(slot.label);
    }
  });

  it("escapes brackets in names when writing the explicit form", () => {
    const slot = oneSlot("[Odd \\[name\\]]");
    expect(slotCanonical(slot)).toBe("table:Odd \\[name\\]");
    expect(oneSlot(`[${slotCanonical(slot)}]`).slot).toEqual(slot.slot);
  });

  it("gives short friendly display text for chips", () => {
    expect(slotDisplay(first("[2d4]"))).toBe("2d4");
    expect(slotDisplay(first("[table:d6]"))).toBe("d6");
    expect(slotDisplay(first("[Rumors]"))).toBe("Rumors");
    expect(slotDisplay(first("[3 unique Rumors]"))).toBe("3 unique Rumors");
    expect(slotDisplay(first("[draw 1 from Tarot]"))).toBe("draw 1 from Tarot");
    expect(slotDisplay(first("[Person as A]"))).toBe("Person as A");
    expect(slotDisplay(first("[mood:Calm]"))).toBe("mood: Calm");
  });

  it("shows references by label (and field)", () => {
    const parts = ok("[Person as A] [A] [A.Faction]").filter((p): p is SlotPart => p.kind === "slot");
    expect(slotDisplay(parts[1])).toBe("A");
    expect(slotDisplay(parts[2])).toBe("A.Faction");
  });
});
