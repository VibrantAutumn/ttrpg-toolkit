/**
 * Weather for a day, as the app keeps it: a small record, rolled once from a weather table and then kept.
 *
 * Which table is rolled: the project's weather table (its climate), or, when the calendar has seasons and a
 * table named like `Temperate weather (Winter)` exists, that season's variant. So a climate can start as one
 * table and grow seasonal tables later without anything else changing.
 */

export interface WeatherData {
  /** What the weather is, in words (the rolled entry's text). */
  text: string;
  /** The table it was rolled from, by name (kept as text so it reads right after the table is renamed or deleted). */
  table: string | null;
  /** The season it was rolled in, if the calendar has seasons. */
  season: string | null;
  /** Typed by hand rather than rolled. */
  manual: boolean;
}

export const MAX_WEATHER_TEXT = 300;

export function weatherToJson(w: WeatherData): string {
  return JSON.stringify({ ...w, text: w.text.slice(0, MAX_WEATHER_TEXT) });
}

/** Reads a kept record; null when it is not one. */
export function parseWeather(json: string): WeatherData | null {
  try {
    const v: unknown = JSON.parse(json);
    if (typeof v !== "object" || v === null) return null;
    const r = v as Record<string, unknown>;
    if (typeof r.text !== "string") return null;
    return {
      text: r.text.slice(0, MAX_WEATHER_TEXT),
      table: typeof r.table === "string" ? r.table : null,
      season: typeof r.season === "string" ? r.season : null,
      manual: r.manual === true,
    };
  } catch {
    return null;
  }
}

/** The table to roll: the season's variant of the base table if there is one, else the base table. */
export function pickWeatherTable<T extends { name: string }>(tables: readonly T[], base: T, season: string | null): T {
  if (season) {
    const wanted = `${base.name.trim()} (${season.trim()})`.toLowerCase();
    const variant = tables.find((t) => t.name.trim().toLowerCase() === wanted);
    if (variant) return variant;
  }
  return base;
}

/** A short line for the status bar and the month view: `Light rain` (cut at the first full stop or 60 characters). */
export function weatherSummary(w: WeatherData, max = 60): string {
  const first = w.text.split(/[.\n]/)[0].trim();
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}
