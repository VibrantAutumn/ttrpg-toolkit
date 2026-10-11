import { createRng } from "../dice/rng";
import { pickedItemsOf, rerollTable, rollTable } from "../tables/roll";
import type { PickedEntry, RollableTable, TableRoll, TableWorld } from "../tables/roll";
import { isComplete, type GeneratorDef } from "./generator";

/**
 * Running a generator: its text is rolled like a one-entry table, so every slot a table entry can hold
 * works. One seed reproduces a run while the tables are unchanged. Pure logic.
 */

export const GENERATOR_TABLE_PREFIX = "generator:";

export interface GeneratorRun {
  seed: number;
  roll: TableRoll;
}

export type RunResult = { ok: true; run: GeneratorRun } | { ok: false; message: string };

/** The generator's text as a table of one entry (also what the caller loads decks and documents for). */
export function asTable(def: GeneratorDef, name: string): RollableTable {
  return { id: `${GENERATOR_TABLE_PREFIX}${name}`, name: name || "Generator", avoidRecent: 0, entries: [{ id: "text", text: def.text, weight: 1 }] };
}

export function generate(def: GeneratorDef, name: string, world: TableWorld, seed: number): RunResult {
  if (!isComplete(def)) return { ok: false, message: "Write something to roll first." };
  const rolled = rollTable(asTable(def, name), world, createRng(seed));
  return rolled.ok ? { ok: true, run: { seed, roll: rolled.roll } } : rolled;
}

/** Rolls the slots that are not locked again (by their place in the text), keeping the rest. */
export function reroll(run: GeneratorRun, locked: ReadonlySet<number>, world: TableWorld, seed: number): RunResult {
  const rolled = rerollTable(run.roll, locked, world, createRng(seed));
  return rolled.ok ? { ok: true, run: { seed, roll: rolled.roll } } : rolled;
}

/** The slots of a run that can be locked (references can't). */
export function lockableSlots(run: GeneratorRun): { index: number; text: string }[] {
  return run.roll.parts.flatMap((part, index) => (part.kind === "slot" && part.slot.type !== "ref" ? [{ index, text: part.text }] : []));
}

/** The table entries the run picked, for "avoid recent" (the generator's own text is not one). */
export function pickedEntries(run: GeneratorRun): PickedEntry[] {
  return run.roll.picked.filter((p) => !p.tableId.startsWith(GENERATOR_TABLE_PREFIX));
}

/** The documents the run picked with entity slots, in order. */
export function pickedDocuments(run: GeneratorRun): { id: string; name: string }[] {
  return pickedItemsOf(run.roll.parts);
}
