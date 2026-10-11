import { describe, expect, it } from "vitest";
import { emptyCalendar, normalizeCalendar, parseCalendar } from "./definition";
import { dayToParts } from "./math";
import { createRng } from "../dice/rng";
import { gregorian } from "./testing";

function read(raw: unknown) {
  const r = normalizeCalendar(raw);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("normalizeCalendar", () => {
  it("keeps a good calendar exactly as it is", () => {
    const g = gregorian();
    const r = read(g);
    expect(r.calendar).toEqual(g);
    expect(r.warnings).toEqual([]);
  });
  it("refuses things that are not calendars and newer versions", () => {
    expect(normalizeCalendar(null).ok).toBe(false);
    expect(normalizeCalendar([]).ok).toBe(false);
    expect(normalizeCalendar({ version: 99 }).ok).toBe(false);
    expect(parseCalendar("{oops").ok).toBe(false);
  });
  it("fills in a default calendar from an empty object", () => {
    const r = read({});
    expect(r.calendar.months.length).toBeGreaterThan(0);
    expect(r.calendar.weekdays.length).toBeGreaterThan(0);
    expect(r.warnings.length).toBe(2);
  });
  it("drops leap exceptions that are not multiples", () => {
    const r = read({ ...gregorian(), leap: { every: 4, offset: 0, exceptEvery: 10, unlessEvery: 400, month: 1, extraDays: 1 } });
    expect(r.calendar.leap).toMatchObject({ every: 4, exceptEvery: null, unlessEvery: null });
    expect(r.warnings.length).toBe(2);
  });
  it("keeps references inside the calendar", () => {
    const r = read({
      ...gregorian(),
      leap: { every: 4, offset: 0, exceptEvery: null, unlessEvery: null, month: 40, extraDays: 1 },
      seasons: [{ name: "Late", month: 99, day: 99 }],
      weekdayOffset: 50,
    });
    expect(r.calendar.leap!.month).toBe(11);
    expect(r.calendar.seasons[0]).toEqual({ name: "Late", month: 11, day: 31 });
    expect(r.calendar.weekdayOffset).toBe(6);
  });
  it("sorts eras and seasons, and wraps a moon's offset into its cycle", () => {
    const r = read({
      ...gregorian(),
      eras: [{ name: "B", short: "B", startYear: 500 }, { name: "A", short: "A", startYear: 1 }],
      seasons: [{ name: "Z", month: 5, day: 1 }, { name: "Y", month: 1, day: 1 }],
      moons: [{ name: "Luna", cycle: 10, offset: -3 }, { name: "Bad", cycle: 0, offset: 1 }],
    });
    expect(r.calendar.eras.map((e) => e.name)).toEqual(["A", "B"]);
    expect(r.calendar.seasons.map((s) => s.name)).toEqual(["Y", "Z"]);
    expect(r.calendar.moons).toEqual([{ name: "Luna", cycle: 10, offset: 7 }]);
    expect(r.warnings.length).toBe(1);
  });
  it("is stable: reading a result gives the same result", () => {
    const rng = createRng(99);
    for (let n = 0; n < 200; n++) {
      const messy = {
        hoursPerDay: rng.int(-5, 200),
        minutesPerHour: rng.int(-5, 300),
        weekdays: Array.from({ length: rng.int(0, 40) }, (_, i) => (rng.int(0, 3) ? `d${i}` : 7)),
        months: Array.from({ length: rng.int(0, 70) }, (_, i) => ({ name: rng.int(0, 3) ? `m${i}` : null, days: rng.int(-5, 600) })),
        leap: rng.int(0, 1) ? { every: rng.int(-2, 9), offset: rng.int(-9, 9), exceptEvery: rng.int(0, 40), unlessEvery: rng.int(0, 400), month: rng.int(-2, 80), extraDays: rng.int(-2, 150) } : 5,
        eras: [{ name: "E", startYear: rng.int(-9, 9) }, 3],
        seasons: [{ name: "S", month: rng.int(-3, 80), day: rng.int(-3, 700) }],
        moons: [{ name: "M", cycle: rng.int(-3, 60) / 2, offset: rng.int(-100, 100) / 3 }],
        anchor: { year: rng.int(-99, 99), day: rng.int(-9999, 9999) },
      };
      const first = read(messy).calendar;
      expect(read(first).calendar).toEqual(first);
      // Whatever came out has to work.
      expect(() => dayToParts(first, rng.int(-5000, 5000))).not.toThrow();
    }
  });
  it("the default calendar is valid", () => {
    expect(read(emptyCalendar()).warnings).toEqual([]);
  });
});
