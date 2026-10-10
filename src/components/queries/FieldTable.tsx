import { useEffect, useMemo, useState } from "react";
import { listFieldValues } from "../../api/fields";
import { getItems } from "../../api/library";
import { runQuery, type QueryResult } from "../../api/queries";
import type { FieldValue } from "../../lib/fields/value";
import type { Column, Query } from "../../lib/queries/query";
import { MAX_COLUMNS } from "../../lib/queries/query";
import {
  addColumn,
  buildRows,
  columnKey,
  columnLabel,
  filterRows,
  moveColumn,
  nextSort,
  removeColumn,
  sortDirection,
  type TableContext,
} from "../../lib/queries/table";
import { useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { itemIcon, itemTypeLabel } from "../item/itemDisplay";
import type { QueryCatalog } from "./useQueryCatalog";

const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** What a smart collection finds, as a table: the name, then the columns chosen (kind, dates, any field). Read-only. */
export function FieldTable({ campaignId, query, catalog, onChange }: { campaignId: string; query: Query; catalog: QueryCatalog; onChange: (q: Query) => void }) {
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const columns = useMemo(() => query.view?.columns ?? [], [query.view]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [values, setValues] = useState<Map<string, Map<string, FieldValue>>>(new Map());
  const [linkNames, setLinkNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify([query.where, query.sort]);
  const fieldIds = useMemo(() => columns.flatMap((c) => (c.by === "field" ? [c.fieldId] : [])), [columns]);
  const fieldKey = fieldIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const found = await runQuery(campaignId, query);
        const loaded = new Map<string, Map<string, FieldValue>>();
        const linked = new Set<string>();
        for (const id of fieldIds) {
          const def = catalog.fields.find((d) => d.id === id);
          if (!def) continue;
          const map = await listFieldValues(def);
          loaded.set(id, map);
          if (def.kind === "link") for (const ids of map.values()) (ids as string[]).forEach((x) => linked.add(x));
        }
        const names = new Map<string, string>();
        if (linked.size > 0) for (const i of await getItems([...linked])) names.set(i.id, i.name);
        if (cancelled) return;
        setResult(found);
        setValues(loaded);
        setLinkNames(names);
        setError(null);
      })().catch((e) => !cancelled && setError(String(e)));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `key` and `fieldKey` stand for the query's rules/sort and the chosen fields
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, key, fieldKey, catalog.fields, dataVersion]);

  const ctx: TableContext = useMemo(
    () => ({ definitions: catalog.fields, values, itemName: (id) => linkNames.get(id), typeLabel: itemTypeLabel, date: formatDate }),
    [catalog.fields, values, linkNames],
  );
  const rows = useMemo(() => (result ? filterRows(buildRows(result.items, columns, ctx), filter) : []), [result, columns, ctx, filter]);

  const setColumns = (next: Column[]) => onChange({ ...query, view: { mode: "table", columns: next } });
  const header = (column: Column | null, label: string) => {
    const dir = sortDirection(query, column);
    return (
      <th key={column ? columnKey(column) : "name"} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
        <button type="button" className="link" onClick={() => onChange({ ...query, sort: nextSort(query, column) })}>
          {label} {dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""}
        </button>
      </th>
    );
  };

  const fixed: Column[] = [{ by: "type" }, { by: "created" }, { by: "updated" }];
  const addable: Column[] = [...fixed, ...catalog.fields.map((d): Column => ({ by: "field", fieldId: d.id }))].filter((c) => !columns.some((x) => columnKey(x) === columnKey(c)));

  return (
    <div className="field-table">
      {error && <p className="error">{error}</p>}
      <div className="row wrap">
        <input type="search" value={filter} onChange={(e) => setFilter(e.currentTarget.value)} placeholder="Filter this table..." aria-label="Filter this table" />
        <button type="button" onClick={() => setEditing(!editing)}>
          {editing ? "Done with columns" : "Columns..."}
        </button>
      </div>
      {editing && (
        <div className="query-group">
          <ul className="query-rules">
            {columns.map((c, i) => (
              <li key={columnKey(c)} className="row wrap">
                <strong>{columnLabel(c, catalog.fields)}</strong>
                <button type="button" disabled={i === 0} aria-label="Move left" onClick={() => setColumns(moveColumn(columns, i, -1))}>
                  ◀
                </button>
                <button type="button" disabled={i === columns.length - 1} aria-label="Move right" onClick={() => setColumns(moveColumn(columns, i, 1))}>
                  ▶
                </button>
                <button type="button" onClick={() => setColumns(removeColumn(columns, i))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {columns.length === 0 && <p className="empty">Only the name is shown. Add columns below.</p>}
          <select
            value=""
            aria-label="Add a column"
            disabled={columns.length >= MAX_COLUMNS || addable.length === 0}
            onChange={(e) => {
              const picked = addable.find((c) => columnKey(c) === e.currentTarget.value);
              if (picked) setColumns(addColumn(columns, picked));
            }}
          >
            <option value="">Add a column...</option>
            {addable.map((c) => (
              <option key={columnKey(c)} value={columnKey(c)}>
                {columnLabel(c, catalog.fields)}
              </option>
            ))}
          </select>
        </div>
      )}
      {!result ? (
        <p className="empty">Looking...</p>
      ) : (
        <>
          <p className="meta">
            {rows.length === result.items.length ? `${rows.length} items` : `${rows.length} of ${result.items.length} items`}
            {result.truncated ? " (the rules find more than can be listed)" : ""}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {header(null, "Name")}
                  {columns.map((c) => header(c, columnLabel(c, catalog.fields)))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.item.id}>
                    <td>
                      <button type="button" className="link name" onClick={() => openItem(row.item.id)}>
                        {itemIcon(row.item)} {row.item.name}
                      </button>
                    </td>
                    {row.cells.map((cell, i) => (
                      <td key={i}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="empty">Nothing to show.</p>}
        </>
      )}
    </div>
  );
}
