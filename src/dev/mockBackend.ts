/**
 * A tiny pretend backend for looking at screens in an ordinary browser (`npm run dev`, no Tauri
 * window). DEV ONLY: `main.tsx` loads it only when the app is not running inside Tauri, and the
 * production build drops it. It keeps a few things in memory (one project, items, formulas) and
 * answers every command it does not know with an empty list or null, so screens open instead of
 * failing. It is for checking layout, not behaviour: real saving, files and the keyboard are
 * only checked in the real app.
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import { STARTER_CALENDARS } from "../starter/calendars";

interface MockItem {
  id: string;
  projectId: string;
  library: string;
  itemType: string;
  name: string;
  icon: string | null;
  folderId: string | null;
  visibility: "default";
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

type Args = Record<string, unknown>;

export function installMockBackend(): void {
  const now = Date.now();
  const project = { id: "p1", name: "Curse of Strahd", createdAt: now, updatedAt: now, deletedAt: null };
  const items = new Map<string, MockItem>();
  const notations = new Map<string, string>();
  const bodies = new Map<string, string>();
  let counter = 0;

  const add = (library: string, itemType: string, name: string, notation?: string): MockItem => {
    counter += 1;
    const item: MockItem = {
      id: `i${counter}`,
      projectId: project.id,
      library,
      itemType,
      name,
      icon: null,
      folderId: null,
      visibility: "default",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    items.set(item.id, item);
    if (notation !== undefined) notations.set(item.id, notation);
    return item;
  };

  add("dice", "formula", "Attack", "1d20+5");
  add("dice", "formula", "Fireball", "8d6");
  add("dice", "saved_roll", "Crit damage", "2d8+4");
  add("worldbuilding", "document", "Strahd von Zarovich");
  add("worldbuilding", "document", "Castle Ravenloft");
  add("worldbuilding", "template", "NPC");
  add("worldbuilding", "smart_collection", "Living NPCs");
  const mockCards = ["The Fool", "The Magician", "Two of Cups", "The Tower", "Ace of Swords"].map((n) => add("cards", "card", n));
  add("cards", "deck", "Tarot");
  add("cards", "set", "Major Arcana");
  add("cards", "pool", "Omens");
  add("cards", "spread", "Three-card reading");

  const folders: { id: string; projectId: string; library: string; parentId: string | null; name: string; createdAt: number; updatedAt: number; deletedAt: null }[] = [];
  const addFolder = (library: string, name: string) => {
    counter += 1;
    const folder = { id: `f${counter}`, projectId: project.id, library, parentId: null, name, createdAt: now, updatedAt: now, deletedAt: null };
    folders.push(folder);
    return folder;
  };
  const npcs = addFolder("worldbuilding", "NPCs");
  addFolder("worldbuilding", "Places");
  add("worldbuilding", "document", "Ireena Kolyana").folderId = npcs.id;
  add("worldbuilding", "document", "Ismark the Lesser").folderId = npcs.id;

  bodies.set("i4", ["# Strahd", "", "The lord of Barovia.", "", "- First", "- Second", "", "A closing line.", ""].join(String.fromCharCode(10)));

  const live = (library: string, itemType?: string) =>
    [...items.values()].filter((i) => i.deletedAt === null && i.library === library && (itemType === undefined || i.itemType === itemType));

  // Rulesets are global; the mock keeps them (and the project's copies) in memory.
  const rulesets: { id: string; name: string; description: string; definitionJson: string; originId: string | null; createdAt: number; updatedAt: number; deleted: boolean }[] = [];
  const projectRulesets: { id: string; projectId: string; rulesetId: string; name: string; rulesJson: string; idsJson: string; position: number }[] = [];
  const toRecord = ({ deleted: _deleted, ...r }: (typeof rulesets)[number]) => r;

  const encounterStates = new Map<string, string>();

  // Time: the project's "now", a starter calendar, a few events and sessions (so the month view has something to show).
  const timeState: { mainCalendarId: string | null; nowDay: number; nowMinute: number; sessionId: string | null; weatherTableId: string | null } = {
    mainCalendarId: null,
    nowDay: 0,
    nowMinute: 9 * 60,
    sessionId: null,
    weatherTableId: null,
  };
  const jsonDocs = new Map<string, string>();
  const events = new Map<string, Args>();
  const sessions = new Map<string, Args>();
  const weather = new Map<number, string>();
  const eventRecord = (id: string) => {
    const item = items.get(id);
    const e = events.get(id);
    if (!item || !e) return null;
    return { itemId: id, name: item.name, itemType: item.itemType, visibility: item.visibility, ...(e as object), updatedAt: now } as {
      itemId: string; name: string; itemType: string; visibility: string; startDay: number; endDay: number | null; recurrenceJson: string | null; updatedAt: number;
    };
  };
  const sessionRecord = (id: string) => ({
    itemId: id, realDate: null, startDay: null, startMinute: null, endDay: null, endMinute: null, status: "planned", updatedAt: now, ...(sessions.get(id) ?? {}),
  }) as { itemId: string; realDate: string | null; startDay: number | null; startMinute: number | null; endDay: number | null; endMinute: number | null; status: string; updatedAt: number };
  {
    const real = add("calendar", "calendar", STARTER_CALENDARS[0].name);
    jsonDocs.set(real.id, JSON.stringify(STARTER_CALENDARS[0].calendar));
    add("calendar", "calendar", STARTER_CALENDARS[1].name);
    jsonDocs.set(`i${counter}`, JSON.stringify(STARTER_CALENDARS[1].calendar));
    timeState.mainCalendarId = real.id;
    timeState.nowDay = 739900; // somewhere in 2026
    const feast = add("calendar", "event", "Harvest feast");
    events.set(feast.id, { startDay: timeState.nowDay + 3, startMinute: null, endDay: timeState.nowDay + 4, endMinute: null, recurrenceJson: JSON.stringify({ kind: "weeks", interval: 1, weekday: 4 }), untilDay: null, body: "" });
    const note = add("calendar", "note", "Strahd's spy arrives");
    (note as { visibility: string }).visibility = "secret";
    events.set(note.id, { startDay: timeState.nowDay + 6, startMinute: null, endDay: null, endMinute: null, recurrenceJson: null, untilDay: null, body: "" });
    const first = add("worldbuilding", "session", "Session 1: Arrival");
    sessions.set(first.id, { realDate: "2026-09-12", startDay: timeState.nowDay - 5, startMinute: 0, endDay: timeState.nowDay - 2, endMinute: 0, status: "ended" });
    add("calendar", "timeline", "World history");
  }

  const handlers: Record<string, (a: Args) => unknown> = {
    get_encounter: (a) => {
      const text = encounterStates.get(String(a.itemId));
      return text === undefined ? null : { itemId: a.itemId, stateJson: text, createdAt: now, updatedAt: now };
    },
    set_encounter_state: (a) => void encounterStates.set(String(a.itemId), String(a.stateJson)),
    list_rulesets: () => rulesets.filter((r) => !r.deleted).map(toRecord),
    list_deleted_rulesets: () => rulesets.filter((r) => r.deleted).map(toRecord),
    get_ruleset: (a) => toRecord(rulesets.find((r) => r.id === a.id)!),
    create_ruleset: (a) => {
      counter += 1;
      const made = { id: `r${counter}`, name: String(a.name), description: String(a.description), definitionJson: String(a.definitionJson), originId: (a.originId as string | null) ?? null, createdAt: now, updatedAt: now, deleted: false };
      rulesets.push(made);
      return toRecord(made);
    },
    update_ruleset: (a) => {
      const r = rulesets.find((x) => x.id === a.id)!;
      Object.assign(r, { name: String(a.name), description: String(a.description), definitionJson: String(a.definitionJson), updatedAt: Date.now() });
      return toRecord(r);
    },
    delete_ruleset: (a) => void (rulesets.find((r) => r.id === a.id)!.deleted = true),
    restore_ruleset: (a) => {
      const r = rulesets.find((x) => x.id === a.id)!;
      r.deleted = false;
      return toRecord(r);
    },
    purge_ruleset: (a) => void rulesets.splice(rulesets.findIndex((r) => r.id === a.id), 1),
    list_installed_ruleset_starters: () => rulesets.filter((r) => !r.deleted && r.originId).map((r) => r.originId),
    list_project_rulesets: () => projectRulesets,
    apply_ruleset: (a) => {
      const r = rulesets.find((x) => x.id === a.ruleset_id || x.id === a.rulesetId)!;
      let copy = projectRulesets.find((c) => c.rulesetId === r.id);
      if (!copy) {
        counter += 1;
        copy = { id: `pr${counter}`, projectId: project.id, rulesetId: r.id, name: r.name, rulesJson: r.definitionJson, idsJson: '{"fields":{},"sets":{}}', position: projectRulesets.length };
        projectRulesets.push(copy);
      }
      copy.rulesJson = r.definitionJson;
      return { projectRuleset: copy, fieldsMade: 3, setsMade: 1, formulasMade: 2 };
    },
    remove_project_ruleset: (a) => void projectRulesets.splice(projectRulesets.findIndex((c) => c.id === a.projectRulesetId), 1),
    // ---- Time (calendars, events, sessions, weather and the project's "now") ----
    get_project_state: () => ({ projectId: project.id, ...timeState }),
    set_main_calendar: (a) => void (timeState.mainCalendarId = (a.calendarId as string | null) ?? null),
    set_project_now: (a) => {
      timeState.nowDay = Number(a.day);
      timeState.nowMinute = Number(a.minute);
    },
    set_current_session: (a) => void (timeState.sessionId = (a.sessionId as string | null) ?? null),
    set_weather_table: (a) => void (timeState.weatherTableId = (a.tableId as string | null) ?? null),
    get_calendar: (a) => (jsonDocs.has(String(a.itemId)) ? { itemId: a.itemId, json: jsonDocs.get(String(a.itemId)), createdAt: now, updatedAt: now } : null),
    set_calendar: (a) => void jsonDocs.set(String(a.itemId), String(a.calendarJson)),
    list_calendars: () => live("calendar", "calendar").map((i) => ({ itemId: i.id, name: i.name, updatedAt: now })),
    get_timeline: (a) => (jsonDocs.has(String(a.itemId)) ? { itemId: a.itemId, json: jsonDocs.get(String(a.itemId)), createdAt: now, updatedAt: now } : null),
    set_timeline: (a) => void jsonDocs.set(String(a.itemId), String(a.configJson)),
    list_timelines: () => live("calendar", "timeline").map((i) => ({ itemId: i.id, name: i.name, updatedAt: now })),
    get_calendar_event: (a) => eventRecord(String(a.itemId)),
    set_calendar_event: (a) => void events.set(String(a.itemId), a.input as Args),
    list_calendar_events: (a) =>
      [...events.keys()]
        .map(eventRecord)
        .filter((e): e is NonNullable<typeof e> => e !== null && e.startDay <= Number(a.toDay) && (e.recurrenceJson !== null || (e.endDay ?? e.startDay) >= Number(a.fromDay))),
    list_all_calendar_events: () => [...events.keys()].map(eventRecord).filter((e) => e !== null),
    set_item_visibility: (a) => {
      const item = items.get(String(a.id));
      if (item) (item as { visibility: string }).visibility = String(a.visibility);
      return item;
    },
    get_session: (a) => sessionRecord(String(a.itemId)),
    set_session: (a) => void sessions.set(String(a.itemId), a.input as Args),
    start_session: (a) => {
      const id = String(a.itemId);
      sessions.set(id, { ...sessionRecord(id), realDate: a.realDate ?? null, startDay: timeState.nowDay, startMinute: timeState.nowMinute, endDay: null, endMinute: null, status: "running" });
      timeState.sessionId = id;
      return sessionRecord(id);
    },
    end_session: (a) => {
      const id = String(a.itemId);
      sessions.set(id, { ...sessionRecord(id), endDay: timeState.nowDay, endMinute: timeState.nowMinute, status: "ended" });
      if (timeState.sessionId === id) timeState.sessionId = null;
      return sessionRecord(id);
    },
    list_sessions: () =>
      live("worldbuilding", "session").map((i) => {
        const s = sessionRecord(i.id);
        return { itemId: i.id, name: i.name, status: s.status, realDate: s.realDate, startDay: s.startDay, endDay: s.endDay, updatedAt: now };
      }),
    get_weather: (a) => (weather.has(Number(a.day)) ? { day: a.day, weatherJson: weather.get(Number(a.day)), updatedAt: now } : null),
    set_weather: (a) => void weather.set(Number(a.day), String(a.weatherJson)),
    clear_weather: (a) => void weather.delete(Number(a.day)),
    list_weather: (a) =>
      [...weather.entries()].filter(([d]) => d >= Number(a.fromDay) && d <= Number(a.toDay)).map(([day, weatherJson]) => ({ day, weatherJson, updatedAt: now })),
    db_schema_version: () => 28,
    list_projects: () => [project],
    get_current_project: () => project,
    set_current_project: () => project,
    list_formulas: () =>
      live("dice", "formula").map((i) => ({ itemId: i.id, name: i.name, notation: notations.get(i.id) ?? "", folderId: null })),
    create_formula: (a) => add("dice", "formula", String(a.name || a.notation), String(a.notation)),
    get_formula: (a) => ({ itemId: a.itemId, notation: notations.get(String(a.itemId)) ?? "", createdAt: now, updatedAt: now }),
    set_formula_notation: (a) => void notations.set(String(a.itemId), String(a.notation)),
    get_saved_roll: (a) => ({
      itemId: a.itemId,
      notation: notations.get(String(a.itemId)) ?? "1d6",
      seed: 1,
      text: "",
      resultJson: "{}",
      createdAt: now,
      updatedAt: now,
    }),
    list_collections: () => [...items.values()].filter((i) => i.library === "cards" && ["deck", "set", "pool"].includes(i.itemType)),
    resolve_collection_cards: () => mockCards,
    list_spreads: () =>
      [...items.values()].filter((i) => i.itemType === "spread").map((i) => ({ itemId: i.id, name: i.name, positions: 3, ready: true })),
    list_items_of_type: (a) => live(String(a.library), String(a.itemType)),
    list_items: (a) => live(String(a.library)).filter((i) => i.folderId === (a.folderId ?? null)),
    get_item_fields: () => ({ setIds: [], values: [] }),
    get_document_body: (a) => bodies.get(String(a.itemId)) ?? "",
    set_document_body: (a) => void bodies.set(String(a.itemId), String(a.body)),
    list_trash: () => ({ folders: [], items: [] }),
    list_folders: (a) => folders.filter((f) => f.library === String(a.library)),
    create_folder: (a) => addFolder(String(a.library), String(a.name)),
    create_item: (a) => {
      const made = add(String(a.library), String(a.itemType), String(a.name));
      made.folderId = (a.folderId as string | null) ?? null;
      return made;
    },
    search_items: (a) => {
      const text = String(a.text ?? "").toLowerCase();
      return [...items.values()].filter((i) => i.deletedAt === null && i.name.toLowerCase().includes(text)).slice(0, 8);
    },
    get_item: (a) => items.get(String(a.id)) ?? null,
    rename_item: (a) => {
      const item = items.get(String(a.id));
      if (item) item.name = String(a.name);
      return item;
    },
    delete_item: (a) => {
      const item = items.get(String(a.id));
      if (item) item.deletedAt = Date.now();
    },
    restore_item: (a) => {
      const item = items.get(String(a.id));
      if (item) item.deletedAt = null;
      return item;
    },
  };

  mockIPC((cmd, payload) => {
    const handler = handlers[cmd];
    if (handler) return handler((payload ?? {}) as Args);
    if (cmd.startsWith("list_") || cmd.startsWith("search_") || cmd.startsWith("resolve_")) return [];
    if (!cmd.startsWith("plugin:")) console.warn(`[mock backend] no answer for "${cmd}"`);
    return null;
  });
}
