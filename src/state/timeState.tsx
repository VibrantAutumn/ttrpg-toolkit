import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getItem } from "../api/library";
import { getProjectState, getWeather, loadCalendar, type ProjectState } from "../api/time";
import { emptyCalendar, type Calendar } from "../lib/calendar/definition";
import { setDisplayCalendar } from "../lib/calendar/display";
import { parseWeather, type WeatherData } from "../lib/calendar/weather";
import { useCurrentProject } from "./CurrentProject";
import { useDataVersion } from "./dataVersion";

/**
 * The project's "now" and the calendar it is read through, kept fresh for the whole app (status bar,
 * month view, date pickers...). Changes go through `state/timeActions.ts`, which bump the data version, so
 * this reloads by itself.
 */
export interface TimeValue {
  loading: boolean;
  /** The saved state, or null when no project is open. */
  state: ProjectState | null;
  /** The main calendar, or the plain default one when the project has none yet (`hasCalendar` says which). */
  calendar: Calendar;
  hasCalendar: boolean;
  calendarName: string | null;
  sessionName: string | null;
  /** The weather kept for the current in-game day. */
  weather: WeatherData | null;
  reload: () => Promise<void>;
}

const FALLBACK: TimeValue = {
  loading: true,
  state: null,
  calendar: emptyCalendar(),
  hasCalendar: false,
  calendarName: null,
  sessionName: null,
  weather: null,
  reload: async () => {},
};

const TimeContext = createContext<TimeValue>(FALLBACK);

export function TimeProvider({ children }: { children: ReactNode }) {
  const { project } = useCurrentProject();
  const version = useDataVersion();
  const projectId = project?.id ?? null;
  const [value, setValue] = useState<Omit<TimeValue, "reload">>(FALLBACK);

  const load = useCallback(async () => {
    if (!projectId) {
      setDisplayCalendar(null);
      setValue({ ...FALLBACK, loading: false });
      return;
    }
    try {
      const state = await getProjectState(projectId);
      let calendar = emptyCalendar();
      let calendarName: string | null = null;
      let hasCalendar = false;
      if (state.mainCalendarId) {
        try {
          calendar = (await loadCalendar(state.mainCalendarId)).calendar;
          calendarName = (await getItem(state.mainCalendarId)).name;
          hasCalendar = true;
        } catch {
          // A calendar that can't be read is treated as not set.
        }
      }
      const sessionName = state.sessionId ? await getItem(state.sessionId).then((i) => i.name, () => null) : null;
      const kept = await getWeather(projectId, state.nowDay);
      setDisplayCalendar(hasCalendar ? calendar : null);
      setValue({
        loading: false,
        state,
        calendar,
        hasCalendar,
        calendarName,
        sessionName,
        weather: kept ? parseWeather(kept.weatherJson) : null,
      });
    } catch (e) {
      console.error("Could not load the project's time", e);
      setValue({ ...FALLBACK, loading: false });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  const full = useMemo(() => ({ ...value, reload: load }), [value, load]);
  return <TimeContext.Provider value={full}>{children}</TimeContext.Provider>;
}

export function useTime(): TimeValue {
  return useContext(TimeContext);
}
