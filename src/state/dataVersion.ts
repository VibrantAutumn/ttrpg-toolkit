import { useSyncExternalStore } from "react";

/**
 * A counter that goes up whenever library data is changed somewhere other than
 * the library screen showing it (saving a roll, renaming or deleting from an
 * item's page...). Library screens stay mounted while hidden, so they include
 * this number in their reload and refresh themselves when it changes.
 */
let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call after changing library data from outside a library screen. */
export function bumpDataVersion(): void {
  version += 1;
  listeners.forEach((l) => l());
}

export function useDataVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
