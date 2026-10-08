import { useEffect, useRef, useState } from "react";
import { updateTableEntry, type TableEntry } from "../../api/tables";
import { createAutosaver, type Autosaver, type SaveStatus } from "../../lib/autosave";
import { parseWeightInput } from "../../lib/tables/ranges";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  error: "Couldn't save",
};

/**
 * One entry of a table: its range, text and weight. Edits save by themselves
 * (after a pause, on leaving the box, and when the app is hidden), and only when
 * the text isn't blank and the weight makes sense.
 */
export function EntryRow({
  entry,
  rangeText,
  canMoveUp,
  canMoveDown,
  onSaved,
  onMove,
  onDelete,
}: {
  entry: TableEntry;
  /** Where the entry sits in the table's numbers, e.g. `11–30`. */
  rangeText: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSaved: (id: string, text: string, weight: number) => void;
  onMove: (id: string, by: -1 | 1) => void;
  onDelete: (id: string) => void;
}) {
  const [text, setText] = useState(entry.text);
  const [weightText, setWeightText] = useState(String(entry.weight));
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const saver = useRef<Autosaver | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  useEffect(() => {
    const autosaver = createAutosaver({
      save: async (json) => {
        const value = JSON.parse(json) as { text: string; weight: number };
        await updateTableEntry(entry.id, value.text, value.weight);
        onSavedRef.current(entry.id, value.text, value.weight);
      },
      delayMs: 800,
      onStatus: (s) => setStatus(s),
    });
    saver.current = autosaver;
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") void autosaver.flush();
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", saveWhenHidden);
      void autosaver.flush(); // don't lose the last edit when leaving the page
      saver.current = null;
    };
  }, [entry.id]);

  // Show changes made elsewhere (another screen, an undo), but never over unsaved typing.
  useEffect(() => {
    if (saver.current?.hasUnsaved()) return;
    setText(entry.text);
    setWeightText(String(entry.weight));
    setProblem(null);
  }, [entry.text, entry.weight]);

  function edit(nextText: string, nextWeightText: string) {
    setText(nextText);
    setWeightText(nextWeightText);
    if (nextText.trim() === "") {
      setProblem("An entry needs some text.");
      return;
    }
    const weight = parseWeightInput(nextWeightText);
    if (!weight.ok) {
      setProblem(weight.message);
      return;
    }
    setProblem(null);
    saver.current?.change(JSON.stringify({ text: nextText, weight: weight.weight }));
  }

  return (
    <li className="table-entry">
      <div className="row wrap">
        <span className="entry-range" title="Where this entry sits among the table's numbers">
          {rangeText}
        </span>
        <textarea
          value={text}
          onChange={(e) => edit(e.currentTarget.value, weightText)}
          onBlur={() => void saver.current?.flush()}
          aria-label={`Text of the entry at ${rangeText}`}
          rows={2}
        />
      </div>
      <div className="row wrap mini-actions">
        <label>
          Weight{" "}
          <input
            className="narrow"
            value={weightText}
            onChange={(e) => edit(text, e.currentTarget.value)}
            onBlur={() => void saver.current?.flush()}
            aria-label={`Weight of the entry at ${rangeText}`}
            inputMode="numeric"
            placeholder="1 or 11–30"
          />
        </label>
        <button onClick={() => onMove(entry.id, -1)} disabled={!canMoveUp} aria-label={`Move the entry at ${rangeText} up`}>
          ↑
        </button>
        <button onClick={() => onMove(entry.id, 1)} disabled={!canMoveDown} aria-label={`Move the entry at ${rangeText} down`}>
          ↓
        </button>
        <button onClick={() => onDelete(entry.id)} aria-label={`Delete the entry at ${rangeText}`}>
          Delete
        </button>
        <small className={status === "error" ? "error" : "meta"} role="status">
          {STATUS_LABEL[status]}
        </small>
      </div>
      {problem && <p className="error" role="alert">{problem}</p>}
    </li>
  );
}
