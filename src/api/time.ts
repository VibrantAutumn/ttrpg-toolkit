import { invoke } from "@tauri-apps/api/core";
import { normalizeCalendar, type Calendar } from "../lib/calendar/definition";

/** Mirrors the Rust `JsonRecord` (a calendar or a timeline's saved text). */
export interface JsonRecord {
  itemId: string;
  json: string;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `JsonEntry` (a row of the calendar or timeline list). */
export interface JsonEntry {
  itemId: string;
  name: string;
  updatedAt: number;
}

/** Mirrors the Rust `CalendarEvent`: a quick event or a dated note. Dates are absolute day numbers. */
export interface CalendarEventRecord {
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
  body: string;
  updatedAt: number;
}

export interface EventInput {
  startDay: number;
  startMinute: number | null;
  endDay: number | null;
  endMinute: number | null;
  recurrenceJson: string | null;
  untilDay: number | null;
  body: string;
}

export interface ProjectState {
  projectId: string;
  mainCalendarId: string | null;
  nowDay: number;
  nowMinute: number;
  sessionId: string | null;
  weatherTableId: string | null;
}

export type SessionStatus = "planned" | "running" | "ended";

export interface SessionRecord {
  itemId: string;
  realDate: string | null;
  startDay: number | null;
  startMinute: number | null;
  endDay: number | null;
  endMinute: number | null;
  status: SessionStatus;
  updatedAt: number;
}

export interface SessionInput {
  realDate: string | null;
  startDay: number | null;
  startMinute: number | null;
  endDay: number | null;
  endMinute: number | null;
  status: SessionStatus;
}

export interface SessionEntry {
  itemId: string;
  name: string;
  status: SessionStatus;
  realDate: string | null;
  startDay: number | null;
  endDay: number | null;
  updatedAt: number;
}

export interface WeatherRecord {
  day: number;
  weatherJson: string;
  updatedAt: number;
}

// ---- Calendars and timelines ----

export const getCalendarRecord = (itemId: string) => invoke<JsonRecord | null>("get_calendar", { itemId });
export const setCalendarJson = (itemId: string, calendarJson: string) => invoke<void>("set_calendar", { itemId, calendarJson });
export const listCalendars = (projectId: string) => invoke<JsonEntry[]>("list_calendars", { projectId });

/** A calendar read through `normalizeCalendar`; a calendar with nothing saved yet reads as the default one. */
export async function loadCalendar(itemId: string): Promise<{ calendar: Calendar; warnings: string[] }> {
  const record = await getCalendarRecord(itemId);
  let raw: unknown = {};
  if (record) {
    try {
      raw = JSON.parse(record.json);
    } catch {
      raw = {};
    }
  }
  const read = normalizeCalendar(raw);
  if (!read.ok) throw new Error(read.error);
  return { calendar: read.calendar, warnings: read.warnings };
}

export const saveCalendar = (itemId: string, calendar: Calendar) => setCalendarJson(itemId, JSON.stringify(calendar));

export const getTimelineRecord = (itemId: string) => invoke<JsonRecord | null>("get_timeline", { itemId });
export const setTimelineJson = (itemId: string, configJson: string) => invoke<void>("set_timeline", { itemId, configJson });
export const listTimelines = (projectId: string) => invoke<JsonEntry[]>("list_timelines", { projectId });

// ---- Events and notes ----

export const getCalendarEvent = (itemId: string) => invoke<CalendarEventRecord | null>("get_calendar_event", { itemId });
export const setCalendarEvent = (itemId: string, input: EventInput) => invoke<void>("set_calendar_event", { itemId, input });
export const listCalendarEvents = (projectId: string, fromDay: number, toDay: number) =>
  invoke<CalendarEventRecord[]>("list_calendar_events", { projectId, fromDay, toDay });
export const listAllCalendarEvents = (projectId: string) =>
  invoke<CalendarEventRecord[]>("list_all_calendar_events", { projectId });

// ---- Project state ----

export const getProjectState = (projectId: string) => invoke<ProjectState>("get_project_state", { projectId });
export const setMainCalendar = (projectId: string, calendarId: string | null) =>
  invoke<void>("set_main_calendar", { projectId, calendarId });
export const setProjectNow = (projectId: string, day: number, minute: number) =>
  invoke<void>("set_project_now", { projectId, day, minute });
export const setWeatherTable = (projectId: string, tableId: string | null) =>
  invoke<void>("set_weather_table", { projectId, tableId });
export const setCurrentSession = (projectId: string, sessionId: string | null) =>
  invoke<void>("set_current_session", { projectId, sessionId });

// ---- Sessions ----

export const getSession = (itemId: string) => invoke<SessionRecord>("get_session", { itemId });
export const setSession = (itemId: string, input: SessionInput) => invoke<void>("set_session", { itemId, input });
export const startSession = (itemId: string, realDate: string | null) => invoke<SessionRecord>("start_session", { itemId, realDate });
export const endSession = (itemId: string) => invoke<SessionRecord>("end_session", { itemId });
export const listSessions = (projectId: string) => invoke<SessionEntry[]>("list_sessions", { projectId });

// ---- Weather ----

export const getWeather = (projectId: string, day: number) => invoke<WeatherRecord | null>("get_weather", { projectId, day });
export const setWeather = (projectId: string, day: number, weatherJson: string) =>
  invoke<void>("set_weather", { projectId, day, weatherJson });
export const clearWeather = (projectId: string, day: number) => invoke<void>("clear_weather", { projectId, day });
export const listWeather = (projectId: string, fromDay: number, toDay: number) =>
  invoke<WeatherRecord[]>("list_weather", { projectId, fromDay, toDay });
