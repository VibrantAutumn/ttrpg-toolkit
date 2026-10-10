import { useEffect, useMemo, useState } from "react";
import { addToCollection, listCollections } from "../../api/cards";
import { createItem, listItemsOfType, type Item } from "../../api/library";
import { useCurrentProject } from "../../state/CurrentProject";
import { resolveCustomPool } from "../../state/customPool";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { FILTER_SET_LIBRARY, FILTER_SET_TYPE } from "../worldbuilding/filterSets";
import { DrawPanel } from "./DrawPanel";
import { cardTypeIcon } from "./icons";

const CUSTOM = "__custom";
/** Cards in the ready-made first draw. */
const FIRST_DRAW_COUNT = 3;

/**
 * Draw cards. The pool is a saved set, deck or pool (the first one is chosen already, so one tap
 * draws three cards) or a **custom pool** built on the spot by ticking sets, decks, pools and filter
 * sets, which can be saved as a real pool.
 */
export function PoolDraw() {
  const { project } = useCurrentProject();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;
  const [sources, setSources] = useState<Item[]>([]);
  const [filterSets, setFilterSets] = useState<Item[]>([]);
  const [chosenId, setChosenId] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const [poolName, setPoolName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setSources([]);
      setFilterSets([]);
      return;
    }
    let active = true;
    Promise.all([listCollections(projectId), listItemsOfType(projectId, FILTER_SET_LIBRARY, FILTER_SET_TYPE)])
      .then(([list, sets]) => {
        if (!active) return;
        setSources(list);
        setFilterSets(sets);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  const custom = chosenId === CUSTOM;
  const chosen = custom ? undefined : (sources.find((s) => s.id === chosenId) ?? sources[0]);
  // Ticked things that were deleted meanwhile drop out.
  const everything = useMemo(() => [...sources, ...filterSets], [sources, filterSets]);
  const liveTicked = ticked.filter((id) => everything.some((s) => s.id === id));
  const tickedKey = liveTicked.join(",");

  if (!projectId) return <p className="empty">No project is open. Choose one from the project name at the top of the sidebar.</p>;

  const toggle = (id: string) => setTicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  async function saveAsPool() {
    if (!projectId || liveTicked.length === 0) return;
    try {
      const pool = await createItem(projectId, "cards", "pool", poolName.trim() || "Custom pool", null);
      for (const id of liveTicked) await addToCollection(pool.id, id);
      setChosenId(pool.id);
      setPoolName("");
      setError(null);
      setNote(`Saved as the pool “${pool.name}”.`);
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      {error && <p className="error" role="alert">{error}</p>}
      {sources.length === 0 && !custom && (
        <p className="empty">
          Nothing to draw from yet. Add the starter decks in the Library tab, or make a pool, deck or set and add some cards to
          it.
        </p>
      )}
      <label className="field">
        <span>Pool</span>
        <select
          value={custom ? CUSTOM : (chosen?.id ?? "")}
          onChange={(e) => {
            setChosenId(e.currentTarget.value);
            setNote(null);
          }}
          aria-label="Pool to draw from"
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {cardTypeIcon(s.itemType)} {s.name} ({s.itemType})
            </option>
          ))}
          <option value={CUSTOM}>Custom pool…</option>
        </select>
      </label>
      {note && <p className="meta">{note}</p>}

      {custom && (
        <div className="custom-pool">
          <p className="meta">Tick what to draw from. Cards in more than one of them count once.</p>
          {everything.length === 0 ? (
            <p className="empty">No sets, decks, pools or filter sets yet.</p>
          ) : (
            <ul className="list">
              {everything.map((s) => (
                <li key={s.id}>
                  <label>
                    <input type="checkbox" checked={liveTicked.includes(s.id)} onChange={() => toggle(s.id)} />{" "}
                    {s.itemType === FILTER_SET_TYPE ? "🔎" : cardTypeIcon(s.itemType)} {s.name}{" "}
                    <small className="meta">{s.itemType === FILTER_SET_TYPE ? "filter set" : s.itemType}</small>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <form
            className="row wrap"
            onSubmit={(e) => {
              e.preventDefault();
              void saveAsPool();
            }}
          >
            <input
              value={poolName}
              onChange={(e) => setPoolName(e.currentTarget.value)}
              placeholder="Name for a saved pool"
              aria-label="Name for the saved pool"
            />
            <button type="submit" disabled={liveTicked.length === 0}>
              Save as pool
            </button>
          </form>
        </div>
      )}

      {custom ? (
        liveTicked.length === 0 ? (
          <p className="empty">Tick at least one thing to draw from.</p>
        ) : (
          <DrawPanel
            key={tickedKey}
            sourceId={CUSTOM}
            sourceName="Custom pool"
            sourceIds={liveTicked}
            loadCards={() => resolveCustomPool(liveTicked)}
            defaultCount={FIRST_DRAW_COUNT}
            showHeading={false}
          />
        )
      ) : (
        chosen && (
          <DrawPanel
            key={chosen.id}
            sourceId={chosen.id}
            sourceName={chosen.name}
            defaultCount={FIRST_DRAW_COUNT}
            showHeading={false}
          />
        )
      )}
    </div>
  );
}
