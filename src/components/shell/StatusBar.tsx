import { useEffect, useRef, useState } from "react";
import { listCalendars, listSessions, setWeatherTable, type JsonEntry, type SessionEntry } from "../../api/time";
import { listTables, type TableSummary } from "../../api/tables";
import { formatDate, formatTime, seasonAt, moonPhase } from "../../lib/calendar/math";
import { weatherSummary } from "../../lib/calendar/weather";
import { mainRules } from "../../lib/rulesets/projectRules";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useProjectRules } from "../../state/projectRules";
import { useNavigation } from "../../state/Navigation";
import {
  addStarterCalendars,
  advanceNow,
  chooseMainCalendar,
  createSessionPage,
  endSessionNow,
  rollWeatherFor,
  setNow,
  setWeatherByHand,
  startSessionNow,
} from "../../state/timeActions";
import { useTime } from "../../state/timeState";
import { DatePicker, TimePicker } from "../time/DatePicker";
import "../time/time.css";

type Part = "date" | "session" | "weather" | "calendar";

/**
 * The slim bar above the page: the in-game date and time, the current session, the weather and the calendar and
 * ruleset in use. Tapping a part opens a small panel to change it. On a narrow screen only the date and the
 * weather are shown; the panel has everything.
 */
export function StatusBar() {
  const { project } = useCurrentProject();
  const time = useTime();
  const { rules } = useProjectRules(project?.id ?? null);
  const [open, setOpen] = useState<Part | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const { error: stepError, run: runStep } = useAction();

  // Clicking (or tapping) anywhere outside the bar puts the open panel away; so does Escape.
  useEffect(() => {
    if (open === null) return;
    const away = (e: Event) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (!project || time.loading || !time.state) return null;
  const { calendar, state } = time;
  const toggle = (part: Part) => setOpen((current) => (current === part ? null : part));
  const ruleset = mainRules(rules);
  const season = seasonAt(calendar, state.nowDay)?.name;

  return (
    <div className="status-bar" role="region" aria-label="Project status" ref={barRef}>
      <button type="button" className="status-step" aria-label="Back one day" title="Back one day" onClick={() => runStep(async () => void (await advanceNow(project.id, calendar, { day: state.nowDay, minute: state.nowMinute }, -calendar.hoursPerDay * calendar.minutesPerHour)))}>
        ◀
      </button>
      <button type="button" className="status-part" aria-expanded={open === "date"} onClick={() => toggle("date")}>
        <span aria-hidden>📅</span>
        <span className="status-text">
          {formatDate(calendar, state.nowDay)}, {formatTime(calendar, state.nowMinute)}
          {season ? ` · ${season}` : ""}
        </span>
      </button>
      <button type="button" className="status-step" aria-label="Forward one day" title="Forward one day" onClick={() => runStep(async () => void (await advanceNow(project.id, calendar, { day: state.nowDay, minute: state.nowMinute }, calendar.hoursPerDay * calendar.minutesPerHour)))}>
        ▶
      </button>
      <button type="button" className="status-part status-optional" aria-expanded={open === "session"} onClick={() => toggle("session")}>
        <span aria-hidden>📖</span>
        <span className="status-text">{time.sessionName ?? "No session"}</span>
      </button>
      <button type="button" className="status-part" aria-expanded={open === "weather"} onClick={() => toggle("weather")}>
        <span aria-hidden>☁️</span>
        <span className="status-text">{time.weather ? weatherSummary(time.weather) : "No weather"}</span>
      </button>
      {/* The calendar is chosen once; the bar only asks for it while there is none. */}
      {!time.hasCalendar && (
        <button type="button" className="status-part" aria-expanded={open === "calendar"} onClick={() => toggle("calendar")}>
          <span aria-hidden>🗓️</span>
          <span className="status-text">Choose a calendar</span>
        </button>
      )}
      {ruleset && time.hasCalendar && <span className="meta status-optional">{ruleset.name}</span>}
      {stepError && <span className="error" role="alert">{stepError}</span>}
      {open === "date" && <DatePanel projectId={project.id} />}
      {open === "session" && <SessionPanel projectId={project.id} onDone={() => setOpen(null)} />}
      {open === "weather" && <WeatherPanel projectId={project.id} />}
      {open === "calendar" && <CalendarPanel projectId={project.id} rulesetName={ruleset?.name ?? null} />}
    </div>
  );
}

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(work: () => Promise<string | null | void>) {
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      if (message) setError(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}

function Problem({ message }: { message: string | null }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null;
}

function DatePanel({ projectId }: { projectId: string }) {
  const { calendar, state, hasCalendar } = useTime();
  const { error, busy, run } = useAction();
  if (!state) return null;
  const at = { day: state.nowDay, minute: state.nowMinute };
  const moons = calendar.moons.map((m) => `${m.name}: ${moonPhase(m, state.nowDay).name}`);
  const minutesPerHour = calendar.minutesPerHour;
  const day = calendar.hoursPerDay * minutesPerHour;
  return (
    <div className="status-panel">
      {!hasCalendar && <p className="meta">This project has no calendar yet, so a plain one is used. Open the calendar part to add one.</p>}
      <div className="row">
        <label>
          Date
          <DatePicker calendar={calendar} day={at.day} disabled={busy} onChange={(d) => d !== null && run(() => setNow(projectId, { day: d, minute: at.minute }))} />
        </label>
        <label>
          Time
          <TimePicker calendar={calendar} minute={at.minute} disabled={busy} onChange={(m) => run(() => setNow(projectId, { day: at.day, minute: m }))} />
        </label>
      </div>
      <div className="row">
        <span>Move time:</span>
        {[
          ["+10 min", 10],
          ["+1 hour", minutesPerHour],
          ["+8 hours", 8 * minutesPerHour],
          ["+1 day", day],
          ["+1 week", day * calendar.weekdays.length],
          ["−1 day", -day],
        ].map(([label, minutes]) => (
          <button key={label as string} type="button" disabled={busy} onClick={() => run(() => advanceNow(projectId, calendar, at, minutes as number).then(() => null))}>
            {label}
          </button>
        ))}
      </div>
      {moons.length > 0 && <p className="meta">{moons.join(" · ")}</p>}
      <Problem message={error} />
    </div>
  );
}

function SessionPanel({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { state, calendar } = useTime();
  const version = useDataVersion();
  const { openItem } = useNavigation();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [name, setName] = useState("");
  const [rollOnStart, setRollOnStart] = useState(false);
  const { error, busy, run } = useAction();
  useEffect(() => {
    listSessions(projectId).then(setSessions, () => setSessions([]));
  }, [projectId, version]);
  if (!state) return null;
  const current = sessions.find((s) => s.itemId === state.sessionId);

  async function start(id: string) {
    await startSessionNow(id);
    if (rollOnStart) {
      const rolled = await rollWeatherFor(projectId, state!.nowDay, calendar);
      if (!rolled.ok) return rolled.message;
    }
    return null;
  }

  return (
    <div className="status-panel">
      {current ? (
        <div className="row">
          <strong>{current.name}</strong>
          <span className="meta">{current.status}</span>
          <button type="button" onClick={() => openItem(current.itemId)}>
            Open
          </button>
          <button type="button" disabled={busy} onClick={() => run(async () => void (await endSessionNow(current.itemId)))}>
            End session
          </button>
        </div>
      ) : (
        <p className="meta">No session is running. Start one so "Save to session" has somewhere to go.</p>
      )}
      <label className="check">
        <input type="checkbox" checked={rollOnStart} onChange={(e) => setRollOnStart(e.currentTarget.checked)} />
        Roll the weather when a session starts
      </label>
      {sessions.filter((s) => s.itemId !== state.sessionId).length > 0 && (
        <div className="row">
          <label>
            Start an existing session
            <select
              value=""
              disabled={busy}
              onChange={(e) => {
                const id = e.currentTarget.value;
                if (id) run(() => start(id).then((m) => (m ? m : (onDone(), null))));
              }}
            >
              <option value="">Choose a session...</option>
              {sessions
                .filter((s) => s.itemId !== state.sessionId)
                .map((s) => (
                  <option key={s.itemId} value={s.itemId}>
                    {s.name}
                    {s.realDate ? ` (${s.realDate})` : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const title = name.trim();
          if (title === "") return;
          run(async () => {
            const made = await createSessionPage(projectId, title);
            const message = await start(made.id);
            setName("");
            if (!message) {
              onDone();
              openItem(made.id);
            }
            return message;
          });
        }}
      >
        <input value={name} placeholder="New session name" aria-label="New session name" onChange={(e) => setName(e.currentTarget.value)} />
        <button type="submit" disabled={busy || name.trim() === ""}>
          Create and start
        </button>
      </form>
      <Problem message={error} />
    </div>
  );
}

function WeatherPanel({ projectId }: { projectId: string }) {
  const { state, calendar, weather } = useTime();
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [text, setText] = useState("");
  const { error, busy, run } = useAction();
  useEffect(() => {
    listTables(projectId).then(setTables, () => setTables([]));
  }, [projectId]);
  if (!state) return null;
  return (
    <div className="status-panel">
      <p>{weather ? weather.text : "No weather has been rolled for this day."}</p>
      {weather && (
        <p className="meta">
          {weather.manual ? "Set by hand" : `Rolled from ${weather.table ?? "a table"}`}
          {weather.season ? ` · ${weather.season}` : ""}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(async () => ((await rollWeatherFor(projectId, state.nowDay, calendar)) as { ok: boolean; message?: string }).message ?? null)}
        >
          {weather ? "Roll again" : "Roll the weather"}
        </button>
        <label>
          Rolled from
          <select
            value={state.weatherTableId ?? ""}
            onChange={(e) => run(async () => (await setWeatherTable(projectId, e.currentTarget.value || null), bumpDataVersion(), null))}
          >
            <option value="">(first table with “weather” in its name)</option>
            {tables.map((t) => (
              <option key={t.itemId} value={t.itemId}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() === "") return;
          run(async () => {
            await setWeatherByHand(projectId, state.nowDay, text.trim(), calendar);
            setText("");
          });
        }}
      >
        <input value={text} placeholder="Or type the weather" aria-label="Weather typed by hand" onChange={(e) => setText(e.currentTarget.value)} />
        <button type="submit" disabled={busy || text.trim() === ""}>
          Set
        </button>
      </form>
      <p className="meta">If the calendar has seasons and a table named like “Temperate weather (Winter)” exists, that season's table is used.</p>
      <Problem message={error} />
    </div>
  );
}

function CalendarPanel({ projectId, rulesetName }: { projectId: string; rulesetName: string | null }) {
  const { state } = useTime();
  const version = useDataVersion();
  const [calendars, setCalendars] = useState<JsonEntry[]>([]);
  const { error, busy, run } = useAction();
  useEffect(() => {
    listCalendars(projectId).then(setCalendars, () => setCalendars([]));
  }, [projectId, version]);
  if (!state) return null;
  return (
    <div className="status-panel">
      <div className="row">
        <label>
          Main calendar
          <select value={state.mainCalendarId ?? ""} disabled={busy} onChange={(e) => run(async () => void (await chooseMainCalendar(projectId, e.currentTarget.value || null)))}>
            <option value="">(none)</option>
            {calendars.map((c) => (
              <option key={c.itemId} value={c.itemId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => run(async () => ((await addStarterCalendars(projectId)).length === 0 ? "The starter calendars are already in this project." : null))}>
          Add starter calendars
        </button>
      </div>
      <p className="meta">Ruleset: {rulesetName ?? "none chosen (Rulesets tool)"}</p>
      <Problem message={error} />
    </div>
  );
}
