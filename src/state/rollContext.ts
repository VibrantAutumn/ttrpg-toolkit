import { useSyncExternalStore } from "react";
import { parseContext, serializeContext } from "../lib/tables/rollContext";
import { deviceStorage } from "./deviceStorage";

/**
 * The roll context chosen on this device: tags that limit what entity slots may pick. Remembered per
 * project in the browser's storage (a blocked storage just means it isn't remembered), shared by every
 * place that rolls, and never part of the project's data.
 */

const keyFor = (projectId: string) => `ttrpg.rollContext.${projectId}`;
const cache = new Map<string, string[]>();
const listeners = new Set<() => void>();

export function getRollContext(projectId: string): string[] {
  const cached = cache.get(projectId);
  if (cached) return cached;
  let ids: string[] = [];
  try {
    ids = parseContext(deviceStorage()?.getItem(keyFor(projectId)));
  } catch {
    ids = [];
  }
  cache.set(projectId, ids);
  return ids;
}

export function setRollContext(projectId: string, tagIds: string[]): void {
  const ids = parseContext(serializeContext(tagIds));
  cache.set(projectId, ids);
  try {
    deviceStorage()?.setItem(keyFor(projectId), serializeContext(ids));
  } catch {
    // not remembered; still used until the app closes
  }
  listeners.forEach((l) => l());
}

const EMPTY: string[] = [];

/** The tag ids of the current context (a stable array, so React only re-renders on a real change). */
export function useRollContext(projectId: string | null): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (projectId ? getRollContext(projectId) : EMPTY),
  );
}
