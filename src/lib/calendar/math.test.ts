import { describe, expect, it } from "vitest";
import { createRng } from "../dice/rng";
import { emptyCalendar, type Calendar } from "./definition";
import {
  alignDate,
  alignMoon,
  alignWeekday,
  addDays,
  addMonths,
  addYears,
  advanceTime,
  dayToParts,
  eraOf,
  formatDate,
  formatDateTime,
  isLeapYear,
  monthDays,
  moonPhase,
  nextPhaseDay,
  partsToDay,
  seasonAt,
  weekdayIndex,
  yearLength,
  yearStart,
} from "./math";
import { gregorian, plain } from "./testing";

describe("leap years", () => {
  const g = gregorian();
  it("follows the Gregorian rule", () => {
    expect(isLeapYear(g, 2000)).toBe(true);
    expect(isLeapYear(g, 1900)).toBe(false);
    expect(isLeapYear(g, 2024)).toBe(true);
    expect(isLeapYear(g, 2023)).toBe(false);
    expect(isLeapYear(g, 2100)).toBe(false);
    expect(isLeapYear(g, 400)).toBe(true);
    expect(isLeapYear(g, -4)).toBe(true);
  });
  it("gives the leap month an extra day only in leap years", () => {
    expect(monthDays(g, 2024, 1)).toBe(29);
    expect(monthDays(g, 2023, 1)).toBe(28);
    expect(yearLength(g, 2024)).toBe(366);
    expect(yearLength(g, 1900)).toBe(365);
  });
  it("never has leap years without a rule", () => {
    const p = plain();
    expect(isLeapYear(p, 4)).toBe(false);
    expect(yearLength(p, 4)).toBe(360);
  });
  it("shifts the pattern with an offset", () => {
    const c: Calendar = { ...plain(), leap: { every: 3, offset: 1, exceptEvery: null, unlessEvery: null, month: 0, extraDays: 2 } };
    expect(isLeapYear(c, 1)).toBe(true);
    expect(isLeapYear(c, 4)).toBe(true);
    expect(isLeapYear(c, 3)).toBe(false);
    expect(monthDays(c, 4, 0)).toBe(32);
  });
});

describe("day numbers match the real calendar", () => {
  const g = gregorian();
  it("knows well-known dates", () => {
    expect(partsToDay(g, { year: 1, month: 0, day: 1 })).toBe(0);
    expect(partsToDay(g, { year: 1970, month: 0, day: 1 })).toBe(719162);
    expect(partsToDay(g, { year: 2000, month: 0, day: 1 })).toBe(730119);
    expect(partsToDay(g, { year: 2000, month: 1, day: 29 })).toBe(730119 + 31 + 28);
  });
  it("turns a day back into parts", () => {
    expect(dayToParts(g, 719162)).toEqual({ year: 1970, month: 0, day: 1, dayOfYear: 1 });
    expect(dayToParts(g, 730119 + 59)).toEqual({ year: 2000, month: 1, day: 29, dayOfYear: 60 });
    expect(dayToParts(g, 730119 + 366)).toEqual({ year: 2001, month: 0, day: 1, dayOfYear: 1 });
  });
  it("works for days before day zero", () => {
    expect(dayToParts(g, -1)).toEqual({ year: 0, month: 11, day: 31, dayOfYear: 366 });
    expect(partsToDay(g, { year: 0, month: 11, day: 31 })).toBe(-1);
  });
  it("knows the weekday", () => {
    expect(weekdayIndex(g, 0)).toBe(0); // Monday
    expect(g.weekdays[weekdayIndex(g, 730119)]).toBe("Saturday"); // 2000-01-01
    expect(g.weekdays[weekdayIndex(g, 719162)]).toBe("Thursday"); // 1970-01-01
    expect(g.weekdays[weekdayIndex(g, -1)]).toBe("Sunday");
  });
  it("honours the anchor", () => {
    // Year 1 starts on absolute day 100 in this calendar.
    const c = { ...plain(), anchor: { year: 1, day: 100 } };
    expect(partsToDay(c, { year: 1, month: 0, day: 1 })).toBe(100);
    expect(dayToParts(c, 99)).toEqual({ year: 0, month: 11, day: 30, dayOfYear: 360 });
  });
  it("lines up two calendars through the shared day number", () => {
    const g2 = gregorian();
    const other = { ...plain(), anchor: { year: 1, day: partsToDay(g2, { year: 2000, month: 0, day: 1 })! } };
    expect(dayToParts(other, 730119)).toMatchObject({ year: 1, month: 0, day: 1 });
    expect(dayToParts(other, 730119 + 45)).toMatchObject({ year: 1, month: 1, day: 16 });
  });
});

describe("invalid dates", () => {
  const g = gregorian();
  it("refuses days that do not exist", () => {
    expect(partsToDay(g, { year: 2023, month: 1, day: 29 })).toBeNull();
    expect(partsToDay(g, { year: 2024, month: 1, day: 29 })).not.toBeNull();
    expect(partsToDay(g, { year: 2024, month: 12, day: 1 })).toBeNull();
    expect(partsToDay(g, { year: 2024, month: 0, day: 0 })).toBeNull();
    expect(partsToDay(g, { year: 2024.5, month: 0, day: 1 })).toBeNull();
  });
});

describe("round trip over random calendars", () => {
  it("every day maps to parts and back, and days follow each other", () => {
    const rng = createRng(12345);
    for (let n = 0; n < 60; n++) {
      const monthCount = rng.int(1, 14);
      const months = Array.from({ length: monthCount }, (_, i) => ({ name: `m${i}`, days: rng.int(1, 45) }));
      const every = rng.int(1, 6);
      const exceptEvery = rng.int(0, 1) ? every * rng.int(2, 5) : null;
      const unlessEvery = exceptEvery && rng.int(0, 1) ? exceptEvery * rng.int(2, 4) : null;
      const c: Calendar = {
        ...emptyCalendar(),
        weekdays: Array.from({ length: rng.int(1, 10) }, (_, i) => `d${i}`),
        weekdayOffset: rng.int(0, 5),
        months,
        leap: rng.int(0, 2)
          ? { every, offset: rng.int(-5, 5), exceptEvery, unlessEvery, month: rng.int(0, monthCount - 1), extraDays: rng.int(1, 5) }
          : null,
        anchor: { year: rng.int(-50, 50), day: rng.int(-1000, 1000) },
      };
      let prev = dayToParts(c, -2000);
      for (let d = -1999; d < 2000; d++) {
        const parts = dayToParts(c, d);
        expect(partsToDay(c, parts)).toBe(d);
        expect(parts.day).toBeGreaterThanOrEqual(1);
        expect(parts.day).toBeLessThanOrEqual(monthDays(c, parts.year, parts.month));
        // The day after is the next day of the month, or day 1 of the next month or year.
        const sameMonth = parts.year === prev.year && parts.month === prev.month;
        if (sameMonth) expect(parts.day).toBe(prev.day + 1);
        else expect(parts.day).toBe(1);
        prev = parts;
      }
    }
  });
  it("year starts agree with year lengths", () => {
    const g = gregorian();
    for (let y = -810; y < 810; y++) {
      expect(yearStart(g, y + 1) - yearStart(g, y)).toBe(yearLength(g, y));
    }
  });
});

describe("eras", () => {
  const g = gregorian();
  it("counts the year inside the era", () => {
    expect(eraOf(g, 2024)).toEqual({ era: g.eras[0], yearInEra: 2024 });
    expect(eraOf(g, 0)).toBeNull();
  });
  it("picks the latest era that has begun", () => {
    const c: Calendar = {
      ...plain(),
      eras: [
        { name: "First Age", short: "FA", startYear: 1 },
        { name: "Second Age", short: "SA", startYear: 500 },
      ],
    };
    expect(eraOf(c, 499)?.era.short).toBe("FA");
    expect(eraOf(c, 500)).toEqual({ era: c.eras[1], yearInEra: 1 });
    expect(eraOf(c, 520)?.yearInEra).toBe(21);
  });
});

describe("seasons", () => {
  const g = gregorian();
  const day = (y: number, m: number, d: number) => partsToDay(g, { year: y, month: m, day: d })!;
  it("finds the season of a day", () => {
    expect(seasonAt(g, day(2024, 0, 15))?.name).toBe("Winter");
    expect(seasonAt(g, day(2024, 2, 20))?.name).toBe("Spring");
    expect(seasonAt(g, day(2024, 2, 19))?.name).toBe("Winter");
    expect(seasonAt(g, day(2024, 6, 4))?.name).toBe("Summer");
    expect(seasonAt(g, day(2024, 11, 25))?.name).toBe("Winter");
  });
  it("wraps from the end of the year to the first season", () => {
    const c: Calendar = { ...plain(), seasons: [{ name: "Thaw", month: 2, day: 1 }, { name: "Freeze", month: 8, day: 1 }] };
    expect(seasonAt(c, partsToDay(c, { year: 3, month: 0, day: 5 })!)?.name).toBe("Freeze");
  });
  it("is null with no seasons", () => {
    expect(seasonAt(plain(), 10)).toBeNull();
  });
});

describe("moons", () => {
  it("cycles by formula and names the phases", () => {
    const moon = { name: "M", cycle: 8, offset: 0 };
    expect(moonPhase(moon, 0).name).toBe("New Moon");
    expect(moonPhase(moon, 1).name).toBe("Waxing Crescent");
    expect(moonPhase(moon, 2).name).toBe("First Quarter");
    expect(moonPhase(moon, 3).name).toBe("Waxing Gibbous");
    expect(moonPhase(moon, 4).name).toBe("Full Moon");
    expect(moonPhase(moon, 5).name).toBe("Waning Gibbous");
    expect(moonPhase(moon, 6).name).toBe("Last Quarter");
    expect(moonPhase(moon, 7).name).toBe("Waning Crescent");
    expect(moonPhase(moon, 8).name).toBe("New Moon");
  });
  it("repeats every cycle and works for negative days", () => {
    const moon = { name: "M", cycle: 29.5, offset: 3 };
    expect(moonPhase(moon, 10).fraction).toBeCloseTo(moonPhase(moon, 10 + 59).fraction, 9);
    expect(moonPhase(moon, -5).fraction).toBeGreaterThanOrEqual(0);
    expect(moonPhase(moon, -5).fraction).toBeLessThan(1);
  });
  it("uses the offset as the day in the cycle on day zero", () => {
    expect(moonPhase({ name: "M", cycle: 8, offset: 4 }, 0).name).toBe("Full Moon");
  });
  it("is full about once a cycle on a real-world moon", () => {
    const g = gregorian();
    let fulls = 0;
    for (let d = 0; d < 295; d++) if (moonPhase(g.moons[0], d).name === "Full Moon") fulls++;
    // "Full" is an eighth of the cycle (about 3.7 days), so about 37 days in 10 cycles.
    expect(fulls).toBeGreaterThanOrEqual(33);
    expect(fulls).toBeLessThanOrEqual(41);
  });
});

describe("adding time", () => {
  const g = gregorian();
  const day = (y: number, m: number, d: number) => partsToDay(g, { year: y, month: m, day: d })!;
  it("adds days across month and year ends", () => {
    expect(dayToParts(g, addDays(day(2023, 11, 31), 1))).toMatchObject({ year: 2024, month: 0, day: 1 });
    expect(addDays(5, -10)).toBe(-5);
  });
  it("adds months and clamps to the end of a shorter month", () => {
    expect(dayToParts(g, addMonths(g, day(2024, 0, 31), 1))).toMatchObject({ year: 2024, month: 1, day: 29 });
    expect(dayToParts(g, addMonths(g, day(2023, 0, 31), 1))).toMatchObject({ year: 2023, month: 1, day: 28 });
    expect(dayToParts(g, addMonths(g, day(2023, 10, 15), 3))).toMatchObject({ year: 2024, month: 1, day: 15 });
    expect(dayToParts(g, addMonths(g, day(2024, 0, 15), -1))).toMatchObject({ year: 2023, month: 11, day: 15 });
    expect(dayToParts(g, addMonths(g, day(2024, 5, 15), 0))).toMatchObject({ year: 2024, month: 5, day: 15 });
  });
  it("adds years and moves a leap day to the end of February", () => {
    expect(dayToParts(g, addYears(g, day(2024, 1, 29), 1))).toMatchObject({ year: 2025, month: 1, day: 28 });
    expect(dayToParts(g, addYears(g, day(2024, 1, 29), 4))).toMatchObject({ year: 2028, month: 1, day: 29 });
  });
  it("adds minutes and carries into days", () => {
    expect(advanceTime(g, { day: 10, minute: 23 * 60 }, 90)).toEqual({ day: 11, minute: 30 });
    expect(advanceTime(g, { day: 10, minute: 30 }, -60)).toEqual({ day: 9, minute: 23 * 60 + 30 });
    expect(advanceTime(g, { day: 0, minute: 0 }, 3 * 1440)).toEqual({ day: 3, minute: 0 });
  });
  it("uses the calendar's own day length", () => {
    const c: Calendar = { ...plain(), hoursPerDay: 10, minutesPerHour: 100 }; // 1000 minutes
    expect(advanceTime(c, { day: 0, minute: 900 }, 250)).toEqual({ day: 1, minute: 150 });
  });
});

describe("formatting", () => {
  const g = gregorian();
  it("writes dates with the era", () => {
    const d = partsToDay(g, { year: 2024, month: 2, day: 5 })!;
    expect(formatDate(g, d)).toBe("5 March 2024 CE");
    expect(formatDate(g, d, { weekday: true })).toBe("Tuesday, 5 March 2024 CE");
    expect(formatDate(g, d, { era: false })).toBe("5 March 2024");
  });
  it("writes the plain year when no era has begun", () => {
    expect(formatDate(g, partsToDay(g, { year: 0, month: 0, day: 1 })!)).toBe("1 January 0");
  });
  it("writes a time of day", () => {
    const d = partsToDay(g, { year: 2024, month: 2, day: 5 })!;
    expect(formatDateTime(g, { day: d, minute: 9 * 60 + 5 })).toBe("5 March 2024 CE, 09:05");
    expect(formatDateTime(g, { day: d, minute: 0 })).toBe("5 March 2024 CE, 00:00");
  });
});

describe("lining calendars up", () => {
  it("alignDate makes a date in this calendar fall on a given absolute day", () => {
    const g = gregorian();
    const day2000 = partsToDay(g, { year: 2000, month: 0, day: 1 })!;
    const other = alignDate(plain(), { year: 7, month: 2, day: 10 }, day2000);
    expect(partsToDay(other, { year: 7, month: 2, day: 10 })).toBe(day2000);
    expect(dayToParts(other, day2000 + 1)).toMatchObject({ year: 7, month: 2, day: 11 });
    expect(dayToParts(other, day2000 - 69)).toMatchObject({ year: 7, month: 0, day: 1 });
  });
  it("alignDate also works across a leap month and negative years", () => {
    const g = gregorian();
    const target = partsToDay(g, { year: 1970, month: 5, day: 15 })!;
    const aligned = alignDate(g, { year: -4, month: 2, day: 1 }, target);
    expect(partsToDay(aligned, { year: -4, month: 2, day: 1 })).toBe(target);
  });
  it("alignDate leaves the calendar alone for a date that doesn't exist", () => {
    const p = plain();
    expect(alignDate(p, { year: 1, month: 0, day: 31 }, 5)).toBe(p);
  });
  it("alignWeekday and alignMoon do what they say", () => {
    const g = gregorian();
    const day = partsToDay(g, { year: 2024, month: 0, day: 1 })!;
    expect(alignWeekday(g, day, 3).weekdays[weekdayIndex(alignWeekday(g, day, 3), day)]).toBe("Thursday");
    const moon = alignMoon({ name: "M", cycle: 29.5, offset: 0 }, day, 0.5);
    expect(moonPhase(moon, day).name).toBe("Full Moon");
    expect(moonPhase(moon, day + 29.5 * 2).fraction).toBeCloseTo(0.5, 9);
    expect(moon.offset).toBeGreaterThanOrEqual(0);
    expect(moon.offset).toBeLessThan(29.5);
  });
});

describe("nextPhaseDay", () => {
  it("finds the next full moon, and aligning to it gives it back", () => {
    const moon = { name: "M", cycle: 8, offset: 0 };
    expect(nextPhaseDay(moon, 0, 0.5)).toBe(4);
    expect(nextPhaseDay(moon, 5, 0.5)).toBe(12);
    expect(nextPhaseDay(moon, 4, 0.5)).toBe(4);
    const odd = alignMoon({ name: "M", cycle: 29.53, offset: 0 }, 1000, 0.5);
    expect(nextPhaseDay(odd, 990, 0.5)).toBe(1000);
  });
});
