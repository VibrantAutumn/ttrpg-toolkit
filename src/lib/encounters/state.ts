import type { InitiativeType } from "../rulesets/ruleset";

/**
 * An encounter in play: who is in it, whose turn it is, health, statuses and a log. Pure TypeScript and
 * plain data, so the database only stores it as JSON text (`db/encounters.rs` checks it is an object of
 * reasonable size) and every rule lives in `engine.ts`, tested without any screen.
 *
 * The state is one value; every change is a function from a state to a new state (`engine.ts`), which also
 * writes the log line and keeps what undo needs. Nothing random is hidden: rolls use a seeded generator
 * whose counter is part of the state.
 */

export const ENCOUNTER_VERSION = 1;

export type Side = "party" | "foes";
export const SIDES: readonly Side[] = ["party", "foes"];
export const SIDE_LABELS: Record<Side, string> = { party: "Party", foes: "Foes" };

export type Phase = "setup" | "running" | "finished";

/** What the player display shows of a foe's health. */
export type FoeHealthDisplay = "description" | "hidden";

export const LIMITS = {
  combatants: 60,
  statuses: 12,
  name: 60,
  notes: 2_000,
  statText: 100,
  stats: 12,
  log: 200,
  logText: 300,
  history: 20,
  maxRound: 9_999,
} as const;

export interface Bar {
  current: number;
  max: number;
}

/** A property shown on a combatant's row (its text as it was when the combatant was added). */
export interface CombatStat {
  label: string;
  value: string;
}

export interface ActiveStatus {
  /** Unique within the combatant. */
  id: string;
  /** The ruleset status it came from, or null for a one-off made for this encounter. */
  statusId: string | null;
  name: string;
  notes: string;
  /** `#rrggbb`, or none. */
  color: string | null;
  /** Rounds left, or null for "until removed". */
  remaining: number | null;
}

export interface Combatant {
  /** Unique within the encounter (`c1`, `c2`...). */
  id: string;
  /** The name without its number ("Goblin"). */
  baseName: string;
  /** 1, 2, 3... when several combatants share a base name, else null. */
  number: number | null;
  /** The page this combatant came from, or null for a quick-add. Kept even if the page is later deleted. */
  itemId: string | null;
  side: Side;
  initiative: number | null;
  /** Added to the initiative roll (a property's value when the combatant was added). */
  bonus: number;
  health: Bar | null;
  stats: CombatStat[];
  statuses: ActiveStatus[];
  /** GM-only: never shown on the player display. */
  hidden: boolean;
  defeated: boolean;
  /** GM notes. Never shown on the player display. */
  notes: string;
}

export interface LogEntry {
  /** Goes up by one per entry, so undo can remove exactly the entries a change made. */
  id: number;
  round: number;
  text: string;
}

export interface EncounterState {
  version: typeof ENCOUNTER_VERSION;
  seed: number;
  /** Counts random choices so far (each roll uses its own generator made from the seed and this). */
  counter: number;
  phase: Phase;
  /** 0 while setting up. */
  round: number;
  initiativeType: InitiativeType;
  /** Whether the highest or the lowest initiative goes first. */
  order: "high" | "low";
  /** Dice notation rolled for initiative; blank means it is entered by hand. */
  formula: string;
  foeHealth: FoeHealthDisplay;
  combatants: Combatant[];
  /** Individual and popcorn: whose turn it is. */
  turn: string | null;
  /** Combatants that have acted this round. */
  acted: string[];
  /** Group: the side whose turn it is. */
  side: Side | null;
  /** Group: the side that goes first each round, and how each side rolled. */
  firstSide: Side | null;
  sideInitiative: Record<Side, number | null>;
  nextId: number;
  log: LogEntry[];
  /** Earlier states for undo, newest last (JSON text; see `engine.ts`). */
  history: string[];
}

export function newEncounterState(seed: number, options: Partial<Pick<EncounterState, "initiativeType" | "order" | "formula" | "foeHealth">> = {}): EncounterState {
  return {
    version: ENCOUNTER_VERSION,
    seed: seed >>> 0,
    counter: 0,
    phase: "setup",
    round: 0,
    initiativeType: options.initiativeType ?? "individual",
    order: options.order ?? "high",
    formula: options.formula ?? "1d20",
    foeHealth: options.foeHealth ?? "description",
    combatants: [],
    turn: null,
    acted: [],
    side: null,
    firstSide: null,
    sideInitiative: { party: null, foes: null },
    nextId: 1,
    log: [],
    history: [],
  };
}

// ---------------------------------------------------------------- names and order

/** "Goblin 2", or just "Goblin" when it has no number. */
export const combatantName = (c: Pick<Combatant, "baseName" | "number">): string => (c.number === null ? c.baseName : `${c.baseName} ${c.number}`);

/** A combatant that can still take a turn. */
export const isActive = (c: Combatant): boolean => !c.defeated;

/**
 * The initiative order (individual initiative): by result (highest first, or lowest first under a lowest-first
 * ruleset), then by bonus, then in the order they were added. Combatants with no result yet come last.
 */
export function turnOrder(state: Pick<EncounterState, "combatants" | "order">): Combatant[] {
  const sign = state.order === "low" ? -1 : 1;
  return state.combatants
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      const ai = a.c.initiative;
      const bi = b.c.initiative;
      if (ai === null || bi === null) {
        if (ai === bi) return a.index - b.index;
        return ai === null ? 1 : -1;
      }
      if (ai !== bi) return (bi - ai) * sign;
      if (a.c.bonus !== b.c.bonus) return b.c.bonus - a.c.bonus;
      return a.index - b.index;
    })
    .map((x) => x.c);
}

/** How healthy a bar looks, in a word (what the player display shows instead of numbers). */
export function healthDescription(bar: Bar): string {
  if (bar.max <= 0) return bar.current > 0 ? "Healthy" : "Down";
  if (bar.current <= 0) return "Down";
  const fraction = bar.current / bar.max;
  if (fraction <= 0.25) return "Critical";
  if (fraction <= 0.5) return "Bloodied";
  if (fraction < 1) return "Hurt";
  return "Healthy";
}

// ---------------------------------------------------------------- reading what was stored

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = finite(v);
  return n === null ? fallback : Math.min(max, Math.max(min, Math.round(n)));
};
const COLOR = /^#[0-9a-fA-F]{6}$/;

function readBar(raw: unknown): Bar | null {
  if (!isObject(raw)) return null;
  const current = finite(raw.current);
  const max = finite(raw.max);
  return current === null || max === null ? null : { current, max };
}

function readStatus(raw: unknown): ActiveStatus | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id, 40);
  const name = str(raw.name, LIMITS.name).trim();
  if (id === "" || name === "") return null;
  const remaining = finite(raw.remaining);
  return {
    id,
    statusId: typeof raw.statusId === "string" && raw.statusId !== "" ? raw.statusId.slice(0, 40) : null,
    name,
    notes: str(raw.notes, 300),
    color: typeof raw.color === "string" && COLOR.test(raw.color) ? raw.color.toLowerCase() : null,
    remaining: remaining === null ? null : Math.max(0, Math.round(remaining)),
  };
}

function readCombatant(raw: unknown): Combatant | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id, 40);
  const baseName = str(raw.baseName, LIMITS.name).trim();
  if (id === "" || baseName === "") return null;
  const statuses: ActiveStatus[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(raw.statuses) ? raw.statuses : []) {
    const read = readStatus(s);
    if (read && !seen.has(read.id) && statuses.length < LIMITS.statuses) {
      seen.add(read.id);
      statuses.push(read);
    }
  }
  const stats: CombatStat[] = [];
  for (const s of Array.isArray(raw.stats) ? raw.stats : []) {
    if (isObject(s) && stats.length < LIMITS.stats) stats.push({ label: str(s.label, LIMITS.name), value: str(s.value, LIMITS.statText) });
  }
  const number = finite(raw.number);
  const initiative = finite(raw.initiative);
  return {
    id,
    baseName,
    number: number === null ? null : Math.max(1, Math.round(number)),
    itemId: typeof raw.itemId === "string" && raw.itemId !== "" ? raw.itemId : null,
    side: raw.side === "party" ? "party" : "foes",
    initiative,
    bonus: finite(raw.bonus) ?? 0,
    health: readBar(raw.health),
    stats,
    statuses,
    hidden: raw.hidden === true,
    defeated: raw.defeated === true,
    notes: str(raw.notes, LIMITS.notes),
  };
}

export type EncounterRead = { ok: true; state: EncounterState } | { ok: false; error: string };

/**
 * The one gate every stored encounter passes through. Never throws. Repairs what can be repaired (a bad combatant is
 * dropped, a turn pointing at nobody is cleared) and refuses only what it can't read at all or what a newer app made.
 * Reading its own result changes nothing.
 */
export function normalizeEncounterState(raw: unknown): EncounterRead {
  if (!isObject(raw)) return { ok: false, error: "That isn't an encounter." };
  if (typeof raw.version === "number" && raw.version > ENCOUNTER_VERSION) {
    return { ok: false, error: "That encounter was made by a newer version of the app. Update the app to use it." };
  }
  const base = newEncounterState(int(raw.seed, 0, 4294967295, 1));

  const combatants: Combatant[] = [];
  const ids = new Set<string>();
  for (const item of Array.isArray(raw.combatants) ? raw.combatants : []) {
    const c = readCombatant(item);
    if (c && !ids.has(c.id) && combatants.length < LIMITS.combatants) {
      ids.add(c.id);
      combatants.push(c);
    }
  }

  const phase: Phase = raw.phase === "running" || raw.phase === "finished" ? raw.phase : "setup";
  const initiativeType: InitiativeType = raw.initiativeType === "group" || raw.initiativeType === "popcorn" ? raw.initiativeType : "individual";
  const sideInit = isObject(raw.sideInitiative) ? raw.sideInitiative : {};
  const asSide = (v: unknown): Side | null => (v === "party" || v === "foes" ? v : null);

  const log: LogEntry[] = [];
  for (const e of Array.isArray(raw.log) ? raw.log : []) {
    if (!isObject(e)) continue;
    const id = finite(e.id);
    if (id === null) continue;
    log.push({ id: Math.round(id), round: int(e.round, 0, LIMITS.maxRound, 0), text: str(e.text, LIMITS.logText) });
  }

  const acted = (Array.isArray(raw.acted) ? raw.acted : []).filter((x): x is string => typeof x === "string" && ids.has(x));
  const turn = typeof raw.turn === "string" && ids.has(raw.turn) ? raw.turn : null;
  const maxNumber = Math.max(0, ...combatants.map((c) => Number(c.id.replace(/^c/, "")) || 0));

  const state: EncounterState = {
    version: ENCOUNTER_VERSION,
    seed: base.seed,
    counter: int(raw.counter, 0, Number.MAX_SAFE_INTEGER, 0),
    phase,
    round: phase === "setup" ? 0 : int(raw.round, 1, LIMITS.maxRound, 1),
    initiativeType,
    order: raw.order === "low" ? "low" : "high",
    formula: typeof raw.formula === "string" ? raw.formula.trim().slice(0, 200) : "1d20",
    foeHealth: raw.foeHealth === "hidden" ? "hidden" : "description",
    combatants,
    turn,
    acted: [...new Set(acted)],
    side: asSide(raw.side),
    firstSide: asSide(raw.firstSide),
    sideInitiative: { party: finite(sideInit.party), foes: finite(sideInit.foes) },
    nextId: Math.max(int(raw.nextId, 1, Number.MAX_SAFE_INTEGER, 1), maxNumber + 1, log.reduce((m, e) => Math.max(m, e.id + 1), 1)),
    log: log.slice(-LIMITS.log),
    history: (Array.isArray(raw.history) ? raw.history : []).filter((h): h is string => typeof h === "string").slice(-LIMITS.history),
  };
  return { ok: true, state };
}

/** Reads stored text. */
export function parseEncounterState(text: string): EncounterRead {
  try {
    return normalizeEncounterState(JSON.parse(text));
  } catch {
    return { ok: false, error: "That encounter's data couldn't be read." };
  }
}
