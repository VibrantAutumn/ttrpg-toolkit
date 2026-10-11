import { describe, expect, it } from "vitest";
import { dayToParts, partsToDay, weekdayIndex } from "./math";
import { describeRecurrence, normalizeRecurrence, occurrences, type Recurrence } from "./recurrence";
import { gregorian, plain } from "./testing";

const g = gregorian();
const d = (y: number, m: number, day: number) => partsToDay(g, { year: y, month: m, day })!;
const asText = (days: number[]) =>
  days.map((x) => {
    const p = dayToParts(g, x);
    return `${p.year}-${p.month + 1}-${p.day}`;
  });

describe("every N days", () => {
  const rule: Recurrence = { kind: "days", interval: 10 };
  it("counts from the start day", () => {
    const start = d(2024, 0, 5);
    expect(asText(occurrences(g, rule, start, null, d(2024, 0, 1), d(2024, 1, 10)))).toEqual([
      "2024-1-5", "2024-1-15", "2024-1-25", "2024-2-4",
    ]);
  });
  it("never goes before the start or past the end", () => {
    const start = d(2024, 0, 5);
    expect(occurrences(g, rule, start, d(2024, 0, 20), d(2023, 0, 1), d(2025, 0, 1))).toEqual([start, start + 10]);
  });
  it("finds nothing when the window is before the start", () => {
    expect(occurrences(g, rule, d(2024, 0, 5), null, d(2023, 0, 1), d(2023, 5, 1))).toEqual([]);
  });
});

describe("weekly", () => {
  it("falls on the chosen weekday every N weeks", () => {
    const rule: Recurrence = { kind: "weeks", interval: 2, weekday: 4 }; // Fridays
    const start = d(2024, 2, 1); // a Friday
    const days = occurrences(g, rule, start, null, start, d(2024, 2, 31));
    expect(asText(days)).toEqual(["2024-3-1", "2024-3-15", "2024-3-29"]);
    for (const x of days) expect(weekdayIndex(g, x)).toBe(4);
  });
  it("starts on the first such weekday on or after the start", () => {
    const rule: Recurrence = { kind: "weeks", interval: 1, weekday: 0 }; // Mondays
    const days = occurrences(g, rule, d(2024, 2, 1), null, d(2024, 2, 1), d(2024, 2, 20));
    expect(asText(days)).toEqual(["2024-3-4", "2024-3-11", "2024-3-18"]);
  });
  it("uses the calendar's own week length", () => {
    const p = plain(); // 5-day week
    const rule: Recurrence = { kind: "weeks", interval: 1, weekday: 2 };
    const days = occurrences(p, rule, 0, null, 0, 20);
    expect(days).toEqual([2, 7, 12, 17]);
  });
});

describe("monthly", () => {
  it("falls on the same day of every month and clamps to short months", () => {
    const rule: Recurrence = { kind: "monthly", day: 31, interval: 1 };
    expect(asText(occurrences(g, rule, d(2024, 0, 1), null, d(2024, 0, 1), d(2024, 3, 30)))).toEqual([
      "2024-1-31", "2024-2-29", "2024-3-31", "2024-4-30",
    ]);
  });
  it("can be every N months", () => {
    const rule: Recurrence = { kind: "monthly", day: 15, interval: 3 };
    expect(asText(occurrences(g, rule, d(2024, 0, 1), null, d(2024, 0, 1), d(2024, 11, 31)))).toEqual([
      "2024-1-15", "2024-4-15", "2024-7-15", "2024-10-15",
    ]);
  });
});

describe("yearly", () => {
  const rule: Recurrence = { kind: "yearly", month: 11, day: 25 };
  it("falls on the same date every year", () => {
    expect(asText(occurrences(g, rule, d(2020, 0, 1), null, d(2022, 0, 1), d(2024, 11, 31)))).toEqual([
      "2022-12-25", "2023-12-25", "2024-12-25",
    ]);
  });
  it("moves a leap day to the end of February in other years", () => {
    const leap: Recurrence = { kind: "yearly", month: 1, day: 29 };
    expect(asText(occurrences(g, leap, d(2023, 0, 1), null, d(2023, 0, 1), d(2025, 11, 31)))).toEqual([
      "2023-2-28", "2024-2-29", "2025-2-28",
    ]);
  });
  it("respects the start date inside the first year", () => {
    expect(occurrences(g, rule, d(2024, 11, 26), null, d(2024, 0, 1), d(2025, 11, 31))).toEqual([d(2025, 11, 25)]);
  });
});

describe("the Nth weekday of a month", () => {
  it("finds the first Monday of every month", () => {
    const rule: Recurrence = { kind: "nthWeekday", nth: 1, weekday: 0, month: null };
    expect(asText(occurrences(g, rule, d(2024, 0, 1), null, d(2024, 0, 1), d(2024, 3, 30)))).toEqual([
      "2024-1-1", "2024-2-5", "2024-3-4", "2024-4-1",
    ]);
  });
  it("finds the last Friday of one month a year", () => {
    const rule: Recurrence = { kind: "nthWeekday", nth: -1, weekday: 4, month: 10 }; // November
    expect(asText(occurrences(g, rule, d(2020, 0, 1), null, d(2023, 0, 1), d(2024, 11, 31)))).toEqual([
      "2023-11-24", "2024-11-29",
    ]);
  });
  it("skips months that do not have an Nth such weekday", () => {
    const p = plain(); // 30-day months, 5-day week: every weekday occurs exactly 6 times
    const rule: Recurrence = { kind: "nthWeekday", nth: 6, weekday: 0, month: 0 };
    expect(occurrences(p, rule, 0, null, 0, 40)).toEqual([25]);
    const none: Recurrence = { kind: "nthWeekday", nth: 7, weekday: 0, month: null };
    expect(occurrences(p, none, 0, null, 0, 100)).toEqual([]);
  });
});

describe("limits", () => {
  it("returns at most the cap and in order", () => {
    const days = occurrences(g, { kind: "days", interval: 1 }, 0, null, 0, 100000, 50);
    expect(days.length).toBe(50);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });
  it("returns nothing for a backwards window", () => {
    expect(occurrences(g, { kind: "days", interval: 1 }, 0, null, 10, 5)).toEqual([]);
  });
});

describe("reading and describing rules", () => {
  it("repairs a stored rule instead of throwing", () => {
    expect(normalizeRecurrence({ kind: "days", interval: 0 })).toEqual({ kind: "days", interval: 1 });
    expect(normalizeRecurrence({ kind: "monthly", day: 99 })).toEqual({ kind: "monthly", day: 99, interval: 1 });
    expect(normalizeRecurrence({ kind: "nope" })).toBeNull();
    expect(normalizeRecurrence(null)).toBeNull();
    expect(normalizeRecurrence({ kind: "nthWeekday", nth: 9, weekday: -3, month: null })).toEqual({
      kind: "nthWeekday", nth: 5, weekday: 0, month: null,
    });
  });
  it("says a rule in words", () => {
    expect(describeRecurrence(g, { kind: "days", interval: 1 })).toBe("Every day");
    expect(describeRecurrence(g, { kind: "days", interval: 3 })).toBe("Every 3 days");
    expect(describeRecurrence(g, { kind: "weeks", interval: 1, weekday: 4 })).toBe("Every Friday");
    expect(describeRecurrence(g, { kind: "weeks", interval: 2, weekday: 4 })).toBe("Every 2 weeks on Friday");
    expect(describeRecurrence(g, { kind: "monthly", day: 15, interval: 1 })).toBe("On day 15 of every month");
    expect(describeRecurrence(g, { kind: "yearly", month: 11, day: 25 })).toBe("Every year on 25 December");
    expect(describeRecurrence(g, { kind: "nthWeekday", nth: 1, weekday: 0, month: null })).toBe("The first Monday of every month");
    expect(describeRecurrence(g, { kind: "nthWeekday", nth: -1, weekday: 4, month: 10 })).toBe("The last Friday of November");
  });
});
