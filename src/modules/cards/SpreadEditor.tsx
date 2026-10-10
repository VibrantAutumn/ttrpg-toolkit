import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSpread,
  listCollections,
  setSpreadNotes,
  setSpreadPositions,
  setSpreadReversals,
  type Spread,
} from "../../api/cards";
import { getItem, type Item } from "../../api/library";
import { LogEntryView } from "../../components/results/LogEntryView";
import { createAutosaver, type Autosaver, type SaveStatus } from "../../lib/autosave";
import {
  MAX_POSITIONS,
  MAX_POSITION_NAME,
  MIN_POSITIONS,
  checkPositions,
  type PositionDraft,
} from "../../lib/cards/spread";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useRollLog } from "../../state/rollLog";
import { drawSpreadById } from "../../state/spreadActions";
import { cardTypeIcon } from "./icons";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  error: "Couldn't save",
};

/** A position being edited; `missing` marks one whose chosen source has been deleted. */
interface Draft extends PositionDraft {
  missing: boolean;
}

const blankDrafts = (): Draft[] =>
  Array.from({ length: MIN_POSITIONS }, (_, i) => ({ name: `Position ${i + 1}`, sourceId: null, meaning: "", missing: false }));

const draftsOf = (spread: Spread): Draft[] =>
  spread.positions.length === 0
    ? blankDrafts()
    : spread.positions.map((p) => ({ name: p.name, sourceId: p.sourceMissing ? null : p.sourceId, meaning: p.meaning, missing: p.sourceMissing }));

/** What counts as "unsaved": the parts a person can change. */
const signature = (drafts: readonly Draft[]) => JSON.stringify(drafts.map((d) => [d.name, d.sourceId, d.meaning]));

/**
 * A spread's page: name each position and choose the one set, deck or pool it
 * draws from, say how to read it, and draw the whole reading. The positions are
 * saved together with "Save positions" (so a half-built spread is never drawn);
 * the notes and reversal settings save by themselves.
 */
export function SpreadEditor({ itemId }: { itemId: string }) {
  const dataVersion = useDataVersion();
  const log = useRollLog();
  const [stored, setStored] = useState<Spread | null>(null); // null while loading
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sources, setSources] = useState<Item[]>([]);
  const [notes, setNotes] = useState("");
  const [percentText, setPercentText] = useState("50");
  const [notesStatus, setNotesStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const saver = useRef<Autosaver | null>(null);
  const draftsRef = useRef<Draft[]>([]);
  const storedSignature = useRef("");
  draftsRef.current = drafts;

  /** Reads the spread and the places it can draw from. Keeps unsaved position edits unless `force`. */
  const load = useCallback(
    async (force: boolean) => {
      try {
        const [spread, item] = await Promise.all([getSpread(itemId), getItem(itemId)]);
        const list = await listCollections(item.projectId);
        setSources(list);
        setStored(spread);
        const fresh = draftsOf(spread);
        const unsaved = signature(draftsRef.current) !== storedSignature.current;
        storedSignature.current = signature(fresh);
        if (force || !unsaved) {
          setDrafts(fresh);
        }
        if (force) {
          setNotes(spread.notes);
          setPercentText(String(spread.reversalPercent));
        }
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [itemId],
  );

  // First load, and again whenever anything in the library changes (a source renamed or deleted...).
  const firstLoad = useRef(true);
  useEffect(() => {
    void load(firstLoad.current);
    firstLoad.current = false;
  }, [load, dataVersion]);

  useEffect(() => {
    const autosaver = createAutosaver({
      save: (text) => setSpreadNotes(itemId, text),
      delayMs: 800,
      onStatus: (s) => setNotesStatus(s),
    });
    saver.current = autosaver;
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") void autosaver.flush();
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", saveWhenHidden);
      void autosaver.flush(); // don't lose the last edits when leaving the page
      saver.current = null;
    };
  }, [itemId]);

  const latest = useMemo(
    () => log.find((e) => e.kind === "draw" && e.sourceId === itemId),
    [log, itemId],
  );

  if (!stored) {
    return error ? <p className="error">{error}</p> : <p className="empty">Loading...</p>;
  }

  const dirty = signature(drafts) !== storedSignature.current;
  const sourceName = (id: string | null) => sources.find((s) => s.id === id)?.name;
  const change = (index: number, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch, missing: patch.sourceId !== undefined ? false : d.missing } : d)));
  const move = (index: number, by: -1 | 1) =>
    setDrafts((list) => {
      const target = index + by;
      if (target < 0 || target >= list.length) return list;
      const next = list.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  async function savePositions() {
    setMessage(null);
    const problem = checkPositions(drafts);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await setSpreadPositions(
        itemId,
        drafts.map((d) => ({ name: d.name.trim(), sourceId: d.sourceId, meaning: d.meaning })),
      );
      await load(true);
      bumpDataVersion();
      setMessage("Positions saved.");
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveReversals(reversals: boolean, percentText: string) {
    const percent = percentText.trim() === "" ? NaN : Number(percentText);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      setError("The reversal chance must be a whole number between 0 and 100.");
      return;
    }
    try {
      await setSpreadReversals(itemId, reversals, percent);
      await load(false);
      bumpDataVersion();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function draw() {
    setMessage(null);
    const outcome = await drawSpreadById(itemId);
    setError(outcome.ok ? null : outcome.message);
  }

  const canDraw = stored.positions.length >= MIN_POSITIONS && !dirty;

  return (
    <div className="spread-editor">
      <h2>Positions</h2>
      <p className="meta">
        Each position draws one card from the set, deck or pool you choose for it. A card used in one position can't
        come up in another. To mix sources, make a pool and choose that.
      </p>
      <ol className="spread-positions">
        {drafts.map((d, i) => (
          <li key={i} className="spread-position">
            <div className="row wrap">
              <input
                value={d.name}
                onChange={(e) => change(i, { name: e.currentTarget.value })}
                aria-label={`Name of position ${i + 1}`}
                placeholder="Position name"
                maxLength={MAX_POSITION_NAME}
              />
              <select
                value={d.sourceId ?? ""}
                onChange={(e) => change(i, { sourceId: e.currentTarget.value || null })}
                aria-label={`Source for position ${i + 1}`}
              >
                <option value="">{d.missing ? "Its source was deleted: choose another" : "Choose a source..."}</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {cardTypeIcon(s.itemType)} {s.name} ({s.itemType})
                  </option>
                ))}
                {d.sourceId && !sourceName(d.sourceId) && <option value={d.sourceId}>(unavailable)</option>}
              </select>
            </div>
            <textarea
              value={d.meaning}
              onChange={(e) => change(i, { meaning: e.currentTarget.value })}
              aria-label={`What position ${i + 1} means`}
              placeholder="What this position means (optional)"
              rows={2}
            />
            <div className="row wrap mini-actions">
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move position ${i + 1} up`}>
                ↑
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === drafts.length - 1}
                aria-label={`Move position ${i + 1} down`}
              >
                ↓
              </button>
              <button
                onClick={() => setDrafts((list) => list.filter((_, j) => j !== i))}
                disabled={drafts.length <= MIN_POSITIONS}
                aria-label={`Remove position ${i + 1}`}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="row wrap">
        <button
          onClick={() =>
            setDrafts((list) => [...list, { name: `Position ${list.length + 1}`, sourceId: null, meaning: "", missing: false }])
          }
          disabled={drafts.length >= MAX_POSITIONS}
        >
          Add a position
        </button>
        <button onClick={() => void savePositions()} disabled={!dirty}>
          Save positions
        </button>
        {dirty && <small className="meta">Unsaved changes to the positions.</small>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="meta" role="status">{message}</p>}

      <h2>Draw</h2>
      <label>
        <input
          type="checkbox"
          checked={stored.reversals}
          onChange={(e) => void saveReversals(e.currentTarget.checked, percentText)}
        />{" "}
        Cards can come up reversed
      </label>
      {stored.reversals && (
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void saveReversals(true, percentText);
          }}
        >
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            value={percentText}
            onChange={(e) => setPercentText(e.currentTarget.value)}
            aria-label="Reversal chance in percent"
            className="narrow"
          />
          <span>% reversed</span>
          <button type="submit">Set</button>
        </form>
      )}
      <div className="row wrap">
        <button onClick={() => void draw()} disabled={!canDraw}>
          Draw this spread
        </button>
        {!canDraw && (
          <small className="meta">
            {stored.positions.length < MIN_POSITIONS ? "Save at least 3 positions first." : "Save the positions first."}
          </small>
        )}
      </div>
      {latest && (
        <ul className="list">
          <LogEntryView key={latest.id} entry={latest} />
        </ul>
      )}

      <label className="field">
        <span>How to read it</span>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.currentTarget.value);
            saver.current?.change(e.currentTarget.value);
          }}
          onBlur={() => void saver.current?.flush()}
          placeholder="Notes on interpreting this spread..."
          rows={5}
        />
      </label>
      <p className={notesStatus === "error" ? "error" : "meta"} role="status">
        {STATUS_LABEL[notesStatus]}
      </p>
    </div>
  );
}
