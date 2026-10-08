import { drawCards, formatDrawResult, type DrawCard, type DrawnCard, type DrawOptions } from "../cards/draw";
import { formatSpreadResult } from "../cards/spread";
import { parseDice, type ParseError } from "../dice/parse";
import { createRng, newSeed } from "../dice/rng";
import { rerollDice, rollDice, type DiceResult } from "../dice/roll";
import { formatDiceResult } from "./format";

/** The kinds of result the log can hold. Tables and generators join later. */
export type ResultKind = "dice" | "draw";

/** What every kind of log entry has. */
interface EntryBase {
  id: string;
  createdAt: number;
  /** The seed of the random source that produced this result. */
  seed: number;
  /** What the result is called (a formula's name), or null for a plain one. */
  label: string | null;
  /** The readable one-line form (also what "copy" and "save" use). */
  text: string;
  /** The library item this was saved as, once saved. */
  savedItemId: string | null;
}

export interface DiceLogEntry extends EntryBase {
  kind: "dice";
  notation: string;
  result: DiceResult;
  /** Positions of the terms that stay as they are when rerolling. */
  locked: number[];
}

export interface DrawLogEntry extends EntryBase {
  kind: "draw";
  /** What was drawn from: a set, deck or pool, or the deck in play itself (it may be deleted later). */
  sourceId: string;
  sourceName: string;
  /** The deck in play this came from, or null for a plain draw from a set, deck or pool. */
  playId: string | null;
  /** The spread this reading came from (it may be deleted later), or null for any other draw. */
  spreadId: string | null;
  /** For a spread reading: the position name of each card, in the same order as `cards`. */
  positions: string[] | null;
  options: DrawOptions;
  cards: DrawnCard[];
}

/** One line in the roll log. Entries are never edited in place; changes make a new object. */
export type RollLogEntry = DiceLogEntry | DrawLogEntry;

export type RollOutcome = { ok: true; entry: DiceLogEntry } | { ok: false; error: ParseError };
export type DrawLogOutcome = { ok: true; entry: DrawLogEntry } | { ok: false; message: string };

export interface RollLog {
  /** Newest first. The same array is returned until the log changes. */
  entries(kind: "dice"): readonly DiceLogEntry[];
  entries(kind: "draw"): readonly DrawLogEntry[];
  entries(kind?: ResultKind | "all"): readonly RollLogEntry[];
  roll(notation: string, seed?: number, label?: string): RollOutcome;
  /** Draws from `candidates` (a set, deck or pool's distinct cards) and logs the result. */
  drawFrom(
    source: { id: string; name: string },
    candidates: readonly DrawCard[],
    options: DrawOptions,
    seed?: number,
  ): DrawLogOutcome;
  /** Logs cards that a deck in play has already dealt. */
  logDraw(input: {
    sourceId: string;
    sourceName: string;
    playId: string | null;
    /** For a spread reading: which spread, and each card's position name (same order as `cards`). */
    spreadId?: string | null;
    positions?: readonly string[] | null;
    options: DrawOptions;
    cards: readonly DrawnCard[];
    seed: number;
  }): DrawLogEntry;
  /** Rolls a dice entry again (keeping its locked terms) as a new entry; null if unknown or not dice. */
  reroll(id: string, seed?: number): DiceLogEntry | null;
  /** Dice only: keeps or releases one term of a result when rerolling. */
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
 * when the app restarts, and a result worth keeping is saved as a library item.
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
    const found = list.find((e) => e.id === id);
    if (!found) return;
    const changed = change(found);
    if (changed === found) return; // nothing to do: keep the same list and tell nobody
    set(list.map((e) => (e.id === id ? changed : e)));
  }

  function makeDiceEntry(
    result: DiceResult,
    seed: number,
    locked: number[],
    label: string | null,
  ): DiceLogEntry {
    return {
      id: newId(),
      kind: "dice",
      createdAt: now(),
      seed,
      notation: result.notation,
      label,
      text: formatDiceResult(result),
      result,
      locked,
      savedItemId: null,
    };
  }

  const entries = (kind: ResultKind | "all" = "all"): readonly RollLogEntry[] => {
    if (kind === "all") return list;
    if (!filtered || filtered.source !== list || filtered.kind !== kind) {
      filtered = { source: list, kind, out: list.filter((e) => e.kind === kind) };
    }
    return filtered.out;
  };

  function makeDrawEntry(input: {
    sourceId: string;
    sourceName: string;
    playId: string | null;
    spreadId?: string | null;
    positions?: readonly string[] | null;
    options: DrawOptions;
    cards: readonly DrawnCard[];
    seed: number;
  }): DrawLogEntry {
    const cards = input.cards.map((c) => ({ id: c.id, name: c.name, reversed: c.reversed }));
    // Position names only make sense if there is one for every card.
    const positions = input.positions && input.positions.length === cards.length ? [...input.positions] : null;
    return {
      id: newId(),
      kind: "draw",
      createdAt: now(),
      seed: input.seed,
      label: null,
      text: positions
        ? formatSpreadResult(input.sourceName, cards.map((c, i) => ({ ...c, position: positions[i] })))
        : formatDrawResult(input.sourceName, cards),
      savedItemId: null,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      playId: input.playId,
      spreadId: positions ? (input.spreadId ?? null) : null,
      positions,
      options: { ...input.options },
      cards,
    };
  }

  return {
    // The overloads promise narrower lists for "dice" and "draw"; the filter delivers them.
    entries: entries as RollLog["entries"],

    roll(notation, seed = newSeed(), label) {
      const parsed = parseDice(notation);
      if (!parsed.ok) return parsed;
      const entry = makeDiceEntry(rollDice(parsed.expression, createRng(seed)), seed, [], label ?? null);
      push(entry);
      return { ok: true, entry };
    },

    drawFrom(source, candidates, drawOptions, seed = newSeed()) {
      const drawn = drawCards(candidates, drawOptions, createRng(seed));
      if (!drawn.ok) return drawn;
      const entry = makeDrawEntry({
        sourceId: source.id,
        sourceName: source.name,
        playId: null,
        options: drawOptions,
        cards: drawn.cards,
        seed,
      });
      push(entry);
      return { ok: true, entry };
    },

    logDraw(input) {
      const entry = makeDrawEntry(input);
      push(entry);
      return entry;
    },

    reroll(id, seed = newSeed()) {
      const old = list.find((e) => e.id === id);
      if (!old || old.kind !== "dice") return null;
      const parsed = parseDice(old.notation);
      if (!parsed.ok) return null; // can't happen: the notation parsed when it was rolled
      const result = rerollDice(parsed.expression, old.result, new Set(old.locked), createRng(seed));
      const entry = makeDiceEntry(result, seed, [...old.locked], old.label);
      push(entry);
      return entry;
    },

    toggleLock(id, termIndex) {
      replace(id, (e) => {
        if (e.kind !== "dice") return e;
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
