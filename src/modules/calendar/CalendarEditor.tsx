import { useEffect, useMemo, useRef, useState } from "react";
import { getItem } from "../../api/library";
import { getCalendarRecord, saveCalendar } from "../../api/time";
import { DatePicker } from "../../components/time/DatePicker";
import { createAutosaver, type SaveStatus } from "../../lib/autosave";
import { emptyCalendar, LIMITS, normalizeCalendar, type Calendar } from "../../lib/calendar/definition";
import { alignDate, alignMoon, alignWeekday, dayToParts, formatDate, moonPhase, nextPhaseDay, weekdayIndex, yearLength } from "../../lib/calendar/math";
import { bumpDataVersion } from "../../state/dataVersion";
import { chooseMainCalendar } from "../../state/timeActions";
import { useTime } from "../../state/timeState";
import "../../components/time/time.css";

function IntBox({ value, onChange, min, max, label, width }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; width?: string }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      style={{ width: width ?? "5rem" }}
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => {
        const n = Number(e.currentTarget.value);
        if (e.currentTarget.value !== "" && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function move<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

function RowButtons({ index, count, onMove, onRemove, canRemove = true }: { index: number; count: number; onMove: (delta: number) => void; onRemove: () => void; canRemove?: boolean }) {
  return (
    <>
      <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
        ▲
      </button>
      <button type="button" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
        ▼
      </button>
      <button type="button" aria-label="Remove" disabled={!canRemove} onClick={onRemove}>
        ✕
      </button>
    </>
  );
}

/** The editor of a calendar item: the calendar builder. */
export function CalendarEditor({ itemId }: { itemId: string }) {
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getCalendarRecord(itemId), getItem(itemId)])
      .then(([record, item]) => {
        if (!active) return;
        let raw: unknown = {};
        try {
          raw = record ? JSON.parse(record.json) : emptyCalendar();
        } catch {
          raw = emptyCalendar();
        }
        const read = normalizeCalendar(raw);
        if (!read.ok) return setLoadError(read.error);
        setProjectId(item.projectId);
        setCalendar(read.calendar);
      })
      .catch((e) => active && setLoadError(String(e)));
    return () => {
      active = false;
    };
  }, [itemId]);

  if (loadError) return <p className="error">{loadError}</p>;
  if (!calendar || !projectId) return <p className="empty">Loading...</p>;
  return <CalendarBuilder itemId={itemId} projectId={projectId} initial={calendar} />;
}

function CalendarBuilder({ itemId, projectId, initial }: { itemId: string; projectId: string; initial: Calendar }) {
  const [draft, setDraft] = useState<Calendar>(initial);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const time = useTime();
  const isMain = time.state?.mainCalendarId === itemId;

  const saver = useMemo(
    () =>
      createAutosaver({
        save: async (text) => {
          // What is saved has been through the one gate; the draft on screen may be half-finished.
          const read = normalizeCalendar(JSON.parse(text));
          if (!read.ok) throw new Error(read.error);
          await saveCalendar(itemId, read.calendar);
          setSaveError(null);
          bumpDataVersion();
        },
        delayMs: 700,
        onStatus: (s, e) => {
          setStatus(s);
          if (s === "error") setSaveError(String(e));
        },
      }),
    [itemId],
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

  function update(change: (c: Calendar) => Calendar) {
    setDraft((current) => {
      const next = change(current);
      saver.change(JSON.stringify(next));
      return next;
    });
  }

  // The checked version drives the preview, so a half-finished edit never breaks the page.
  const checked = useMemo(() => {
    const read = normalizeCalendar(draft);
    return read.ok ? read : null;
  }, [draft]);
  const cal = checked?.calendar ?? emptyCalendar();
  const sampleDay = time.state?.nowDay ?? 0;
  const monthCount = cal.months.length;

  const [alignParts, setAlignParts] = useState({ year: cal.anchor.year, month: 0, day: 1 });
  const [alignTo, setAlignTo] = useState<number>(sampleDay);
  const [alignWeekdayIndex, setAlignWeekdayIndex] = useState<number | null>(null);

  return (
    <section className="calendar-builder">
      <p className="meta">
        {status === "saving" ? "Saving..." : status === "dirty" ? "Unsaved changes..." : status === "error" ? "Couldn't save." : "Saved."}
        {saveError ? ` ${saveError}` : ""}
      </p>
      {isMain ? (
        <p className="meta">This is the project's main calendar.</p>
      ) : (
        <button type="button" onClick={() => chooseMainCalendar(projectId, itemId)}>
          Use as the main calendar
        </button>
      )}
      {checked && checked.warnings.length > 0 && (
        <ul className="meta">
          {checked.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <h2>Days and weeks</h2>
      <div className="row-list">
        <label>
          Hours in a day <IntBox label="Hours in a day" value={draft.hoursPerDay} min={1} max={LIMITS.hoursPerDay} onChange={(n) => update((c) => ({ ...c, hoursPerDay: n }))} />
        </label>
        <label>
          Minutes in an hour <IntBox label="Minutes in an hour" value={draft.minutesPerHour} min={1} max={LIMITS.minutesPerHour} onChange={(n) => update((c) => ({ ...c, minutesPerHour: n }))} />
        </label>
      </div>
      <p className="meta">Every calendar in a project counts the same days, so a day is the same length in all of them; this only sets how it is divided.</p>
      <h3>Weekdays</h3>
      <ul className="editor-list">
        {draft.weekdays.map((w, i) => (
          <li key={i}>
            <input value={w} aria-label={`Weekday ${i + 1}`} maxLength={LIMITS.label} onChange={(e) => update((c) => ({ ...c, weekdays: c.weekdays.map((x, j) => (j === i ? e.currentTarget.value : x)) }))} />
            <RowButtons
              index={i}
              count={draft.weekdays.length}
              canRemove={draft.weekdays.length > 1}
              onMove={(d) => update((c) => ({ ...c, weekdays: move(c.weekdays, i, d) }))}
              onRemove={() => update((c) => ({ ...c, weekdays: c.weekdays.filter((_, j) => j !== i), weekdayOffset: 0 }))}
            />
          </li>
        ))}
      </ul>
      <button type="button" disabled={draft.weekdays.length >= LIMITS.weekdays} onClick={() => update((c) => ({ ...c, weekdays: [...c.weekdays, `Day ${c.weekdays.length + 1}`] }))}>
        Add a weekday
      </button>

      <h2>Months</h2>
      <ul className="editor-list">
        {draft.months.map((m, i) => (
          <li key={i}>
            <input value={m.name} aria-label={`Month ${i + 1} name`} maxLength={LIMITS.label} onChange={(e) => update((c) => ({ ...c, months: c.months.map((x, j) => (j === i ? { ...x, name: e.currentTarget.value } : x)) }))} />
            <IntBox label={`Days in ${m.name}`} value={m.days} min={1} max={LIMITS.monthDays} onChange={(n) => update((c) => ({ ...c, months: c.months.map((x, j) => (j === i ? { ...x, days: n } : x)) }))} />
            <span className="meta">days</span>
            <RowButtons
              index={i}
              count={draft.months.length}
              canRemove={draft.months.length > 1}
              onMove={(d) => update((c) => ({ ...c, months: move(c.months, i, d) }))}
              onRemove={() => update((c) => ({ ...c, months: c.months.filter((_, j) => j !== i) }))}
            />
          </li>
        ))}
      </ul>
      <button type="button" disabled={draft.months.length >= LIMITS.months} onClick={() => update((c) => ({ ...c, months: [...c.months, { name: `Month ${c.months.length + 1}`, days: 30 }] }))}>
        Add a month
      </button>
      <p className="meta">
        A normal year has {cal.months.reduce((sum, m) => sum + m.days, 0)} days
        {cal.leap ? `; a leap year has ${cal.months.reduce((sum, m) => sum + m.days, 0) + cal.leap.extraDays}` : ""}.
      </p>

      <h2>Leap years</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.leap !== null}
          onChange={(e) =>
            update((c) => ({
              ...c,
              leap: e.currentTarget.checked ? { every: 4, offset: 0, exceptEvery: null, unlessEvery: null, month: Math.max(0, c.months.length - 1), extraDays: 1 } : null,
            }))
          }
        />
        This calendar has leap years
      </label>
      {draft.leap && (
        <div className="stack">
          <div className="row-list">
            <span>Every</span>
            <IntBox label="Leap year every" value={draft.leap.every} min={1} onChange={(n) => update((c) => ({ ...c, leap: c.leap && { ...c.leap, every: n } }))} />
            <span>years, adding</span>
            <IntBox label="Extra days" value={draft.leap.extraDays} min={1} max={LIMITS.leapExtraDays} onChange={(n) => update((c) => ({ ...c, leap: c.leap && { ...c.leap, extraDays: n } }))} />
            <span>day(s) to</span>
            <select value={draft.leap.month} aria-label="Leap month" onChange={(e) => update((c) => ({ ...c, leap: c.leap && { ...c.leap, month: Number(e.currentTarget.value) } }))}>
              {draft.months.map((m, i) => (
                <option key={i} value={i}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <details>
            <summary>Exceptions and offset (Advanced)</summary>
            <div className="row-list">
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.leap.exceptEvery !== null}
                  onChange={(e) => update((c) => ({ ...c, leap: c.leap && { ...c.leap, exceptEvery: e.currentTarget.checked ? c.leap.every * 25 : null, unlessEvery: null } }))}
                />
                Skip it every
              </label>
              {draft.leap.exceptEvery !== null && (
                <>
                  <IntBox label="Skip every" value={draft.leap.exceptEvery} min={1} onChange={(n) => update((c) => ({ ...c, leap: c.leap && { ...c.leap, exceptEvery: n } }))} />
                  <span>years (a multiple of {draft.leap.every})</span>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.leap.unlessEvery !== null}
                      onChange={(e) => update((c) => ({ ...c, leap: c.leap && { ...c.leap, unlessEvery: e.currentTarget.checked ? (c.leap.exceptEvery ?? 100) * 4 : null } }))}
                    />
                    unless it is also every
                  </label>
                  {draft.leap.unlessEvery !== null && (
                    <IntBox label="Unless every" value={draft.leap.unlessEvery} min={1} onChange={(n) => update((c) => ({ ...c, leap: c.leap && { ...c.leap, unlessEvery: n } }))} />
                  )}
                </>
              )}
            </div>
            <label>
              Count the cycle from year <IntBox label="Leap offset" value={draft.leap.offset} onChange={(n) => update((c) => ({ ...c, leap: c.leap && { ...c.leap, offset: n } }))} />
            </label>
            <p className="meta">Years that are a multiple of the interval (counted from the offset) are leap years. The real-world rule is every 4, skipped every 100, unless every 400.</p>
          </details>
          {checked && checked.warnings.some((w) => w.includes("leap")) && <p className="error">Part of the leap rule isn't valid and is ignored; see the notes above.</p>}
        </div>
      )}

      <h2>Eras</h2>
      <p className="meta">From its starting year on, years are counted inside the era (its first year is year 1) and written with its short name.</p>
      <ul className="editor-list">
        {draft.eras.map((era, i) => (
          <li key={i}>
            <input value={era.name} aria-label="Era name" placeholder="Name" maxLength={LIMITS.label} onChange={(e) => update((c) => ({ ...c, eras: c.eras.map((x, j) => (j === i ? { ...x, name: e.currentTarget.value } : x)) }))} />
            <input value={era.short} aria-label="Era short name" placeholder="Short" style={{ width: "4.5rem" }} maxLength={10} onChange={(e) => update((c) => ({ ...c, eras: c.eras.map((x, j) => (j === i ? { ...x, short: e.currentTarget.value } : x)) }))} />
            <span className="meta">starts in year</span>
            <IntBox label="Era starts in year" value={era.startYear} onChange={(n) => update((c) => ({ ...c, eras: c.eras.map((x, j) => (j === i ? { ...x, startYear: n } : x)) }))} />
            <button type="button" aria-label="Remove era" onClick={() => update((c) => ({ ...c, eras: c.eras.filter((_, j) => j !== i) }))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={draft.eras.length >= LIMITS.eras} onClick={() => update((c) => ({ ...c, eras: [...c.eras, { name: "New era", short: "NE", startYear: 1 }] }))}>
        Add an era
      </button>

      <h2>Seasons</h2>
      <p className="meta">A season begins on this day and lasts until the next one begins. Weather tables can have a version for each season.</p>
      <ul className="editor-list">
        {draft.seasons.map((s, i) => (
          <li key={i}>
            <input value={s.name} aria-label="Season name" placeholder="Name" maxLength={LIMITS.label} onChange={(e) => update((c) => ({ ...c, seasons: c.seasons.map((x, j) => (j === i ? { ...x, name: e.currentTarget.value } : x)) }))} />
            <span className="meta">begins on</span>
            <IntBox label="Season starts on day" value={s.day} min={1} max={LIMITS.monthDays} onChange={(n) => update((c) => ({ ...c, seasons: c.seasons.map((x, j) => (j === i ? { ...x, day: n } : x)) }))} />
            <select value={Math.min(s.month, monthCount - 1)} aria-label="Season starts in month" onChange={(e) => update((c) => ({ ...c, seasons: c.seasons.map((x, j) => (j === i ? { ...x, month: Number(e.currentTarget.value) } : x)) }))}>
              {draft.months.map((m, k) => (
                <option key={k} value={k}>
                  {m.name}
                </option>
              ))}
            </select>
            <button type="button" aria-label="Remove season" onClick={() => update((c) => ({ ...c, seasons: c.seasons.filter((_, j) => j !== i) }))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={draft.seasons.length >= LIMITS.seasons} onClick={() => update((c) => ({ ...c, seasons: [...c.seasons, { name: "New season", month: 0, day: 1 }] }))}>
        Add a season
      </button>

      <h2>Moons</h2>
      <ul className="editor-list">
        {draft.moons.map((m, i) => (
          <li key={i} className="stack">
            <div className="row-list">
              <input value={m.name} aria-label="Moon name" placeholder="Name" maxLength={LIMITS.label} onChange={(e) => update((c) => ({ ...c, moons: c.moons.map((x, j) => (j === i ? { ...x, name: e.currentTarget.value } : x)) }))} />
              <span className="meta">cycle of</span>
              <input
                type="number"
                step="any"
                aria-label="Moon cycle in days"
                style={{ width: "6rem" }}
                min={1}
                value={m.cycle}
                onChange={(e) => {
                  const n = Number(e.currentTarget.value);
                  if (Number.isFinite(n) && n > 0) update((c) => ({ ...c, moons: c.moons.map((x, j) => (j === i ? { ...x, cycle: n } : x)) }));
                }}
              />
              <span className="meta">days</span>
              <button type="button" aria-label="Remove moon" onClick={() => update((c) => ({ ...c, moons: c.moons.filter((_, j) => j !== i) }))}>
                ✕
              </button>
            </div>
            <div className="row-list">
              <span className="meta">Next full moon</span>
              <DatePicker
                calendar={cal}
                day={cal.moons[i] ? nextPhaseDay(cal.moons[i], sampleDay, 0.5) : sampleDay}
                label={`${m.name} full`}
                onChange={(d) => d !== null && update((c) => ({ ...c, moons: c.moons.map((x, j) => (j === i ? alignMoon(x, d, 0.5) : x)) }))}
              />
              <span className="meta">(now: {moonPhase(cal.moons[i] ?? m, sampleDay).name})</span>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" disabled={draft.moons.length >= LIMITS.moons} onClick={() => update((c) => ({ ...c, moons: [...c.moons, { name: "Moon", cycle: 28, offset: 0 }] }))}>
        Add a moon
      </button>

      <h2>Line up with the other calendars</h2>
      <p className="meta">
        All calendars count the same days. Say which date here is the same day as a date in the project's main calendar, and this calendar's years begin in the right place.
      </p>
      <div className="row-list">
        <span>The</span>
        <IntBox label="Day of the month" value={alignParts.day} min={1} onChange={(n) => setAlignParts((p) => ({ ...p, day: n }))} width="4rem" />
        <select value={Math.min(alignParts.month, monthCount - 1)} aria-label="Month" onChange={(e) => setAlignParts((p) => ({ ...p, month: Number(e.currentTarget.value) }))}>
          {draft.months.map((m, i) => (
            <option key={i} value={i}>
              {m.name}
            </option>
          ))}
        </select>
        <span>of year</span>
        <IntBox label="Year" value={alignParts.year} onChange={(n) => setAlignParts((p) => ({ ...p, year: n }))} />
        <span>is</span>
        <DatePicker calendar={time.calendar} day={alignTo} label="Same day" onChange={(d) => d !== null && setAlignTo(d)} />
        <span className="meta">in {isMain ? "this calendar" : (time.calendarName ?? "the plain default calendar")}</span>
      </div>
      <div className="row-list">
        <label>
          And that day is a
          <select value={alignWeekdayIndex ?? ""} onChange={(e) => setAlignWeekdayIndex(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}>
            <option value="">(leave the weekdays as they are)</option>
            {cal.weekdays.map((w, i) => (
              <option key={i} value={i}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() =>
            update((c) => {
              const normalized = normalizeCalendar(c);
              if (!normalized.ok) return c;
              let next = alignDate(normalized.calendar, alignParts, alignTo);
              if (alignWeekdayIndex !== null) next = alignWeekday(next, alignTo, alignWeekdayIndex);
              return { ...c, anchor: next.anchor, weekdayOffset: next.weekdayOffset };
            })
          }
        >
          Line it up
        </button>
      </div>
      {(() => {
        const p = dayToParts(cal, sampleDay);
        return (
          <p className="meta">
            Today in this calendar: {formatDate(cal, sampleDay, { weekday: true })} (year {p.year} has {yearLength(cal, p.year)} days; it is a {cal.weekdays[weekdayIndex(cal, sampleDay)]}).
          </p>
        );
      })()}
    </section>
  );
}
