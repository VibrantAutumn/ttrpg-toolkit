import { rollNotation } from "../dice/roll";
import { createRng } from "../dice/rng";
import { adjustBar } from "../fields/bar";
import type { InitiativeType } from "../rulesets/ruleset";
import {
  combatantName,
  isActive,
  LIMITS,
  normalizeEncounterState,
  SIDE_LABELS,
  turnOrder,
  type ActiveStatus,
  type Bar,
  type Combatant,
  type CombatStat,
  type EncounterState,
  type FoeHealthDisplay,
  type Side,
} from "./state";

/**
 * The rules of running an encounter. Every function takes a state and gives a **new** state (the old one is
 * never changed), after writing a line in the log and keeping what undo needs. A change that can't be made gives
 * a sentence saying why and leaves the state alone. Pure TypeScript: no database and no screen.
 */

export type Outcome = { ok: true; state: EncounterState } | { ok: false; message: string };

const refuse = (message: string): Outcome => ({ ok: false, message });

/** What undo keeps of a state: everything except the log, the seed and the counter (those only move forward). */
interface Snapshot {
  state: Omit<EncounterState, "history" | "log" | "seed" | "counter">;
  lastLogId: number;
}

const lastLogId = (state: EncounterState) => state.log.reduce((m, e) => Math.max(m, e.id), 0);

/** Makes the change on a copy, adds the log lines it wrote and remembers the old state for undo. */
function commit(state: EncounterState, change: (draft: EncounterState) => string | null): Outcome {
  const { history, log, seed, counter, ...rest } = state;
  void log;
  void seed;
  void counter;
  const snapshot: Snapshot = { state: rest, lastLogId: lastLogId(state) };
  const draft = JSON.parse(JSON.stringify({ ...state, history: [] })) as EncounterState;
  const problem = change(draft);
  if (problem !== null) return refuse(problem);
  draft.history = [...history, JSON.stringify(snapshot)].slice(-LIMITS.history);
  return { ok: true, state: draft };
}

/** Adds a line to the log (the newest 200 are kept). */
function say(draft: EncounterState, text: string): void {
  draft.log.push({ id: draft.nextId, round: draft.round, text: text.slice(0, LIMITS.logText) });
  draft.nextId += 1;
  if (draft.log.length > LIMITS.log) draft.log.splice(0, draft.log.length - LIMITS.log);
}

const find = (draft: EncounterState, id: string): Combatant | undefined => draft.combatants.find((c) => c.id === id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const barText = (b: Bar) => `${b.current}/${b.max}`;

function trimmedName(name: string): string {
  return name.trim().slice(0, LIMITS.name);
}

// ---------------------------------------------------------------- combatants

/** What it takes to add a combatant. */
export interface CombatantSpec {
  name: string;
  itemId?: string | null;
  side: Side;
  health?: Bar | null;
  bonus?: number;
  stats?: CombatStat[];
  initiative?: number | null;
  hidden?: boolean;
  notes?: string;
}

/** Adds one combatant, numbering it (and the others with the same name) when the name is shared. */
function addOne(draft: EncounterState, spec: CombatantSpec): Combatant {
  const baseName = trimmedName(spec.name);
  const same = draft.combatants.filter((c) => c.baseName.toLowerCase() === baseName.toLowerCase());
  let number: number | null = null;
  if (same.length > 0) {
    // The first one of a name gets "1" the moment a second arrives.
    let top = Math.max(0, ...same.map((c) => c.number ?? 0));
    for (const c of same) if (c.number === null) c.number = ++top;
    number = top + 1;
  }
  const combatant: Combatant = {
    id: `c${draft.nextId}`,
    baseName,
    number,
    itemId: spec.itemId ?? null,
    side: spec.side,
    initiative: spec.initiative ?? null,
    bonus: spec.bonus ?? 0,
    health: spec.health ? { current: spec.health.current, max: spec.health.max } : null,
    stats: (spec.stats ?? []).slice(0, LIMITS.stats).map((s) => ({ label: s.label, value: s.value })),
    statuses: [],
    hidden: spec.hidden === true,
    defeated: false,
    notes: (spec.notes ?? "").slice(0, LIMITS.notes),
  };
  draft.nextId += 1;
  draft.combatants.push(combatant);
  return combatant;
}

/** Adds `count` copies of a combatant ("Goblin" x 3 gives Goblin 1, 2 and 3), each with its own health and statuses. */
export function addCombatants(state: EncounterState, spec: CombatantSpec, count = 1): Outcome {
  if (trimmedName(spec.name) === "") return refuse("Give the combatant a name.");
  const n = Math.round(count);
  if (n < 1) return refuse("Add at least one.");
  if (state.combatants.length + n > LIMITS.combatants) return refuse(`An encounter can have at most ${LIMITS.combatants} combatants.`);
  if (state.phase === "finished") return refuse("This encounter is over.");
  return commit(state, (d) => {
    const added: Combatant[] = [];
    for (let i = 0; i < n; i++) added.push(addOne(d, spec));
    say(d, `${added.map(combatantName).join(", ")} ${added.length === 1 ? "joins" : "join"} the ${spec.side === "party" ? "party" : "foes"}.`);
    return null;
  });
}

export function removeCombatant(state: EncounterState, id: string): Outcome {
  const target = state.combatants.find((c) => c.id === id);
  if (!target) return refuse("That combatant isn't in the encounter.");
  return commit(state, (d) => {
    // If it was somebody's turn, the turn moves on first so the encounter never points at nobody.
    if (d.phase === "running" && d.turn === id) {
      if (d.initiativeType === "individual") advanceIndividual(d);
      if (d.turn === id) d.turn = null;
    }
    d.combatants = d.combatants.filter((c) => c.id !== id);
    d.acted = d.acted.filter((a) => a !== id);
    say(d, `${combatantName(target)} leaves the encounter.`);
    return null;
  });
}

export interface CombatantPatch {
  name?: string;
  side?: Side;
  hidden?: boolean;
  notes?: string;
  bonus?: number;
}

/** Renames (keeping the number), moves to the other side, hides, or edits notes and initiative bonus. */
export function updateCombatant(state: EncounterState, id: string, patch: CombatantPatch): Outcome {
  const target = state.combatants.find((c) => c.id === id);
  if (!target) return refuse("That combatant isn't in the encounter.");
  if (patch.name !== undefined && trimmedName(patch.name) === "") return refuse("Give the combatant a name.");
  return commit(state, (d) => {
    const c = find(d, id) as Combatant;
    const before = combatantName(c);
    if (patch.name !== undefined) c.baseName = trimmedName(patch.name);
    if (patch.side !== undefined) c.side = patch.side;
    if (patch.hidden !== undefined) c.hidden = patch.hidden;
    if (patch.notes !== undefined) c.notes = patch.notes.slice(0, LIMITS.notes);
    if (patch.bonus !== undefined && Number.isFinite(patch.bonus)) c.bonus = patch.bonus;
    const notes: string[] = [];
    if (patch.name !== undefined && combatantName(c) !== before) notes.push(`${before} is now called ${combatantName(c)}`);
    if (patch.side !== undefined && patch.side !== target.side) notes.push(`${combatantName(c)} switches to the ${SIDE_LABELS[patch.side].toLowerCase()}`);
    if (patch.hidden !== undefined && patch.hidden !== target.hidden) notes.push(`${combatantName(c)} is ${patch.hidden ? "hidden from" : "shown to"} the players`);
    if (notes.length > 0) say(d, `${notes.join("; ")}.`);
    return null;
  });
}

export function setDefeated(state: EncounterState, id: string, defeated: boolean): Outcome {
  const target = state.combatants.find((c) => c.id === id);
  if (!target) return refuse("That combatant isn't in the encounter.");
  if (target.defeated === defeated) return { ok: true, state };
  return commit(state, (d) => {
    (find(d, id) as Combatant).defeated = defeated;
    say(d, `${combatantName(target)} ${defeated ? "is defeated" : "is back in the fight"}.`);
    return null;
  });
}

/** Marks a combatant as having acted this round, or clears the mark (for group and popcorn play, or to keep track). */
export function toggleActed(state: EncounterState, id: string): Outcome {
  if (!state.combatants.some((c) => c.id === id)) return refuse("That combatant isn't in the encounter.");
  return commit(state, (d) => {
    d.acted = d.acted.includes(id) ? d.acted.filter((a) => a !== id) : [...d.acted, id];
    return null;
  });
}

// ---------------------------------------------------------------- initiative

export function setInitiative(state: EncounterState, id: string, value: number | null): Outcome {
  const target = state.combatants.find((c) => c.id === id);
  if (!target) return refuse("That combatant isn't in the encounter.");
  if (value !== null && !Number.isFinite(value)) return refuse("Initiative has to be a number.");
  return commit(state, (d) => {
    (find(d, id) as Combatant).initiative = value;
    say(d, value === null ? `${combatantName(target)}'s initiative is cleared.` : `${combatantName(target)}: initiative ${value}.`);
    return null;
  });
}

export function setSideInitiative(state: EncounterState, side: Side, value: number | null): Outcome {
  if (value !== null && !Number.isFinite(value)) return refuse("Initiative has to be a number.");
  return commit(state, (d) => {
    d.sideInitiative[side] = value;
    d.firstSide = firstSideOf(d);
    say(d, value === null ? `The ${SIDE_LABELS[side].toLowerCase()}'s initiative is cleared.` : `The ${SIDE_LABELS[side].toLowerCase()}: initiative ${value}.`);
    return null;
  });
}

/** The side that goes first: the higher result (the lower under a lowest-first ruleset); ties go to the party. */
function firstSideOf(d: EncounterState): Side | null {
  const { party, foes } = d.sideInitiative;
  if (party === null && foes === null) return null;
  if (party === null) return "foes";
  if (foes === null) return "party";
  if (party === foes) return "party";
  return (party > foes) === (d.order === "high") ? "party" : "foes";
}

/** One roll of the encounter's initiative formula, using the next random choice. */
function rollFormula(d: EncounterState): { total: number } | string {
  if (d.formula.trim() === "") return "This encounter has no initiative roll. Enter the turn order by hand.";
  const rng = createRng(((d.seed ^ Math.imul(d.counter + 1, 0x9e3779b1)) >>> 0));
  d.counter += 1;
  const rolled = rollNotation(d.formula, rng);
  if (!rolled.ok) return `The initiative roll “${d.formula}” isn't a dice formula: ${rolled.error.message}`;
  return { total: rolled.result.total };
}

/** Rolls initiative for the chosen combatants (individual and popcorn use per-combatant results). Returns a sentence if it can't. */
function rollFor(d: EncounterState, ids: string[]): string | null {
  const parts: string[] = [];
  if (d.initiativeType === "group") {
    for (const side of ["party", "foes"] as const) {
      const r = rollFormula(d);
      if (typeof r === "string") return r;
      d.sideInitiative[side] = r.total;
      parts.push(`the ${SIDE_LABELS[side].toLowerCase()} ${r.total}`);
    }
    d.firstSide = firstSideOf(d);
  } else {
    for (const id of ids) {
      const c = find(d, id);
      if (!c) continue;
      const r = rollFormula(d);
      if (typeof r === "string") return r;
      c.initiative = r.total + c.bonus;
      parts.push(`${combatantName(c)} ${c.initiative}`);
    }
  }
  if (parts.length > 0) say(d, `Initiative rolled: ${parts.join(", ")}.`);
  return null;
}

/**
 * Rolls initiative with the encounter's formula: for everyone, or only for those who have none yet. Under group
 * initiative each side rolls once. Each combatant adds its own initiative bonus.
 */
export function rollInitiative(state: EncounterState, options: { onlyMissing?: boolean; ids?: string[] } = {}): Outcome {
  const ids = (options.ids ?? state.combatants.map((c) => c.id)).filter((id) => {
    const c = state.combatants.find((x) => x.id === id);
    return c !== undefined && (!options.onlyMissing || c.initiative === null);
  });
  if (state.initiativeType !== "group" && ids.length === 0) return refuse("Nobody needs an initiative roll.");
  if (state.initiativeType === "popcorn") return refuse("Popcorn initiative has no roll: whoever just went picks who goes next.");
  return commit(state, (d) => rollFor(d, ids));
}

// ---------------------------------------------------------------- health and statuses

function healthLine(c: Combatant, before: Bar | null, after: Bar): string {
  const name = combatantName(c);
  if (before) {
    const delta = after.current - before.current;
    if (delta < 0) return `${name} takes ${plural(-delta, "damage", "damage")} (${barText(after)}).`;
    if (delta > 0) return `${name} recovers ${delta} (${barText(after)}).`;
    return `${name}'s health stays at ${barText(after)}.`;
  }
  return `${name}'s health is ${barText(after)}.`;
}

/** Sets a combatant's health bar outright (or removes it with null). */
export function setHealth(state: EncounterState, id: string, bar: Bar | null): Outcome {
  const target = state.combatants.find((c) => c.id === id);
  if (!target) return refuse("That combatant isn't in the encounter.");
  if (bar && (!Number.isFinite(bar.current) || !Number.isFinite(bar.max))) return refuse("Health has to be numbers.");
  return commit(state, (d) => {
    const c = find(d, id) as Combatant;
    const before = c.health;
    c.health = bar ? { current: bar.current, max: bar.max } : null;
    say(d, bar ? healthLine(c, before, bar) : `${combatantName(c)} has no health bar now.`);
    return null;
  });
}

/** Damage (negative) or healing (positive). Health stays between 0 and the maximum, like a property bar. */
export function adjustHealth(state: EncounterState, id: string, delta: number): Outcome {
  const target = state.combatants.find((c) => c.id === id);
  if (!target) return refuse("That combatant isn't in the encounter.");
  if (!Number.isFinite(delta) || delta === 0) return refuse("Type how much damage or healing.");
  if (!target.health) return refuse(`${combatantName(target)} has no health to change. Give it health first.`);
  return commit(state, (d) => {
    const c = find(d, id) as Combatant;
    const before = c.health as Bar;
    const after = adjustBar(before, delta);
    c.health = after;
    say(d, healthLine(c, before, after));
    return null;
  });
}

/** What a status is made from: a ruleset status or a one-off. */
export interface StatusSpec {
  statusId?: string | null;
  name: string;
  notes?: string;
  color?: string | null;
  /** Rounds, or null/undefined for until removed. */
  duration?: number | null;
}

/** Puts a status on a combatant. Adding one it already has refreshes it (new duration) instead of doubling it. */
export function addStatus(state: EncounterState, id: string, spec: StatusSpec): Outcome {
  const target = state.combatants.find((c) => c.id === id);
  if (!target) return refuse("That combatant isn't in the encounter.");
  const name = trimmedName(spec.name);
  if (name === "") return refuse("Give the status a name.");
  const remaining = spec.duration === null || spec.duration === undefined ? null : Math.max(1, Math.round(spec.duration));
  const existing = target.statuses.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!existing && target.statuses.length >= LIMITS.statuses) return refuse(`A combatant can have at most ${LIMITS.statuses} statuses.`);
  return commit(state, (d) => {
    const c = find(d, id) as Combatant;
    const duration = remaining === null ? "" : ` (${plural(remaining, "round")})`;
    const live = c.statuses.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (live) {
      live.remaining = remaining;
      if (spec.notes !== undefined) live.notes = spec.notes.slice(0, 300);
      say(d, `${combatantName(c)}'s ${live.name} is renewed${duration}.`);
      return null;
    }
    const status: ActiveStatus = {
      id: `s${d.nextId}`,
      statusId: spec.statusId ?? null,
      name,
      notes: (spec.notes ?? "").slice(0, 300),
      color: spec.color ?? null,
      remaining,
    };
    d.nextId += 1;
    c.statuses.push(status);
    say(d, `${combatantName(c)} is ${name}${duration}.`);
    return null;
  });
}

export function removeStatus(state: EncounterState, id: string, statusInstanceId: string): Outcome {
  const target = state.combatants.find((c) => c.id === id);
  const status = target?.statuses.find((s) => s.id === statusInstanceId);
  if (!target || !status) return refuse("That status isn't there any more.");
  return commit(state, (d) => {
    const c = find(d, id) as Combatant;
    c.statuses = c.statuses.filter((s) => s.id !== statusInstanceId);
    say(d, `${combatantName(c)} is no longer ${status.name}.`);
    return null;
  });
}

// ---------------------------------------------------------------- settings

/** Changes how initiative works. Only while setting up: changing it mid-fight would leave nobody sure whose turn it is. */
export function setInitiativeType(state: EncounterState, type: InitiativeType): Outcome {
  if (state.phase !== "setup") return refuse("The way initiative works can only be changed before the encounter starts.");
  if (state.initiativeType === type) return { ok: true, state };
  return commit(state, (d) => {
    d.initiativeType = type;
    return null;
  });
}

export function setFoeHealthDisplay(state: EncounterState, value: FoeHealthDisplay): Outcome {
  if (state.foeHealth === value) return { ok: true, state };
  return commit(state, (d) => {
    d.foeHealth = value;
    return null;
  });
}

/** Changes the initiative roll for this encounter (blank means by hand). */
export function setInitiativeFormula(state: EncounterState, formula: string): Outcome {
  const text = formula.trim();
  if (text.length > 200) return refuse("That formula is too long.");
  if (text !== "") {
    const check = rollNotation(text, createRng(1));
    if (!check.ok) return refuse(`That isn't a dice formula: ${check.error.message}`);
  }
  return commit(state, (d) => {
    d.formula = text;
    return null;
  });
}

// ---------------------------------------------------------------- turns

/** Starts a new round: the round counter goes up, "acted" marks clear, and statuses count down (an ended one is removed). */
function newRound(d: EncounterState): void {
  d.round += 1;
  d.acted = [];
  for (const c of d.combatants) {
    const ended: string[] = [];
    c.statuses = c.statuses.filter((s) => {
      if (s.remaining === null) return true;
      s.remaining -= 1;
      if (s.remaining <= 0) {
        ended.push(s.name);
        return false;
      }
      return true;
    });
    if (ended.length > 0) say(d, `${ended.join(", ")} ended on ${combatantName(c)}.`);
  }
}

/** Individual initiative: the turn passes to the next active combatant in order, starting a new round when the list ends. */
function advanceIndividual(d: EncounterState): boolean {
  const order = turnOrder(d).filter(isActive);
  if (order.length === 0) return false;
  const here = d.turn === null ? -1 : order.findIndex((c) => c.id === d.turn);
  if (d.turn !== null && !d.acted.includes(d.turn)) d.acted.push(d.turn);
  if (here + 1 >= order.length) {
    newRound(d);
    d.turn = order[0].id;
  } else {
    d.turn = order[here + 1].id;
  }
  return true;
}

const other = (side: Side): Side => (side === "party" ? "foes" : "party");
const hasActive = (d: EncounterState, side: Side) => d.combatants.some((c) => c.side === side && isActive(c));

/** Begins the encounter: round 1, and the first turn (or side) is chosen. Missing initiative is rolled if the encounter has a formula. */
export function start(state: EncounterState): Outcome {
  if (state.phase !== "setup") return refuse("This encounter has already started.");
  if (!state.combatants.some(isActive)) return refuse("Add at least one combatant first.");
  if (state.initiativeType === "individual" && state.formula.trim() === "" && state.combatants.some((c) => isActive(c) && c.initiative === null)) {
    return refuse("Everyone needs an initiative first: enter one for each combatant.");
  }
  return commit(state, (d) => {
    d.phase = "running";
    d.round = 1;
    d.acted = [];
    d.turn = null;
    if (d.initiativeType === "individual") {
      const missing = d.combatants.filter((c) => c.initiative === null).map((c) => c.id);
      if (missing.length > 0) {
        const problem = rollFor(d, missing);
        if (problem) return problem;
      }
      const first = turnOrder(d).find(isActive);
      d.turn = first ? first.id : null;
      say(d, `Round 1 begins.${first ? ` ${combatantName(first)} goes first.` : ""}`);
    } else if (d.initiativeType === "group") {
      if (d.firstSide === null) {
        if (d.formula.trim() !== "") {
          const problem = rollFor(d, []);
          if (problem) return problem;
        }
        d.firstSide = d.firstSide ?? "party";
      }
      let side: Side = d.firstSide;
      if (!hasActive(d, side)) side = other(side);
      d.side = side;
      say(d, `Round 1 begins. The ${SIDE_LABELS[side].toLowerCase()} go first.`);
    } else {
      say(d, "Round 1 begins. Pick who goes first.");
    }
    return null;
  });
}

/**
 * Ends the current turn and starts the next. Individual: the next active combatant in order. Group: the other side
 * (a new round after both have gone). Popcorn: `pickId` is who goes next (anyone who hasn't acted this round).
 */
export function nextTurn(state: EncounterState, pickId?: string): Outcome {
  if (state.phase !== "running") return refuse("The encounter isn't running.");
  if (!state.combatants.some(isActive)) return refuse("Everyone is defeated.");
  if (state.initiativeType === "popcorn") {
    const pick = pickId === undefined ? undefined : state.combatants.find((c) => c.id === pickId);
    if (pickId !== undefined && (!pick || !isActive(pick))) return refuse("That combatant can't take a turn.");
    const stillToAct = state.combatants.filter((c) => isActive(c) && !state.acted.includes(c.id) && c.id !== state.turn);
    if (stillToAct.length > 0 && !pick) return refuse("Pick who goes next.");
    if (pick && stillToAct.length > 0 && !stillToAct.some((c) => c.id === pick.id)) return refuse(`${combatantName(pick)} has already gone this round.`);
    return commit(state, (d) => {
      if (d.turn !== null && !d.acted.includes(d.turn)) d.acted.push(d.turn);
      const remaining = d.combatants.filter((c) => isActive(c) && !d.acted.includes(c.id));
      if (remaining.length === 0) {
        newRound(d);
        say(d, `Round ${d.round} begins.`);
      }
      d.turn = pick ? pick.id : null;
      if (pick) say(d, `${combatantName(pick)}'s turn.`);
      return null;
    });
  }
  if (state.initiativeType === "group") {
    return commit(state, (d) => {
      const first = d.firstSide ?? "party";
      let side: Side = d.side ?? first;
      let wrapped = false;
      // Move to the other side; going from the second side back to the first is a new round.
      const step = () => {
        if (side === first) side = other(first);
        else {
          side = first;
          wrapped = true;
        }
      };
      step();
      if (!hasActive(d, side)) {
        step();
        if (!hasActive(d, side)) return "Everyone is defeated.";
      }
      if (wrapped) {
        newRound(d);
        say(d, `Round ${d.round} begins.`);
      }
      d.side = side;
      say(d, side === "party" ? "The party's turn." : "The foes' turn.");
      return null;
    });
  }
  return commit(state, (d) => {
    const before = d.round;
    if (!advanceIndividual(d)) return "Everyone is defeated.";
    const c = find(d, d.turn as string) as Combatant;
    if (d.round !== before) say(d, `Round ${d.round} begins.`);
    say(d, `${combatantName(c)}'s turn.`);
    return null;
  });
}

/** Under popcorn initiative, gives the turn to somebody without ending anyone else's (the first pick of the encounter). */
export function pickTurn(state: EncounterState, id: string): Outcome {
  if (state.phase !== "running" || state.initiativeType !== "popcorn") return refuse("Only a running popcorn encounter lets you pick.");
  if (state.turn !== null) return nextTurn(state, id);
  const pick = state.combatants.find((c) => c.id === id);
  if (!pick || !isActive(pick)) return refuse("That combatant can't take a turn.");
  return commit(state, (d) => {
    d.turn = id;
    say(d, `${combatantName(pick)}'s turn.`);
    return null;
  });
}

/** A line saying how it went, for copying or saving to a session later. */
export function outcomeText(state: EncounterState): string {
  const rounds = plural(Math.max(state.round, 0), "round");
  const down = (side: Side) => state.combatants.filter((c) => c.side === side && c.defeated).map(combatantName);
  const standing = (side: Side) => state.combatants.filter((c) => c.side === side && !c.defeated).map(combatantName);
  const lines = [`Encounter: ${rounds}.`];
  for (const side of ["party", "foes"] as const) {
    const label = SIDE_LABELS[side];
    if (state.combatants.some((c) => c.side === side)) {
      lines.push(`${label} standing: ${standing(side).join(", ") || "nobody"}.`);
      if (down(side).length > 0) lines.push(`${label} defeated: ${down(side).join(", ")}.`);
    }
  }
  return lines.join(" ");
}

export function finish(state: EncounterState): Outcome {
  if (state.phase !== "running") return refuse("The encounter isn't running.");
  return commit(state, (d) => {
    d.phase = "finished";
    d.turn = null;
    d.side = null;
    say(d, `The encounter ends after ${plural(d.round, "round")}.`);
    return null;
  });
}

/** Opens a finished encounter again, in the round it ended. */
export function resume(state: EncounterState): Outcome {
  if (state.phase !== "finished") return refuse("The encounter isn't over.");
  return commit(state, (d) => {
    d.phase = "running";
    if (d.initiativeType === "individual") d.turn = turnOrder(d).find(isActive)?.id ?? null;
    if (d.initiativeType === "group") d.side = d.firstSide ?? "party";
    say(d, "The encounter resumes.");
    return null;
  });
}

// ---------------------------------------------------------------- undo

/** Can the last change be taken back? */
export const canUndo = (state: EncounterState): boolean => state.history.length > 0;

/**
 * Takes back the last change, including the log lines it wrote. The seed and counter are not taken back (so
 * rolling again after an undo gives a new result) and neither are ids already handed out.
 */
export function undo(state: EncounterState): Outcome {
  const last = state.history[state.history.length - 1];
  if (last === undefined) return refuse("There is nothing to undo.");
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(last) as Snapshot;
  } catch {
    return refuse("The last change can't be undone.");
  }
  const read = normalizeEncounterState({
    ...snapshot.state,
    seed: state.seed,
    counter: state.counter,
    nextId: state.nextId,
    log: state.log.filter((e) => e.id <= snapshot.lastLogId),
    history: state.history.slice(0, -1),
  });
  return read.ok ? { ok: true, state: read.state } : refuse("The last change can't be undone.");
}
