import type { Item } from "../../api/library";
import type { FieldDefinition } from "../fields/definition";
import { formatValue, type FieldValue } from "../fields/value";
import type { Column, Query, SortKey } from "./query";

/** Pure logic for the table view of a smart collection. */

export interface TableRow {
  item: Item;
  /** One text per column, in column order (the name is not one of them). */
  cells: string[];
}

export interface TableContext {
  definitions: FieldDefinition[];
  /** Field id -> item id -> that item's value for the field. */
  values: Map<string, Map<string, FieldValue>>;
  itemName: (id: string) => string | undefined;
  typeLabel: (item: Item) => string;
  /** Formats a time stamp for a cell. */
  date: (ms: number) => string;
}

export function columnKey(column: Column): string {
  return column.by === "field" ? `field:${column.fieldId}` : column.by;
}

export function columnLabel(column: Column, definitions: FieldDefinition[]): string {
  switch (column.by) {
    case "type":
      return "Kind";
    case "created":
      return "Made";
    case "updated":
      return "Changed";
    case "field":
      return definitions.find((d) => d.id === column.fieldId)?.name ?? "(missing field)";
  }
}

export function cellText(item: Item, column: Column, ctx: TableContext): string {
  switch (column.by) {
    case "type":
      return ctx.typeLabel(item);
    case "created":
      return ctx.date(item.createdAt);
    case "updated":
      return ctx.date(item.updatedAt);
    case "field": {
      const def = ctx.definitions.find((d) => d.id === column.fieldId);
      const value = ctx.values.get(column.fieldId)?.get(item.id);
      if (!def || value === undefined) return "";
      return formatValue(def, value, { itemName: ctx.itemName });
    }
  }
}

export function buildRows(items: Item[], columns: Column[], ctx: TableContext): TableRow[] {
  return items.map((item) => ({ item, cells: columns.map((c) => cellText(item, c, ctx)) }));
}

/** Keeps rows where every word typed appears in the name or in any cell (ignoring case). */
export function filterRows(rows: TableRow[], text: string): TableRow[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((row) => {
    const haystack = [row.item.name, ...row.cells].join("\n").toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

type Dir = "asc" | "desc";

function keyFor(column: Column | null, dir: Dir): SortKey {
  if (column === null) return { by: "name", dir };
  return column.by === "field" ? { by: "field", fieldId: column.fieldId, dir } : { by: column.by, dir };
}

function sameColumn(key: SortKey | undefined, column: Column | null): boolean {
  if (!key) return false;
  if (column === null) return key.by === "name";
  if (column.by === "field") return key.by === "field" && key.fieldId === column.fieldId;
  return key.by === column.by;
}

/**
 * What clicking a column's header does: sort by it ascending, or flip to descending if it is
 * already the first sort. The rest of the sort is dropped (a header click means "just this").
 * Pass `null` for the name column.
 */
export function nextSort(query: Query, column: Column | null): SortKey[] {
  const first = query.sort[0];
  const dir: Dir = sameColumn(first, column) && first.dir === "asc" ? "desc" : "asc";
  return [keyFor(column, dir)];
}

/** Whether the table is sorted by this column first, and which way. */
export function sortDirection(query: Query, column: Column | null): Dir | null {
  const first = query.sort[0];
  return sameColumn(first, column) ? first.dir : null;
}

export function addColumn(columns: Column[], column: Column): Column[] {
  return columns.some((c) => columnKey(c) === columnKey(column)) ? columns : [...columns, column];
}
export function removeColumn(columns: Column[], index: number): Column[] {
  return columns.filter((_, i) => i !== index);
}
export function moveColumn(columns: Column[], index: number, delta: -1 | 1): Column[] {
  const to = index + delta;
  if (to < 0 || to >= columns.length) return columns;
  const next = columns.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
