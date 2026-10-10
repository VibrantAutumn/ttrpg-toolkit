import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSmartCollection, setSmartCollectionQuery } from "../../api/queries";
import { getItem } from "../../api/library";
import { FieldTable } from "../../components/queries/FieldTable";
import { QueryBuilder } from "../../components/queries/QueryBuilder";
import { QueryResults } from "../../components/queries/QueryResults";
import { useQueryCatalog } from "../../components/queries/useQueryCatalog";
import { createAutosaver, type SaveStatus } from "../../lib/autosave";
import { emptyQuery, parseQuery, type Query } from "../../lib/queries/query";
import { bumpDataVersion } from "../../state/dataVersion";

/** The page of a smart collection: the rules, and what they find right now. Changes save themselves. */
export function SmartCollectionView({ itemId }: { itemId: string }) {
  const [projectId, setProjectId] = useState<string | null>(null);
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
        setProjectId(item.projectId);
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
  if (!query || !projectId) return <p className="empty">Loading...</p>;
  return (
    <SmartCollectionBody projectId={projectId} query={query} status={status} problem={problem} onChange={change} />
  );
}

function SmartCollectionBody({ projectId, query, status, problem, onChange }: { projectId: string; query: Query; status: SaveStatus; problem: string | null; onChange: (q: Query) => void }) {
  const catalog = useQueryCatalog(projectId, query);
  const mode = query.view?.mode ?? "list";
  return (
    <div className="smart-collection">
      <p className="meta">
        A filter set finds items by rules and is always up to date.{" "}
        {status === "saved" ? "Saved." : status === "error" ? "Couldn't save yet; will try again." : "Saving..."}
      </p>
      {problem && (
        <p className="error">
          This filter set's saved rules can't be read ({problem}) so it is showing an empty set of rules. Changing anything replaces the old rules.
        </p>
      )}
      <QueryBuilder projectId={projectId} query={query} catalog={catalog} onChange={onChange} />
      <div className="row" role="group" aria-label="How to show the results">
        <button type="button" className={mode === "list" ? "chip on" : "chip"} aria-pressed={mode === "list"} onClick={() => onChange({ ...query, view: { mode: "list", columns: query.view?.columns ?? [] } })}>
          List
        </button>
        <button type="button" className={mode === "table" ? "chip on" : "chip"} aria-pressed={mode === "table"} onClick={() => onChange({ ...query, view: { mode: "table", columns: query.view?.columns ?? [] } })}>
          Table
        </button>
      </div>
      {mode === "table" ? (
        <FieldTable projectId={projectId} query={query} catalog={catalog} onChange={onChange} />
      ) : (
        <QueryResults projectId={projectId} query={query} catalog={catalog} />
      )}
    </div>
  );
}
