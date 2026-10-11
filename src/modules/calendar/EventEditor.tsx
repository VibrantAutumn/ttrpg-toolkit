import { useEffect, useMemo, useRef, useState } from "react";
import { getItem, setItemVisibility, type Item } from "../../api/library";
import { getCalendarEvent, setCalendarEvent } from "../../api/time";
import { DatePicker, TimePicker } from "../../components/time/DatePicker";
import { createAutosaver, type SaveStatus } from "../../lib/autosave";
import type { Calendar } from "../../lib/calendar/definition";
import { draftToInput, newDraft, type EventDraft } from "../../lib/calendar/events";
import { describeRecurrence, normalizeRecurrence, type Recurrence } from "../../lib/calendar/recurrence";
import { bumpDataVersion } from "../../state/dataVersion";
import { useTime } from "../../state/timeState";
import "../../components/time/time.css";

const REPEAT_KINDS: { id: Recurrence["kind"] | "none"; label: string }[] = [
  { id: "none", label: "Does not repeat" },
  { id: "days", label: "Every few days" },
  { id: "weeks", label: "Every few weeks, on a weekday" },
  { id: "monthly", label: "On a day of the month" },
  { id: "yearly", label: "Once a year, on a date" },
  { id: "nthWeekday", label: "The first (second, last...) weekday of a month" },
];

function defaultRule(kind: Recurrence["kind"], calendar: Calendar, startDay: number): Recurrence {
  switch (kind) {
    case "days":
      return { kind, interval: 7 };
    case "weeks":
      return { kind, interval: 1, weekday: 0 };
    case "monthly":
      return { kind, day: 1, interval: 1 };
    case "yearly":
      return { kind, month: 0, day: 1 };
    case "nthWeekday":
      return { kind, nth: 1, weekday: 0, month: null };
  }
  void calendar;
  void startDay;
}

function Num({ value, onChange, min, max, label, width }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; width?: string }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      style={{ width: width ?? "4.5rem" }}
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const n = Number(e.currentTarget.value);
        if (e.currentTarget.value !== "" && Number.isInteger(n)) onChange(n);
      }}
    />
  );
}

/** How a repeating event repeats: a few simple patterns, each with its own small form. */
export function RecurrenceEditor({ calendar, startDay, rule, onChange }: { calendar: Calendar; startDay: number; rule: Recurrence | null; onChange: (r: Recurrence | null) => void }) {
  const set = (patch: Partial<Recurrence>) => onChange(normalizeRecurrence({ ...rule, ...patch }));
  return (
    <div className="stack">
      <label>
        Repeats
        <select
          value={rule?.kind ?? "none"}
          onChange={(e) => {
            const kind = e.currentTarget.value as Recurrence["kind"] | "none";
            onChange(kind === "none" ? null : defaultRule(kind, calendar, startDay));
          }}
        >
          {REPEAT_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {rule?.kind === "days" && (
        <div className="row-list">
          <span>Every</span>
          <Num label="Every how many days" value={rule.interval} min={1} onChange={(n) => set({ interval: n })} />
          <span>days</span>
        </div>
      )}
      {rule?.kind === "weeks" && (
        <div className="row-list">
          <span>Every</span>
          <Num label="Every how many weeks" value={rule.interval} min={1} onChange={(n) => set({ interval: n })} />
          <span>week(s) on</span>
          <select value={rule.weekday} aria-label="Weekday" onChange={(e) => set({ weekday: Number(e.currentTarget.value) })}>
            {calendar.weekdays.map((w, i) => (
              <option key={i} value={i}>
                {w}
              </option>
            ))}
          </select>
        </div>
      )}
      {rule?.kind === "monthly" && (
        <div className="row-list">
          <span>On day</span>
          <Num label="Day of the month" value={rule.day} min={1} onChange={(n) => set({ day: n })} />
          <span>of every</span>
          <Num label="Every how many months" value={rule.interval} min={1} onChange={(n) => set({ interval: n })} />
          <span>month(s)</span>
        </div>
      )}
      {rule?.kind === "yearly" && (
        <div className="row-list">
          <span>Every year on</span>
          <Num label="Day of the month" value={rule.day} min={1} onChange={(n) => set({ day: n })} />
          <select value={Math.min(rule.month, calendar.months.length - 1)} aria-label="Month" onChange={(e) => set({ month: Number(e.currentTarget.value) })}>
            {calendar.months.map((m, i) => (
              <option key={i} value={i}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {rule?.kind === "nthWeekday" && (
        <div className="row-list">
          <span>The</span>
          <select value={rule.nth} aria-label="Which one" onChange={(e) => set({ nth: Number(e.currentTarget.value) })}>
            {[1, 2, 3, 4, 5, -1].map((n) => (
              <option key={n} value={n}>
                {n === -1 ? "last" : ["", "first", "second", "third", "fourth", "fifth"][n]}
              </option>
            ))}
          </select>
          <select value={rule.weekday} aria-label="Weekday" onChange={(e) => set({ weekday: Number(e.currentTarget.value) })}>
            {calendar.weekdays.map((w, i) => (
              <option key={i} value={i}>
                {w}
              </option>
            ))}
          </select>
          <span>of</span>
          <select value={rule.month ?? ""} aria-label="Month" onChange={(e) => onChange({ ...rule, month: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}>
            <option value="">every month</option>
            {calendar.months.map((m, i) => (
              <option key={i} value={i}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {rule && <p className="meta">{describeRecurrence(calendar, rule)}.</p>}
    </div>
  );
}

/** The editor of an event or a dated note. */
export function EventEditor({ itemId }: { itemId: string }) {
  const [item, setItem] = useState<Item | null>(null);
  const [initial, setInitial] = useState<EventDraft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const time = useTime();
  const today = time.state?.nowDay ?? 0;

  useEffect(() => {
    let active = true;
    Promise.all([getItem(itemId), getCalendarEvent(itemId)])
      .then(([i, record]) => {
        if (!active) return;
        setItem(i);
        setIsNew(record === null);
        let recurrence: Recurrence | null = null;
        if (record?.recurrenceJson) {
          try {
            recurrence = normalizeRecurrence(JSON.parse(record.recurrenceJson));
          } catch {
            recurrence = null;
          }
        }
        setInitial(
          record
            ? { startDay: record.startDay, startMinute: record.startMinute, endDay: record.endDay, endMinute: record.endMinute, recurrence, untilDay: record.untilDay, body: record.body }
            : newDraft(today),
        );
      })
      .catch((e) => active && setLoadError(String(e)));
    return () => {
      active = false;
    };
    // The editor loads once per item; the current date only seeds a brand-new event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  if (loadError) return <p className="error">{loadError}</p>;
  if (!item || !initial) return <p className="empty">Loading...</p>;
  return <EventForm item={item} initial={initial} isNew={isNew} calendar={time.calendar} today={today} />;
}

function EventForm({ item, initial, isNew, calendar, today }: { item: Item; initial: EventDraft; isNew: boolean; calendar: Calendar; today: number }) {
  const [draft, setDraft] = useState<EventDraft>(initial);
  const [secret, setSecret] = useState(item.visibility === "secret");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const isNote = item.itemType === "note";

  const saver = useMemo(
    () =>
      createAutosaver({
        save: async (text) => {
          await setCalendarEvent(item.id, draftToInput(JSON.parse(text) as EventDraft));
          setSaveError(null);
          bumpDataVersion();
        },
        delayMs: 600,
        onStatus: (s, e) => {
          setStatus(s);
          if (s === "error") setSaveError(e instanceof Error ? e.message : String(e));
        },
      }),
    [item.id],
  );
  const saverRef = useRef(saver);
  saverRef.current = saver;
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void saverRef.current.flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void saverRef.current.flush();
    };
  }, []);

  // A brand-new event has no saved details yet: save the starting date once so it appears on the calendar.
  // (An event that already has details is never rewritten just by opening it.)
  useEffect(() => {
    if (isNew) saver.change(JSON.stringify(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(change: (d: EventDraft) => EventDraft) {
    setDraft((current) => {
      const next = change(current);
      saver.change(JSON.stringify(next));
      return next;
    });
  }

  const hasTime = draft.startMinute !== null;
  const hasEnd = draft.endDay !== null;

  return (
    <section className="event-editor">
      <p className="meta">
        {status === "saving" ? "Saving..." : status === "dirty" ? "Unsaved changes..." : status === "error" ? "Couldn't save." : "Saved."}
        {saveError ? ` ${saveError}` : ""}
      </p>
      <div className="row-list">
        <label>
          {isNote ? "Note for" : "Date"}
          <DatePicker calendar={calendar} day={draft.startDay} label="Date" onChange={(d) => d !== null && update((x) => ({ ...x, startDay: d }))} />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={hasTime}
            onChange={(e) => update((x) => ({ ...x, startMinute: e.currentTarget.checked ? 12 * calendar.minutesPerHour : null, endMinute: e.currentTarget.checked ? x.endMinute : null }))}
          />
          At a time
        </label>
        {hasTime && <TimePicker calendar={calendar} minute={draft.startMinute ?? 0} label="Start" onChange={(m) => update((x) => ({ ...x, startMinute: m }))} />}
      </div>
      <div className="row-list">
        <label className="check">
          <input
            type="checkbox"
            checked={hasEnd}
            onChange={(e) => update((x) => ({ ...x, endDay: e.currentTarget.checked ? x.startDay : null, endMinute: e.currentTarget.checked ? x.endMinute : null }))}
          />
          Lasts until
        </label>
        {hasEnd && (
          <>
            <DatePicker calendar={calendar} day={draft.endDay} label="End date" onChange={(d) => d !== null && update((x) => ({ ...x, endDay: Math.max(d, x.startDay) }))} />
            {hasTime && <TimePicker calendar={calendar} minute={draft.endMinute ?? draft.startMinute ?? 0} label="End" onChange={(m) => update((x) => ({ ...x, endMinute: m }))} />}
          </>
        )}
      </div>
      <RecurrenceEditor calendar={calendar} startDay={draft.startDay} rule={draft.recurrence} onChange={(r) => update((x) => ({ ...x, recurrence: r }))} />
      {draft.recurrence && (
        <div className="row-list">
          <label className="check">
            <input type="checkbox" checked={draft.untilDay !== null} onChange={(e) => update((x) => ({ ...x, untilDay: e.currentTarget.checked ? x.startDay + 365 : null }))} />
            Stops repeating after
          </label>
          {draft.untilDay !== null && <DatePicker calendar={calendar} day={draft.untilDay} label="Last day" onChange={(d) => d !== null && update((x) => ({ ...x, untilDay: d }))} />}
        </div>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={secret}
          onChange={async (e) => {
            const on = e.currentTarget.checked;
            setSecret(on);
            await setItemVisibility(item.id, on ? "secret" : "default");
            bumpDataVersion();
          }}
        />
        GM only (never shown to players)
      </label>
      <label>
        {isNote ? "Note" : "Details"}
        <textarea rows={6} value={draft.body} placeholder={isNote ? "What the GM wants to remember on this date" : "Anything worth knowing about this event"} onChange={(e) => update((x) => ({ ...x, body: e.currentTarget.value }))} />
      </label>
      <p className="meta">
        {today === draft.startDay ? "This is the project's current date." : ""}
      </p>
    </section>
  );
}
