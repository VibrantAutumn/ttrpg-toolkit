import { useEffect, useState } from "react";
import { installTemplateBundle, listInstalledStarters } from "../../api/starters";
import { toTemplateBundle, type TemplateStarterDef } from "../../lib/templates/starterTemplates";
import { STARTER_TEMPLATES } from "../../starter/templates";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Add starter templates": ready-made templates that come with the app (NPC, Location, Faction,
 * Item, Quest, Session), each with the fields it uses. Adding puts ordinary templates in a
 * Templates folder (all or nothing); after that they are yours to edit, rename or delete. Fields
 * and field sets you already have with the same names are used as they are.
 */
export function StarterTemplates() {
  const { project } = useCurrentProject();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;
  const [installed, setInstalled] = useState<readonly string[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setInstalled([]);
      return;
    }
    let active = true;
    listInstalledStarters(projectId)
      .then((ids) => active && setInstalled(ids))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  async function add(starter: TemplateStarterDef) {
    if (!projectId || working) return;
    setError(null);
    setAdded(null);
    setWorking(starter.id);
    try {
      const result = await installTemplateBundle(projectId, toTemplateBundle(starter));
      bumpDataVersion();
      setAdded(
        `Added ${plural(result.templates, "template")} in a “${starter.name}” folder` +
          (result.fieldsMade > 0 ? `, with ${plural(result.fieldsMade, "new property")} and ${plural(result.setsMade, "property set")}.` : "."),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  }

  if (!projectId) return null;

  return (
    <div className="starter-templates">
      <p className="meta">Ready-made templates that come with the app. They are added as ordinary templates you can edit, rename or delete.</p>
      <ul className="list">
        {STARTER_TEMPLATES.map((starter) => {
          const isInstalled = installed.includes(starter.id);
          return (
            <li key={starter.id} className="row wrap">
              <span className="name">
                <strong>{starter.templates.map((t) => `${t.icon} ${t.name}`).join("  ")}</strong>
                <br />
                <small className="meta">{starter.description}</small>
              </span>
              <button
                type="button"
                onClick={() => void add(starter)}
                disabled={isInstalled || working !== null}
                aria-label={isInstalled ? "Starter templates are already added" : "Add the starter templates"}
              >
                {working === starter.id ? "Adding..." : isInstalled ? "Added ✓" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
      {added && (
        <p className="notice" role="status">
          {added}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
