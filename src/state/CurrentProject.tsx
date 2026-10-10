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
  type Project,
  getCurrentProject,
  setCurrentProject,
} from "../api/projects";

interface CurrentProjectValue {
  /** The project open on this device; null if none is chosen. */
  project: Project | null;
  /** True until the first load finishes. */
  loading: boolean;
  /** Re-reads it from the database (call after anything that could change it). */
  refresh: () => Promise<void>;
  /** Makes a project the open one. */
  open: (id: string) => Promise<void>;
}

const CurrentProjectContext = createContext<CurrentProjectValue | null>(null);

export function CurrentProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setProject(await getCurrentProject());
    } catch (e) {
      console.error("Could not load the current project", e);
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const open = useCallback(async (id: string) => {
    setProject(await setCurrentProject(id));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ project, loading, refresh, open }),
    [project, loading, refresh, open],
  );

  return (
    <CurrentProjectContext.Provider value={value}>
      {children}
    </CurrentProjectContext.Provider>
  );
}

export function useCurrentProject(): CurrentProjectValue {
  const value = useContext(CurrentProjectContext);
  if (!value) {
    throw new Error("useCurrentProject must be used inside CurrentProjectProvider");
  }
  return value;
}
