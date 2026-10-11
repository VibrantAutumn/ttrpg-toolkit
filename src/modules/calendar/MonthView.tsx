import { useEffect, useMemo, useState } from "react";
import { listCalendarEvents, listSessions, listWeather, type SessionEntry } from "../../api/time";
import { dayToParts, eraOf, formatDate, monthDays, moonPhase, partsToDay, seasonAt, weekdayIndex, mod } from "../../lib/calendar/math";
import { expandEvents, type EventInstance } from "../../lib/calendar/events";
import { parseWeather, weatherSummary, type WeatherData } from "../../lib/calendar/weather";
import { useCurrentProject } from "../../state/CurrentProject";
import { useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { createEventItem, rollWeatherFor, setNow, setWeatherByHand } from "../../state/timeActions";
import { useTime } from "../../state/timeState";
import "../../components/time/time.css";

const MOON_ICONS = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
const MAX_CHIPS = 3;

/** The month view: a grid of days with events, notes, sessions, moon phases and weather. */
export function MonthView() {
  const { project } = useCurrentProject();
  const time = useTime();
  const version = useDataVersion();
  const { openItem } = useNavigation();
  const { calendar, state } = time;
  const today = state?.nowDay ?? 0;

  const now = dayToParts(calendar, today);
  const [view, setView] = useState({ year: now.year, month: now.month });
  const [selected, setSelected] = useState<number | null>(null);
  const [instances, setInstances] = useState<EventInstance[]>([]);
  const [weather, setWeather] = useState<Map<number, WeatherData>>(new Map());
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // A month that no longer exists (the calendar was edited) is brought back to the current one.
  const month = Math.min(view.month, calendar.months.length - 1);
  const length = monthDays(calendar, view.year, month);
  const first = partsToDay(calendar, { year: view.year, month, day: 1 }) as number;
  const last = first + length - 1;

  useEffect(() => {
    if (!project) return;
    let active = true;
    Promise.all([listCalendarEvents(project.id, first, last), listWeather(project.id, first, last), listSessions(project.id)])
      .then(([events, kept, allSessions]) => {
        if (!active) return;
        setInstances(expandEvents(calendar, events, first, last));
        const map = new Map<number, WeatherData>();
        for (const w of kept) {
          const parsed = parseWeather(w.weatherJson);
          if (parsed) map.set(w.day, parsed);
        }
        setWeather(map);
        setSessions(allSessions);
        setError(null);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [project, calendar, first, last, version]);

  const byDay = useMemo(() => {
    const map = new Map<number, EventInstance[]>();
    for (const instance of instances) {
      for (let d = Math.max(instance.day, first); d <= Math.min(instance.endDay, last); d++) {
        const list = map.get(d) ?? [];
        list.push(instance);
        map.set(d, list);
      }
    }
    return map;
  }, [instances, first, last]);

  const sessionsOn = (day: number) => sessions.filter((s) => s.startDay !== null && s.startDay <= day && day <= (s.endDay ?? (s.status === "running" ? today : s.startDay)));

  function step(delta: number) {
    const total = view.year * calendar.months.length + month + delta;
    setView({ year: Math.floor(total / calendar.months.length), month: mod(total, calendar.months.length) });
    setSelected(null);
  }

  if (!project || !state) return <p className="empty">Choose a project first.</p>;
  const lead = weekdayIndex(calendar, first);
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length }, (_, i) => first + i)];
  const eraInfo = eraOf(calendar, view.year);
  const yearLabel = eraInfo ? `${eraInfo.yearInEra} ${eraInfo.era.short}` : String(view.year);

  return (
    <section>
      <div className="row-list">
        <button type="button" aria-label="Previous month" onClick={() => step(-1)}>
          ◀
        </button>
        <strong>
          {calendar.months[month].name} {yearLabel}
        </strong>
        <button type="button" aria-label="Next month" onClick={() => step(1)}>
          ▶
        </button>
        <button
          type="button"
          onClick={() => {
            setView({ year: now.year, month: now.month });
            setSelected(today);
          }}
        >
          Today
        </button>
        {seasonAt(calendar, first) && <span className="meta">{seasonAt(calendar, first)?.name}</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {!time.hasCalendar && <p className="meta">This project has no calendar yet, so a plain one is shown. Add one in the Calendars tab.</p>}
      <div className="month-grid" style={{ ["--week-length" as string]: calendar.weekdays.length }}>
        {calendar.weekdays.map((w, i) => (
          <div key={i} className="month-head" title={w}>
            {w.slice(0, 3)}
          </div>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <div key={`b${i}`} className="month-cell blank" />
          ) : (
            <button
              key={day}
              type="button"
              className={`month-cell${day === today ? " today" : ""}${day === selected ? " selected" : ""}`}
              aria-label={formatDate(calendar, day, { weekday: true })}
              aria-pressed={day === selected}
              onClick={() => setSelected(day)}
            >
              <span className="num">
                {dayToParts(calendar, day).day}{" "}
                <span className="moons" aria-hidden>
                  {calendar.moons.map((m) => MOON_ICONS[moonPhase(m, day).index]).join("")}
                </span>
              </span>
              {sessionsOn(day).slice(0, 1).map((s) => (
                <span key={s.itemId} className="chip session">
                  📖 {s.name}
                </span>
              ))}
              {(byDay.get(day) ?? []).slice(0, MAX_CHIPS).map((e, k) => (
                <span key={`${e.itemId}${k}`} className={`chip${e.kind === "note" ? " note" : ""}`}>
                  {e.secret ? "🔒 " : ""}
                  {e.name}
                </span>
              ))}
              {(byDay.get(day)?.length ?? 0) > MAX_CHIPS && <span className="meta">+{(byDay.get(day)?.length ?? 0) - MAX_CHIPS} more</span>}
              {weather.get(day) && <span className="meta">{weatherSummary(weather.get(day) as WeatherData, 18)}</span>}
            </button>
          ),
        )}
      </div>
      {selected !== null && (
        <DayDetail
          projectId={project.id}
          day={selected}
          events={byDay.get(selected) ?? []}
          weather={weather.get(selected) ?? null}
          sessions={sessionsOn(selected)}
          isToday={selected === today}
          onOpen={openItem}
        />
      )}
    </section>
  );
}

function DayDetail({
  projectId,
  day,
  events,
  weather,
  sessions,
  isToday,
  onOpen,
}: {
  projectId: string;
  day: number;
  events: EventInstance[];
  weather: WeatherData | null;
  sessions: SessionEntry[];
  isToday: boolean;
  onOpen: (id: string) => void;
}) {
  const { calendar, state } = useTime();
  const [name, setName] = useState("");
  const [weatherText, setWeatherText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const season = seasonAt(calendar, day);

  async function add(kind: "event" | "note") {
    const title = name.trim();
    if (title === "") return;
    setError(null);
    try {
      const made = await createEventItem(projectId, kind, title, day);
      setName("");
      onOpen(made.id);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="day-detail">
      <h2>{formatDate(calendar, day, { weekday: true })}</h2>
      <p className="meta">
        {season ? `${season.name}. ` : ""}
        {calendar.moons.map((m) => `${m.name}: ${moonPhase(m, day).name}`).join(" · ")}
      </p>
      {!isToday && state && (
        <button type="button" onClick={() => setNow(projectId, { day, minute: 0 })}>
          Make this the current date
        </button>
      )}
      {sessions.length > 0 && (
        <ul className="editor-list">
          {sessions.map((s) => (
            <li key={s.itemId}>
              <span aria-hidden>📖</span>
              <button type="button" onClick={() => onOpen(s.itemId)}>
                {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3>Events and notes</h3>
      {events.length === 0 ? (
        <p className="meta">Nothing on this day.</p>
      ) : (
        <ul className="editor-list">
          {events.map((e, i) => (
            <li key={`${e.itemId}${i}`}>
              <span aria-hidden>{e.kind === "note" ? "📝" : "📌"}</span>
              <button type="button" onClick={() => onOpen(e.itemId)}>
                {e.name}
              </button>
              {e.secret && <span className="meta">GM only</span>}
              {e.repeating && <span className="meta">repeats</span>}
            </li>
          ))}
        </ul>
      )}
      <form
        className="row-list"
        onSubmit={(e) => {
          e.preventDefault();
          void add("event");
        }}
      >
        <input value={name} placeholder="Name" aria-label="Name of the new event or note" onChange={(e) => setName(e.currentTarget.value)} />
        <button type="submit" disabled={name.trim() === ""}>
          Add event
        </button>
        <button type="button" disabled={name.trim() === ""} onClick={() => add("note")}>
          Add DM note
        </button>
      </form>
      <h3>Weather</h3>
      <p>{weather ? weather.text : "No weather kept for this day."}</p>
      <div className="row-list">
        <button
          type="button"
          onClick={async () => {
            setError(null);
            const rolled = await rollWeatherFor(projectId, day, calendar);
            if (!rolled.ok) setError(rolled.message);
          }}
        >
          {weather ? "Roll again" : "Roll the weather"}
        </button>
        <input value={weatherText} placeholder="Or type it" aria-label="Weather for this day" onChange={(e) => setWeatherText(e.currentTarget.value)} />
        <button
          type="button"
          disabled={weatherText.trim() === ""}
          onClick={async () => {
            await setWeatherByHand(projectId, day, weatherText.trim(), calendar);
            setWeatherText("");
          }}
        >
          Set
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
