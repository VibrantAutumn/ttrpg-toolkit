import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTableEntries,
  clearTableRecent,
  deleteTableEntry,
  getTable,
  moveTableEntry,
  restoreTableEntry,
  setTableNotes,
  setTableOptions,
  type TableDetail,
} from "../../api/tables";
import { LogEntryView } from "../../components/results/LogEntryView";
import { createAutosaver, type Autosaver, type SaveStatus } from "../../lib/autosave";
import { entryRanges, formatRange, rangeNote } from "../../lib/tables/ranges";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useRollLog } from "../../state/rollLog";
import { rollTableById } from "../../state/tableActions";
import { EntryRow } from "./EntryRow";
import { SlotChoicesProvider } from "./SlotChoices";

/** The most sides the die of a table can have, and the most entries "avoid recent" can skip (match the Rust limits). */
const MAX_DIE = 1000;
const MAX_AVOID = 50;

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  error: "Couldn't save",
};

/**
 * A table's page: roll it, set its die, and edit its entries (text, weight or
 * range, order). Entries save by themselves; adding and deleting refresh the
 * library lists, and a deleted entry can be brought back with Undo.
 */
export function TableEditor({ itemId }: { itemId: string }) {
  return (
    <SlotChoicesProvider>
      <TableEditorBody itemId={itemId} />
    </SlotChoicesProvider>
  );
}

function TableEditorBody({ itemId }: { itemId: string }) {
  const dataVersion = useDataVersion();
  const log = useRollLog();
  const [table, setTable] = useState<TableDetail | null>(null); // null while loading
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dieText, setDieText] = useState("");
  const [avoidText, setAvoidText] = useState("0");
  const [notes, setNotes] = useState("");
  const [notesStatus, setNotesStatus] = useState<SaveStatus>("saved");
  const notesSaver = useRef<Autosaver | null>(null);
  const firstLoad = useRef(true);
  const [newText, setNewText] = useState("");
  const [manyText, setManyText] = useState("");
  const [undo, setUndo] = useState<{ entryId: string; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await getTable(itemId);
      setTable(detail);
      setDieText(detail.dieSize === null ? "" : String(detail.dieSize));
      setAvoidText(String(detail.avoidRecent));
      if (firstLoad.current) {
        firstLoad.current = false;
        setNotes(detail.notes); // later reloads never overwrite notes being typed
      }
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [itemId]);

  // First load, and again whenever anything in the library changes (a rename, a restore...).
  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  useEffect(() => {
    const autosaver = createAutosaver({
      save: (text) => setTableNotes(itemId, text),
      delayMs: 800,
      onStatus: (status) => setNotesStatus(status),
    });
    notesSaver.current = autosaver;
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") void autosaver.flush();
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", saveWhenHidden);
      void autosaver.flush(); // don't lose the last edits when leaving the page
      notesSaver.current = null;
    };
  }, [itemId]);

  const latest = useMemo(() => log.find((e) => e.kind === "table" && e.tableId === itemId), [log, itemId]);

  const ranges = useMemo(() => entryRanges(table?.entries.map((e) => e.weight) ?? []), [table]);

  if (!table) {
    return error ? <p className="error">{error}</p> : <p className="empty">Loading...</p>;
  }

  const total = table.entries.reduce((sum, e) => sum + e.weight, 0);
  const note = rangeNote(total, table.dieSize);
  const canRoll = total > 0;

  async function run(action: () => Promise<unknown>) {
    setMessage(null);
    try {
      await action();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function roll() {
    setMessage(null);
    const outcome = await rollTableById(itemId);
    setError(outcome.ok ? null : outcome.message);
  }

  const patchEntry = (id: string, text: string, weight: number) =>
    setTable((t) => t && { ...t, entries: t.entries.map((e) => (e.id === id ? { ...e, text, weight } : e)) });

  const patchTags = (id: string, tagIds: string[]) =>
    setTable((t) => t && { ...t, entries: t.entries.map((e) => (e.id === id ? { ...e, tagIds } : e)) });

  async function addOne() {
    if (newText.trim() === "") return;
    await run(async () => {
      await addTableEntries(itemId, [{ text: newText }]);
      setNewText("");
      await load();
      bumpDataVersion();
    });
  }

  async function addMany() {
    const lines = manyText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");
    if (lines.length === 0) return;
    await run(async () => {
      await addTableEntries(itemId, lines.map((text) => ({ text })));
      setManyText("");
      setMessage(`Added ${lines.length} ${lines.length === 1 ? "entry" : "entries"}.`);
      await load();
      bumpDataVersion();
    });
  }

  async function move(id: string, by: -1 | 1) {
    const index = table!.entries.findIndex((e) => e.id === id);
    const target = index + by;
    if (index < 0 || target < 0 || target >= table!.entries.length) return;
    await run(async () => {
      await moveTableEntry(id, target);
      await load();
    });
  }

  async function remove(id: string) {
    const entry = table!.entries.find((e) => e.id === id);
    if (!entry) return;
    await run(async () => {
      await deleteTableEntry(id);
      setUndo({ entryId: id, text: entry.text });
      await load();
      bumpDataVersion();
    });
  }

  async function undoRemove() {
    if (!undo) return;
    const { entryId } = undo;
    setUndo(null);
    await run(async () => {
      await restoreTableEntry(entryId);
      await load();
      bumpDataVersion();
    });
  }

  async function saveDie() {
    const trimmed = dieText.trim();
    const die = trimmed === "" ? null : Number(trimmed);
    if (die !== null && (!Number.isInteger(die) || die < 2 || die > MAX_DIE)) {
      setError(`A die has between 2 and ${MAX_DIE} sides.`);
      return;
    }
    await run(async () => {
      await setTableOptions(itemId, die, table!.avoidRecent);
      await load();
    });
  }

  async function saveAvoid() {
    const trimmed = avoidText.trim();
    const avoid = trimmed === "" ? 0 : Number(trimmed);
    if (!Number.isInteger(avoid) || avoid < 0 || avoid > MAX_AVOID) {
      setError(`Avoid recent can skip between 0 and ${MAX_AVOID} entries.`);
      return;
    }
    await run(async () => {
      await setTableOptions(itemId, table!.dieSize, avoid);
      await load();
    });
  }

  async function forgetRecent() {
    await run(async () => {
      await clearTableRecent(itemId);
      setMessage("Forgot the recent rolls of this table.");
    });
  }

  return (
    <div className="table-editor">
      {table.duplicateName && (
        <p className="meta" role="status">
          {table.foundBySlots
            ? "Another table has this name too. Slots use this one because it is older."
            : "Another table has this name too. Slots use the older one, not this one: rename one of them."}
        </p>
      )}

      <div className="row wrap">
        <button onClick={() => void roll()} disabled={!canRoll}>
          Roll this table
        </button>
        {!canRoll && <small className="meta">Add an entry with a weight above 0 first.</small>}
      </div>
      {latest && (
        <ul className="list">
          <LogEntryView key={latest.id} entry={latest} />
        </ul>
      )}

      <h2>Entries</h2>
      <p className="meta">
        {table.entries.length} {table.entries.length === 1 ? "entry" : "entries"}, total weight {total}. An entry's
        weight is how many places it takes: type a number (3) or a range (11–30, which means 20 wide). Its place in the
        table's numbers follows from the order and the weights; 0 means never picked.
      </p>
      <details className="table-options">
        <summary>Table options: avoid recent, printed die, forget recent rolls</summary>
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDie();
          }}
        >
          <label>
            Printed die{" "}
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={MAX_DIE}
              value={dieText}
              onChange={(e) => setDieText(e.currentTarget.value)}
              placeholder="none"
              className="narrow"
            />
          </label>
          <button type="submit" disabled={dieText.trim() === (table.dieSize === null ? "" : String(table.dieSize))}>
            Set
          </button>
          <small className="meta">Optional: the die a book's version of this table uses (d20, d100...).</small>
        </form>
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAvoid();
          }}
        >
          <label>
            Avoid recent{" "}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_AVOID}
              value={avoidText}
              onChange={(e) => setAvoidText(e.currentTarget.value)}
              className="narrow"
            />
          </label>
          <button type="submit" disabled={avoidText.trim() === String(table.avoidRecent)}>
            Set
          </button>
          <button type="button" onClick={() => void forgetRecent()}>
            Forget recent rolls
          </button>
          <small className="meta">
            Skip the last N entries rolled from this table, so they don't repeat right away (0 = off). If every entry
            would be skipped, the rule is dropped for that roll.
          </small>
        </form>
      </details>
      {note && <p className="meta" role="status">{note}</p>}

      {table.entries.length === 0 ? (
        <p className="empty">No entries yet. Add the first one below.</p>
      ) : (
        <ol className="table-entries">
          {table.entries.map((entry, i) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              rangeText={formatRange(ranges[i])}
              canMoveUp={i > 0}
              canMoveDown={i < table.entries.length - 1}
              onSaved={patchEntry}
              onTagsChanged={patchTags}
              onMove={(id, by) => void move(id, by)}
              onDelete={(id) => void remove(id)}
            />
          ))}
        </ol>
      )}
      {undo && (
        <p className="meta" role="status">
          Deleted “{undo.text.length > 40 ? `${undo.text.slice(0, 40)}…` : undo.text}”.{" "}
          <button onClick={() => void undoRemove()}>Undo</button>
        </p>
      )}

      <form
        className="table-add"
        onSubmit={(e) => {
          e.preventDefault();
          void addOne();
        }}
      >
        <label className="field">
          <span>Add an entry</span>
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.currentTarget.value)}
            placeholder="Text of the new entry"
            rows={2}
          />
        </label>
        <button type="submit" disabled={newText.trim() === ""}>
          Add entry
        </button>
      </form>

      <details className="table-add">
        <summary>Add several at once</summary>
        <label className="field">
          <span>One entry per line</span>
          <textarea
            value={manyText}
            onChange={(e) => setManyText(e.currentTarget.value)}
            placeholder={"The Rusty Flagon\nThe Gilded Goose\nThe Laughing Dwarf"}
            rows={6}
          />
        </label>
        <button onClick={() => void addMany()} disabled={manyText.trim() === ""}>
          Add these entries
        </button>
      </details>

      <label className="field">
        <span>Notes</span>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.currentTarget.value);
            notesSaver.current?.change(e.currentTarget.value);
          }}
          onBlur={() => void notesSaver.current?.flush()}
          placeholder="What this table is for, where it came from..."
          rows={4}
        />
      </label>
      <p className={notesStatus === "error" ? "error" : "meta"} role="status">
        {STATUS_LABEL[notesStatus]}
      </p>

      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="meta" role="status">{message}</p>}
    </div>
  );
}
