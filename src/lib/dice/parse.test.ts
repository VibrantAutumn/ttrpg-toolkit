import { describe, expect, it } from "vitest";
import { MAX_DICE, MAX_SIDES, parseDice } from "./parse";

/** Parse and expect success, returning the expression. */
function ok(notation: string) {
  const result = parseDice(notation);
  if (!result.ok) throw new Error(`"${notation}" should parse but failed: ${result.error.message}`);
  return result.expression;
}

/** Parse and expect failure, returning the error. */
function bad(notation: string) {
  const result = parseDice(notation);
  if (result.ok) throw new Error(`"${notation}" should NOT parse`);
  return result.error;
}

describe("parseDice: basics", () => {
  it("parses a plain dice group", () => {
    expect(ok("2d6").terms).toMatchObject([
      { sign: 1, kind: "dice", count: 2, die: { type: "numeric", sides: 6 } },
    ]);
  });

  it("treats a missing count as one die", () => {
    expect(ok("d20").terms).toMatchObject([{ kind: "dice", count: 1, die: { sides: 20 } }]);
  });

  it("parses a modifier", () => {
    expect(ok("2d6+3").terms).toMatchObject([
      { sign: 1, kind: "dice", count: 2 },
      { sign: 1, kind: "constant", value: 3 },
    ]);
  });

  it("parses subtraction and several dice groups", () => {
    expect(ok("1d8+1d4-2").terms).toMatchObject([
      { sign: 1, kind: "dice", count: 1, die: { sides: 8 } },
      { sign: 1, kind: "dice", count: 1, die: { sides: 4 } },
      { sign: -1, kind: "constant", value: 2 },
    ]);
  });

  it("allows a subtracted dice group and a leading minus", () => {
    expect(ok("-1d4+10").terms).toMatchObject([
      { sign: -1, kind: "dice" },
      { sign: 1, kind: "constant", value: 10 },
    ]);
  });

  it("allows a constant on its own", () => {
    expect(ok("5").terms).toMatchObject([{ kind: "constant", value: 5 }]);
  });

  it("ignores spaces and letter case", () => {
    expect(ok("  2D6 + 3 ")).toEqual(ok("2d6+3"));
    expect(ok("4DF")).toEqual(ok("4dF"));
    expect(ok("4d6KH3")).toEqual(ok("4d6kh3"));
  });
});

describe("parseDice: keep and drop", () => {
  it("parses keep highest / keep lowest", () => {
    expect(ok("4d6kh3").terms[0]).toMatchObject({ keep: { mode: "keep", end: "highest", count: 3 } });
    expect(ok("2d20kl1").terms[0]).toMatchObject({ keep: { mode: "keep", end: "lowest", count: 1 } });
  });

  it("parses drop highest / drop lowest", () => {
    expect(ok("4d6dl1").terms[0]).toMatchObject({ keep: { mode: "drop", end: "lowest", count: 1 } });
    expect(ok("5d8dh2").terms[0]).toMatchObject({ keep: { mode: "drop", end: "highest", count: 2 } });
  });

  it("treats plain k as keep highest and a missing number as one", () => {
    expect(ok("3d6k2").terms[0]).toMatchObject({ keep: { mode: "keep", end: "highest", count: 2 } });
    expect(ok("2d20kh").terms[0]).toMatchObject({ keep: { mode: "keep", end: "highest", count: 1 } });
  });

  it("refuses to keep or drop more dice than are rolled", () => {
    expect(bad("2d6kh3").message).toMatch(/keep/i);
    expect(bad("3d6dl3").message).toMatch(/drop/i);
  });
});

describe("parseDice: advantage and disadvantage", () => {
  it("expands adv/dis on a single die into two dice, keeping one", () => {
    expect(ok("d20 adv").terms[0]).toMatchObject({
      count: 2,
      die: { sides: 20 },
      keep: { mode: "keep", end: "highest", count: 1 },
    });
    expect(ok("d20dis+5").terms[0]).toMatchObject({
      count: 2,
      keep: { mode: "keep", end: "lowest", count: 1 },
    });
  });

  it("only allows adv/dis on a single die", () => {
    expect(bad("2d20 adv").message).toMatch(/advantage/i);
  });
});

describe("parseDice: exploding", () => {
  it("explodes on the highest face by default", () => {
    expect(ok("3d6!").terms[0]).toMatchObject({ explode: { op: "=", value: 6 } });
  });

  it("accepts a chosen value or comparison", () => {
    expect(ok("3d10!>=9").terms[0]).toMatchObject({ explode: { op: ">=", value: 9 } });
    expect(ok("2d6!5").terms[0]).toMatchObject({ explode: { op: "=", value: 5 } });
    expect(ok("2d6!<2").terms[0]).toMatchObject({ explode: { op: "<", value: 2 } });
  });
});

describe("parseDice: rerolls", () => {
  it("r rerolls until the die no longer matches", () => {
    expect(ok("4d6r1").terms[0]).toMatchObject({ reroll: { op: "=", value: 1, once: false } });
    expect(ok("4d6r<=2").terms[0]).toMatchObject({ reroll: { op: "<=", value: 2, once: false } });
  });

  it("ro rerolls only once", () => {
    expect(ok("4d6ro1").terms[0]).toMatchObject({ reroll: { op: "=", value: 1, once: true } });
  });

  it("refuses a reroll that matches every face (it could never finish)", () => {
    expect(bad("2d6r<=6").message).toMatch(/reroll/i);
    expect(bad("1d4r>=1").message).toMatch(/reroll/i);
  });

  it("allows rerolling every face once, since that always finishes", () => {
    expect(ok("2d6ro<=6").terms[0]).toMatchObject({ reroll: { once: true } });
  });

  it("combines with exploding and keep, in that written order", () => {
    expect(ok("4d6r1!kh3").terms[0]).toMatchObject({
      count: 4,
      reroll: { value: 1 },
      explode: { value: 6 },
      keep: { end: "highest", count: 3 },
    });
  });
});

describe("parseDice: pools", () => {
  it("counts successes against a target", () => {
    expect(ok("6d10>=8").terms[0]).toMatchObject({ count: 6, target: { op: ">=", value: 8 } });
  });

  it("supports every comparison", () => {
    expect(ok("5d6>4").terms[0]).toMatchObject({ target: { op: ">", value: 4 } });
    expect(ok("5d6<=2").terms[0]).toMatchObject({ target: { op: "<=", value: 2 } });
    expect(ok("5d6<3").terms[0]).toMatchObject({ target: { op: "<", value: 3 } });
    expect(ok("5d6=6").terms[0]).toMatchObject({ target: { op: "=", value: 6 } });
  });

  it("combines with exploding", () => {
    expect(ok("6d10!>=8").terms[0]).toMatchObject({ explode: { op: ">=", value: 8 } });
    expect(ok("6d10!>=8").terms[0]).not.toHaveProperty("target");
    expect(ok("6d10!>=8>=8").terms[0]).toMatchObject({
      explode: { op: ">=", value: 8 },
      target: { op: ">=", value: 8 },
    });
  });
});

describe("parseDice: Fate dice", () => {
  it("parses dF", () => {
    expect(ok("4dF").terms).toMatchObject([{ kind: "dice", count: 4, die: { type: "fate" } }]);
  });

  it("allows a modifier and keep/drop", () => {
    expect(ok("4dF+2").terms).toHaveLength(2);
    expect(ok("4dFdl1").terms[0]).toMatchObject({ keep: { mode: "drop", end: "lowest", count: 1 } });
  });

  it("refuses exploding, rerolls and pools on Fate dice", () => {
    expect(bad("4dF!").message).toMatch(/fate/i);
    expect(bad("4dFr0").message).toMatch(/fate/i);
    expect(bad("4dF>=1").message).toMatch(/fate/i);
  });
});

describe("parseDice: limits", () => {
  it("exports the limits: 100 dice, 100 faces", () => {
    expect(MAX_DICE).toBe(100);
    expect(MAX_SIDES).toBe(100);
  });

  it("allows exactly the limits", () => {
    expect(ok("100d100").terms[0]).toMatchObject({ count: 100, die: { sides: 100 } });
  });

  it("refuses too many dice or faces", () => {
    expect(bad("101d6").message).toMatch(/100/);
    expect(bad("2d101").message).toMatch(/100/);
  });

  it("counts dice across the whole formula", () => {
    expect(bad("60d6+60d6").message).toMatch(/100/);
  });

  it("refuses zero dice or a zero-sided die", () => {
    expect(bad("0d6").message).toMatch(/at least/i);
    expect(bad("2d0").message).toMatch(/at least/i);
  });
});

describe("parseDice: errors", () => {
  it("rejects empty input", () => {
    expect(bad("").message).toMatch(/empty|nothing/i);
    expect(bad("   ").message).toMatch(/empty|nothing/i);
  });

  it("rejects stray characters and says where", () => {
    const err = bad("2d6+x");
    expect(err.position).toBe(4);
  });

  it("rejects unfinished formulas", () => {
    expect(bad("2d").position).toBe(2);
    expect(bad("2d6+").position).toBe(4);
    expect(bad("d").position).toBe(1);
  });

  it("rejects things we deliberately do not support yet", () => {
    for (const text of ["2d6*2", "(1d6)", "2d6/2"]) {
      expect(parseDice(text).ok).toBe(false);
    }
  });

  it("rejects a modifier twice and modifiers in the wrong order", () => {
    expect(parseDice("4d6kh3kh2").ok).toBe(false);
    expect(parseDice("4d6kh3r1").ok).toBe(false);
  });

  it("rejects numbers too big to be sensible", () => {
    expect(parseDice("2d6+99999999999999999999").ok).toBe(false);
  });

  it("never throws on odd input", () => {
    for (const text of ["+", "-", "d+", "dd6", "2d6!!", "2d6>=", "2d6kh-1", "٣d٦", "2d6 2d6"]) {
      expect(() => parseDice(text)).not.toThrow();
    }
  });
});
