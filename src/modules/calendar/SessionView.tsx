import { useEffect, useState } from "react";
import { getSession, setSession, type SessionInput, type SessionRecord } from "../../api/time";
import { DatePicker, TimePicker } from "../../components/time/DatePicker";
import { formatDateTime } from "../../lib/calendar/math";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { chooseCurrentSession, endSessionNow, startSessionNow } from "../../state/timeActions";
import { useTime } from "../../state/timeState";
import { DocumentEditor } from "../worldbuilding/DocumentEditor";
import "../../components/time/time.css";

const STATUS_WORDS = { planned: "Planned", running: "Running", ended: "Ended" } as const;

function toInput(s: SessionRecord): SessionInput {
  return { realDate: s.realDate, startDay: s.startDay, startMinute: s.startMinute, endDay: s.endDay, endMinute: s.endMinute, status: s.status };
}

/** A session's page: its dates and status on top, then the page's own text (the log is a tab of the page). */
export function SessionView({ itemId }: { itemId: string }) {
  return (
    <div className="stack">
      <SessionHeader itemId={itemId} />
      <DocumentEditor itemId={itemId} />
    </div>
  );
}

function SessionHeader({ itemId }: { itemId: string }) {
  const { calendar, state } = useTime();
  const version = useDataVersion();
  const [session, setSessionRecord] = useState<SessionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSession(itemId)
      .then((s) => active && setSessionRecord(s))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [itemId, version]);

  if (error && !session) return <p className="error">{error}</p>;
  if (!session || !state) return null;
  const current = state.sessionId === itemId;

  async function save(change: Partial<SessionInput>) {
    if (!session) return;
    setError(null);
    try {
      const next = { ...toInput(session), ...change };
      await setSession(itemId, next);
      setSessionRecord({ ...session, ...next });
      bumpDataVersion();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function act(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="day-detail">
      <div className="row-list">
        <strong>{STATUS_WORDS[session.status]}</strong>
        {current && <span className="meta">current session</span>}
        {session.status !== "running" && (
          <button type="button" onClick={() => act(() => startSessionNow(itemId))}>
            {session.status === "ended" ? "Start again" : "Start session"}
          </button>
        )}
        {session.status === "running" && (
          <button type="button" onClick={() => act(() => endSessionNow(itemId))}>
            End session
          </button>
        )}
        {!current && session.status === "ended" && (
          <button type="button" onClick={() => act(() => chooseCurrentSession(state.projectId, itemId))}>
            Make current (to add to its log)
          </button>
        )}
      </div>
      <div className="row-list">
        <label>
          Played on (real world)
          <input type="date" value={session.realDate ?? ""} onChange={(e) => save({ realDate: e.currentTarget.value || null })} />
        </label>
      </div>
      <div className="row-list">
        <label>
          In-game start
          <DatePicker
            calendar={calendar}
            day={session.startDay}
            allowEmpty
            defaultDay={state.nowDay}
            label="Start"
            onChange={(d) => save({ startDay: d, startMinute: d === null ? null : (session.startMinute ?? 0) })}
          />
        </label>
        {session.startDay !== null && (
          <TimePicker calendar={calendar} minute={session.startMinute ?? 0} label="Start" onChange={(m) => save({ startMinute: m })} />
        )}
      </div>
      <div className="row-list">
        <label>
          In-game end
          <DatePicker
            calendar={calendar}
            day={session.endDay}
            allowEmpty
            defaultDay={session.startDay ?? state.nowDay}
            label="End"
            onChange={(d) => save({ endDay: d, endMinute: d === null ? null : (session.endMinute ?? 0) })}
          />
        </label>
        {session.endDay !== null && <TimePicker calendar={calendar} minute={session.endMinute ?? 0} label="End" onChange={(m) => save({ endMinute: m })} />}
      </div>
      {session.startDay !== null && (
        <p className="meta">
          {formatDateTime(calendar, { day: session.startDay, minute: session.startMinute ?? 0 })}
          {session.endDay !== null ? ` to ${formatDateTime(calendar, { day: session.endDay, minute: session.endMinute ?? 0 })}` : " until now"}
        </p>
      )}
      <p className="meta">The Log tab collects everything sent with “Save to session”.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
