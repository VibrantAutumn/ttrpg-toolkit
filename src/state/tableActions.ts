import { listCollections, resolveCollectionCards } from "../api/cards";
import { getItem, getItems } from "../api/library";
import { loadRollableTables, recordTableRecent } from "../api/tables";
import type { TableWorld, RollableDeck, RollableTable } from "../lib/tables/roll";
import { rememberLinkNames } from "../lib/tables/linkNames";
import { buildWorld, linkIdsIn, neededDeckNames } from "../lib/tables/world";
import { loadEntityData } from "./entityWorld";
import type { TableLogOutcome } from "../lib/results/rollLog";
import { rollLog } from "./rollLog";

const key = (name: string) => name.trim().toLowerCase();

/**
 * Loads what a roll needs, fresh from the database: every table in the project
 * with its recent picks, the cards of the decks, sets and pools that any
 * entry draws from (only those, so a big card library isn't loaded for nothing), and the
 * documents that entity slots may pick (narrowed by the roll context).
 */
export async function loadTableWorld(projectId: string, extra: readonly RollableTable[] = []) {
  const tables = await loadRollableTables(projectId);
  // `extra` is text that is rolled but isn't a stored table (a generator): its decks and documents are loaded too.
  const needed = [...tables, ...extra];
  const names = neededDeckNames(needed);
  let decks: RollableDeck[] = [];
  if (names.length > 0) {
    const wanted = new Set(names.map(key));
    const sources = (await listCollections(projectId)).filter((c) => wanted.has(key(c.name)));
    decks = await Promise.all(
      sources.map(async (c) => ({
        id: c.id,
        name: c.name,
        cards: (await resolveCollectionCards(c.id)).map((card) => ({ id: card.id, name: card.name })),
      })),
    );
  }
  // Linked pages are shown by their name now, so a rename is followed (a missing or trashed page keeps the name it was linked with).
  const linkIds = linkIdsIn(needed.flatMap((t) => t.entries.map((e) => e.text)));
  const linkNames = new Map<string, string>();
  if (linkIds.length > 0) {
    for (const item of await getItems(linkIds)) if (item.deletedAt === null) linkNames.set(item.id.toLowerCase(), item.name);
    rememberLinkNames(linkNames);
  }
  const world: TableWorld = buildWorld(tables, decks, await loadEntityData(projectId, needed), linkNames);
  return { tables, world };
}

function failure(e: unknown): { ok: false; message: string } {
  return { ok: false, message: e instanceof Error ? e.message : String(e) };
}

/**
 * Rolls a table and logs the result, then remembers the entries it picked for
 * "avoid recent". Used by the table's page, the Generators tab, the quick tools
 * panel and "Roll again" in the roll log, so they always agree.
 */
export async function rollTableById(tableId: string): Promise<TableLogOutcome> {
  try {
    const item = await getItem(tableId);
    if (item.deletedAt !== null) return { ok: false, message: `“${item.name}” is in the trash.` };
    const { tables, world } = await loadTableWorld(item.projectId);
    const table = tables.find((t) => t.id === tableId);
    if (!table) return { ok: false, message: `“${item.name}” isn't available any more.` };
    const outcome = rollLog.rollTable(table, world);
    if (outcome.ok) await recordTableRecent(outcome.entry.roll.picked);
    return outcome;
  } catch (e) {
    return failure(e);
  }
}

/**
 * Rerolls the unlocked slots of a result in the roll log (as a new entry) and
 * remembers the new picks. Works even if the table was edited or deleted since,
 * because the result keeps the entry text it was rolled from.
 */
export async function rerollTableResult(
  logEntryId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { world } = await loadTableWorld(projectId);
    const entry = rollLog.rerollTable(logEntryId, world);
    if (!entry) return { ok: false, message: "That result can't be rerolled." };
    await recordTableRecent(entry.roll.picked);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
