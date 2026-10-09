import { describe, expect, it } from "vitest";
import { adjustBar, barFraction, parseBarInput } from "./bar";

describe("barFraction", () => {
  it("is how full the bar is, from 0 to 1", () => {
    expect(barFraction({ current: 15, max: 30 })).toBe(0.5);
    expect(barFraction({ current: 40, max: 30 })).toBe(1);
    expect(barFraction({ current: -3, max: 30 })).toBe(0);
    expect(barFraction({ current: 5, max: 0 })).toBe(0);
    expect(barFraction(null)).toBe(0);
  });
});

describe("adjustBar", () => {
  it("changes the current value, keeping it between 0 and the maximum", () => {
    expect(adjustBar({ current: 22, max: 30 }, -5)).toEqual({ current: 17, max: 30 });
    expect(adjustBar({ current: 22, max: 30 }, 20)).toEqual({ current: 30, max: 30 });
    expect(adjustBar({ current: 3, max: 30 }, -10)).toEqual({ current: 0, max: 30 });
  });

  it("can go beyond the limits when asked to", () => {
    expect(adjustBar({ current: 22, max: 30 }, 20, { limit: false })).toEqual({ current: 42, max: 30 });
    expect(adjustBar({ current: 3, max: 30 }, -10, { limit: false })).toEqual({ current: -7, max: 30 });
  });

  it("does not pull a value that is already beyond a limit back when it moves further out", () => {
    expect(adjustBar({ current: 35, max: 30 }, -2)).toEqual({ current: 30, max: 30 });
    expect(adjustBar({ current: 35, max: 30 }, 2)).toEqual({ current: 35, max: 30 });
  });

  it("starts an unset bar at zero over zero", () => {
    expect(adjustBar(null, 5)).toEqual({ current: 0, max: 0 });
  });

  it("keeps decimals tidy", () => {
    expect(adjustBar({ current: 0.1, max: 1 }, 0.2)).toEqual({ current: 0.3, max: 1 });
  });
});

describe("parseBarInput", () => {
  const bar = { current: 22, max: 30 };

  it("reads current/max", () => {
    expect(parseBarInput("12/40", bar)).toEqual({ ok: true, value: { current: 12, max: 40 } });
    expect(parseBarInput(" 12 / 40 ", null)).toEqual({ ok: true, value: { current: 12, max: 40 } });
  });

  it("reads a single number as the new current value, keeping the maximum", () => {
    expect(parseBarInput("9", bar)).toEqual({ ok: true, value: { current: 9, max: 30 } });
  });

  it("reads +n and -n as changes", () => {
    expect(parseBarInput("-5", bar)).toEqual({ ok: true, value: { current: 17, max: 30 } });
    expect(parseBarInput("+20", bar)).toEqual({ ok: true, value: { current: 30, max: 30 } });
  });

  it("reads /n as the new maximum", () => {
    expect(parseBarInput("/40", bar)).toEqual({ ok: true, value: { current: 22, max: 40 } });
  });

  it("starts from nothing when there is no bar yet", () => {
    expect(parseBarInput("7", null)).toEqual({ ok: true, value: { current: 7, max: 7 } });
  });

  it("gives null for empty text, and an error for nonsense", () => {
    expect(parseBarInput("  ", bar)).toEqual({ ok: true, value: null });
    expect(parseBarInput("lots", bar)).toEqual({ ok: false, error: "Type something like 22/30, a new number, or +5 / -5." });
    expect(parseBarInput("5/", bar).ok).toBe(false);
    expect(parseBarInput("1/2/3", bar).ok).toBe(false);
  });
});
