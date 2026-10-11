import { useEffect, useState } from "react";
import type { Calendar } from "../../lib/calendar/definition";
import { dayToParts, formatDate, monthDays, partsToDay } from "../../lib/calendar/math";
import "./time.css";

/**
 * Picks a date in a calendar: a year, a month from the calendar's own month names and a day of the month.
 * The value is an absolute day number (or null for "no date"), so the same date reads right in any calendar.
 * A day that doesn't exist in the chosen month (the 31st of a 30-day month, the leap day in an ordinary
 * year) is moved to the month's last day instead of being refused.
 */
export function DatePicker({
  calendar,
  day,
  onChange,
  allowEmpty = false,
  defaultDay = 0,
  disabled = false,
  label = "Date",
}: {
  calendar: Calendar;
  day: number | null;
  onChange: (day: number | null) => void;
  allowEmpty?: boolean;
  /** The date "Set date" starts from (usually the project's current date). */
  defaultDay?: number;
  disabled?: boolean;
  label?: string;
}) {
  const parts = day === null ? null : dayToParts(calendar, day);
  const [yearText, setYearText] = useState(parts ? String(parts.year) : "");
  const [dayText, setDayText] = useState(parts ? String(parts.day) : "");
  useEffect(() => {
    setYearText(parts ? String(parts.year) : "");
    setDayText(parts ? String(parts.day) : "");
  }, [parts?.year, parts?.day]); // eslint-disable-line react-hooks/exhaustive-deps

  if (parts === null) {
    return (
      <button type="button" disabled={disabled} onClick={() => onChange(defaultDay)}>
        Set {label.toLowerCase()}
      </button>
    );
  }

  function commit(year: number, month: number, dayOfMonth: number) {
    if (!Number.isInteger(year) || !Number.isInteger(dayOfMonth)) return;
    const clamped = Math.min(Math.max(1, dayOfMonth), monthDays(calendar, year, month));
    const next = partsToDay(calendar, { year, month, day: clamped });
    if (next !== null) onChange(next);
  }

  return (
    <span className="date-picker">
      <span className="date-picker-row">
        <input
          className="date-day"
          type="number"
          inputMode="numeric"
          aria-label={`${label}: day of the month`}
          min={1}
          max={monthDays(calendar, parts.year, parts.month)}
          disabled={disabled}
          value={dayText}
          onChange={(e) => setDayText(e.currentTarget.value)}
          onBlur={() => (dayText.trim() === "" ? setDayText(String(parts.day)) : commit(parts.year, parts.month, Number(dayText)))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <select
          aria-label={`${label}: month`}
          disabled={disabled}
          value={parts.month}
          onChange={(e) => commit(parts.year, Number(e.currentTarget.value), parts.day)}
        >
          {calendar.months.map((m, i) => (
            <option key={i} value={i}>
              {m.name}
            </option>
          ))}
        </select>
        <input
          className="date-year"
          type="number"
          inputMode="numeric"
          aria-label={`${label}: year`}
          disabled={disabled}
          value={yearText}
          onChange={(e) => setYearText(e.currentTarget.value)}
          onBlur={() => (yearText.trim() === "" || !Number.isInteger(Number(yearText)) ? setYearText(String(parts.year)) : commit(Number(yearText), parts.month, parts.day))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        {allowEmpty && (
          <button type="button" disabled={disabled} aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange(null)}>
            ✕
          </button>
        )}
      </span>
      <small className="meta">{formatDate(calendar, day as number, { weekday: true })}</small>
    </span>
  );
}

/** A time of day as hours and minutes in the calendar's own day (24 x 60 by default). */
export function TimePicker({
  calendar,
  minute,
  onChange,
  disabled = false,
  label = "Time",
}: {
  calendar: Calendar;
  minute: number;
  onChange: (minute: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const hours = Math.floor(minute / calendar.minutesPerHour);
  const mins = minute % calendar.minutesPerHour;
  const set = (h: number, m: number) => {
    if (!Number.isInteger(h) || !Number.isInteger(m)) return;
    const hh = Math.min(Math.max(0, h), calendar.hoursPerDay - 1);
    const mm = Math.min(Math.max(0, m), calendar.minutesPerHour - 1);
    onChange(hh * calendar.minutesPerHour + mm);
  };
  return (
    <span className="time-picker">
      <input
        type="number"
        inputMode="numeric"
        aria-label={`${label}: hour`}
        min={0}
        max={calendar.hoursPerDay - 1}
        disabled={disabled}
        value={hours}
        onChange={(e) => set(Number(e.currentTarget.value), mins)}
      />
      :
      <input
        type="number"
        inputMode="numeric"
        aria-label={`${label}: minute`}
        min={0}
        max={calendar.minutesPerHour - 1}
        disabled={disabled}
        value={String(mins).padStart(2, "0")}
        onChange={(e) => set(hours, Number(e.currentTarget.value))}
      />
    </span>
  );
}
