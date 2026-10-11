import { useEffect, useState } from "react";
import { listSessions, type SessionEntry } from "../../api/time";
import { LibraryScreen } from "../../components/library/LibraryScreen";
import { formatDate } from "../../lib/calendar/math";
import { useCurrentProject } from "../../state/CurrentProject";
import { useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { addStarterCalendars, createSessionPage, startSessionNow } from "../../state/timeActions";
import { useTime } from "../../state/timeState";
import { MonthView } from "./MonthView";
import { calendarType, eventType, noteType, timelineType } from "./itemTypes";
import "../../components/time/time.css";

type Tab = "month" | "sessions" | "library";

const TABS: { id: Tab; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "sessions", label: "Sessions" },
  { id: "library", label: "Library" },
];

/** The Calendar tool: the month view, the sessions, and the library of calendars, events, notes and timelines. */
export function CalendarScreen() {
  const [tab, setTab] = useState<Tab>("month");
  const { project } = useCurrentProject();
  return (
    <section>
      <h1>Calendar</h1>
      <p className="meta">
        Calendars, events, dated DM notes, sessions and timelines. The date, session and weather at the top of the page are the project's “now”.
      </p>
      <div className="calendar-tabs" role="group" aria-label="Calendar sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {!project ? (
        <p className="empty">Choose a project first.</p>
      ) : (
        <>
          <div hidden={tab !== "month"}>
            <MonthView />
          </div>
          <div hidden={tab !== "sessions"}>
            <SessionsTab projectId={project.id} />
          </div>
          <div hidden={tab !== "library"}>
            <LibraryTab projectId={project.id} />
          </div>
        </>
      )}
    </section>
  );
}

function LibraryTab({ projectId }: { projectId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div>
      <div className="row-list">
        <button
          type="button"
          onClick={async () => {
            const added = await addStarterCalendars(projectId);
            setMessage(added.length === 0 ? "The starter calendars are already in this project." : `Added: ${added.join(", ")}.`);
          }}
        >
          Add starter calendars
        </button>
        {message && <span className="meta">{message}</span>}
      </div>
      <LibraryScreen library="calendar" title="Calendar" showTitle={false} itemTypes={[calendarType, eventType, noteType, timelineType]} />
    </div>
  );
}

function SessionsTab({ projectId }: { projectId: string }) {
  const { calendar, state } = useTime();
  const version = useDataVersion();
  const { openItem } = useNavigation();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSessions(projectId).then(setSessions, (e) => setError(String(e)));
  }, [projectId, version]);

  return (
    <div>
      <form
        className="row-list"
        onSubmit={async (e) => {
          e.preventDefault();
          const title = name.trim();
          if (title === "") return;
          try {
            const made = await createSessionPage(projectId, title);
            setName("");
            openItem(made.id);
          } catch (err) {
            setError(String(err));
          }
        }}
      >
        <input value={name} placeholder="New session name" aria-label="New session name" onChange={(e) => setName(e.currentTarget.value)} />
        <button type="submit" disabled={name.trim() === ""}>
          New session
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {sessions.length === 0 ? (
        <p className="empty">No sessions yet. A session is a page with a real-world date, an in-game start and end, and a Log tab that “Save to session” writes to.</p>
      ) : (
        <ul className="editor-list">
          {sessions.map((s) => (
            <li key={s.itemId}>
              <span aria-hidden>📖</span>
              <button type="button" onClick={() => openItem(s.itemId)}>
                {s.name}
              </button>
              <span className="meta">
                {s.status}
                {state?.sessionId === s.itemId ? " (current)" : ""}
                {s.realDate ? ` · played ${s.realDate}` : ""}
                {s.startDay !== null ? ` · ${formatDate(calendar, s.startDay)}${s.endDay !== null ? ` to ${formatDate(calendar, s.endDay)}` : ""}` : ""}
              </span>
              {s.status !== "running" && (
                <button type="button" onClick={() => startSessionNow(s.itemId).catch((e) => setError(String(e)))}>
                  Start
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
