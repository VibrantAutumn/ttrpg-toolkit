import { createRng } from "../dice/rng";
import type { Rng } from "../dice/rng";
import { rollTable } from "../tables/roll";
import type { PickedEntry, TableRoll, TableWorld } from "../tables/roll";
import { isRowComplete, type GeneratorDef, type GeneratorRow } from "./generator";

/**
 * Running a generator: each row is rolled like a one-entry table, so every slot a table entry can hold
 * works in a row. A row whose slots find nothing (a missing source, an empty collection) rolls the
 * table it names as a fallback, if it names one. Rows are rolled in order from one random stream, so a
 * seed reproduces a run while the tables are unchanged. Pure logic.
 */

export interface GeneratedRow {
  rowId: string;
  label: string;
  /** The roll, or null when the row had nothing to roll or couldn't be rolled (see `message`). */
  roll: TableRoll | null;
  /** True when the row's own slots found nothing and its fallback table was rolled instead. */
  usedFallback: boolean;
  /** A sentence about a row that couldn't be rolled. */
  message?: string;
  /** Text the person typed in the preview instead of the rolled value. */
  override?: string;
}

export interface GeneratorRun {
  seed: number;
  rows: GeneratedRow[];
}

/** What a row shows and what the new document gets. */
export function rowValue(row: GeneratedRow): string {
  return row.override ?? row.roll?.text ?? "";
}

/** Whether the row's slots found nothing: a missing table, deck, collection or tag, or a slot that couldn't be rolled. */
function foundNothing(roll: TableRoll): boolean {
  return roll.parts.some((p) => p.kind === "slot" && (p.outcome.type === "missing" || p.outcome.type === "error"));
}

export function rollRow(row: GeneratorRow, world: TableWorld, rng: Rng): GeneratedRow {
  const base = { rowId: row.id, label: row.label, usedFallback: false };
  if (!isRowComplete(row)) return { ...base, roll: null, message: "Nothing to roll yet." };
  const own = rollTable(
    { id: `generator-row:${row.id}`, name: row.label || "Row", avoidRecent: 0, entries: [{ id: row.id, text: row.source, weight: 1 }] },
    world,
    rng,
  );
  if (!own.ok) return { ...base, roll: null, message: own.message };
  if (foundNothing(own.roll) && row.fallback !== "") {
    const table = world.findTable(row.fallback);
    if (table) {
      const fallback = rollTable(table, world, rng);
      if (fallback.ok) return { ...base, roll: fallback.roll, usedFallback: true };
    }
  }
  return { ...base, roll: own.roll };
}

export function generate(def: GeneratorDef, world: TableWorld, seed: number): GeneratorRun {
  const rng = createRng(seed);
  return { seed, rows: def.rows.map((row) => rollRow(row, world, rng)) };
}

/**
 * Rolls the rows that are not in `keep` again (with a new seed), leaving the kept rows exactly as
 * they are, including anything typed over them. Rows added to the generator since are rolled too.
 */
export function rerollRows(def: GeneratorDef, run: GeneratorRun, keep: ReadonlySet<string>, world: TableWorld, seed: number): GeneratorRun {
  const rng = createRng(seed);
  const before = new Map(run.rows.map((r) => [r.rowId, r]));
  return {
    seed,
    rows: def.rows.map((row) => {
      const kept = before.get(row.id);
      return kept && keep.has(row.id) ? kept : rollRow(row, world, rng);
    }),
  };
}

/** Types over a row's value (or puts the rolled value back with `null`). */
export function setOverride(run: GeneratorRun, rowId: string, text: string | null): GeneratorRun {
  return {
    ...run,
    rows: run.rows.map((r) => {
      if (r.rowId !== rowId) return r;
      const { override: _gone, ...rest } = r;
      void _gone;
      return text === null ? rest : { ...rest, override: text };
    }),
  };
}

/** The table entries the run picked, for "avoid recent". */
export function pickedEntries(run: GeneratorRun): PickedEntry[] {
  return run.rows.flatMap((r) => (r.roll ? r.roll.picked.filter((p) => !p.tableId.startsWith("generator-row:")) : []));
}
