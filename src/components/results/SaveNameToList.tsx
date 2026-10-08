import { useEffect, useState } from "react";
import { listTables, type TableSummary } from "../../api/tables";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { saveNameToTable } from "../../state/nameActions";

/**
 * "Save to list": adds a generated name to a table you choose, as a new entry
 * (so a name you like can be rolled again later or kept with its tags).
 */
export function SaveNameToList({ name }: { name: string }) {
  const { campaign } = useCurrentCampaign();
  const [open, setOpen] = useState(false);
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [chosen, setChosen] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !campaign) return;
    let active = true;
    listTables(campaign.id)
      .then((list) => active && setTables(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [open, campaign]);

  async function save() {
    const table = tables.find((t) => t.itemId === chosen);
    if (!table) return;
    try {
      await saveNameToTable(table.itemId, name);
      setNote(`Added “${name}” to “${table.name}”.`);
      setError(null);
      setOpen(false);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={!campaign}>
        Save to list
      </button>
      {open && (
        <div className="row wrap">
          <select value={chosen} onChange={(e) => setChosen(e.currentTarget.value)} aria-label="Table to add the name to">
            <option value="">Choose a table...</option>
            {tables.map((t) => (
              <option key={t.itemId} value={t.itemId}>
                {t.name}
              </option>
            ))}
          </select>
          <button onClick={() => void save()} disabled={chosen === ""}>
            Add
          </button>
        </div>
      )}
      {note && <p className="meta" role="status">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
