import { useEffect, useState } from "react";
import { listTables, type TableSummary } from "../../api/tables";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { useDataVersion } from "../../state/dataVersion";
import { rollTableById } from "../../state/tableActions";

const LAST_TABLE_KEY = "ttrpg.quickTable";

// A blocked or missing storage (some previews, private windows) just means nothing is remembered.
function remembered(): string {
  try {
    return localStorage.getItem(LAST_TABLE_KEY) ?? "";
  } catch {
    return "";
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(LAST_TABLE_KEY, id);
  } catch {
    // nothing to do
  }
}

/** Choose any table in the campaign and roll it; the result goes to the roll log. */
export function TableRoller() {
  const { campaign } = useCurrentCampaign();
  const dataVersion = useDataVersion();
  const campaignId = campaign?.id ?? null;

  const [tables, setTables] = useState<TableSummary[]>([]);
  const [chosen, setChosen] = useState(remembered);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setTables([]);
      return;
    }
    let active = true;
    listTables(campaignId)
      .then((list) => active && setTables(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  if (!campaignId) return <p className="empty">Choose a campaign to roll its tables.</p>;
  if (tables.length === 0) return <p className="empty">No tables yet. Make one in the Tables tool.</p>;

  // The remembered table may be gone (deleted or in another campaign): fall back to the first.
  const selected = tables.find((t) => t.itemId === chosen) ?? tables[0];

  async function roll() {
    const outcome = await rollTableById(selected.itemId);
    setError(outcome.ok ? null : outcome.message);
  }

  return (
    <div>
      <div className="row wrap">
        <select
          value={selected.itemId}
          onChange={(e) => {
            setChosen(e.currentTarget.value);
            remember(e.currentTarget.value);
          }}
          aria-label="Table to roll"
          className="grow"
        >
          {tables.map((t) => (
            <option key={t.itemId} value={t.itemId}>
              {t.name} ({t.entries})
            </option>
          ))}
        </select>
        <button onClick={() => void roll()} disabled={selected.entries === 0}>
          Roll
        </button>
      </div>
      {selected.entries === 0 && <small className="meta">This table has no entries yet.</small>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
