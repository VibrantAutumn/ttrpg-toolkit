import { useCallback, useEffect, useState } from "react";
import { listFieldDefinitions, listFieldSets } from "../api/fields";
import type { FieldDefinition } from "../lib/fields/definition";
import type { FieldSet } from "../lib/fields/fieldSets";
import { useDataVersion } from "./dataVersion";

export interface FieldCatalog {
  definitions: FieldDefinition[];
  sets: FieldSet[];
  /** True until the first load finishes. */
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * The campaign's fields and field sets, kept fresh: they reload when library data changes
 * anywhere (see `state/dataVersion.ts`), so an edit in the Fields tab shows on item pages that
 * stay mounted behind it.
 */
export function useFieldCatalog(campaignId: string | null): FieldCatalog {
  const dataVersion = useDataVersion();
  const [definitions, setDefinitions] = useState<FieldDefinition[]>([]);
  const [sets, setSets] = useState<FieldSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(0);

  useEffect(() => {
    if (!campaignId) {
      setDefinitions([]);
      setSets([]);
      setLoading(false);
      return;
    }
    let active = true;
    Promise.all([listFieldDefinitions(campaignId), listFieldSets(campaignId)])
      .then(([d, s]) => {
        if (!active) return;
        setDefinitions(d);
        setSets(s);
        setError(null);
      })
      .catch((e) => active && setError(String(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion, manual]);

  const reload = useCallback(async () => setManual((n) => n + 1), []);
  return { definitions, sets, loading, error, reload };
}
