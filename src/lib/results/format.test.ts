import { describe, expect, it } from "vitest";
import { parseDice } from "../dice/parse";
import { rollDice } from "../dice/roll";
import { scripted } from "../dice/testing";
import { formatDiceResult, termTexts } from "./format";

function text(notation: string, ...values: number[]): string {
  const parsed = parseDice(notation);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return formatDiceResult(rollDice(parsed.expression, scripted(...values)));
}

describe("formatDiceResult", () => {
  it("shows the dice, the modifier and the total", () => {
    expect(text("2d6+3", 4, 5)).toBe("2d6+3 → [4, 5] + 3 = 12");
  });

  it("shows dropped dice in brackets", () => {
    expect(text("4d6kh3", 2, 6, 3, 5)).toBe("4d6kh3 → [(2), 6, 3, 5] = 14");
  });

  it("marks exploding dice", () => {
    expect(text("1d6!", 6, 4)).toBe("1d6! → [6!, 4] = 10");
  });

  it("shows what a reroll replaced", () => {
    expect(text("1d6r1", 1, 4)).toBe("1d6r1 → [4 (was 1)] = 4");
    expect(text("1d6r1", 1, 1, 5)).toBe("1d6r1 → [5 (was 1, 1)] = 5");
  });

  it("marks successes in a pool and counts them", () => {
    expect(text("4d10>=8", 10, 3, 8, 1)).toBe("4d10>=8 → [10✓, 3, 8✓, 1] = 2 successes");
    expect(text("2d10>=8", 9, 2)).toBe("2d10>=8 → [9✓, 2] = 1 success");
  });

  it("does not say 'successes' when a pool is mixed with other terms", () => {
    expect(text("2d6>=5+1", 5, 1)).toBe("2d6>=5+1 → [5✓, 1] + 1 = 2");
  });

  it("writes Fate dice as + - and 0", () => {
    expect(text("4dF", -1, 0, 1, 1)).toBe("4df → [-, 0, +, +] = 1");
  });

  it("handles several terms and subtraction", () => {
    expect(text("1d8+1d4-2", 6, 3)).toBe("1d8+1d4-2 → [6] + [3] - 2 = 7");
  });

  it("handles a negative leading term and a negative total", () => {
    expect(text("-1d4", 3)).toBe("-1d4 → -[3] = -3");
    expect(text("1d4-10", 2)).toBe("1d4-10 → [2] - 10 = -8");
  });

  it("says when a limit stopped the roll", () => {
    const out = text("1d1!", ...Array(101).fill(1));
    expect(out.endsWith("(stopped early: a roll limit was reached)")).toBe(true);
  });
});

describe("termTexts", () => {
  it("writes each term on its own, without signs", () => {
    const parsed = parseDice("1d8+1d4-2");
    if (!parsed.ok) throw new Error("should parse");
    expect(termTexts(rollDice(parsed.expression, scripted(6, 3)))).toEqual(["[6]", "[3]", "2"]);
  });

  it("uses + - 0 for Fate dice", () => {
    const parsed = parseDice("2dF");
    if (!parsed.ok) throw new Error("should parse");
    expect(termTexts(rollDice(parsed.expression, scripted(-1, 1)))).toEqual(["[-, +]"]);
  });
});
