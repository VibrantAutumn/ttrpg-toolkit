import { describe, expect, it } from "vitest";
import { partsToDay, yearLength } from "../calendar/math";
import { gregorian, plain } from "../calendar/testing";
import { emptyQuery } from "../queries/query";
import {
  axisTicks,
  defaultTimeline,
  laneOf,
  normalizeTimeline,
  packEntries,
  windowFor,
  zoomSpanDays,
  type TimelineEntry,
} from "./timeline";

const g = gregorian();

describe("zoom and window", () => {
  it("spans a century down to a day in the calendar's own units", () => {
    expect(zoomSpanDays(g, "year")).toBeCloseTo(365.2425, 3);
    expect(zoomSpanDays(g, "century")).toBeCloseTo(36524.25, 1);
    expect(zoomSpanDays(g, "decade")).toBeCloseTo(3652.425, 2);
    expect(zoomSpanDays(g, "month")).toBeCloseTo(365.2425 / 12, 3);
    expect(zoomSpanDays(g, "week")).toBe(7);
    expect(zoomSpanDays(g, "day")).toBe(1);
    expect(zoomSpanDays(plain(), "year")).toBe(360);
    expect(zoomSpanDays(plain(), "week")).toBe(5);
  });
  it("centres the window on a day and covers a few spans, never less than a day", () => {
    const w = windowFor(g, "week", 100);
    expect(w.from).toBeLessThan(100);
    expect(w.to).toBeGreaterThan(100);
    expect(w.to - w.from).toBeGreaterThanOrEqual(7);
    const d = windowFor(g, "day", 100);
    expect(d.to - d.from).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(d.from) && Number.isInteger(d.to)).toBe(true);
  });
});

describe("axis ticks", () => {
  it("marks the start of each year at year zoom's neighbours and each month at year zoom", () => {
    const from = partsToDay(g, { year: 2024, month: 0, day: 1 })!;
    const to = from + yearLength(g, 2024) - 1;
    const ticks = axisTicks(g, "year", from, to);
    expect(ticks.map((t) => t.label)).toEqual(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
    expect(ticks[0].day).toBe(from);
    expect(ticks[1].day).toBe(from + 31);
  });
  it("marks years at decade zoom and tens of years at century zoom", () => {
    const from = partsToDay(g, { year: 1995, month: 0, day: 1 })!;
    const to = partsToDay(g, { year: 2015, month: 11, day: 31 })!;
    expect(axisTicks(g, "decade", from, to).map((t) => t.label)).toEqual(["1995", "1996", "1997", "1998", "1999", "2000", "2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009", "2010", "2011", "2012", "2013", "2014", "2015"].map((y) => `${y} CE`));
    expect(axisTicks(g, "century", from, to).map((t) => t.label)).toEqual(["2000 CE", "2010 CE"]);
  });
  it("marks every day at week and day zoom", () => {
    const ticks = axisTicks(g, "week", 100, 106);
    expect(ticks.map((t) => t.day)).toEqual([100, 101, 102, 103, 104, 105, 106]);
  });
  it("keeps ticks inside the window and in order", () => {
    for (const zoom of ["century", "decade", "year", "month", "week", "day"] as const) {
      const w = windowFor(g, zoom, 730119);
      const ticks = axisTicks(g, zoom, w.from, w.to);
      expect(ticks.length, zoom).toBeGreaterThan(0);
      expect(ticks.length, zoom).toBeLessThan(400);
      for (let i = 0; i < ticks.length; i++) {
        expect(ticks[i].day).toBeGreaterThanOrEqual(w.from);
        expect(ticks[i].day).toBeLessThanOrEqual(w.to);
        if (i > 0) expect(ticks[i].day).toBeGreaterThan(ticks[i - 1].day);
      }
    }
  });
});

const entry = (key: string, day: number, endDay = day, label = key): TimelineEntry => ({ key, itemId: key, label, day, endDay, kind: "event", laneKey: "all" });

describe("packing entries into rows", () => {
  it("puts entries that would overlap on different rows and others on the same row", () => {
    const placed = packEntries([entry("a", 0, 0, "aaaa"), entry("b", 0, 0, "bbbb"), entry("c", 50, 50, "cccc")], 0, 100, 1000);
    const row = (k: string) => placed.find((p) => p.entry.key === k)!.row;
    expect(row("a")).toBe(0);
    expect(row("b")).toBe(1);
    expect(row("c")).toBe(0);
  });
  it("makes a span as wide as its days, and short ones wide enough to read", () => {
    const placed = packEntries([entry("long", 10, 29, "x"), entry("point", 50, 50, "a long label here")], 0, 100, 1000);
    const long = placed.find((p) => p.entry.key === "long")!;
    expect(long.left).toBeCloseTo(100, 5);
    expect(long.width).toBeCloseTo(200, 5);
    const point = placed.find((p) => p.entry.key === "point")!;
    expect(point.width).toBeGreaterThan(40);
  });
  it("leaves out entries outside the window and clips ones that cross its edge", () => {
    const placed = packEntries([entry("out", 200), entry("cross", 90, 120)], 0, 100, 1000);
    expect(placed.map((p) => p.entry.key)).toEqual(["cross"]);
    expect(placed[0].left + placed[0].width).toBeLessThanOrEqual(1000.0001);
  });
  it("never overlaps two entries on one row (random check)", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 40; round++) {
      const entries = Array.from({ length: 40 }, (_, i) => {
        const day = rand(300);
        return entry(`e${i}`, day, day + rand(20), "x".repeat(rand(12) + 1));
      });
      const placed = packEntries(entries, 0, 300, 900);
      const byRow = new Map<number, typeof placed>();
      for (const p of placed) byRow.set(p.row, [...(byRow.get(p.row) ?? []), p]);
      for (const row of byRow.values()) {
        const sorted = [...row].sort((a, b) => a.left - b.left);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i].left).toBeGreaterThanOrEqual(sorted[i - 1].left + sorted[i - 1].width - 0.0001);
      }
    }
  });
});

describe("lanes", () => {
  it("one lane for everything with no rule, one per kind with the kind rule", () => {
    const e: TimelineEntry = { ...entry("a", 1), kind: "session" };
    expect(laneOf({ by: "none" }, e)).toEqual({ key: "all", label: "Everything" });
    expect(laneOf({ by: "kind" }, e)).toEqual({ key: "session", label: "Sessions" });
  });
  it("uses the dropdown choice or the tag the item has, else Other", () => {
    const e = entry("a", 1);
    const lookups = { choices: new Map([["a", { key: "c1", label: "Zhentarim" }]]), tags: new Map<string, { key: string; label: string }>() };
    expect(laneOf({ by: "field", fieldId: "f" }, e, lookups)).toEqual({ key: "c1", label: "Zhentarim" });
    expect(laneOf({ by: "field", fieldId: "f" }, entry("b", 1), lookups)).toEqual({ key: "other", label: "Other" });
    const tagLookups = { choices: new Map(), tags: new Map([["a", { key: "t1", label: "Harpers" }]]) };
    expect(laneOf({ by: "tag", parentTagId: "p" }, e, tagLookups)).toEqual({ key: "t1", label: "Harpers" });
  });
});

describe("normalizeTimeline", () => {
  it("fills in a default for anything unreadable and keeps good settings", () => {
    expect(normalizeTimeline(null)).toEqual(defaultTimeline());
    expect(normalizeTimeline({ version: 1, zoom: "century", lanes: { by: "kind" } })).toMatchObject({ zoom: "century", lanes: { by: "kind" } });
    expect(normalizeTimeline({ zoom: "weeks" }).zoom).toBe(defaultTimeline().zoom);
    expect(normalizeTimeline({ lanes: { by: "field" } }).lanes).toEqual({ by: "none" });
  });
  it("repairs the query and is stable", () => {
    const t = normalizeTimeline({ query: { version: 1, where: { op: "all", not: false, rules: [] }, sort: [] } });
    expect(normalizeTimeline(t)).toEqual(t);
    expect(t.query.where.rules).toEqual([]);
    expect(emptyQuery().where.rules).toEqual([]);
  });
});
