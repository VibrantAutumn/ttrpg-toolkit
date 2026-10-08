export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export interface Autosaver {
  /** Call on every edit with the full current text. Saves after a pause. */
  change(text: string): void;
  /** Saves any unsaved text now. Never rejects; failures are reported via `onStatus`. */
  flush(): Promise<void>;
  /** True if there is text that has not been saved yet. */
  hasUnsaved(): boolean;
}

/**
 * Debounced saving that never loses or reorders edits:
 * - rapid changes collapse into one save of the latest text;
 * - saves run one at a time, in order;
 * - if a save fails, the text is kept and retried on the next flush.
 */
export function createAutosaver(options: {
  save: (text: string) => Promise<void>;
  delayMs: number;
  onStatus?: (status: SaveStatus, error?: unknown) => void;
}): Autosaver {
  const { save, delayMs, onStatus = () => {} } = options;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();

  function flush(): Promise<void> {
    clearTimeout(timer);
    timer = undefined;
    if (pending === null) return chain;
    const text = pending;
    pending = null;
    onStatus("saving");
    chain = chain.then(async () => {
      try {
        await save(text);
        // If more edits arrived while saving, the status stays "dirty".
        if (pending === null) onStatus("saved");
      } catch (error) {
        if (pending === null) pending = text; // keep it so the next flush retries
        onStatus("error", error);
      }
    });
    return chain;
  }

  return {
    change(text) {
      pending = text;
      clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
      onStatus("dirty");
    },
    flush,
    hasUnsaved: () => pending !== null,
  };
}
