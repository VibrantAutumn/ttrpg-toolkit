import { useEffect, useState } from "react";
import { listTags, type Tag } from "../../api/library";
import { toggleContextTag } from "../../lib/tables/rollContext";
import { useCurrentProject } from "../../state/CurrentProject";
import { useDataVersion } from "../../state/dataVersion";
import { setRollContext, useRollContext } from "../../state/rollContext";

/**
 * "Only documents tagged...": limits what entity slots (`[Person]`) may pick in every roll on this device.
 * An item has to carry every chosen tag. Hidden behind a toggle until used, so ordinary rolls stay simple.
 */
export function RollContextBar() {
  const { project } = useCurrentProject();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;
  const chosen = useRollContext(projectId);
  const [tags, setTags] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setTags([]);
      return;
    }
    let active = true;
    listTags(projectId)
      .then((t) => active && setTags(t))
      .catch(() => active && setTags([]));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  if (!projectId || tags.length === 0) return null;
  const names = chosen.map((id) => tags.find((t) => t.id === id)?.name).filter((n): n is string => n !== undefined);

  return (
    <div className="roll-context">
      <div className="row wrap">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          Roll context: {names.length === 0 ? "none" : names.join(" + ")}
        </button>
        {names.length > 0 && (
          <button type="button" onClick={() => setRollContext(projectId, [])}>
            Clear
          </button>
        )}
      </div>
      {open && (
        <>
          <p className="meta">Documents picked by slots like [Person] must carry every tag chosen here.</p>
          <div className="chips">
            {tags.map((t) => {
              const on = chosen.includes(t.id);
              return (
                <button key={t.id} type="button" className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => setRollContext(projectId, toggleContextTag(chosen, t.id))}>
                  {t.name}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
