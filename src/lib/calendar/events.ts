import type { Calendar } from "./definition";
import { normalizeRecurrence, occurrences, type Recurrence } from "./recurrence";

/**
 * Events and dated notes: what the editor holds while you type, how it becomes a valid saved event, and how
 * repeating events turn into the days they land on (for the month view and timelines).
 */

/** What an event is, as the database reports it (a subset of `CalendarEventRecord` in `api/time.ts`). */
export interface EventLike {
  itemId: string;
  name: string;
  itemType: "event" | "note";
  visibility: "default" | "visible" | "secret";
  startDay: number;
  startMinute: number | null;
  endDay: number | null;
  endMinute: number | null;
  recurrenceJson: string | null;
  untilDay: number | null;
}

/** What the editor holds. It may be half-finished (an end before the start); `draftToInput` repairs that. */
export interface EventDraft {
  startDay: number;
  startMinute: number | null;
  endDay: number | null;
  endMinute: number | null;
  recurrence: Recurrence | null;
  untilDay: number | null;
  body: string;
}

export interface EventInputData {
  startDay: number;
  startMinute: number | null;
  endDay: number | null;
  endMinute: number | null;
  recurrenceJson: string | null;
  untilDay: number | null;
  body: string;
}

export function newDraft(startDay: number): EventDraft {
  return { startDay, startMinute: null, endDay: null, endMinute: null, recurrence: null, untilDay: null, body: "" };
}

export function draftToInput(draft: EventDraft): EventInputData {
  const endDay = draft.endDay === null ? null : Math.max(draft.endDay, draft.startDay);
  let endMinute = endDay === null ? null : draft.endMinute;
  if (endMinute !== null && endDay === draft.startDay && draft.startMinute !== null && endMinute < draft.startMinute) {
    endMinute = draft.startMinute;
  }
  const untilDay = draft.recurrence && draft.untilDay !== null && draft.untilDay >= draft.startDay ? draft.untilDay : null;
  return {
    startDay: draft.startDay,
    startMinute: draft.startMinute,
    endDay,
    endMinute,
    recurrenceJson: draft.recurrence ? JSON.stringify(draft.recurrence) : null,
    untilDay,
    body: draft.body,
  };
}

/** One appearance of an event on the calendar. */
export interface EventInstance {
  itemId: string;
  name: string;
  kind: "event" | "note";
  secret: boolean;
  /** First day of this appearance. */
  day: number;
  /** Last day (equal to `day` for a one-day event). */
  endDay: number;
  startMinute: number | null;
  repeating: boolean;
}

/** Every appearance of the events that touches `from..to`, by day, then time of day, then name. */
export function expandEvents(c: Calendar, events: readonly EventLike[], from: number, to: number): EventInstance[] {
  const out: EventInstance[] = [];
  for (const e of events) {
    const span = Math.max(0, (e.endDay ?? e.startDay) - e.startDay);
    let rule: Recurrence | null = null;
    if (e.recurrenceJson !== null) {
      try {
        rule = normalizeRecurrence(JSON.parse(e.recurrenceJson));
      } catch {
        rule = null;
      }
    }
    const make = (day: number, repeating: boolean): EventInstance => ({
      itemId: e.itemId,
      name: e.name,
      kind: e.itemType,
      secret: e.visibility === "secret",
      day,
      endDay: day + span,
      startMinute: e.startMinute,
      repeating,
    });
    if (rule) {
      // An appearance that began before the window can still reach into it.
      for (const day of occurrences(c, rule, e.startDay, e.untilDay, from - span, to)) out.push(make(day, true));
    } else if (e.startDay <= to && e.startDay + span >= from) {
      out.push(make(e.startDay, false));
    }
  }
  out.sort((a, b) => a.day - b.day || (a.startMinute ?? -1) - (b.startMinute ?? -1) || a.name.localeCompare(b.name));
  return out.filter((i) => i.day <= to && i.endDay >= from);
}
