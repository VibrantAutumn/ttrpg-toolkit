import { minutesPerDay, type Calendar, type Era, type Moon, type Season } from "./definition";

/**
 * Calendar math: pure functions over a `Calendar` and plain numbers.
 *
 * A date is an **absolute day number** (an integer, shared by every calendar of a project) and
 * optionally a **minute of the day**. `DateParts` are that day read through one calendar.
 */

export interface DateParts {
  year: number;
  /** Index from 0. */
  month: number;
  /** From 1. */
  day: number;
}

export interface DatePartsWithDayOfYear extends DateParts {
  /** From 1. */
  dayOfYear: number;
}

/** A moment: an absolute day and the minute of that day (0 up to the calendar's minutes per day). */
export interface DateTime {
  day: number;
  minute: number;
}

/** A modulo that is never negative. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** A running count of leap years up to `n` (already shifted by the offset), so differences give counts for any range. */
function leapCount(rule: NonNullable<Calendar["leap"]>, n: number): number {
  let count = Math.floor(n / rule.every);
  if (rule.exceptEvery) count -= Math.floor(n / rule.exceptEvery);
  if (rule.exceptEvery && rule.unlessEvery) count += Math.floor(n / rule.unlessEvery);
  return count;
}

export function isLeapYear(c: Calendar, year: number): boolean {
  const r = c.leap;
  if (!r) return false;
  const n = year - r.offset;
  if (mod(n, r.every) !== 0) return false;
  if (r.exceptEvery && mod(n, r.exceptEvery) === 0) {
    return !!(r.unlessEvery && mod(n, r.unlessEvery) === 0);
  }
  return true;
}

export function monthDays(c: Calendar, year: number, month: number): number {
  const base = c.months[month].days;
  return c.leap && c.leap.month === month && isLeapYear(c, year) ? base + c.leap.extraDays : base;
}

function baseYearLength(c: Calendar): number {
  return c.months.reduce((sum, m) => sum + m.days, 0);
}

export function yearLength(c: Calendar, year: number): number {
  return baseYearLength(c) + (c.leap && isLeapYear(c, year) ? c.leap.extraDays : 0);
}

/** The absolute day on which `year` begins. */
export function yearStart(c: Calendar, year: number): number {
  const a0 = c.anchor.year;
  let start = c.anchor.day + (year - a0) * baseYearLength(c);
  if (c.leap) {
    const off = c.leap.offset;
    start += c.leap.extraDays * (leapCount(c.leap, year - 1 - off) - leapCount(c.leap, a0 - 1 - off));
  }
  return start;
}

export function dayToParts(c: Calendar, day: number): DatePartsWithDayOfYear {
  const avg = baseYearLength(c) + (c.leap ? c.leap.extraDays / c.leap.every : 0);
  let year = c.anchor.year + Math.floor((day - c.anchor.day) / avg);
  while (yearStart(c, year) > day) year--;
  while (yearStart(c, year + 1) <= day) year++;
  let rest = day - yearStart(c, year);
  const dayOfYear = rest + 1;
  for (let month = 0; month < c.months.length; month++) {
    const len = monthDays(c, year, month);
    if (rest < len) return { year, month, day: rest + 1, dayOfYear };
    rest -= len;
  }
  // Unreachable: the year's months add up to the year's length.
  return { year, month: c.months.length - 1, day: 1, dayOfYear };
}

/** The absolute day of a date, or null if the date does not exist in this calendar. */
export function partsToDay(c: Calendar, p: DateParts): number | null {
  if (!Number.isInteger(p.year) || !Number.isInteger(p.month) || !Number.isInteger(p.day)) return null;
  if (p.month < 0 || p.month >= c.months.length) return null;
  if (p.day < 1 || p.day > monthDays(c, p.year, p.month)) return null;
  let day = yearStart(c, p.year) + p.day - 1;
  for (let m = 0; m < p.month; m++) day += monthDays(c, p.year, m);
  return day;
}

export function weekdayIndex(c: Calendar, day: number): number {
  return mod(day + c.weekdayOffset, c.weekdays.length);
}

/** The season a day falls in, or null if the calendar has none. */
export function seasonAt(c: Calendar, day: number): Season | null {
  if (c.seasons.length === 0) return null;
  const { month, day: d } = dayToParts(c, day);
  let found: Season | null = null;
  for (const s of c.seasons) {
    if (s.month < month || (s.month === month && s.day <= d)) found = s;
  }
  // Before the first season of the year: the year's last season is still going.
  return found ?? c.seasons[c.seasons.length - 1];
}

export const PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
] as const;

export interface MoonPhase {
  /** 0 up to (not including) 1 through the cycle; 0 is new, 0.5 is full. */
  fraction: number;
  /** 0 to 7 into `PHASE_NAMES`. */
  index: number;
  name: string;
}

export function moonPhase(moon: Moon, day: number): MoonPhase {
  const position = mod(day + moon.offset, moon.cycle);
  const fraction = Math.min(position / moon.cycle, 1 - Number.EPSILON);
  const index = Math.floor(fraction * 8 + 0.5) % 8;
  return { fraction, index, name: PHASE_NAMES[index] };
}

export function eraOf(c: Calendar, year: number): { era: Era; yearInEra: number } | null {
  let found: Era | null = null;
  for (const e of c.eras) if (e.startYear <= year) found = e;
  return found ? { era: found, yearInEra: year - found.startYear + 1 } : null;
}

export function addDays(day: number, n: number): number {
  return day + n;
}

/** Same day of the month `n` months later (or earlier), or the month's last day if it is shorter. */
export function addMonths(c: Calendar, day: number, n: number): number {
  const p = dayToParts(c, day);
  const count = c.months.length;
  const total = p.year * count + p.month + n;
  const year = Math.floor(total / count);
  const month = mod(total, count);
  return partsToDay(c, { year, month, day: Math.min(p.day, monthDays(c, year, month)) }) as number;
}

export function addYears(c: Calendar, day: number, n: number): number {
  const p = dayToParts(c, day);
  const year = p.year + n;
  return partsToDay(c, { year, month: p.month, day: Math.min(p.day, monthDays(c, year, p.month)) }) as number;
}

export function advanceTime(c: Calendar, at: DateTime, minutes: number): DateTime {
  const perDay = minutesPerDay(c);
  const total = at.minute + minutes;
  return { day: at.day + Math.floor(total / perDay), minute: mod(total, perDay) };
}

export interface FormatOptions {
  weekday?: boolean;
  /** Show the era's short name after the year (default true). */
  era?: boolean;
}

/** `5 March 2024 CE`, or `Tuesday, 5 March 2024 CE`. */
export function formatDate(c: Calendar, day: number, options: FormatOptions = {}): string {
  const p = dayToParts(c, day);
  const era = eraOf(c, p.year);
  const year = era ? era.yearInEra : p.year;
  let out = `${p.day} ${c.months[p.month].name} ${year}`;
  if (era && options.era !== false) out += ` ${era.era.short}`;
  if (options.weekday) out = `${c.weekdays[weekdayIndex(c, day)]}, ${out}`;
  return out;
}

/** `09:05` for a minute of the day. */
export function formatTime(c: Calendar, minute: number): string {
  const hours = Math.floor(minute / c.minutesPerHour);
  const mins = minute % c.minutesPerHour;
  const hourWidth = String(c.hoursPerDay - 1).length;
  const minWidth = String(c.minutesPerHour - 1).length;
  return `${String(hours).padStart(hourWidth, "0")}:${String(mins).padStart(minWidth, "0")}`;
}

export function formatDateTime(c: Calendar, at: DateTime, options: FormatOptions = {}): string {
  return `${formatDate(c, at.day, options)}, ${formatTime(c, at.minute)}`;
}

// ---------------------------------------------------------------- lining a calendar up with the others

/**
 * Makes `parts` (a date in this calendar) fall on absolute day `day`, by moving where year numbering starts.
 * Returns the calendar unchanged if the date doesn't exist in it. Used by the calendar builder so nobody has to
 * type a raw day number: "Year 1, Frostmoon 1 is the same day as 1 January 2000 in the real-world calendar".
 */
export function alignDate(c: Calendar, parts: DateParts, day: number): Calendar {
  if (partsToDay(c, parts) === null) return c;
  let within = parts.day - 1;
  for (let m = 0; m < parts.month; m++) within += monthDays(c, parts.year, m);
  return { ...c, anchor: { year: parts.year, day: day - within } };
}

/** Makes absolute day `day` fall on the given weekday (an index into the weekdays). */
export function alignWeekday(c: Calendar, day: number, weekday: number): Calendar {
  if (weekday < 0 || weekday >= c.weekdays.length) return c;
  return { ...c, weekdayOffset: mod(weekday - day, c.weekdays.length) };
}

/** Moves a moon's cycle so that on absolute day `day` it is at `fraction` of the way round (0 new, 0.5 full). */
export function alignMoon(moon: Moon, day: number, fraction: number): Moon {
  return { ...moon, offset: mod(fraction * moon.cycle - day, moon.cycle) };
}

/** The first day on or after `from` when a moon is closest to `fraction` of its cycle (0 new, 0.5 full). */
export function nextPhaseDay(moon: Moon, from: number, fraction: number): number {
  let best = from;
  let bestGap = Infinity;
  for (let day = from; day <= from + Math.ceil(moon.cycle); day++) {
    const gap = Math.abs(((moonPhase(moon, day).fraction - fraction + 1.5) % 1) - 0.5);
    if (gap < bestGap - 1e-12) {
      best = day;
      bestGap = gap;
    }
  }
  return best;
}
