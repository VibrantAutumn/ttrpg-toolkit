import type { PublicCombatant, PublicView } from "./publicView";

/**
 * How the GM's window hands the player display (a second window) what to show. The value is a `PublicView`, which
 * has already had every secret taken out (`publicView.ts`); the display never sees an encounter itself.
 *
 * The view is written as text to `localStorage` (windows of the app share it, and a `storage` event tells the other
 * window), so the display can also read the latest one when it opens. Everything read back goes through
 * `parsePublicView`, which accepts only the exact shape and never throws.
 */

export const DISPLAY_STORAGE_KEY = "ttrpg.playerDisplay";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.slice(0, max) : "");
const COLOR = /^#[0-9a-fA-F]{6}$/;

function parseCombatant(raw: unknown): PublicCombatant | null {
  if (!isObject(raw)) return null;
  const name = str(raw.name, 80);
  if (name === "") return null;
  const statuses = (Array.isArray(raw.statuses) ? raw.statuses : [])
    .filter(isObject)
    .map((s) => ({ name: str(s.name, 80), color: typeof s.color === "string" && COLOR.test(s.color) ? s.color : null }))
    .filter((s) => s.name !== "")
    .slice(0, 12);
  return {
    name,
    side: raw.side === "party" ? "party" : "foes",
    current: raw.current === true,
    acted: raw.acted === true,
    defeated: raw.defeated === true,
    health: typeof raw.health === "string" && raw.health !== "" ? raw.health.slice(0, 40) : null,
    statuses,
  };
}

/** Reads a view from what came over the channel; anything that isn't one gives null. */
export function parsePublicView(raw: unknown): PublicView | null {
  if (!isObject(raw)) return null;
  const phase = raw.phase === "running" || raw.phase === "finished" ? raw.phase : raw.phase === "setup" ? "setup" : null;
  if (phase === null) return null;
  const round = typeof raw.round === "number" && Number.isFinite(raw.round) ? Math.max(0, Math.round(raw.round)) : 0;
  const side = raw.side === "party" || raw.side === "foes" ? raw.side : null;
  const combatants = (Array.isArray(raw.combatants) ? raw.combatants : [])
    .map(parseCombatant)
    .filter((c): c is PublicCombatant => c !== null)
    .slice(0, 60);
  return {
    title: str(raw.title, 120),
    phase,
    round,
    side,
    sideLabel: side === null ? null : str(raw.sideLabel, 40) || (side === "party" ? "Party" : "Foes"),
    combatants,
  };
}

export function parsePublicViewText(text: string | null): PublicView | null {
  if (text === null) return null;
  try {
    return parsePublicView(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Shows this on the player display (null clears it). Never throws: a device without storage just shows nothing. */
export function publishDisplay(view: PublicView | null): void {
  try {
    if (view === null) localStorage.removeItem(DISPLAY_STORAGE_KEY);
    else localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(view));
  } catch {
    /* storage blocked: nothing to do */
  }
}

/** What is being shown right now. */
export function currentDisplay(): PublicView | null {
  try {
    return parsePublicViewText(localStorage.getItem(DISPLAY_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Calls `onChange` whenever the shown view changes (from any window). Returns a function that stops listening. */
export function subscribeDisplay(onChange: (view: PublicView | null) => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === DISPLAY_STORAGE_KEY || event.key === null) onChange(currentDisplay());
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}
