import type { Calendar } from "./definition";
import { formatDate } from "./math";

/**
 * The calendar dates are shown in when nothing more specific is known: the project's main calendar,
 * set by the app shell (`state/timeState.tsx`). Date properties are stored as absolute day numbers,
 * so showing one needs a calendar; screens that don't carry one around (property lists, tables,
 * query results) read it from here, and fall back to `Day 12` when no calendar is set.
 */
let current: Calendar | null = null;

export function setDisplayCalendar(calendar: Calendar | null): void {
  current = calendar;
}

export function getDisplayCalendar(): Calendar | null {
  return current;
}

export function displayDay(day: number): string {
  return current ? formatDate(current, day) : `Day ${day}`;
}
