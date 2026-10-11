import { useEffect, useState } from "react";
import { setGeneratorDefinition } from "../../api/generators";
import { createItem, deleteItem, listItemsOfType } from "../../api/library";
import { toDefinition, type StarterGeneratorDef } from "../../lib/generators/starterGenerators";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { STARTER_GENERATORS } from "../../starter/generators";

const key = (text: string) => text.trim().toLowerCase();

async function install(projectId: string, starter: StarterGeneratorDef): Promise<void> {
  const item = await createItem(projectId, "tables", "generator", starter.name, null);
  try {
    await setGeneratorDefinition(item.id, toDefinition(starter));
  } catch (e) {
    await deleteItem(item.id).catch(() => undefined); // don't leave an empty generator behind
    throw e;
  }
}

/** "Add starter generators": a Quick NPC and an Adventure hook that roll the starter tables. They become ordinary generators. */
export function StarterGenerators() {
  const { project } = useCurrentProject();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;
  const [existing, setExisting] = useState<ReadonlySet<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setExisting(new Set());
      return;
    }
    let active = true;
    listItemsOfType(projectId, "tables", "generator")
      .then((list) => active && setExisting(new Set(list.map((g) => key(g.name)))))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  if (!projectId) return null;

  async function add(starter: StarterGeneratorDef) {
    if (!projectId) return;
    setWorking(starter.name);
    try {
      await install(projectId, starter);
      setMessage(`Added “${starter.name}”. It rolls the starter tables, so add those too if you haven't.`);
      setError(null);
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(null);
    }
  }

  return (
    <details className="starter-generators">
      <summary>Add starter generators</summary>
      <p className="meta">Ready-made generators. They roll the starter tables (Fantasy names, NPC quirks and rumors).</p>
      {error && <p className="error">{error}</p>}
      {message && <p className="meta">{message}</p>}
      <ul className="list">
        {STARTER_GENERATORS.map((g) => {
          const have = existing.has(key(g.name));
          return (
            <li key={g.name} className="row wrap">
              <span className="name">
                <strong>{g.name}</strong> <small className="meta">{g.description}</small>
              </span>
              <button type="button" disabled={have || working !== null} onClick={() => void add(g)}>
                {have ? "Already added" : working === g.name ? "Adding..." : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
