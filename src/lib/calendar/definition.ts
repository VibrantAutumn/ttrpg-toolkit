/**
 * Calendars: plain data, pure TypeScript, no database.
 *
 * **Dates are day numbers.** Every calendar in a project counts the same days: absolute day 0 is
 * one fixed day, and each calendar says how those days are grouped into years, months and weeks
 * (and where its own year numbering starts, `anchor`). So converting a date to another calendar
 * is just reading the same day number with the other calendar, and sorting or comparing dates is
 * comparing numbers. All calendars of a project share one day length for that reason.
 */

export const CALENDAR_VERSION = 1;

export const LIMITS = {
  name: 60,
  months: 60,
  monthDays: 500,
  weekdays: 30,
  hoursPerDay: 100,
  minutesPerHour: 200,
  eras: 12,
  seasons: 24,
  moons: 10,
  moonCycle: 100000,
  leapExtraDays: 100,
  year: 1_000_000,
  label: 40,
} as const;

export interface CalendarMonth {
  name: string;
  days: number;
}

/**
 * Which years are leap years, and what they get. A year `y` is leap when `y - offset` is a
 * multiple of `every`, except when it is also a multiple of `exceptEvery`, unless it is a
 * multiple of `unlessEvery` (the Gregorian rule is 4 / 100 / 400). `exceptEvery` has to be a
 * multiple of `every`, and `unlessEvery` a multiple of `exceptEvery`.
 */
export interface LeapRule {
  every: number;
  offset: number;
  exceptEvery: number | null;
  unlessEvery: number | null;
  /** Index of the month that gets the extra days. */
  month: number;
  extraDays: number;
}

/** From `startYear` on, years are counted inside this era (its first year is year 1 of the era). */
export interface Era {
  name: string;
  short: string;
  startYear: number;
}

/** A season begins on this day of this month (month index from 0, day from 1) and lasts until the next one. */
export interface Season {
  name: string;
  month: number;
  day: number;
}

/** `cycle` is the length in days (fractions allowed); `offset` is how far into the cycle day 0 is. */
export interface Moon {
  name: string;
  cycle: number;
  offset: number;
}

export interface Calendar {
  version: number;
  hoursPerDay: number;
  minutesPerHour: number;
  weekdays: string[];
  /** Which weekday (index) absolute day 0 is. */
  weekdayOffset: number;
  months: CalendarMonth[];
  leap: LeapRule | null;
  eras: Era[];
  seasons: Season[];
  moons: Moon[];
  /** The first day of year `anchor.year` is absolute day `anchor.day`. */
  anchor: { year: number; day: number };
}

export function emptyCalendar(): Calendar {
  return {
    version: CALENDAR_VERSION,
    hoursPerDay: 24,
    minutesPerHour: 60,
    weekdays: ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"],
    weekdayOffset: 0,
    months: Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
    leap: null,
    eras: [],
    seasons: [],
    moons: [],
    anchor: { year: 1, day: 0 },
  };
}

export type CalendarRead = { ok: true; calendar: Calendar; warnings: string[] } | { ok: false; error: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * The one gate every stored or edited calendar passes through. Never throws; repairs what it can
 * and says what it changed in `warnings`; refuses only things that are not a calendar or come
 * from a newer app.
 */
export function normalizeCalendar(raw: unknown): CalendarRead {
  if (!isObject(raw)) return { ok: false, error: "This is not a calendar." };
  const version = typeof raw.version === "number" ? raw.version : CALENDAR_VERSION;
  if (version > CALENDAR_VERSION) return { ok: false, error: "This calendar was made by a newer version of the app." };
  const warnings: string[] = [];
  const base = emptyCalendar();

  const hoursPerDay = int(raw.hoursPerDay, 1, LIMITS.hoursPerDay, base.hoursPerDay);
  const minutesPerHour = int(raw.minutesPerHour, 1, LIMITS.minutesPerHour, base.minutesPerHour);

  let weekdays = (Array.isArray(raw.weekdays) ? raw.weekdays : [])
    .map((w) => text(w, LIMITS.label))
    .filter((w) => w !== "")
    .slice(0, LIMITS.weekdays);
  if (weekdays.length === 0) {
    weekdays = base.weekdays;
    warnings.push("A calendar needs at least one weekday, so the default week was used.");
  }

  const months: CalendarMonth[] = [];
  for (const m of Array.isArray(raw.months) ? raw.months.slice(0, LIMITS.months) : []) {
    if (!isObject(m)) continue;
    months.push({ name: text(m.name, LIMITS.label) || `Month ${months.length + 1}`, days: int(m.days, 1, LIMITS.monthDays, 30) });
  }
  if (months.length === 0) {
    months.push(...base.months);
    warnings.push("A calendar needs at least one month, so the default months were used.");
  }

  let leap: LeapRule | null = null;
  if (isObject(raw.leap)) {
    const every = int(raw.leap.every, 1, LIMITS.year, 0);
    if (every >= 1) {
      let exceptEvery: number | null =
        typeof raw.leap.exceptEvery === "number" ? int(raw.leap.exceptEvery, 1, LIMITS.year, 0) : null;
      if (exceptEvery !== null && (exceptEvery < 1 || exceptEvery % every !== 0 || exceptEvery === every)) {
        exceptEvery = null;
        warnings.push("The leap exception was dropped: it has to be a bigger multiple of the leap interval.");
      }
      let unlessEvery: number | null =
        typeof raw.leap.unlessEvery === "number" ? int(raw.leap.unlessEvery, 1, LIMITS.year, 0) : null;
      if (unlessEvery !== null && (exceptEvery === null || unlessEvery < 1 || unlessEvery % exceptEvery !== 0 || unlessEvery === exceptEvery)) {
        unlessEvery = null;
        warnings.push("The leap exception's exception was dropped: it has to be a bigger multiple of the exception.");
      }
      leap = {
        every,
        offset: int(raw.leap.offset, -LIMITS.year, LIMITS.year, 0),
        exceptEvery,
        unlessEvery,
        month: int(raw.leap.month, 0, months.length - 1, months.length - 1),
        extraDays: int(raw.leap.extraDays, 1, LIMITS.leapExtraDays, 1),
      };
    } else {
      warnings.push("The leap rule was dropped: it needs a whole number of years.");
    }
  }

  const eras: Era[] = [];
  for (const e of Array.isArray(raw.eras) ? raw.eras.slice(0, LIMITS.eras) : []) {
    if (!isObject(e)) continue;
    const name = text(e.name, LIMITS.label);
    if (name === "") continue;
    eras.push({ name, short: text(e.short, 10) || name.slice(0, 3), startYear: int(e.startYear, -LIMITS.year, LIMITS.year, 1) });
  }
  eras.sort((a, b) => a.startYear - b.startYear);

  const seasons: Season[] = [];
  for (const s of Array.isArray(raw.seasons) ? raw.seasons.slice(0, LIMITS.seasons) : []) {
    if (!isObject(s)) continue;
    const name = text(s.name, LIMITS.label);
    if (name === "") continue;
    const month = int(s.month, 0, months.length - 1, 0);
    seasons.push({ name, month, day: int(s.day, 1, months[month].days, 1) });
  }
  seasons.sort((a, b) => a.month - b.month || a.day - b.day);

  const moons: Moon[] = [];
  for (const m of Array.isArray(raw.moons) ? raw.moons.slice(0, LIMITS.moons) : []) {
    if (!isObject(m)) continue;
    const name = text(m.name, LIMITS.label);
    if (name === "") continue;
    const cycle = typeof m.cycle === "number" && Number.isFinite(m.cycle) && m.cycle >= 1 ? Math.min(m.cycle, LIMITS.moonCycle) : 0;
    if (cycle === 0) {
      warnings.push(`The moon "${name}" was dropped: its cycle has to be at least 1 day.`);
      continue;
    }
    const rawOffset = typeof m.offset === "number" && Number.isFinite(m.offset) ? m.offset : 0;
    // Only wrap an offset that is outside the cycle, so reading a calendar twice never nudges it.
    let offset = rawOffset;
    if (offset < 0 || offset >= cycle) offset = ((rawOffset % cycle) + cycle) % cycle;
    if (offset >= cycle) offset = 0;
    moons.push({ name, cycle, offset });
  }

  const anchorRaw = isObject(raw.anchor) ? raw.anchor : {};
  return {
    ok: true,
    warnings,
    calendar: {
      version: CALENDAR_VERSION,
      hoursPerDay,
      minutesPerHour,
      weekdays,
      weekdayOffset: int(raw.weekdayOffset, 0, weekdays.length - 1, 0),
      months,
      leap,
      eras,
      seasons,
      moons,
      anchor: {
        year: int(anchorRaw.year, -LIMITS.year, LIMITS.year, 1),
        day: int(anchorRaw.day, -1_000_000_000, 1_000_000_000, 0),
      },
    },
  };
}

export function parseCalendar(textJson: string): CalendarRead {
  try {
    return normalizeCalendar(JSON.parse(textJson));
  } catch {
    return { ok: false, error: "This calendar could not be read." };
  }
}

export function minutesPerDay(c: Calendar): number {
  return c.hoursPerDay * c.minutesPerHour;
}
