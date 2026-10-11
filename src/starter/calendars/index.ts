import { emptyCalendar, type Calendar } from "../../lib/calendar/definition";

/**
 * Calendars that come with the app. Plain data: adding one to a project makes a calendar item with a copy
 * of this (see `state/calendarActions.ts`). Both count from the same absolute day 0, so a date in one reads
 * as a date in the other.
 */
export interface StarterCalendarDef {
  /** The calendar item's name; also how "already added" is known. */
  name: string;
  description: string;
  calendar: Calendar;
}

/** The real new moon of 2000-01-06 18:14 UTC (absolute day 730124, a little after three quarters of the day). */
const REAL_NEW_MOON_DAY = 730124.76;
const SYNODIC_MONTH = 29.530588;

const realWorld: Calendar = {
  ...emptyCalendar(),
  weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  weekdayOffset: 0,
  months: [
    ["January", 31], ["February", 28], ["March", 31], ["April", 30], ["May", 31], ["June", 30],
    ["July", 31], ["August", 31], ["September", 30], ["October", 31], ["November", 30], ["December", 31],
  ].map(([name, days]) => ({ name: name as string, days: days as number })),
  leap: { every: 4, offset: 0, exceptEvery: 100, unlessEvery: 400, month: 1, extraDays: 1 },
  eras: [{ name: "Common Era", short: "CE", startYear: 1 }],
  seasons: [
    { name: "Winter", month: 0, day: 1 },
    { name: "Spring", month: 2, day: 20 },
    { name: "Summer", month: 5, day: 21 },
    { name: "Autumn", month: 8, day: 22 },
    { name: "Winter", month: 11, day: 21 },
  ],
  moons: [{ name: "The Moon", cycle: SYNODIC_MONTH, offset: ((-REAL_NEW_MOON_DAY % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH }],
  anchor: { year: 1, day: 0 },
};

/** Thirteen months of four weeks, one moon that is full once a month, a leap day every four years. */
const fantasy: Calendar = {
  ...emptyCalendar(),
  weekdays: ["Sunsday", "Moonsday", "Starsday", "Windsday", "Tidesday", "Hearthsday", "Restday"],
  weekdayOffset: 0,
  months: [
    "Frostmoon", "Thawmoon", "Seedmoon", "Bloomtide", "Suntide", "Highsun", "Harvestide",
    "Goldleaf", "Mistmoon", "Frostfall", "Darkmoon", "Yuletide", "Longnight",
  ].map((name) => ({ name, days: 28 })),
  leap: { every: 4, offset: 0, exceptEvery: null, unlessEvery: null, month: 12, extraDays: 1 },
  eras: [{ name: "Age of Embers", short: "AE", startYear: 1 }],
  seasons: [
    { name: "Winter", month: 0, day: 1 },
    { name: "Spring", month: 2, day: 1 },
    { name: "Summer", month: 4, day: 1 },
    { name: "Autumn", month: 7, day: 1 },
    { name: "Winter", month: 10, day: 1 },
  ],
  moons: [{ name: "Lumen", cycle: 28, offset: 14 }],
  anchor: { year: 1, day: 0 },
};

export const STARTER_CALENDARS: StarterCalendarDef[] = [
  {
    name: "Real-world calendar",
    description: "Months, weeks, leap years and the real moon, the way the world counts them.",
    calendar: realWorld,
  },
  {
    name: "Simple fantasy calendar",
    description: "Thirteen months of four weeks, four seasons, a leap day every four years and one moon, Lumen.",
    calendar: fantasy,
  },
];
