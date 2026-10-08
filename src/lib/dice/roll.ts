/**
 * Rolls a parsed dice expression with a random source and records every die,
 * so the UI can show what was kept, dropped, rerolled or exploded.
 *
 * Order of randomness (this matters for reproducing a seeded roll): for each
 * die in turn, its first roll, then its rerolls, then each explosion (which is
 * itself rerolled and may explode again), before the next die is rolled.
 */
import { type Compare, type DiceExpression, type DiceTerm, type ParseError, matchesCompare, parseDice } from "./parse";
import type { Rng } from "./rng";

/** Most extra dice one die can explode into, and most rerolls of one die. */
export const MAX_EXPLOSIONS = 100;
export const MAX_REROLLS = 100;

export interface DieRecord {
  /** Final face (after rerolls). Fate dice are -1, 0 or 1. */
  value: number;
  /** False if keep/drop removed it from the total. */
  kept: boolean;
  /** This die triggered an extra die. */
  exploded: boolean;
  /** This die is an extra die rolled because another exploded. */
  fromExplosion: boolean;
  /** Faces thrown away by rerolls, oldest first. */
  rerolledFrom: number[];
  /** Pools only: whether this die counted as a success. */
  success?: boolean;
}

export interface DiceTermResult {
  kind: "dice";
  sign: 1 | -1;
  dice: DieRecord[];
  /** Signed contribution to the total (sum of kept dice, or success count). */
  subtotal: number;
}

export interface ConstantTermResult {
  kind: "constant";
  sign: 1 | -1;
  value: number;
  subtotal: number;
}

export type TermResult = DiceTermResult | ConstantTermResult;

export interface DiceResult {
  notation: string;
  total: number;
  terms: TermResult[];
  /** True if an explosion or reroll limit stopped the roll early. */
  capped: boolean;
}

export type RollNotationResult = { ok: true; result: DiceResult } | { ok: false; error: ParseError };

export function rollDice(expression: DiceExpression, rng: Rng): DiceResult {
  let capped = false;
  const terms: TermResult[] = expression.terms.map((term) => {
    if (term.kind === "constant") {
      return { kind: "constant", sign: term.sign, value: term.value, subtotal: term.sign * term.value };
    }
    const rolled = rollDiceTerm(term, rng);
    if (rolled.capped) capped = true;
    return rolled.result;
  });
  const total = terms.reduce((sum, t) => sum + t.subtotal, 0);
  return { notation: expression.notation, total, terms, capped };
}

/** Parse and roll in one step. */
export function rollNotation(notation: string, rng: Rng): RollNotationResult {
  const parsed = parseDice(notation);
  if (!parsed.ok) return parsed;
  return { ok: true, result: rollDice(parsed.expression, rng) };
}

function rollDiceTerm(term: DiceTerm, rng: Rng): { result: DiceTermResult; capped: boolean } {
  let capped = false;
  const dice: DieRecord[] = [];
  const draw = (): number => (term.die.type === "fate" ? rng.int(-1, 1) : rng.int(1, term.die.sides));

  /** One die: first roll plus rerolls. */
  const rollOne = (fromExplosion: boolean): DieRecord => {
    const record: DieRecord = {
      value: draw(),
      kept: true,
      exploded: false,
      fromExplosion,
      rerolledFrom: [],
    };
    const reroll = term.reroll;
    if (reroll) {
      while (matchesCompare(reroll, record.value)) {
        const limit = reroll.once ? 1 : MAX_REROLLS;
        if (record.rerolledFrom.length >= limit) {
          if (!reroll.once) capped = true;
          break;
        }
        record.rerolledFrom.push(record.value);
        record.value = draw();
      }
    }
    return record;
  };

  for (let n = 0; n < term.count; n++) {
    let record = rollOne(false);
    dice.push(record);
    const explode = term.explode;
    if (explode) {
      let extras = 0;
      while (matchesCompare(explode, record.value)) {
        if (extras >= MAX_EXPLOSIONS) {
          capped = true;
          break;
        }
        record.exploded = true;
        extras++;
        record = rollOne(true);
        dice.push(record);
      }
    }
  }

  if (term.keep) applyKeep(dice, term.keep);

  const target = term.target;
  if (target) {
    for (const die of dice) die.success = die.kept && matchesCompare(target, die.value);
  }

  const raw = target
    ? dice.filter((d) => d.success).length
    : dice.reduce((sum, d) => (d.kept ? sum + d.value : sum), 0);

  return {
    result: { kind: "dice", sign: term.sign, dice, subtotal: term.sign * raw },
    capped,
  };
}

/** Marks dice as not kept. Ties are settled by roll order (earlier dice rank lower). */
function applyKeep(dice: DieRecord[], keep: NonNullable<DiceTerm["keep"]>): void {
  const lowToHigh = dice
    .map((_, index) => index)
    .sort((a, b) => dice[a].value - dice[b].value || a - b);
  const k = Math.min(keep.count, dice.length);
  const lowest = lowToHigh.slice(0, k);
  const highest = lowToHigh.slice(lowToHigh.length - k);

  let dropped: number[];
  if (keep.mode === "keep") {
    const kept = new Set(keep.end === "highest" ? highest : lowest);
    dropped = lowToHigh.filter((i) => !kept.has(i));
  } else {
    dropped = keep.end === "highest" ? highest : lowest;
  }
  for (const i of dropped) dice[i].kept = false;
}

export type { Compare };
