import { listFieldDefinitions, listFieldValues } from "../api/fields";
import { getItems, listItemsOfType, listTags, type Item } from "../api/library";
import { runQuery, runSmartCollection } from "../api/queries";
import { formatValue } from "../lib/fields/value";
import { neededEntityNames, neededFieldNames, type EntityData, type LoadedField } from "../lib/tables/entities";
import type { EntitySource } from "../lib/tables/roll";
import { contextQuery, narrowItems } from "../lib/tables/rollContext";
import type { Query } from "../lib/queries/query";
import { emptyQuery } from "../lib/queries/query";
import { getRollContext } from "./rollContext";

const key = (name: string) => name.trim().toLowerCase();

/** The items an entity slot can pick: not the smart collections themselves (an "everything" collection finds those too). */
const pickable = (items: Item[]) => items.filter((i) => i.itemType !== "smart_collection");

function tagQuery(tagId: string): Query {
  const q = emptyQuery();
  return { ...q, where: { op: "all", not: false, rules: [{ kind: "tag", tagId, subtags: true, not: false }] } };
}

/**
 * Loads what entity slots need for a roll, fresh from the database: for each name an entity slot may refer
 * to, the items of the smart collection with that name (else those carrying the tag with that name),
 * narrowed by the roll context; and the values of the fields that `[A.Field]` references use.
 * Returns undefined when no slot needs documents, so ordinary rolls cost nothing extra.
 */
export async function loadEntityData(
  campaignId: string,
  tables: readonly { name: string; entries: readonly { text: string }[] }[],
): Promise<EntityData | undefined> {
  const names = neededEntityNames(tables);
  if (names.length === 0) return undefined;

  const [collections, tags] = await Promise.all([listItemsOfType(campaignId, "worldbuilding", "smart_collection"), listTags(campaignId)]);
  const contextTags = getRollContext(campaignId);
  const query = contextQuery(contextTags);
  const allowed = query ? new Set((await runQuery(campaignId, query)).items.map((i) => i.id)) : null;

  const sources: EntitySource[] = [];
  for (const name of names) {
    const collection = collections.find((c) => key(c.name) === key(name));
    const tag = collection ? undefined : tags.find((t) => key(t.name) === key(name));
    if (!collection && !tag) continue;
    const found = collection ? await runSmartCollection(collection.id) : await runQuery(campaignId, tagQuery((tag as { id: string }).id));
    const items = narrowItems(pickable(found.items), allowed);
    sources.push({ name, kind: collection ? "collection" : "tag", items: items.map((i) => ({ id: i.id, name: i.name })) });
  }

  const fields = await loadFields(campaignId, tables, sources);
  return { sources, fields };
}

async function loadFields(
  campaignId: string,
  tables: readonly { name: string; entries: readonly { text: string }[] }[],
  sources: readonly EntitySource[],
): Promise<LoadedField[]> {
  const fieldNames = neededFieldNames(tables);
  if (fieldNames.length === 0) return [];
  const wanted = new Set(sources.flatMap((s) => s.items.map((i) => i.id)));
  const definitions = await listFieldDefinitions(campaignId);
  const loaded: { name: string; kind: string; values: Map<string, unknown> }[] = [];
  const linked = new Set<string>();
  for (const name of fieldNames) {
    const def = definitions.find((d) => key(d.name) === key(name));
    if (!def) continue;
    const all = await listFieldValues(def);
    const values = new Map<string, unknown>();
    for (const [itemId, value] of all) {
      if (!wanted.has(itemId)) continue;
      values.set(itemId, value);
      if (def.kind === "link") (value as string[]).forEach((id) => linked.add(id));
    }
    loaded.push({ name, kind: def.kind, values });
  }
  const linkNames = new Map<string, string>();
  if (linked.size > 0) for (const i of await getItems([...linked])) linkNames.set(i.id, i.name);

  return loaded.map(({ name, values }) => {
    const def = definitions.find((d) => key(d.name) === key(name));
    const text = new Map<string, string>();
    if (def) {
      for (const [itemId, value] of values) {
        const shown = formatValue(def, value as never, { itemName: (id) => linkNames.get(id) });
        if (shown !== "") text.set(itemId, shown);
      }
    }
    return { name, text };
  });
}
