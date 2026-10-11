import { describe, expect, it } from "vitest";
import { draftToInput, expandEvents, newDraft, type EventLike } from "./events";
import { partsToDay } from "./math";
import { gregorian } from "./testing";

const g = gregorian();
const d = (y: number, m: number, day: number) => partsToDay(g, { year: y, month: m, day })!;

const base: EventLike = {
  itemId: "a",
  name: "Event",
  itemType: "event",
  visibility: "default",
  startDay: 100,
  startMinute: null,
  endDay: null,
  endMinute: null,
  recurrenceJson: null,
  untilDay: null,
};

describe("draftToInput", () => {
  it("makes a valid input out of a half-finished draft", () => {
    const draft = { ...newDraft(100), endDay: 90, endMinute: 5, untilDay: 50, recurrence: null };
    const input = draftToInput(draft);
    expect(input.endDay).toBe(100);
    expect(input.untilDay).toBeNull();
    expect(input.endMinute).toBe(5);
  });
  it("keeps the end time after the start time on a one-day event", () => {
    const input = draftToInput({ ...newDraft(100), startMinute: 600, endDay: 100, endMinute: 300 });
    expect(input.endMinute).toBe(600);
  });
  it("drops an end time with no end date, and writes the rule as JSON", () => {
    const input = draftToInput({ ...newDraft(1), endMinute: 5, recurrence: { kind: "days", interval: 2 } });
    expect(input.endMinute).toBeNull();
    expect(JSON.parse(input.recurrenceJson!)).toEqual({ kind: "days", interval: 2 });
  });
});

describe("expandEvents", () => {
  it("lists one-off events that touch the window, by date then time then name", () => {
    const events: EventLike[] = [
      { ...base, itemId: "1", name: "Late", startDay: 12, startMinute: 600 },
      { ...base, itemId: "2", name: "Early", startDay: 12, startMinute: 60 },
      { ...base, itemId: "3", name: "Long", startDay: 5, endDay: 11 },
      { ...base, itemId: "4", name: "Outside", startDay: 40 },
    ];
    const out = expandEvents(g, events, 10, 20);
    expect(out.map((e) => e.name)).toEqual(["Long", "Early", "Late"]);
    expect(out[0]).toMatchObject({ day: 5, endDay: 11, repeating: false });
  });
  it("expands a repeating event into each day it lands on, keeping its length", () => {
    const events: EventLike[] = [{ ...base, startDay: 0, endDay: 1, recurrenceJson: JSON.stringify({ kind: "days", interval: 7 }) }];
    const out = expandEvents(g, events, 6, 15);
    expect(out.map((e) => [e.day, e.endDay])).toEqual([
      [7, 8],
      [14, 15],
    ]);
    expect(out.every((e) => e.repeating)).toBe(true);
  });
  it("includes a repeat that began just before the window and still overlaps it", () => {
    const events: EventLike[] = [{ ...base, startDay: 0, endDay: 3, recurrenceJson: JSON.stringify({ kind: "days", interval: 10 }) }];
    expect(expandEvents(g, events, 11, 12).map((e) => e.day)).toEqual([10]);
  });
  it("respects when a repeating event stops", () => {
    const events: EventLike[] = [{ ...base, startDay: 0, untilDay: 15, recurrenceJson: JSON.stringify({ kind: "days", interval: 10 }) }];
    expect(expandEvents(g, events, 0, 100).map((e) => e.day)).toEqual([0, 10]);
  });
  it("finds yearly festivals in the right month", () => {
    const events: EventLike[] = [{ ...base, startDay: d(2020, 11, 25), recurrenceJson: JSON.stringify({ kind: "yearly", month: 11, day: 25 }) }];
    const out = expandEvents(g, events, d(2024, 0, 1), d(2024, 11, 31));
    expect(out.map((e) => e.day)).toEqual([d(2024, 11, 25)]);
  });
  it("treats an unreadable rule as a one-off event", () => {
    const events: EventLike[] = [{ ...base, startDay: 5, recurrenceJson: "nope" }];
    expect(expandEvents(g, events, 0, 10).map((e) => [e.day, e.repeating])).toEqual([[5, false]]);
  });
  it("marks secret items", () => {
    expect(expandEvents(g, [{ ...base, startDay: 1, visibility: "secret" }], 0, 5)[0].secret).toBe(true);
  });
});
