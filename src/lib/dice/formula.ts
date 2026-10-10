import { parseDice, type ParseError } from "./parse";

/** Longest formula text that can be saved (the database enforces the same limit). */
export const MAX_FORMULA_LENGTH = 200;

/** A parse error as one sentence for people (positions count from one). */
export function describeParseError(error: ParseError): string {
  return `${error.message} (at character ${error.position + 1})`;
}

export type FormulaCheck = { ok: true; notation: string } | { ok: false; message: string };

/**
 * Checks formula text before it is saved, so a typo can never be stored.
 * The text is kept as typed (outer spaces removed).
 */
export function checkFormula(text: string): FormulaCheck {
  const notation = text.trim();
  if (notation.length > MAX_FORMULA_LENGTH) {
    return { ok: false, message: `A formula can be at most ${MAX_FORMULA_LENGTH} characters long.` };
  }
  const parsed = parseDice(notation);
  if (!parsed.ok) return { ok: false, message: describeParseError(parsed.error) };
  return { ok: true, notation };
}
