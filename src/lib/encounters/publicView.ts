import { combatantName, healthDescription, isActive, SIDE_LABELS, turnOrder, type Combatant, type EncounterState, type Phase, type Side } from "./state";

/**
 * What the player display may show of an encounter. **Secrets are never in it**: combatants marked hidden are left out
 * altogether, GM notes and status notes are never copied, a foe's health is a word (or nothing) and never a number, and
 * a foe's initiative result is not shown. The display only ever receives this value, never the encounter itself, so
 * nothing secret can leak by a screen forgetting to hide it.
 */
export interface PublicStatus {
  name: string;
  color: string | null;
}

export interface PublicCombatant {
  name: string;
  side: Side;
  /** It is this combatant's turn (individual and popcorn). */
  current: boolean;
  /** It has acted this round. */
  acted: boolean;
  defeated: boolean;
  /** "12 / 20" for the party, a word like "Bloodied" for a foe, or null when it isn't shown. */
  health: string | null;
  statuses: PublicStatus[];
}

export interface PublicView {
  /** The encounter's name. */
  title: string;
  phase: Phase;
  round: number;
  /** Group initiative: whose turn it is. */
  side: Side | null;
  sideLabel: string | null;
  combatants: PublicCombatant[];
}

function publicCombatant(state: EncounterState, c: Combatant): PublicCombatant {
  let health: string | null = null;
  if (c.health) {
    if (c.side === "party") health = `${c.health.current} / ${c.health.max}`;
    else if (state.foeHealth === "description") health = healthDescription(c.health);
  }
  return {
    name: combatantName(c),
    side: c.side,
    current: state.turn === c.id,
    acted: state.acted.includes(c.id),
    defeated: c.defeated,
    health,
    statuses: c.statuses.map((s) => ({ name: s.name, color: s.color })),
  };
}

/** The player display's view of an encounter, in the order the display lists it. */
export function publicView(state: EncounterState, title: string): PublicView {
  const visible = (c: Combatant) => !c.hidden;
  let ordered: Combatant[];
  if (state.initiativeType === "individual") {
    // Defeated combatants drop to the bottom, in order.
    const order = turnOrder(state).filter(visible);
    ordered = [...order.filter(isActive), ...order.filter((c) => !isActive(c))];
  } else if (state.initiativeType === "group") {
    const first: Side = state.side ?? state.firstSide ?? "party";
    const sides: Side[] = [first, first === "party" ? "foes" : "party"];
    ordered = sides.flatMap((s) => state.combatants.filter((c) => visible(c) && c.side === s));
  } else {
    ordered = state.combatants.filter(visible);
  }
  const showSide = state.initiativeType === "group" && state.phase === "running" ? state.side : null;
  return {
    title,
    phase: state.phase,
    round: state.round,
    side: showSide,
    sideLabel: showSide ? SIDE_LABELS[showSide] : null,
    combatants: ordered.map((c) => publicCombatant(state, c)),
  };
}
