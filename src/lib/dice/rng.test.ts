import { describe, expect, it } from "vitest";
import { createRng } from "./rng";

function draw(seed: number, count: number, min = 1, max = 20): number[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => rng.int(min, max));
}

describe("createRng", () => {
  it("gives the same sequence for the same seed", () => {
    expect(draw(42, 50)).toEqual(draw(42, 50));
  });

  it("gives different sequences for different seeds", () => {
    expect(draw(1, 50)).not.toEqual(draw(2, 50));
  });

  it("stays inside the asked range, ends included", () => {
    const values = draw(7, 5000, 1, 6);
    expect(Math.min(...values)).toBe(1);
    expect(Math.max(...values)).toBe(6);
  });

  it("supports negative ranges (Fate dice)", () => {
    const values = draw(9, 1000, -1, 1);
    expect(new Set(values)).toEqual(new Set([-1, 0, 1]));
  });

  it("returns the only value when min equals max", () => {
    expect(draw(3, 10, 4, 4)).toEqual(Array(10).fill(4));
  });

  it("is roughly even (no face turns up more than 1.5x or less than 0.5x its share)", () => {
    const counts = new Array(6).fill(0);
    for (const v of draw(123, 6000, 1, 6)) counts[v - 1]++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(500);
      expect(c).toBeLessThan(1500);
    }
  });

  it("rejects a range where min is above max, and non-integers", () => {
    const rng = createRng(1);
    expect(() => rng.int(5, 4)).toThrow();
    expect(() => rng.int(1.5, 4)).toThrow();
  });

  it("reports its seed so a result can be reproduced", () => {
    expect(createRng(99).seed).toBe(99);
  });
});
