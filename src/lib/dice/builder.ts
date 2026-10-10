/**
 * Helpers behind the roller's die buttons and modifier box. The formula text is the only state:
 * clicking a die edits that text, and the text can also be typed by hand. These functions only
 * read and rewrite plain terms (`2d6`, `+3`); anything else in a formula (`kh3`, `adv`, `>=8`)
 * is left exactly as it was.
 */

import { MAX_FORMULA_LENGTH } from "./formula";

/** The dice on the roller's buttons. */
export const DIE_BUTTONS: readonly number[] = [4, 6, 8, 10, 12, 20, 100];

/** The most dice one formula can hold (the parser's limit). */
const MAX_DICE = 100;

interface Term {
  sign: "+" | "-";
  body: string;
}

/** Splits `2d6 + 1d4 - 1` into signed terms. Spaces around a term are dropped. */
function terms(formula: string): Term[] {
  const found: Term[] = [];
  const pattern = /([+-]?)([^+-]*)/g;
  for (const match of formula.matchAll(pattern)) {
    const body = match[2].trim();
    if (body === "") continue;
    found.push({ sign: match[1] === "-" ? "-" : "+", body });
  }
  return found;
}

function write(list: Term[]): string {
  return list.map((t, i) => (i === 0 ? (t.sign === "-" ? "-" : "") : t.sign) + t.body).join("");
}

const isConstant = (t: Term) => /^\d+$/.test(t.body);

/**
 * Adds one die with `sides` faces: `d6` + a d6 gives `2d6`; a different die is added as a new
 * term (before a trailing constant, so `d6+3` + a d8 gives `d6+d8+3`).
 */
export function addDie(formula: string, sides: number): string {
  const list = terms(formula);
  const same = list.find((t) => {
    const m = /^(\d*)d(\d+)$/i.exec(t.body);
    return t.sign === "+" && m !== null && Number(m[2]) === sides;
  });
  if (same) {
    const m = /^(\d*)d/i.exec(same.body) as RegExpExecArray;
    const count = Math.min(MAX_DICE, (m[1] === "" ? 1 : Number(m[1])) + 1);
    same.body = `${count}d${sides}`;
  } else {
    let at = list.length;
    while (at > 0 && isConstant(list[at - 1])) at--;
    list.splice(at, 0, { sign: "+", body: `d${sides}` });
  }
  const text = write(list);
  return text.length > MAX_FORMULA_LENGTH ? formula : text;
}

/** The modifier of a formula: its plain numbers added up (`d20+5-2` gives 3). */
export function getModifier(formula: string): number {
  return terms(formula)
    .filter(isConstant)
    .reduce((sum, t) => sum + (t.sign === "-" ? -1 : 1) * Number(t.body), 0);
}

/** Replaces the formula's plain numbers with one modifier (0 removes it). */
export function setModifier(formula: string, modifier: number): string {
  const list = terms(formula).filter((t) => !isConstant(t));
  const whole = Math.trunc(modifier);
  if (Number.isFinite(whole) && whole !== 0) list.push({ sign: whole < 0 ? "-" : "+", body: String(Math.abs(whole)) });
  return write(list);
}
