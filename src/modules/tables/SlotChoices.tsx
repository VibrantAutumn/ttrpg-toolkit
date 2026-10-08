import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { listCollections } from "../../api/cards";
import { listTags, type Item, type Tag } from "../../api/library";
import { listTables, type TableSummary } from "../../api/tables";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { useDataVersion } from "../../state/dataVersion";

/**
 * What a table's page needs to know about the rest of the campaign: the tables
 * and the decks, sets and pools the "Insert slot" menu can offer, and the tags
 * an entry can carry.
 */
interface Choices {
  tables: TableSummary[];
  collections: Item[];
  tags: Tag[];
}

const EMPTY: Choices = { tables: [], collections: [], tags: [] };

const SlotChoicesContext = createContext<Choices>(EMPTY);

/** Loads the choices once for a whole table page (not once per entry). */
export function SlotChoicesProvider({ children }: { children: ReactNode }) {
  const { campaign } = useCurrentCampaign();
  const dataVersion = useDataVersion();
  const campaignId = campaign?.id ?? null;
  const [choices, setChoices] = useState<Choices>(EMPTY);

  useEffect(() => {
    if (!campaignId) {
      setChoices(EMPTY);
      return;
    }
    let active = true;
    Promise.all([listTables(campaignId), listCollections(campaignId), listTags(campaignId)])
      .then(([tables, collections, tags]) => active && setChoices({ tables, collections, tags }))
      .catch(() => active && setChoices(EMPTY)); // the menus just offer nothing
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  return <SlotChoicesContext.Provider value={choices}>{children}</SlotChoicesContext.Provider>;
}

export const useSlotChoices = () => useContext(SlotChoicesContext);
