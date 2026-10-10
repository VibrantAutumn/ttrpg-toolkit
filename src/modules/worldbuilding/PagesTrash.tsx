import { useCallback, useEffect, useState } from "react";
import { emptyTrash, listTrash, type Trash } from "../../api/library";
import { TrashPanel } from "../../components/library/TrashPanel";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";

const LIBRARY = "worldbuilding";

/** Deleted pages, folders, templates and filter sets, with restore and delete forever. */
export function PagesTrash() {
  const { project } = useCurrentProject();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;
  const [trash, setTrash] = useState<Trash>({ folders: [], items: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    listTrash(projectId, LIBRARY)
      .then((t) => active && setTrash(t))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(null);
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  if (!projectId) return <p className="empty">No project is open. Choose one first.</p>;
  return (
    <section>
      <h1>Trash</h1>
      <p className="meta">Pages, folders and templates you deleted. The cards, dice and tables tools keep their own trash.</p>
      {error && <p className="error">{error}</p>}
      <TrashPanel trash={trash} run={run} emptyAll={() => emptyTrash(projectId, LIBRARY)} />
    </section>
  );
}
