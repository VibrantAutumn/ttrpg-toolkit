import { listTags } from "../api/library";
import { addTableEntries, loadRollableTables } from "../api/tables";
import { buildGenerator, type NameSetup } from "../lib/tables/nameSetup";
import type { NameLogOutcome } from "../lib/results/rollLog";
import { bumpDataVersion } from "./dataVersion";
import { rollLog } from "./rollLog";

/**
 * Makes a name from a setup and logs it. Reads the tables and tags fresh from
 * the database, so the name always reflects the lists as they are right now.
 * `label` is what the result is called (a preset's name), if the setup has one.
 * Used by the Names tab, the quick tools panel and presets, so they always agree.
 */
export async function generateNameFromSetup(
  campaignId: string,
  setup: NameSetup,
  label: string | null = null,
): Promise<NameLogOutcome> {
  try {
    const [tables, tags] = await Promise.all([loadRollableTables(campaignId), listTags(campaignId)]);
    const built = buildGenerator(
      setup,
      tables.map((t) => ({ id: t.id, name: t.name, entries: t.entries })),
      tags.map((t) => ({ id: t.id, name: t.name, parentId: t.parentId })),
    );
    if (!built.ok) return built;
    return rollLog.generateName(built.generator, undefined, label);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Adds a generated name to the end of a table, as a new entry. Throws with a readable message if it can't. */
export async function saveNameToTable(tableId: string, name: string): Promise<void> {
  await addTableEntries(tableId, [{ text: name }]);
  bumpDataVersion(); // table lists and open table pages show the new entry
}
