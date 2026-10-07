import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type Campaign,
  getCurrentCampaign,
  setCurrentCampaign,
} from "../api/campaigns";

interface CurrentCampaignValue {
  /** The campaign open on this device; null if none is chosen. */
  campaign: Campaign | null;
  /** True until the first load finishes. */
  loading: boolean;
  /** Re-reads it from the database (call after anything that could change it). */
  refresh: () => Promise<void>;
  /** Makes a campaign the open one. */
  open: (id: string) => Promise<void>;
}

const CurrentCampaignContext = createContext<CurrentCampaignValue | null>(null);

export function CurrentCampaignProvider({ children }: { children: ReactNode }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setCampaign(await getCurrentCampaign());
    } catch (e) {
      console.error("Could not load the current campaign", e);
      setCampaign(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const open = useCallback(async (id: string) => {
    setCampaign(await setCurrentCampaign(id));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ campaign, loading, refresh, open }),
    [campaign, loading, refresh, open],
  );

  return (
    <CurrentCampaignContext.Provider value={value}>
      {children}
    </CurrentCampaignContext.Provider>
  );
}

export function useCurrentCampaign(): CurrentCampaignValue {
  const value = useContext(CurrentCampaignContext);
  if (!value) {
    throw new Error("useCurrentCampaign must be used inside CurrentCampaignProvider");
  }
  return value;
}
