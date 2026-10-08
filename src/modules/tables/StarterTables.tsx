import { useEffect, useState } from "react";
import { installTableBundle, listInstalledStarters } from "../../api/starters";
import { listTables } from "../../api/tables";
import { toTableBundle, type TableStarterDef } from "../../lib/tables/starterTables";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { STARTER_TABLES } from "../../starter/tables";

const key = (text: string) => text.trim().toLowerCase();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Add starter tables": ready-made tables (and name setups that use them) that
 * come with the app. Adding one puts ordinary tables in the open campaign (all or
 * nothing); after that they are yours to rename, edit or delete.
 */
export function StarterTables() {
  const { campaign } = useCurrentCampaign();
  const dataVersion = useDataVersion();
  const campaignId = campaign?.id ?? null;
  const [installed, setInstalled] = useState<readonly string[]>([]);
  const [tableNames, setTableNames] = useState<ReadonlySet<string>>(new Set());
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setInstalled([]);
      setTableNames(new Set());
      return;
    }
    let active = true;
    Promise.all([listInstalledStarters(campaignId), listTables(campaignId)])
      .then(([ids, tables]) => {
        if (!active) return;
        setInstalled(ids);
        setTableNames(new Set(tables.map((t) => key(t.name))));
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  async function add(starter: TableStarterDef) {
    if (!campaignId || working) return;
    setError(null);
    setAdded(null);
    setWorking(starter.id);
    try {
      const result = await installTableBundle(campaignId, toTableBundle(starter));
      bumpDataVersion();
      const presets = result.presets > 0 ? ` and ${plural(result.presets, "name setup")}` : "";
      setAdded(`Added ${starter.name}: ${plural(result.tables, "table")}${presets}, in a folder of that name.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(null);
    }
  }

  if (!campaignId) return null;

  return (
    <details className="starter-decks">
      <summary>Add starter tables</summary>
      <p className="meta">
        Ready-made tables that come with the app. They are added to this campaign as ordinary tables you can rename,
        edit or delete.
      </p>
      <ul className="list">
        {STARTER_TABLES.map((starter) => {
          const isInstalled = installed.includes(starter.id);
          const clashes = starter.tables.filter((t) => tableNames.has(key(t.name))).map((t) => t.name);
          const entries = starter.tables.reduce((n, t) => n + t.entries.length, 0);
          const blocked = !isInstalled && clashes.length > 0;
          return (
            <li key={starter.id} className="row wrap">
              <span className="name">
                <strong>{starter.name}</strong>{" "}
                <small className="meta">
                  {plural(starter.tables.length, "table")}, {plural(entries, "entry", "entries")}
                  {starter.presets.length > 0 && `, ${plural(starter.presets.length, "name setup")}`}
                </small>
                <br />
                <small className="meta">{starter.description}</small>
                {blocked && (
                  <>
                    <br />
                    <small className="meta">
                      You already have a table called {clashes.map((c) => `“${c}”`).join(", ")}. Rename or delete it to
                      add this.
                    </small>
                  </>
                )}
              </span>
              <button
                onClick={() => void add(starter)}
                disabled={isInstalled || blocked || working !== null}
                aria-label={isInstalled ? `${starter.name} is already added` : `Add ${starter.name}`}
              >
                {working === starter.id ? "Adding..." : isInstalled ? "Added ✓" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
      {added && <p className="notice" role="status">{added}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </details>
  );
}
