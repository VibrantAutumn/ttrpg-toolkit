import { useEffect, useState } from "react";
import { listProjectRulesets } from "../api/rulesets";
import { readProjectRules, type ProjectRules } from "../lib/rulesets/projectRules";
import { useDataVersion } from "./dataVersion";

/**
 * The rulesets the project uses (its copies), read and kept fresh: they reload when library data changes anywhere
 * (see `state/dataVersion.ts`), so using or dropping a ruleset shows on pages that stay mounted behind it.
 */
export function useProjectRules(projectId: string | null): { rules: ProjectRules[]; loading: boolean } {
  const dataVersion = useDataVersion();
  const [rules, setRules] = useState<ProjectRules[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) {
      setRules([]);
      setLoading(false);
      return;
    }
    let active = true;
    listProjectRulesets(projectId)
      .then((list) => {
        if (!active) return;
        setRules(list.map(readProjectRules).filter((r): r is ProjectRules => r !== null));
      })
      .catch(() => active && setRules([]))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  return { rules, loading };
}
