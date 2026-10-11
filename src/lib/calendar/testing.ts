import { emptyCalendar, type Calendar } from "./definition";

// Calendars used by the tests in this folder.

/** The real-world calendar. Day 0 is 0001-01-01, which was a Monday (proleptic Gregorian). */
export function gregorian(): Calendar {
  const lengths: [string, number][] = [
    ["January", 31], ["February", 28], ["March", 31], ["April", 30], ["May", 31], ["June", 30],
    ["July", 31], ["August", 31], ["September", 30], ["October", 31], ["November", 30], ["December", 31],
  ];
  return {
    ...emptyCalendar(),
    weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    months: lengths.map(([name, days]) => ({ name, days })),
    leap: { every: 4, offset: 0, exceptEvery: 100, unlessEvery: 400, month: 1, extraDays: 1 },
    eras: [{ name: "Common Era", short: "CE", startYear: 1 }],
    seasons: [
      { name: "Winter", month: 0, day: 1 },
      { name: "Spring", month: 2, day: 20 },
      { name: "Summer", month: 5, day: 21 },
      { name: "Autumn", month: 8, day: 22 },
      { name: "Winter", month: 11, day: 21 },
    ],
    moons: [{ name: "Moon", cycle: 29.530588, offset: 0 }],
  };
}

/** 360 days, no leap years, 5 weekdays. */
export function plain(): Calendar {
  return {
    ...emptyCalendar(),
    weekdays: ["A", "B", "C", "D", "E"],
    months: Array.from({ length: 12 }, (_, i) => ({ name: `M${i + 1}`, days: 30 })),
    leap: null,
  };
}

