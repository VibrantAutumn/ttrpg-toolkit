import { describe, expect, it } from "vitest";
import { MAX_WEIGHT, entryRanges, formatRange, parseWeightInput, rangeNote } from "./ranges";

describe("entryRanges", () => {
  it("lays the entries end to end, each as wide as its weight", () => {
    expect(entryRanges([1, 3, 2])).toEqual([
      { start: 1, end: 1 },
      { start: 2, end: 4 },
      { start: 5, end: 6 },
    ]);
  });

  it("gives no range to an entry with weight 0, and carries on after it", () => {
    expect(entryRanges([2, 0, 1])).toEqual([{ start: 1, end: 2 }, null, { start: 3, end: 3 }]);
  });

  it("handles no entries", () => {
    expect(entryRanges([])).toEqual([]);
  });
});

describe("formatRange", () => {
  it("writes one number for a range of one, and two for more", () => {
    expect(formatRange({ start: 4, end: 4 })).toBe("4");
    expect(formatRange({ start: 11, end: 30 })).toBe("11–30");
  });

  it("writes a dash for an entry that is never picked", () => {
    expect(formatRange(null)).toBe("—");
  });
});

describe("parseWeightInput", () => {
  const weight = (text: string) => {
    const r = parseWeightInput(text);
    if (!r.ok) throw new Error(`"${text}" should parse: ${r.message}`);
    return r.weight;
  };
  const message = (text: string) => {
    const r = parseWeightInput(text);
    if (r.ok) throw new Error(`"${text}" should not parse`);
    return r.message;
  };

  it("reads a plain number as the weight", () => {
    expect(weight("3")).toBe(3);
    expect(weight("  12 ")).toBe(12);
    expect(weight("0")).toBe(0);
    expect(weight("007")).toBe(7);
  });

  it("reads a range as its width", () => {
    expect(weight("11-30")).toBe(20);
    expect(weight("5–5")).toBe(1);
    expect(weight("1 — 100")).toBe(100);
    expect(weight("01-10")).toBe(10);
  });

  it("refuses a range that runs backwards", () => {
    expect(message("30-11")).toMatch(/backwards|start/i);
  });

  it("refuses empty or non-numeric text", () => {
    expect(message("")).toMatch(/number|range/i);
    expect(message("  ")).toMatch(/number|range/i);
    expect(message("abc")).toMatch(/number|range/i);
    expect(message("2.5")).toMatch(/number|range/i);
    expect(message("-3")).toMatch(/number|range/i);
    expect(message("1-")).toMatch(/number|range/i);
  });

  it("refuses a weight above the limit", () => {
    expect(weight(String(MAX_WEIGHT))).toBe(MAX_WEIGHT);
    expect(message(String(MAX_WEIGHT + 1))).toMatch(new RegExp(String(MAX_WEIGHT).replace(/(\d)(?=(\d{3})+$)/g, "$1,?")));
    expect(message(`1-${MAX_WEIGHT + 1}`)).toMatch(/at most|more than|10/i);
  });
});

describe("rangeNote", () => {
  it("says nothing when there is no die, or when the entries fill it exactly", () => {
    expect(rangeNote(37, null)).toBeNull();
    expect(rangeNote(100, 100)).toBeNull();
  });

  it("says which numbers are left without an entry", () => {
    expect(rangeNote(85, 100)).toMatch(/86.{1,3}100/);
  });

  it("says when a single number is left", () => {
    expect(rangeNote(19, 20)).toMatch(/\b20\b/);
    expect(rangeNote(19, 20)).not.toMatch(/20–20/); // one number, not a range of one
  });

  it("says when the entries add up to more than the die", () => {
    const note = rangeNote(120, 100) ?? "";
    expect(note).toMatch(/120/);
    expect(note).toMatch(/d100/);
  });

  it("says when there are no entries yet", () => {
    expect(rangeNote(0, 20)).toMatch(/d20/);
  });
});
