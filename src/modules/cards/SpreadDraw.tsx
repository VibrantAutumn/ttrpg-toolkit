import { useEffect, useMemo, useState } from "react";
import { listSpreads, type SpreadEntry } from "../../api/cards";
import { createItem } from "../../api/library";
import { LogEntryView } from "../../components/results/LogEntryView";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useRollLog } from "../../state/rollLog";
import { drawSpreadById } from "../../state/spreadActions";
import { SpreadEditor } from "./SpreadEditor";

/** Pick a spread, draw it, or edit it right here (or make a new one). */
export function SpreadDraw() {
  const { project } = useCurrentProject();
  const dataVersion = useDataVersion();
  const log = useRollLog();
  const projectId = project?.id ?? null;
  const [spreads, setSpreads] = useState<SpreadEntry[]>([]);
  const [chosenId, setChosenId] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setSpreads([]);
      return;
    }
    let active = true;
    listSpreads(projectId)
      .then((list) => active && setSpreads(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  const chosen = spreads.find((s) => s.itemId === chosenId) ?? spreads[0];
  const latest = useMemo(
    () => (chosen ? log.find((e) => e.kind === "draw" && e.spreadId === chosen.itemId) : undefined),
    [log, chosen],
  );
  if (!projectId) return null;

  async function draw(id: string) {
    const outcome = await drawSpreadById(id);
    setError(outcome.ok ? null : outcome.message);
    if (!outcome.ok) bumpDataVersion();
  }

  async function makeSpread() {
    if (!projectId) return;
    try {
      const made = await createItem(projectId, "cards", "spread", "New spread", null);
      setChosenId(made.id);
      setEditing(true);
      setError(null);
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <h2>Spread</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {spreads.length === 0 ? (
        <p className="empty">No spreads yet. A spread draws one card for each of several named positions.</p>
      ) : (
        <div className="row wrap">
          <select
            value={chosen?.itemId ?? ""}
            onChange={(e) => {
              setChosenId(e.currentTarget.value);
              setEditing(false);
            }}
            aria-label="Spread"
          >
            {spreads.map((s) => (
              <option key={s.itemId} value={s.itemId}>
                📜 {s.name} ({s.positions} positions{s.ready ? "" : ", needs finishing"})
              </option>
            ))}
          </select>
          {chosen && (
            <>
              <button
                onClick={() => void draw(chosen.itemId)}
                disabled={!chosen.ready || editing}
                title={chosen.ready ? "Draw every position" : "Edit it to finish its positions"}
              >
                Draw spread
              </button>
              <button onClick={() => setEditing((on) => !on)} aria-pressed={editing}>
                {editing ? "Done editing" : "Edit spread"}
              </button>
            </>
          )}
        </div>
      )}
      <div className="row">
        <button onClick={() => void makeSpread()}>New spread</button>
      </div>
      {editing && chosen ? (
        <SpreadEditor key={chosen.itemId} itemId={chosen.itemId} />
      ) : (
        latest && (
          <ul className="list">
            <LogEntryView key={latest.id} entry={latest} />
          </ul>
        )
      )}
    </div>
  );
}
