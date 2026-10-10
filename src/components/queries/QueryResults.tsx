import { useEffect, useState } from "react";
import { runQuery, type QueryResult } from "../../api/queries";
import { describeQuery } from "../../lib/queries/describe";
import type { Query } from "../../lib/queries/query";
import { useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { itemIcon, itemTypeLabel, libraryLabel } from "../item/itemDisplay";
import type { QueryCatalog } from "./useQueryCatalog";

const SHOWN_AT_FIRST = 50;

/** What a query finds right now. Re-runs when the query or the campaign's data changes. */
export function QueryResults({ campaignId, query, catalog, onlyType }: { campaignId: string; query: Query; catalog: QueryCatalog; onlyType?: string }) {
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const key = JSON.stringify(query);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      runQuery(campaignId, query, onlyType)
        .then((r) => {
          if (cancelled) return;
          setResult(r);
          setError(null);
        })
        .catch((e) => !cancelled && setError(String(e)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` stands for the query's content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, key, onlyType, dataVersion]);

  if (error) return <p className="error">{error}</p>;
  if (!result) return <p className="empty">Looking...</p>;
  const shown = showAll ? result.items : result.items.slice(0, SHOWN_AT_FIRST);
  return (
    <div className="query-results">
      <h2>
        {result.items.length === 0
          ? "Nothing found"
          : `${result.items.length}${result.truncated ? "+" : ""} ${result.items.length === 1 ? "item" : "items"}`}
      </h2>
      <p className="meta">{describeQuery(query, catalog.names)}</p>
      {result.truncated && <p className="meta">Only the first {result.items.length} are listed. Narrow the rules to see the rest.</p>}
      <ul className="list">
        {shown.map((i) => (
          <li key={i.id} className="row wrap">
            <button type="button" className="link name" onClick={() => openItem(i.id)}>
              {itemIcon(i)} {i.name}
            </button>
            <small className="meta">
              {itemTypeLabel(i)} · {libraryLabel(i)}
            </small>
          </li>
        ))}
      </ul>
      {!showAll && result.items.length > SHOWN_AT_FIRST && (
        <button type="button" onClick={() => setShowAll(true)}>
          Show all {result.items.length}
        </button>
      )}
    </div>
  );
}
