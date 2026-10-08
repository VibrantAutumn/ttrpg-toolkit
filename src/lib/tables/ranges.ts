/**
 * Entry weights and the number ranges they make. A table entry has a weight
 * (how many places it takes up in the roll); its range is worked out from the
 * weights in order, like a printed d100 table: weights 1, 3, 2 give 1, 2-4, 5-6.
 * Pure logic, no randomness.
 */

/** Must match the Rust limit (`MAX_WEIGHT` in `db/tables.rs`). */
export const MAX_WEIGHT = 10_000;

export interface EntryRange {
  start: number;
  end: number;
}

/** The range each entry covers, in order; null for an entry that is never picked (weight 0). */
export function entryRanges(weights: readonly number[]): (EntryRange | null)[] {
  let next = 1;
  return weights.map((w) => {
    if (w <= 0) return null;
    const range = { start: next, end: next + w - 1 };
    next += w;
    return range;
  });
}

/** `4`, `11–30`, or `—` for an entry that is never picked. */
export function formatRange(range: EntryRange | null): string {
  if (!range) return "—";
  return range.start === range.end ? String(range.start) : `${range.start}–${range.end}`;
}

export type WeightInput = { ok: true; weight: number } | { ok: false; message: string };

const NOT_A_WEIGHT = "Type a whole number (like 3) or a range (like 11–30).";

/**
 * Reads what is typed in an entry's weight box: a whole number is the weight,
 * and a range like `11-30` means the entry is that wide (20). Where the entry
 * actually sits comes from the order of the entries, not from the typed numbers.
 */
export function parseWeightInput(text: string): WeightInput {
  const t = text.trim();
  const tooBig = { ok: false, message: `A weight can be at most ${MAX_WEIGHT.toLocaleString("en-US")}.` } as const;

  const single = /^\d+$/.exec(t);
  if (single) {
    const weight = Number(single[0]);
    return weight > MAX_WEIGHT ? tooBig : { ok: true, weight };
  }
  const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(t);
  if (range) {
    const [from, to] = [Number(range[1]), Number(range[2])];
    if (to < from) return { ok: false, message: "A range has to start at the lower number, like 11–30." };
    const weight = to - from + 1;
    return weight > MAX_WEIGHT ? tooBig : { ok: true, weight };
  }
  return { ok: false, message: NOT_A_WEIGHT };
}

/**
 * A note for a table that has a die size (d20, d100...) when its entries don't
 * add up to exactly that, or null when all is well. The roll always uses the
 * entries' total, so this is only a heads-up for tables copied from a book.
 */
export function rangeNote(totalWeight: number, dieSize: number | null): string | null {
  if (dieSize === null || totalWeight === dieSize) return null;
  if (totalWeight === 0) return `No entries cover the d${dieSize} yet.`;
  if (totalWeight > dieSize) {
    return `The entries add up to ${totalWeight}, more than the d${dieSize} has.`;
  }
  const first = totalWeight + 1;
  return first === dieSize
    ? `The entries cover 1–${totalWeight} of the d${dieSize}; ${dieSize} has no entry.`
    : `The entries cover 1–${totalWeight} of the d${dieSize}; ${first}–${dieSize} have no entry.`;
}
