import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { listCollections } from "../../api/cards";
import { listFieldDefinitions } from "../../api/fields";
import { listItemsOfType, listTags, type Item, type Tag } from "../../api/library";
import { listTables, type TableSummary } from "../../api/tables";
import { useCurrentProject } from "../../state/CurrentProject";
import { useDataVersion } from "../../state/dataVersion";

/**
 * What a table's page needs to know about the rest of the project: the tables
 * and the decks, sets and pools the "Insert slot" menu can offer, and the tags
 * an entry can carry.
 */
interface Choices {
  tables: TableSummary[];
  collections: Item[];
  tags: Tag[];
  /** Smart collections (entity slots can pick from them). */
  smart: Item[];
  /** Names of the project's fields (`[A.Field]` can read them). */
  fieldNames: string[];
}

const EMPTY: Choices = { tables: [], collections: [], tags: [], smart: [], fieldNames: [] };

const SlotChoicesContext = createContext<Choices>(EMPTY);

/** Loads the choices once for a whole table page (not once per entry). */
export function SlotChoicesProvider({ children }: { children: ReactNode }) {
  const { project } = useCurrentProject();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;
  const [choices, setChoices] = useState<Choices>(EMPTY);

  useEffect(() => {
    if (!projectId) {
      setChoices(EMPTY);
      return;
    }
    let active = true;
    Promise.all([
      listTables(projectId),
      listCollections(projectId),
      listTags(projectId),
      listItemsOfType(projectId, "worldbuilding", "smart_collection"),
      listFieldDefinitions(projectId),
    ])
      .then(([tables, collections, tags, smart, defs]) => active && setChoices({ tables, collections, tags, smart, fieldNames: defs.map((d) => d.name) }))
      .catch(() => active && setChoices(EMPTY)); // the menus just offer nothing
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  return <SlotChoicesContext.Provider value={choices}>{children}</SlotChoicesContext.Provider>;
}

export const useSlotChoices = () => useContext(SlotChoicesContext);
