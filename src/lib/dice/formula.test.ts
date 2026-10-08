import { describe, expect, it } from "vitest";
import { checkFormula, describeParseError, QUICK_ROLLS } from "./formula";
import { parseDice } from "./parse";

describe("checkFormula", () => {
  it("accepts a good formula and keeps it as typed, minus outer spaces", () => {
    expect(checkFormula("1d20+5")).toEqual({ ok: true, notation: "1d20+5" });
    expect(checkFormula("  2d6 + 3 ")).toEqual({ ok: true, notation: "2d6 + 3" });
  });

  it("refuses an empty formula", () => {
    const r = checkFormula("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/empty|nothing/i);
  });

  it("refuses bad notation with a message that says where", () => {
    const r = checkFormula("2d6*2");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/at character 4/);
  });

  it("refuses formulas that are too long to store", () => {
    const r = checkFormula("1d6" + "+1".repeat(200));
    expect(r.ok).toBe(false);
  });
});

describe("describeParseError", () => {
  it("counts characters from one for people", () => {
    expect(describeParseError({ message: "Unexpected \"x\"", position: 3 })).toBe(
      'Unexpected "x" (at character 4)',
    );
  });
});

describe("QUICK_ROLLS", () => {
  it("offers the usual dice, then advantage and disadvantage", () => {
    expect(QUICK_ROLLS.map((q) => q.label)).toEqual([
      "d4",
      "d6",
      "d8",
      "d10",
      "d12",
      "d20",
      "d100",
      "d20 adv",
      "d20 dis",
    ]);
  });

  it("only contains notation the parser accepts", () => {
    for (const q of QUICK_ROLLS) {
      expect(parseDice(q.notation).ok, q.label).toBe(true);
    }
  });
});
