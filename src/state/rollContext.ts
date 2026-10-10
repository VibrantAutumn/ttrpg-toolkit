import { useSyncExternalStore } from "react";
import { parseContext, serializeContext } from "../lib/tables/rollContext";
import { deviceStorage } from "./deviceStorage";

/**
 * The roll context chosen on this device: tags that limit what entity slots may pick. Remembered per
 * campaign in the browser's storage (a blocked storage just means it isn't remembered), shared by every
 * place that rolls, and never part of the campaign's data.
 */

const keyFor = (campaignId: string) => `ttrpg.rollContext.${campaignId}`;
const cache = new Map<string, string[]>();
const listeners = new Set<() => void>();

export function getRollContext(campaignId: string): string[] {
  const cached = cache.get(campaignId);
  if (cached) return cached;
  let ids: string[] = [];
  try {
    ids = parseContext(deviceStorage()?.getItem(keyFor(campaignId)));
  } catch {
    ids = [];
  }
  cache.set(campaignId, ids);
  return ids;
}

export function setRollContext(campaignId: string, tagIds: string[]): void {
  const ids = parseContext(serializeContext(tagIds));
  cache.set(campaignId, ids);
  try {
    deviceStorage()?.setItem(keyFor(campaignId), serializeContext(ids));
  } catch {
    // not remembered; still used until the app closes
  }
  listeners.forEach((l) => l());
}

const EMPTY: string[] = [];

/** The tag ids of the current context (a stable array, so React only re-renders on a real change). */
export function useRollContext(campaignId: string | null): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (campaignId ? getRollContext(campaignId) : EMPTY),
  );
}
