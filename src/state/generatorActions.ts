import { createItem, setDocumentBody, type Item } from "../api/library";
import { recordTableRecent } from "../api/tables";
import { newSeed } from "../lib/dice/rng";
import { outputPage } from "../lib/generators/document";
import type { GeneratorDef } from "../lib/generators/generator";
import { asTable, generate, pickedEntries, reroll, type GeneratorRun, type RunResult } from "../lib/generators/run";
import { bumpDataVersion } from "./dataVersion";
import { loadTableWorld } from "./tableActions";

function failure(e: unknown): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : String(e) };
}

/** Rolls the generator, reading the tables and documents fresh, and remembers the entries picked ("avoid recent"). */
export async function runGenerator(projectId: string, def: GeneratorDef, name: string): Promise<RunResult> {
  try {
    const { world } = await loadTableWorld(projectId, [asTable(def, name)]);
    const result = generate(def, name, world, newSeed());
    if (result.ok) await recordTableRecent(pickedEntries(result.run));
    return result;
  } catch (e) {
    return failure(e);
  }
}

/** Rolls the slots that aren't locked again, keeping the rest. */
export async function rerollGenerator(projectId: string, def: GeneratorDef, name: string, run: GeneratorRun, locked: ReadonlySet<number>): Promise<RunResult> {
  try {
    const { world } = await loadTableWorld(projectId, [asTable(def, name)]);
    const result = reroll(run, locked, world, newSeed());
    if (result.ok) await recordTableRecent(pickedEntries(result.run));
    return result;
  } catch (e) {
    return failure(e);
  }
}

export type SaveResult = { ok: true; item: Item } | { ok: false; message: string };

/**
 * Saves the output as a plain page (no folder), with a link to every document it picked. Only ever
 * done when the person asks; a generator never makes pages by itself.
 */
export async function saveOutput(projectId: string, run: GeneratorRun, generatorName: string): Promise<SaveResult> {
  let item: Item | null = null;
  try {
    const page = outputPage(run, generatorName);
    item = await createItem(projectId, "worldbuilding", "document", page.name, null);
    await setDocumentBody(item.id, page.markdown, page.mentions);
    bumpDataVersion();
    return { ok: true, item };
  } catch (e) {
    bumpDataVersion();
    const reason = e instanceof Error ? e.message : String(e);
    return { ok: false, message: item ? `The page “${item.name}” was made, but its text could not be saved: ${reason}` : reason };
  }
}
