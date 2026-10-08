import { parseDice, type ParseError } from "../dice/parse";
import { createRng, newSeed } from "../dice/rng";
import { rerollDice, rollDice, type DiceResult } from "../dice/roll";
import { formatDiceResult } from "./format";

/** The kinds of result the log can hold. Draws, tables and generators join later. */
export type ResultKind = "dice";

/** One line in the roll log. Entries are never edited in place; changes make a new object. */
export interface RollLogEntry {
  id: string;
  kind: ResultKind;
  createdAt: number;
  /** The seed of the random source that produced this roll. */
  seed: number;
  notation: string;
  /** The readable one-line form (also what "copy" and "save" use). */
  text: string;
  result: DiceResult;
  /** Positions of the terms that stay as they are when rerolling. */
  locked: number[];
  /** The library item this was saved as, once saved. */
  savedItemId: string | null;
}

export type RollOutcome = { ok: true; entry: RollLogEntry } | { ok: false; error: ParseError };

export interface RollLog {
  /** Newest first. The same array is returned until the log changes. */
  entries(kind?: ResultKind | "all"): readonly RollLogEntry[];
  roll(notation: string, seed?: number): RollOutcome;
  /** Rolls an entry again (keeping its locked terms) as a new entry; null if unknown. */
  reroll(id: string, seed?: number): RollLogEntry | null;
  toggleLock(id: string, termIndex: number): void;
  markSaved(id: string, itemId: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export interface RollLogOptions {
  capacity?: number;
  now?: () => number;
  newId?: () => string;
}

const DEFAULT_CAPACITY = 200;

/**
 * The in-memory roll log. It is deliberately not saved anywhere: it is cleared
 * when the app restarts, and a roll worth keeping is saved as a library item.
 */
export function createRollLog(options: RollLogOptions = {}): RollLog {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const now = options.now ?? Date.now;
  let counter = 0;
  const newId = options.newId ?? (() => `roll-${now()}-${++counter}`);

  let list: readonly RollLogEntry[] = [];
  const listeners = new Set<() => void>();
  let filtered: { source: readonly RollLogEntry[]; kind: ResultKind; out: readonly RollLogEntry[] } | null = null;

  function set(next: readonly RollLogEntry[]): void {
    list = next;
    listeners.forEach((l) => l());
  }

  function push(entry: RollLogEntry): void {
    set([entry, ...list].slice(0, capacity));
  }

  function replace(id: string, change: (e: RollLogEntry) => RollLogEntry): void {
    if (!list.some((e) => e.id === id)) return;
    set(list.map((e) => (e.id === id ? change(e) : e)));
  }

  function makeEntry(result: DiceResult, seed: number, locked: number[]): RollLogEntry {
    return {
      id: newId(),
      kind: "dice",
      createdAt: now(),
      seed,
      notation: result.notation,
      text: formatDiceResult(result),
      result,
      locked,
      savedItemId: null,
    };
  }

  return {
    entries(kind = "all") {
      if (kind === "all") return list;
      if (!filtered || filtered.source !== list || filtered.kind !== kind) {
        filtered = { source: list, kind, out: list.filter((e) => e.kind === kind) };
      }
      return filtered.out;
    },

    roll(notation, seed = newSeed()) {
      const parsed = parseDice(notation);
      if (!parsed.ok) return parsed;
      const entry = makeEntry(rollDice(parsed.expression, createRng(seed)), seed, []);
      push(entry);
      return { ok: true, entry };
    },

    reroll(id, seed = newSeed()) {
      const old = list.find((e) => e.id === id);
      if (!old) return null;
      const parsed = parseDice(old.notation);
      if (!parsed.ok) return null; // can't happen: the notation parsed when it was rolled
      const result = rerollDice(parsed.expression, old.result, new Set(old.locked), createRng(seed));
      const entry = makeEntry(result, seed, [...old.locked]);
      push(entry);
      return entry;
    },

    toggleLock(id, termIndex) {
      replace(id, (e) => {
        if (!Number.isInteger(termIndex) || termIndex < 0 || termIndex >= e.result.terms.length) return e;
        const locked = e.locked.includes(termIndex)
          ? e.locked.filter((i) => i !== termIndex)
          : [...e.locked, termIndex].sort((a, b) => a - b);
        return { ...e, locked };
      });
    },

    markSaved(id, itemId) {
      replace(id, (e) => ({ ...e, savedItemId: itemId }));
    },

    clear() {
      set([]);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
