import { LIMITS, type Calendar } from "./definition";
import { dayToParts, mod, monthDays, partsToDay, weekdayIndex } from "./math";

/**
 * Recurring events: a few simple patterns, as plain data. A pattern says only *how* dates repeat;
 * the event holds the first day (`start`) and an optional last day (`until`). Everything is
 * computed from the calendar, so a rule keeps working if the calendar is edited.
 */

export type Recurrence =
  /** Every `interval` days, counted from the start day. */
  | { kind: "days"; interval: number }
  /** Every `interval` weeks on a weekday (index into the calendar's weekdays), from the first such weekday on or after the start. */
  | { kind: "weeks"; interval: number; weekday: number }
  /** On a day of the month, every `interval` months counted from the start's month. A day past the month's end means its last day. */
  | { kind: "monthly"; day: number; interval: number }
  /** On a date every year (a leap day falls on the month's last day in other years). */
  | { kind: "yearly"; month: number; day: number }
  /** The `nth` weekday of a month (`nth` of -1 means the last one), in one month of the year or in every month. */
  | { kind: "nthWeekday"; nth: number; weekday: number; month: number | null };

const MAX_WINDOW_DAYS = 400_000;
export const DEFAULT_CAP = 1000;

function whole(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Reads a stored rule. Repairs numbers; returns null for something that is not a rule. */
export function normalizeRecurrence(raw: unknown): Recurrence | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "days":
      return { kind: "days", interval: whole(r.interval, 1, 100000, 1) };
    case "weeks":
      return { kind: "weeks", interval: whole(r.interval, 1, 1000, 1), weekday: whole(r.weekday, 0, LIMITS.weekdays - 1, 0) };
    case "monthly":
      return { kind: "monthly", day: whole(r.day, 1, LIMITS.monthDays, 1), interval: whole(r.interval, 1, 1000, 1) };
    case "yearly":
      return { kind: "yearly", month: whole(r.month, 0, LIMITS.months - 1, 0), day: whole(r.day, 1, LIMITS.monthDays, 1) };
    case "nthWeekday": {
      const nth = typeof r.nth === "number" && r.nth < 0 ? -1 : whole(r.nth, 1, 5, 1);
      return {
        kind: "nthWeekday",
        nth,
        weekday: whole(r.weekday, 0, LIMITS.weekdays - 1, 0),
        month: r.month === null || r.month === undefined ? null : whole(r.month, 0, LIMITS.months - 1, 0),
      };
    }
    default:
      return null;
  }
}

/** The days an event repeats on inside `from..to` (both included), oldest first, at most `cap`. */
export function occurrences(
  c: Calendar,
  rule: Recurrence,
  start: number,
  until: number | null,
  from: number,
  to: number,
  cap: number = DEFAULT_CAP,
): number[] {
  const lo = Math.max(from, start);
  const hi = Math.min(until === null ? to : Math.min(to, until), lo + MAX_WINDOW_DAYS);
  if (hi < lo) return [];
  const out: number[] = [];
  const push = (day: number) => {
    if (day >= lo && day <= hi && out.length < cap) out.push(day);
  };
  const stepped = (first: number, step: number) => {
    // `first` is on the pattern; walk it forward from the window's start.
    const k = Math.max(0, Math.ceil((lo - first) / step));
    for (let day = first + k * step; day <= hi && out.length < cap; day += step) push(day);
  };

  const months = c.months.length;
  const weekLength = c.weekdays.length;

  switch (rule.kind) {
    case "days":
      stepped(start, rule.interval);
      break;
    case "weeks": {
      if (rule.weekday >= weekLength) break;
      const first = start + mod(rule.weekday - weekdayIndex(c, start), weekLength);
      stepped(first, rule.interval * weekLength);
      break;
    }
    case "monthly": {
      const s = dayToParts(c, start);
      const startTotal = s.year * months + s.month;
      const a = dayToParts(c, lo);
      const b = dayToParts(c, hi);
      for (let t = a.year * months + a.month; t <= b.year * months + b.month && out.length < cap; t++) {
        if (mod(t - startTotal, rule.interval) !== 0) continue;
        const year = Math.floor(t / months);
        const month = mod(t, months);
        push(partsToDay(c, { year, month, day: Math.min(rule.day, monthDays(c, year, month)) }) as number);
      }
      break;
    }
    case "yearly": {
      if (rule.month >= months) break;
      for (let year = dayToParts(c, lo).year; year <= dayToParts(c, hi).year && out.length < cap; year++) {
        push(partsToDay(c, { year, month: rule.month, day: Math.min(rule.day, monthDays(c, year, rule.month)) }) as number);
      }
      break;
    }
    case "nthWeekday": {
      if (rule.weekday >= weekLength) break;
      const a = dayToParts(c, lo);
      const b = dayToParts(c, hi);
      for (let t = a.year * months + a.month; t <= b.year * months + b.month && out.length < cap; t++) {
        const year = Math.floor(t / months);
        const month = mod(t, months);
        if (rule.month !== null && rule.month !== month) continue;
        const length = monthDays(c, year, month);
        const first = partsToDay(c, { year, month, day: 1 }) as number;
        const offset = mod(rule.weekday - weekdayIndex(c, first), weekLength);
        if (offset >= length) continue;
        const index = rule.nth === -1 ? offset + Math.floor((length - 1 - offset) / weekLength) * weekLength : offset + (rule.nth - 1) * weekLength;
        if (index < length) push(first + index);
      }
      break;
    }
  }
  return out;
}

const ORDINALS: Record<number, string> = { 1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", [-1]: "last" };

/** A rule in words, using the calendar's own weekday and month names. */
export function describeRecurrence(c: Calendar, rule: Recurrence): string {
  const weekday = (i: number) => c.weekdays[i] ?? `day ${i + 1}`;
  const month = (i: number) => c.months[i]?.name ?? `month ${i + 1}`;
  switch (rule.kind) {
    case "days":
      return rule.interval === 1 ? "Every day" : `Every ${rule.interval} days`;
    case "weeks":
      return rule.interval === 1 ? `Every ${weekday(rule.weekday)}` : `Every ${rule.interval} weeks on ${weekday(rule.weekday)}`;
    case "monthly":
      return rule.interval === 1 ? `On day ${rule.day} of every month` : `On day ${rule.day} of every ${rule.interval} months`;
    case "yearly":
      return `Every year on ${rule.day} ${month(rule.month)}`;
    case "nthWeekday":
      return `The ${ORDINALS[rule.nth]} ${weekday(rule.weekday)} of ${rule.month === null ? "every month" : month(rule.month)}`;
  }
}
