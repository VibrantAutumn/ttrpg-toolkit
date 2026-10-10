import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSmartCollection, setSmartCollectionQuery } from "../../api/queries";
import { getItem } from "../../api/library";
import { QueryBuilder } from "../../components/queries/QueryBuilder";
import { QueryResults } from "../../components/queries/QueryResults";
import { useQueryCatalog } from "../../components/queries/useQueryCatalog";
import { createAutosaver, type SaveStatus } from "../../lib/autosave";
import { emptyQuery, parseQuery, type Query } from "../../lib/queries/query";
import { bumpDataVersion } from "../../state/dataVersion";

/** The page of a smart collection: the rules, and what they find right now. Changes save themselves. */
export function SmartCollectionView({ itemId }: { itemId: string }) {
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [query, setQuery] = useState<Query | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);

  const saver = useMemo(
    () =>
      createAutosaver({
        save: async (json) => {
          await setSmartCollectionQuery(itemId, json);
          bumpDataVersion();
        },
        delayMs: 600,
        onStatus: setStatus,
      }),
    [itemId],
  );
  const saverRef = useRef(saver);
  saverRef.current = saver;

  useEffect(() => {
    let active = true;
    Promise.all([getItem(itemId), getSmartCollection(itemId)])
      .then(([item, saved]) => {
        if (!active) return;
        setCampaignId(item.campaignId);
        const read = parseQuery(saved.queryJson);
        if (read.ok) {
          setQuery(read.query);
          setProblem(null);
        } else {
          setQuery(emptyQuery());
          setProblem(read.error);
        }
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
      void saverRef.current.flush();
    };
  }, [itemId]);

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void saverRef.current.flush();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const change = useCallback(
    (next: Query) => {
      setQuery(next);
      setProblem(null);
      saver.change(JSON.stringify(next));
    },
    [saver],
  );

  if (error) return <p className="error">{error}</p>;
  if (!query || !campaignId) return <p className="empty">Loading...</p>;
  return (
    <SmartCollectionBody campaignId={campaignId} query={query} status={status} problem={problem} onChange={change} />
  );
}

function SmartCollectionBody({ campaignId, query, status, problem, onChange }: { campaignId: string; query: Query; status: SaveStatus; problem: string | null; onChange: (q: Query) => void }) {
  const catalog = useQueryCatalog(campaignId, query);
  return (
    <div className="smart-collection">
      <p className="meta">
        A smart collection finds items by rules and is always up to date.{" "}
        {status === "saved" ? "Saved." : status === "error" ? "Couldn't save yet; will try again." : "Saving..."}
      </p>
      {problem && (
        <p className="error">
          This collection's saved rules can't be read ({problem}) so it is showing an empty set of rules. Changing anything replaces the old rules.
        </p>
      )}
      <QueryBuilder campaignId={campaignId} query={query} catalog={catalog} onChange={onChange} />
      <QueryResults campaignId={campaignId} query={query} catalog={catalog} />
    </div>
  );
}
