import { getItems, listTagLinks } from "../api/library";
import { listFieldValues } from "../api/fields";
import { runQuery } from "../api/queries";
import { listCalendarEvents, listSessions } from "../api/time";
import type { Calendar } from "../lib/calendar/definition";
import { expandEvents } from "../lib/calendar/events";
import type { FieldDefinition } from "../lib/fields/definition";
import type { DateValue } from "../lib/fields/value";
import {
  laneOf,
  OTHER_LANE,
  type Lane,
  type LaneLookups,
  type LaneRule,
  type TimelineConfig,
  type TimelineEntry,
} from "../lib/timelines/timeline";

export interface TimelineData {
  entries: TimelineEntry[];
  /** Lanes in the order they are drawn. */
  lanes: Lane[];
  /** True when the query found more items than the engine returns. */
  truncated: boolean;
}

/**
 * Loads what a timeline shows for a window of days: the dated things that pass its query (events and notes,
 * sessions, and pages with a date property), grouped into lanes. Everything is read fresh, so the view always
 * agrees with the database.
 */
export async function loadTimelineData(
  projectId: string,
  config: TimelineConfig,
  calendar: Calendar,
  from: number,
  to: number,
  today: number,
  definitions: readonly FieldDefinition[],
): Promise<TimelineData> {
  // An empty query means "no restriction", so the plain default timeline shows everything that is dated.
  const restricted = config.query.where.rules.length > 0;
  let allowed: Set<string> | null = null;
  let truncated = false;
  if (restricted) {
    const result = await runQuery(projectId, config.query);
    allowed = new Set(result.items.map((i) => i.id));
    truncated = result.truncated;
  }
  const passes = (id: string) => allowed === null || allowed.has(id);

  const entries: TimelineEntry[] = [];
  const libraryOf = new Map<string, string>();

  if (config.sources.events || config.sources.notes) {
    const events = await listCalendarEvents(projectId, from, to);
    for (const e of expandEvents(calendar, events, from, to)) {
      if (!passes(e.itemId)) continue;
      if (e.kind === "event" ? !config.sources.events : !config.sources.notes) continue;
      entries.push({ key: `${e.itemId}@${e.day}`, itemId: e.itemId, label: e.name, day: e.day, endDay: e.endDay, kind: e.kind, laneKey: "" });
      libraryOf.set(e.itemId, "calendar");
    }
  }

  if (config.sources.sessions) {
    for (const s of await listSessions(projectId)) {
      if (s.startDay === null || !passes(s.itemId)) continue;
      const end = s.endDay ?? (s.status === "running" ? Math.max(today, s.startDay) : s.startDay);
      if (end < from || s.startDay > to) continue;
      entries.push({ key: s.itemId, itemId: s.itemId, label: s.name, day: s.startDay, endDay: end, kind: "session", laneKey: "" });
      libraryOf.set(s.itemId, "worldbuilding");
    }
  }

  if (config.sources.properties) {
    const dateFields = definitions.filter((d) => d.kind === "date");
    const found: { itemId: string; field: FieldDefinition; value: DateValue }[] = [];
    for (const def of dateFields) {
      for (const [itemId, value] of await listFieldValues(def)) {
        const v = value as DateValue | null;
        if (!v || !passes(itemId)) continue;
        if ((v.endDay ?? v.day) < from || v.day > to) continue;
        found.push({ itemId, field: def, value: v });
      }
    }
    if (found.length > 0) {
      const items = new Map((await getItems([...new Set(found.map((f) => f.itemId))])).filter((i) => i.deletedAt === null).map((i) => [i.id, i]));
      // Events, notes and sessions are shown from their own tables above; a page's date properties are shown here.
      for (const f of found) {
        const item = items.get(f.itemId);
        if (!item || item.library === "calendar" || item.itemType === "session") continue;
        const several = dateFields.length > 1;
        entries.push({
          key: `${f.itemId}:${f.field.id}`,
          itemId: f.itemId,
          label: several ? `${item.name} · ${f.field.name}` : item.name,
          day: f.value.day,
          endDay: f.value.endDay ?? f.value.day,
          kind: "property",
          laneKey: "",
        });
        libraryOf.set(f.itemId, item.library);
      }
    }
  }

  const lookups = await laneLookups(projectId, config.lanes, definitions, [...new Set(libraryOf.values())], [...libraryOf.keys()]);
  const laneMap = new Map<string, Lane>();
  for (const entry of entries) {
    const lane = laneOf(config.lanes, entry, lookups);
    entry.laneKey = lane.key;
    laneMap.set(lane.key, lane);
  }
  // Lanes with something in them, in a steady order: the rule's own lanes first, "Other" last.
  const ordered = [...laneMap.values()].sort((a, b) => (a.key === OTHER_LANE.key ? 1 : b.key === OTHER_LANE.key ? -1 : a.label.localeCompare(b.label)));
  entries.sort((a, b) => a.day - b.day || a.label.localeCompare(b.label));
  return { entries, lanes: ordered, truncated };
}

async function laneLookups(
  projectId: string,
  rule: LaneRule,
  definitions: readonly FieldDefinition[],
  libraries: string[],
  itemIds: string[],
): Promise<LaneLookups> {
  const lookups: LaneLookups = { choices: new Map(), tags: new Map() };
  if (rule.by === "field") {
    const def = definitions.find((d) => d.id === rule.fieldId);
    if (def && def.kind === "dropdown") {
      const wanted = new Set(itemIds);
      for (const [itemId, value] of await listFieldValues(def)) {
        if (!wanted.has(itemId) || typeof value !== "string") continue;
        const option = def.config.options.find((o) => o.id === value);
        if (option) lookups.choices.set(itemId, { key: option.id, label: option.label });
      }
    }
  } else if (rule.by === "tag") {
    for (const library of libraries) {
      for (const link of await listTagLinks(projectId, library)) {
        if (link.tag.deletedAt !== null || link.tag.parentId !== rule.parentTagId) continue;
        if (!lookups.tags.has(link.itemId)) lookups.tags.set(link.itemId, { key: link.tag.id, label: link.tag.name });
      }
    }
  }
  return lookups;
}
