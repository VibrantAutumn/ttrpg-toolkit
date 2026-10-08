import type { DiceResult, DieRecord, TermResult } from "../dice/roll";

/** Fate dice faces are written + - 0. */
function faceText(die: DieRecord, fate: boolean): string {
  if (fate) return die.value > 0 ? "+" : die.value < 0 ? "-" : "0";
  return String(die.value);
}

function dieText(die: DieRecord, fate: boolean): string {
  let text = faceText(die, fate);
  if (die.exploded) text += "!";
  if (die.success) text += "✓";
  if (die.rerolledFrom.length > 0) text += ` (was ${die.rerolledFrom.join(", ")})`;
  return die.kept ? text : `(${text})`;
}

function termBody(term: TermResult, fate: boolean): string {
  if (term.kind === "constant") return String(term.value);
  return `[${term.dice.map((d) => dieText(d, fate)).join(", ")}]`;
}

/** Each term of a result written out, e.g. `["[4, 5]", "3"]` for 2d6+3 (no signs). */
export function termTexts(result: DiceResult): string[] {
  const fate = isFate(result);
  return result.terms.map((t) => termBody(t, fate));
}

function isFate(result: DiceResult): boolean {
  // Fate dice are the only ones whose notation has "df" in it.
  return /\d*df/.test(result.notation) || result.notation.startsWith("df");
}

/**
 * A dice result as one readable line, e.g. `4d6kh3 → [(2), 6, 3, 5] = 14`.
 * (Dropped dice are in round brackets, `!` marks an exploded die, `✓` a success.)
 * This is what "copy as text" gives and what a saved roll shows.
 */
export function formatDiceResult(result: DiceResult): string {
  const fate = isFate(result);
  let body = "";
  result.terms.forEach((term, i) => {
    const text = termBody(term, fate);
    if (i === 0) body += term.sign < 0 ? `-${text}` : text;
    else body += ` ${term.sign < 0 ? "-" : "+"} ${text}`;
  });

  let unit = "";
  const only = result.terms.length === 1 ? result.terms[0] : undefined;
  if (only && only.kind === "dice" && only.dice.some((d) => d.success !== undefined)) {
    unit = Math.abs(result.total) === 1 ? " success" : " successes";
  }

  const note = result.capped ? " (stopped early: a roll limit was reached)" : "";
  return `${result.notation} → ${body} = ${result.total}${unit}${note}`;
}
