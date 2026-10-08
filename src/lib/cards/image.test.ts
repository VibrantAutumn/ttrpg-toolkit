import { describe, expect, it } from "vitest";
import { FULL_MAX, THUMB_MAX, fitWithin } from "./image";

describe("fitWithin", () => {
  it("shrinks so the longest side fits, keeping the shape", () => {
    expect(fitWithin(1200, 600, 600)).toEqual({ width: 600, height: 300 });
    expect(fitWithin(600, 1200, 600)).toEqual({ width: 300, height: 600 });
    expect(fitWithin(4000, 4000, 200)).toEqual({ width: 200, height: 200 });
  });

  it("never enlarges a picture that already fits", () => {
    expect(fitWithin(300, 200, 600)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(600, 600, 600)).toEqual({ width: 600, height: 600 });
  });

  it("rounds to whole pixels and never goes below one", () => {
    expect(fitWithin(1000, 333, 600)).toEqual({ width: 600, height: 200 });
    expect(fitWithin(10000, 3, 600)).toEqual({ width: 600, height: 1 });
  });

  it("refuses sizes that make no sense", () => {
    expect(() => fitWithin(0, 100, 600)).toThrow();
    expect(() => fitWithin(100, -5, 600)).toThrow();
    expect(() => fitWithin(100, 100, 0)).toThrow();
    expect(() => fitWithin(NaN, 100, 600)).toThrow();
  });

  it("has sensible size limits for full pictures and thumbnails", () => {
    expect(FULL_MAX).toBe(600);
    expect(THUMB_MAX).toBe(200);
  });
});
