import { useEffect, useMemo, useState } from "react";
import { getItems, listFolders, listTags, type Folder, type Item, type Tag } from "../../api/library";
import type { FieldDefinition } from "../../lib/fields/definition";
import type { QueryNames } from "../../lib/queries/describe";
import { itemIdsIn, pathLabel } from "../../lib/queries/catalog";
import type { Query } from "../../lib/queries/query";
import { registry } from "../../registry";
import { useDataVersion } from "../../state/dataVersion";
import { useFieldCatalog } from "../../state/fieldCatalog";

/** Everything the query builder offers to choose from, and the names that go with the ids a query holds. */
export interface QueryCatalog {
  tags: Tag[];
  folders: Folder[];
  fields: FieldDefinition[];
  /** Names of the items a query mentions (filled in as they load). */
  itemNames: Map<string, string>;
  names: QueryNames;
}

export function useQueryCatalog(projectId: string, query: Query): QueryCatalog {
  const dataVersion = useDataVersion();
  const { definitions } = useFieldCatalog(projectId);
  const [tags, setTags] = useState<Tag[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [itemNames, setItemNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let active = true;
    listTags(projectId)
      .then((t) => active && setTags(t))
      .catch(() => active && setTags([]));
    Promise.all(registry.getTools().map((tool) => listFolders(projectId, tool.id)))
      .then((lists) => active && setFolders(lists.flat()))
      .catch(() => active && setFolders([]));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  const wanted = itemIdsIn(query).sort().join(",");
  useEffect(() => {
    const missing = wanted === "" ? [] : wanted.split(",").filter((id) => !itemNames.has(id));
    if (missing.length === 0) return;
    let active = true;
    getItems(missing)
      .then((items: Item[]) => {
        if (!active) return;
        setItemNames((prev) => {
          const next = new Map(prev);
          for (const i of items) next.set(i.id, i.name);
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [wanted, itemNames]);

  const names = useMemo<QueryNames>(
    () => ({
      tag: (id) => (tags.some((t) => t.id === id) ? pathLabel(tags, id) : undefined),
      folder: (id) => (folders.some((f) => f.id === id) ? pathLabel(folders, id) : undefined),
      field: (id) => definitions.find((d) => d.id === id)?.name,
      item: (id) => itemNames.get(id),
      choice: (fieldId, optionId) => {
        const def = definitions.find((d) => d.id === fieldId);
        return def?.kind === "dropdown" ? def.config.options.find((o) => o.id === optionId)?.label : undefined;
      },
      itemType: (id) => registry.getItemType(id)?.label ?? id,
      library: (id) => registry.getLibraryLabel(id),
    }),
    [tags, folders, definitions, itemNames],
  );

  return { tags, folders, fields: definitions, itemNames, names };
}
