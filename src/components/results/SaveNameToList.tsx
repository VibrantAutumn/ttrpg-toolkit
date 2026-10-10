import { useEffect, useState } from "react";
import { createItem } from "../../api/library";
import { listTables, type TableSummary } from "../../api/tables";
import { useCurrentProject } from "../../state/CurrentProject";
import { saveNameToTable } from "../../state/nameActions";

/** The drop-down's value for "make a new table". Table ids are UUIDs, so this can't clash. */
const NEW_TABLE = "new-table";

/**
 * "Save to list": adds a generated name to a table you choose, as a new entry
 * (so a name you like can be rolled again later or kept with its tags), or to a
 * new table made right here.
 */
export function SaveNameToList({ name }: { name: string }) {
  const { project } = useCurrentProject();
  const [open, setOpen] = useState(false);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [chosen, setChosen] = useState("");
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !project) return;
    let active = true;
    listTables(project.id)
      .then((list) => active && setTables(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [open, project]);

  const making = chosen === NEW_TABLE;
  const ready = making ? newName.trim() !== "" : chosen !== "";

  async function save() {
    if (!project || !ready) return;
    try {
      if (making) {
        const table = await createItem(project.id, "tables", "table", newName, null);
        await saveNameToTable(table.id, name);
        setNote(`Made the table “${table.name}” and added “${name}” to it.`);
        setNewName("");
        setChosen("");
      } else {
        const table = tables.find((t) => t.itemId === chosen);
        if (!table) return;
        await saveNameToTable(table.itemId, name);
        setNote(`Added “${name}” to “${table.name}”.`);
      }
      setError(null);
      setOpen(false);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!project}>
        Save to list
      </button>
      {open && (
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <select value={chosen} onChange={(e) => setChosen(e.currentTarget.value)} aria-label="Table to add the name to">
            <option value="">Choose a table...</option>
            {tables.map((t) => (
              <option key={t.itemId} value={t.itemId}>
                {t.name}
              </option>
            ))}
            <option value={NEW_TABLE}>＋ New table…</option>
          </select>
          {making && (
            <input
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
              placeholder="Name of the new table"
              aria-label="Name of the new table"
              autoFocus
            />
          )}
          <button type="submit" disabled={!ready}>
            {making ? "Create and add" : "Add"}
          </button>
        </form>
      )}
      {note && <p className="meta" role="status">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
