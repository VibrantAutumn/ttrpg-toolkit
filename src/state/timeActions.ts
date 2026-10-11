import { createItem, getDocumentBody, getItem, listItemsOfType, setDocumentBody, setItemVisibility, type Item } from "../api/library";
import { recordTableRecent } from "../api/tables";
import { addDocumentTab, listTabs } from "../api/tabs";
import {
  endSession as endSessionApi,
  getProjectState,
  loadCalendar,
  saveCalendar,
  setCalendarEvent,
  setCurrentSession,
  setMainCalendar,
  setProjectNow,
  setWeather,
  startSession as startSessionApi,
  type SessionRecord,
} from "../api/time";
import { emptyCalendar, type Calendar } from "../lib/calendar/definition";
import { advanceTime, seasonAt, type DateTime } from "../lib/calendar/math";
import { draftToInput, newDraft } from "../lib/calendar/events";
import { appendEntry, logEntry } from "../lib/calendar/sessionLog";
import { pickWeatherTable, weatherToJson, type WeatherData } from "../lib/calendar/weather";
import { createRng, newSeed } from "../lib/dice/rng";
import { rollTable } from "../lib/tables/roll";
import { STARTER_CALENDARS } from "../starter/calendars";
import { bumpDataVersion } from "./dataVersion";
import { loadTableWorld } from "./tableActions";

const CALENDAR_LIBRARY = "calendar";
const PAGES_LIBRARY = "worldbuilding";

/** Today in the real world as `YYYY-MM-DD` (the device's own date), for a session's real-world date. */
export function todayText(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

// ---------------------------------------------------------------- calendars

/** Makes a calendar item holding `calendar`. The first calendar of a project becomes its main one. */
export async function createCalendar(projectId: string, name: string, calendar: Calendar): Promise<Item> {
  const item = await createItem(projectId, CALENDAR_LIBRARY, "calendar", name, null);
  await saveCalendar(item.id, calendar);
  const state = await getProjectState(projectId);
  if (!state.mainCalendarId) await setMainCalendar(projectId, item.id);
  bumpDataVersion();
  return item;
}

/** Adds the starter calendars the project doesn't have yet (found by name). Returns the names it added. */
export async function addStarterCalendars(projectId: string): Promise<string[]> {
  const existing = new Set((await listItemsOfType(projectId, CALENDAR_LIBRARY, "calendar")).map((i) => i.name.trim().toLowerCase()));
  const added: string[] = [];
  for (const starter of STARTER_CALENDARS) {
    if (existing.has(starter.name.toLowerCase())) continue;
    await createCalendar(projectId, starter.name, starter.calendar);
    added.push(starter.name);
  }
  return added;
}

export async function chooseMainCalendar(projectId: string, calendarId: string | null): Promise<void> {
  await setMainCalendar(projectId, calendarId);
  bumpDataVersion();
}

// ---------------------------------------------------------------- events

/** Makes a quick event or a dated note on a day. */
export async function createEventItem(projectId: string, kind: "event" | "note", name: string, day: number): Promise<Item> {
  const item = await createItem(projectId, CALENDAR_LIBRARY, kind, name, null);
  await setCalendarEvent(item.id, draftToInput(newDraft(day)));
  if (kind === "note") await setItemVisibility(item.id, "secret");
  bumpDataVersion();
  return item;
}

// ---------------------------------------------------------------- the moment

export async function setNow(projectId: string, at: DateTime): Promise<void> {
  await setProjectNow(projectId, at.day, at.minute);
  bumpDataVersion();
}

/** Moves the in-game clock forward (or back, with a negative number) by some minutes. */
export async function advanceNow(projectId: string, calendar: Calendar, from: DateTime, minutes: number): Promise<DateTime> {
  const next = advanceTime(calendar, from, minutes);
  await setNow(projectId, next);
  return next;
}

// ---------------------------------------------------------------- sessions

/** Makes a session page with its Log tab. */
export async function createSessionPage(projectId: string, name: string): Promise<Item> {
  const session = await createItem(projectId, PAGES_LIBRARY, "session", name, null);
  await addDocumentTab(session.id, "Log");
  bumpDataVersion();
  return session;
}

export async function startSessionNow(sessionId: string): Promise<SessionRecord> {
  const started = await startSessionApi(sessionId, todayText());
  bumpDataVersion();
  return started;
}

export async function endSessionNow(sessionId: string): Promise<SessionRecord> {
  const ended = await endSessionApi(sessionId);
  bumpDataVersion();
  return ended;
}

export async function chooseCurrentSession(projectId: string, sessionId: string | null): Promise<void> {
  await setCurrentSession(projectId, sessionId);
  bumpDataVersion();
}

/** The session's log page (its tab named Log, or the first tab), made if it has none. */
async function logDocumentId(sessionId: string): Promise<string> {
  const tabs = (await listTabs(sessionId)).filter((t) => t.kind === "document" && t.item);
  const log = tabs.find((t) => t.item?.name.trim().toLowerCase() === "log") ?? tabs[0];
  if (log?.item) return log.item.id;
  const made = await addDocumentTab(sessionId, "Log");
  if (!made.item) throw new Error("The session's log couldn't be made.");
  return made.item.id;
}

/**
 * "Save to session": adds `text` to the end of the current session's log, dated with the in-game moment.
 * Says why it couldn't when there is no current session.
 */
export async function saveToSession(
  projectId: string,
  text: string,
  title?: string,
): Promise<{ ok: true; sessionName: string } | { ok: false; message: string }> {
  try {
    const state = await getProjectState(projectId);
    if (!state.sessionId) {
      return { ok: false, message: "There is no current session. Start a session first (the status bar at the top has the button)." };
    }
    const calendar = state.mainCalendarId ? (await loadCalendar(state.mainCalendarId)).calendar : emptyCalendar();
    const logId = await logDocumentId(state.sessionId);
    const body = await getDocumentBody(logId);
    await setDocumentBody(logId, appendEntry(body, logEntry(calendar, { day: state.nowDay, minute: state.nowMinute }, text, title)));
    bumpDataVersion();
    return { ok: true, sessionName: (await getItem(state.sessionId)).name };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------- weather

/**
 * Rolls the weather for a day from the project's weather table (its season's variant if there is one),
 * keeps it for that day and returns it. Says why when it can't.
 */
export async function rollWeatherFor(
  projectId: string,
  day: number,
  calendar: Calendar,
): Promise<{ ok: true; weather: WeatherData } | { ok: false; message: string }> {
  try {
    const state = await getProjectState(projectId);
    const { tables, world } = await loadTableWorld(projectId);
    const base = tables.find((t) => t.id === state.weatherTableId) ?? tables.find((t) => /weather/i.test(t.name));
    if (!base) {
      return { ok: false, message: "No weather table is chosen. Add the starter weather tables (Generators > Library) and choose one in the status bar." };
    }
    const season = seasonAt(calendar, day)?.name ?? null;
    const table = pickWeatherTable(tables, base, season);
    const rolled = rollTable(table, world, createRng(newSeed()));
    if (!rolled.ok) return { ok: false, message: rolled.message };
    await recordTableRecent(rolled.roll.picked);
    const weather: WeatherData = { text: rolled.roll.text, table: table.name, season, manual: false };
    await setWeather(projectId, day, weatherToJson(weather));
    bumpDataVersion();
    return { ok: true, weather };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Keeps weather typed by hand for a day. */
export async function setWeatherByHand(projectId: string, day: number, text: string, calendar: Calendar): Promise<void> {
  await setWeather(projectId, day, weatherToJson({ text, table: null, season: seasonAt(calendar, day)?.name ?? null, manual: true }));
  bumpDataVersion();
}
