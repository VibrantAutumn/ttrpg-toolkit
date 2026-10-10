import { useEffect, useState } from "react";
import { listTables, type TableSummary } from "../../api/tables";
import { RollLogList } from "../../components/results/RollLogList";
import { useCurrentProject } from "../../state/CurrentProject";
import { useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { rollTableById } from "../../state/tableActions";
import { RollContextBar } from "./RollContextBar";

/** Every table in the project with a Roll button, and the log of table rolls below. */
export function TableList() {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;

  const [tables, setTables] = useState<TableSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setTables([]);
      return;
    }
    let active = true;
    listTables(projectId)
      .then((list) => active && setTables(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  async function roll(table: TableSummary) {
    const outcome = await rollTableById(table.itemId);
    setError(outcome.ok ? null : outcome.message);
  }

  if (!projectId) return <p className="empty">Choose a project to roll its tables.</p>;

  return (
    <div>
      <h2>Your tables</h2>
      <RollContextBar />
      {tables.length === 0 ? (
        <p className="empty">No tables yet. Make one in the Library tab.</p>
      ) : (
        <ul className="list">
          {tables.map((t) => (
            <li key={t.itemId} className="row wrap">
              <span className="name">
                <button className="link name" onClick={() => openItem(t.itemId)}>
                  {t.name}
                </button>{" "}
                <small className="meta">
                  {t.entries} {t.entries === 1 ? "entry" : "entries"}
                  {t.duplicateName && !t.foundBySlots && " · another table has this name, so slots use that one"}
                </small>
              </span>
              <button onClick={() => void roll(t)} disabled={t.entries === 0}>
                Roll
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <h2>Table rolls</h2>
      <RollLogList kind="table" showClear emptyText="Nothing rolled yet. The log is cleared when the app restarts." />
    </div>
  );
}
