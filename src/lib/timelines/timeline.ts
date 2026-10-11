import type { Calendar } from "../calendar/definition";
import { dayToParts, eraOf, monthDays, yearStart } from "../calendar/math";
import { emptyQuery, normalizeQuery, type Query } from "../queries/query";

/**
 * Timelines: what a timeline holds (which items, how lanes are made, how far it is zoomed) and the pure layout
 * of what it shows (zoom windows, axis ticks, packing into rows). Loading the dated things is in
 * `modules/calendar/TimelineView.tsx`; nothing here touches the database.
 *
 * A timeline shows **dated things**: events and dated notes, sessions, and any page with a date property. A
 * saved query (the shared filter builder) says which items count; the lane rule groups them.
 */

export const TIMELINE_VERSION = 1;

export type ZoomLevel = "century" | "decade" | "year" | "month" | "week" | "day";
export const ZOOM_LEVELS: readonly ZoomLevel[] = ["century", "decade", "year", "month", "week", "day"];
export const ZOOM_LABELS: Record<ZoomLevel, string> = {
  century: "Centuries",
  decade: "Decades",
  year: "Years",
  month: "Months",
  week: "Weeks",
  day: "Days",
};

export type LaneRule =
  | { by: "none" }
  /** One lane per kind of thing: events, notes, sessions, pages. */
  | { by: "kind" }
  /** One lane per sub-tag of this tag (or per top-level tag when none is chosen). */
  | { by: "tag"; parentTagId: string | null }
  /** One lane per choice of a dropdown property. */
  | { by: "field"; fieldId: string };

export interface TimelineSources {
  events: boolean;
  notes: boolean;
  sessions: boolean;
  properties: boolean;
}

export interface TimelineConfig {
  version: number;
  query: Query;
  lanes: LaneRule;
  sources: TimelineSources;
  zoom: ZoomLevel;
  /** The day the timeline is centred on; null means the project's current date. */
  centerDay: number | null;
}

export function defaultTimeline(): TimelineConfig {
  return {
    version: TIMELINE_VERSION,
    query: emptyQuery(),
    lanes: { by: "none" },
    sources: { events: true, notes: true, sessions: true, properties: true },
    zoom: "year",
    centerDay: null,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The one gate every timeline's settings pass through. Never throws; anything unreadable becomes the plain default. */
export function normalizeTimeline(raw: unknown): TimelineConfig {
  const base = defaultTimeline();
  if (!isObject(raw)) return base;
  const query = raw.query !== undefined ? normalizeQuery(raw.query) : null;
  let lanes: LaneRule = base.lanes;
  if (isObject(raw.lanes)) {
    const l = raw.lanes;
    if (l.by === "kind") lanes = { by: "kind" };
    else if (l.by === "tag") lanes = { by: "tag", parentTagId: typeof l.parentTagId === "string" && l.parentTagId !== "" ? l.parentTagId : null };
    else if (l.by === "field" && typeof l.fieldId === "string" && l.fieldId !== "") lanes = { by: "field", fieldId: l.fieldId };
  }
  const s = isObject(raw.sources) ? raw.sources : {};
  const flag = (v: unknown) => (typeof v === "boolean" ? v : true);
  return {
    version: TIMELINE_VERSION,
    query: query?.ok ? query.query : base.query,
    lanes,
    sources: { events: flag(s.events), notes: flag(s.notes), sessions: flag(s.sessions), properties: flag(s.properties) },
    zoom: ZOOM_LEVELS.includes(raw.zoom as ZoomLevel) ? (raw.zoom as ZoomLevel) : base.zoom,
    centerDay: typeof raw.centerDay === "number" && Number.isInteger(raw.centerDay) && Math.abs(raw.centerDay) <= 1_000_000_000 ? raw.centerDay : null,
  };
}

export function parseTimeline(json: string): TimelineConfig {
  try {
    return normalizeTimeline(JSON.parse(json));
  } catch {
    return defaultTimeline();
  }
}

// ---------------------------------------------------------------- zoom windows

/** How many days one "screenful" is at a zoom level, in the calendar's own units. */
export function zoomSpanDays(c: Calendar, zoom: ZoomLevel): number {
  const baseYear = c.months.reduce((sum, m) => sum + m.days, 0);
  const year = baseYear + (c.leap ? (c.leap.extraDays * (1 / c.leap.every - (c.leap.exceptEvery ? 1 / c.leap.exceptEvery : 0) + (c.leap.exceptEvery && c.leap.unlessEvery ? 1 / c.leap.unlessEvery : 0))) : 0);
  switch (zoom) {
    case "century":
      return year * 100;
    case "decade":
      return year * 10;
    case "year":
      return year;
    case "month":
      return year / c.months.length;
    case "week":
      return c.weekdays.length;
    case "day":
      return 1;
  }
}

/** The days a timeline draws around a centre day: three screenfuls, so there is room to scroll either way. */
export function windowFor(c: Calendar, zoom: ZoomLevel, center: number): { from: number; to: number } {
  const half = Math.max(2, Math.ceil(zoomSpanDays(c, zoom) * 1.5));
  return { from: center - half, to: center + half };
}

// ---------------------------------------------------------------- the axis

export interface Tick {
  day: number;
  label: string;
}

function yearLabel(c: Calendar, year: number): string {
  const era = eraOf(c, year);
  return era ? `${era.yearInEra} ${era.era.short}` : String(year);
}

/** Marks along the top of a timeline, oldest first, all inside `from..to`. */
export function axisTicks(c: Calendar, zoom: ZoomLevel, from: number, to: number): Tick[] {
  const ticks: Tick[] = [];
  const yearsFrom = dayToParts(c, from).year;
  const yearsTo = dayToParts(c, to).year;
  switch (zoom) {
    case "century":
    case "decade":
      for (let y = yearsFrom; y <= yearsTo; y++) {
        if (zoom === "century" && y % 10 !== 0) continue;
        const day = yearStart(c, y);
        if (day >= from && day <= to) ticks.push({ day, label: yearLabel(c, y) });
      }
      break;
    case "year":
      for (let y = yearsFrom; y <= yearsTo; y++) {
        for (let m = 0, day = yearStart(c, y); m < c.months.length; day += monthDays(c, y, m), m++) {
          if (day >= from && day <= to) ticks.push({ day, label: c.months[m].name });
        }
      }
      break;
    case "month":
      for (let day = from; day <= to; day++) {
        const p = dayToParts(c, day);
        if ((p.day - 1) % 5 === 0) ticks.push({ day, label: p.day === 1 ? c.months[p.month].name : String(p.day) });
      }
      break;
    case "week":
    case "day":
      for (let day = from; day <= to; day++) {
        const p = dayToParts(c, day);
        ticks.push({ day, label: p.day === 1 ? `${p.day} ${c.months[p.month].name}` : String(p.day) });
      }
      break;
  }
  return ticks;
}

// ---------------------------------------------------------------- what is shown

export type EntryKind = "event" | "note" | "session" | "property";

/** One dated thing on a timeline. */
export interface TimelineEntry {
  /** Unique among entries (an item can appear several times: a repeating event, or several date properties). */
  key: string;
  itemId: string;
  label: string;
  day: number;
  /** Last day (equal to `day` for a single day). */
  endDay: number;
  kind: EntryKind;
  /** Filled in by `laneOf` when lanes are made. */
  laneKey: string;
}

export interface Lane {
  key: string;
  label: string;
}

export interface LaneLookups {
  /** item id -> the dropdown choice it has (for field lanes). */
  choices: Map<string, Lane>;
  /** item id -> the sub-tag it carries (for tag lanes). */
  tags: Map<string, Lane>;
}

const KIND_LANES: Record<EntryKind, Lane> = {
  event: { key: "event", label: "Events" },
  note: { key: "note", label: "DM notes" },
  session: { key: "session", label: "Sessions" },
  property: { key: "property", label: "Pages" },
};

export const OTHER_LANE: Lane = { key: "other", label: "Other" };

/** Which lane an entry belongs to under a rule. */
export function laneOf(rule: LaneRule, entry: TimelineEntry, lookups?: LaneLookups): Lane {
  switch (rule.by) {
    case "none":
      return { key: "all", label: "Everything" };
    case "kind":
      return KIND_LANES[entry.kind];
    case "field":
      return lookups?.choices.get(entry.itemId) ?? OTHER_LANE;
    case "tag":
      return lookups?.tags.get(entry.itemId) ?? OTHER_LANE;
  }
}

export interface PlacedEntry {
  entry: TimelineEntry;
  /** Pixels from the left of the timeline. */
  left: number;
  width: number;
  /** Row inside its lane, from 0, so entries that would overlap sit one under another. */
  row: number;
}

const MIN_LABEL_PX = 6; // about one character
const LABEL_PADDING_PX = 14;
const MAX_LABEL_PX = 180;
const GAP_PX = 4;

/**
 * Places entries along a window `from..to` drawn `widthPx` wide. A span is as wide as its days; a short one is
 * widened so its label can be read. Entries that would overlap go on later rows. Entries outside the window
 * are left out; ones that cross its edge are clipped to it.
 */
export function packEntries(entries: readonly TimelineEntry[], from: number, to: number, widthPx: number): PlacedEntry[] {
  const perDay = widthPx / Math.max(1, to - from);
  const placed: PlacedEntry[] = [];
  const candidates = entries
    .filter((e) => e.endDay >= from && e.day <= to)
    .map((e) => {
      const left = Math.max(0, (e.day - from) * perDay);
      const right = Math.min(widthPx, (e.endDay + 1 - from) * perDay);
      const labelPx = Math.min(MAX_LABEL_PX, e.label.length * MIN_LABEL_PX + LABEL_PADDING_PX);
      return { entry: e, left, width: Math.max(right - left, labelPx) };
    })
    .sort((a, b) => a.left - b.left || b.width - a.width || a.entry.key.localeCompare(b.entry.key));
  const rowEnds: number[] = [];
  for (const c of candidates) {
    let row = rowEnds.findIndex((end) => c.left >= end + GAP_PX);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = c.left + c.width;
    placed.push({ ...c, row });
  }
  return placed;
}
