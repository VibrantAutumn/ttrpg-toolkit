import { describe, expect, it } from "vitest";
import { parseDice } from "./parse";
import { createRng } from "./rng";
import { MAX_EXPLOSIONS, MAX_REROLLS, rollDice, rollNotation } from "./roll";
import { scripted } from "./testing";

/**
 * Roll `notation` using a scripted source. Dice are asked for in this order:
 * for each die, its first roll, then any rerolls of it, then its explosions,
 * before moving to the next die.
 */
function roll(notation: string, ...values: number[]) {
  const parsed = parseDice(notation);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const rng = scripted(...values);
  const result = rollDice(parsed.expression, rng);
  expect(rng.remaining(), "the roller should use every scripted value").toBe(0);
  return result;
}

/** The face values of the first group's dice, in order, with a marker for dropped dice. */
const faces = (r: ReturnType<typeof roll>) =>
  r.terms[0].kind === "dice" ? r.terms[0].dice.map((d) => (d.kept ? d.value : `~${d.value}`)) : [];

describe("rollDice: basics", () => {
  it("adds up dice and a modifier", () => {
    const r = roll("2d6+3", 4, 5);
    expect(r.total).toBe(12);
    expect(faces(r)).toEqual([4, 5]);
  });

  it("subtracts", () => {
    expect(roll("1d8-2", 5).total).toBe(3);
    expect(roll("5-1d4", 3).total).toBe(2);
  });

  it("can go negative", () => {
    expect(roll("1d4-10", 2).total).toBe(-8);
  });

  it("sums several groups and keeps a subtotal per term", () => {
    const r = roll("1d8+1d4-2", 6, 3);
    expect(r.total).toBe(7);
    expect(r.terms.map((t) => t.subtotal)).toEqual([6, 3, -2]);
  });

  it("subtracts a dice group's whole subtotal", () => {
    const r = roll("-2d4", 1, 3);
    expect(r.total).toBe(-4);
    expect(r.terms[0].subtotal).toBe(-4);
  });

  it("rolls a constant without using any randomness", () => {
    expect(roll("7").total).toBe(7);
  });

  it("remembers the notation it rolled", () => {
    expect(roll("2d6 + 3", 1, 1).notation).toBe("2d6+3");
  });
});

describe("rollDice: keep and drop", () => {
  it("keeps the highest dice and marks the rest dropped", () => {
    const r = roll("4d6kh3", 2, 6, 3, 5);
    expect(faces(r)).toEqual(["~2", 6, 3, 5]);
    expect(r.total).toBe(14);
  });

  it("keeps the lowest", () => {
    const r = roll("3d10kl2", 9, 2, 5);
    expect(r.total).toBe(7);
    expect(faces(r)).toEqual(["~9", 2, 5]);
  });

  it("drops the lowest / highest", () => {
    expect(roll("4d6dl1", 1, 4, 4, 6).total).toBe(14);
    expect(roll("4d6dh1", 1, 4, 4, 6).total).toBe(9);
  });

  it("drops only one die when there is a tie for lowest", () => {
    const r = roll("3d6dl1", 2, 2, 5);
    expect(r.total).toBe(7);
    expect(r.terms[0].kind === "dice" && r.terms[0].dice.filter((d) => !d.kept)).toHaveLength(1);
  });
});

describe("rollDice: advantage and disadvantage", () => {
  it("takes the higher die for advantage", () => {
    const r = roll("d20 adv+5", 7, 15);
    expect(r.total).toBe(20);
    expect(faces(r)).toEqual(["~7", 15]);
  });

  it("takes the lower die for disadvantage", () => {
    expect(roll("d20 dis", 7, 15).total).toBe(7);
  });
});

describe("rollDice: Fate dice", () => {
  it("rolls -1, 0 or +1 per die", () => {
    const r = roll("4dF", -1, 0, 1, 1);
    expect(r.total).toBe(1);
    expect(faces(r)).toEqual([-1, 0, 1, 1]);
  });

  it("adds a modifier", () => {
    expect(roll("4dF+2", 1, 1, 0, -1).total).toBe(3);
  });
});

describe("rollDice: exploding", () => {
  it("rolls an extra die on the highest face and adds it", () => {
    const r = roll("1d6!", 6, 4);
    expect(r.total).toBe(10);
    expect(r.terms[0].kind === "dice" && r.terms[0].dice).toMatchObject([
      { value: 6, exploded: true, fromExplosion: false },
      { value: 4, exploded: false, fromExplosion: true },
    ]);
  });

  it("keeps exploding while the extra dice also explode", () => {
    expect(roll("1d6!", 6, 6, 6, 2).total).toBe(20);
  });

  it("explodes each die separately", () => {
    expect(roll("2d6!", 6, 1, 3).total).toBe(10);
  });

  it("explodes on a chosen value or comparison", () => {
    expect(roll("1d10!>=9", 9, 10, 3).total).toBe(22);
    expect(roll("1d6!<=2", 1, 2, 5).total).toBe(8);
  });

  it("stops after the explosion cap so it cannot loop forever", () => {
    // d1 always rolls its highest face, so it would explode without end.
    const values = Array(MAX_EXPLOSIONS + 1).fill(1);
    const r = roll("1d1!", ...values);
    expect(r.total).toBe(MAX_EXPLOSIONS + 1);
    expect(r.capped).toBe(true);
  });

  it("does not flag capped on a normal roll", () => {
    expect(roll("1d6!", 6, 4).capped).toBe(false);
  });
});

describe("rollDice: rerolls", () => {
  it("rerolls a matching die until it stops matching", () => {
    const r = roll("1d6r1", 1, 1, 4);
    expect(r.total).toBe(4);
    expect(r.terms[0].kind === "dice" && r.terms[0].dice[0]).toMatchObject({
      value: 4,
      rerolledFrom: [1, 1],
    });
  });

  it("rerolls only once with ro, keeping the new value even if it matches", () => {
    expect(roll("1d6ro1", 1, 1).total).toBe(1);
    expect(roll("1d6ro1", 1, 5).total).toBe(5);
  });

  it("leaves non-matching dice alone", () => {
    const r = roll("2d6r1", 3, 5);
    expect(r.total).toBe(8);
    expect(r.terms[0].kind === "dice" && r.terms[0].dice[0].rerolledFrom).toEqual([]);
  });

  it("supports comparisons", () => {
    expect(roll("1d6r<=2", 2, 1, 6).total).toBe(6);
  });

  it("rerolls before exploding", () => {
    // 1 is rerolled to 6, which then explodes into 3.
    expect(roll("1d6r1!", 1, 6, 3).total).toBe(9);
  });

  it("stops after the reroll cap", () => {
    // d2 rerolling 1 or 2 is refused by the parser, so use a rule that
    // almost never ends: reroll everything but the top face of a d100.
    const values = [...Array(MAX_REROLLS).fill(1), 1];
    const r = roll("1d100r<=99", ...values);
    expect(r.capped).toBe(true);
  });
});

describe("rollDice: pools", () => {
  it("counts dice that meet the target", () => {
    const r = roll("6d10>=8", 10, 3, 8, 7, 9, 1);
    expect(r.total).toBe(3);
    expect(r.terms[0].kind === "dice" && r.terms[0].dice.map((d) => d.success)).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("supports every comparison", () => {
    expect(roll("3d6>4", 4, 5, 6).total).toBe(2);
    expect(roll("3d6<=2", 1, 2, 3).total).toBe(2);
    expect(roll("3d6<3", 1, 2, 3).total).toBe(2);
    expect(roll("3d6=6", 6, 6, 5).total).toBe(2);
  });

  it("counts exploded dice as separate chances to succeed", () => {
    // First die: 10 (success, explodes) then 2 (no). Second die: 9 (success, explodes) then 4 (no).
    expect(roll("2d10!>=9>=9", 10, 2, 9, 4).total).toBe(2);
  });

  it("only counts kept dice", () => {
    expect(roll("3d10kh1>=8", 9, 9, 2).total).toBe(1);
  });

  it("adds a modifier to the success count", () => {
    expect(roll("2d6>=5+1", 5, 1).total).toBe(2);
  });
});

describe("rollNotation (seeded)", () => {
  it("returns an error for bad notation instead of throwing", () => {
    const r = rollNotation("2d", createRng(1));
    expect(r.ok).toBe(false);
  });

  it("gives identical results for the same seed", () => {
    const a = rollNotation("8d6!kh5+2", createRng(2024));
    const b = rollNotation("8d6!kh5+2", createRng(2024));
    expect(a).toEqual(b);
  });

  it("stays within the possible range over many rolls", () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const r = rollNotation("2d6+3", rng);
      if (!r.ok) throw new Error("should parse");
      expect(r.result.total).toBeGreaterThanOrEqual(5);
      expect(r.result.total).toBeLessThanOrEqual(15);
    }
  });

  it("makes advantage average higher than a single die", () => {
    const rng = createRng(11);
    let single = 0;
    let adv = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const s = rollNotation("d20", rng);
      const a = rollNotation("d20 adv", rng);
      if (!s.ok || !a.ok) throw new Error("should parse");
      single += s.result.total;
      adv += a.result.total;
    }
    expect(adv / n).toBeGreaterThan(single / n + 3);
  });
});
