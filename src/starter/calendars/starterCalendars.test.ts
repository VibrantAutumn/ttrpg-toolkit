import { describe, expect, it } from "vitest";
import { normalizeCalendar } from "../../lib/calendar/definition";
import { dayToParts, moonPhase, partsToDay, weekdayIndex } from "../../lib/calendar/math";
import { STARTER_CALENDARS } from "./index";

describe("starter calendars", () => {
  it("are valid as written, with no repairs", () => {
    for (const s of STARTER_CALENDARS) {
      const r = normalizeCalendar(s.calendar);
      expect(r.ok, s.name).toBe(true);
      if (r.ok) {
        expect(r.warnings, s.name).toEqual([]);
        expect(r.calendar, s.name).toEqual(s.calendar);
      }
    }
  });
  it("have distinct names", () => {
    expect(new Set(STARTER_CALENDARS.map((s) => s.name)).size).toBe(STARTER_CALENDARS.length);
  });
  it("the real-world calendar agrees with real dates", () => {
    const c = STARTER_CALENDARS[0].calendar;
    const day = partsToDay(c, { year: 2000, month: 0, day: 1 })!;
    expect(c.weekdays[weekdayIndex(c, day)]).toBe("Saturday");
    // 2000-01-06 had a new moon and 2000-01-21 a full one (give or take a day).
    const phaseOn = (d: number) => moonPhase(c.moons[0], partsToDay(c, { year: 2000, month: 0, day: d })!).name;
    expect(phaseOn(6)).toBe("New Moon");
    expect(phaseOn(21)).toBe("Full Moon");
  });
  it("the fantasy calendar has a full moon every 28 days and a long year every fourth year", () => {
    const c = STARTER_CALENDARS[1].calendar;
    expect(moonPhase(c.moons[0], 0).name).toBe("Full Moon");
    expect(moonPhase(c.moons[0], 14).name).toBe("New Moon");
    expect(dayToParts(c, partsToDay(c, { year: 4, month: 12, day: 29 })!)).toMatchObject({ year: 4, month: 12, day: 29 });
    expect(partsToDay(c, { year: 5, month: 12, day: 29 })).toBeNull();
  });
});
