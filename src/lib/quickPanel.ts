/**
 * Remembers which widgets in the quick tools panel are collapsed. This is only a
 * convenience kept in the browser's storage: it can be missing or blocked (a
 * private window, cleared site data), and then everything simply starts open.
 */
export const QUICK_PANEL_KEY = "quickTools.collapsed";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** The ids of the collapsed widgets. Anything unreadable gives "nothing collapsed". */
export function loadCollapsed(storage: ReadableStorage | undefined): Set<string> {
  try {
    const raw = storage?.getItem(QUICK_PANEL_KEY);
    if (!raw) return new Set();
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

/** Saves them. Returns false (never throws) if the storage refuses. */
export function saveCollapsed(storage: WritableStorage | undefined, collapsed: ReadonlySet<string>): boolean {
  if (!storage) return false;
  try {
    storage.setItem(QUICK_PANEL_KEY, JSON.stringify([...collapsed].sort()));
    return true;
  } catch {
    return false;
  }
}

/** A new set with the widget's id added (collapsing it) or removed (opening it). */
export function toggleCollapsed(collapsed: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(collapsed);
  if (!next.delete(id)) next.add(id);
  return next;
}
