import { useSyncExternalStore } from "react";
import { createRollLog, type RollLogEntry } from "../lib/results/rollLog";

/**
 * The app's one roll log. It lives in memory only, so it is empty again after a
 * restart; a roll worth keeping is saved as a library item.
 */
export const rollLog = createRollLog();

/** The log's entries, newest first; the component re-renders when they change. */
export function useRollLog(): readonly RollLogEntry[] {
  return useSyncExternalStore(rollLog.subscribe, () => rollLog.entries());
}
