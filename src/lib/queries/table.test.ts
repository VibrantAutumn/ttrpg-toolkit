import { describe, expect, it } from "vitest";
import type { Item } from "../../api/library";
import { newDefinition, type FieldDefinition } from "../fields/definition";
import type { FieldValue } from "../fields/value";
import { MAX_COLUMNS, emptyQuery, normalizeQuery, type Column, type Query } from "./query";
import { addColumn, buildRows, cellText, columnLabel, filterRows, moveColumn, nextSort, removeColumn, sortDirection, type TableContext } from "./table";

const item = (id: string, name: string): Item => ({
  id, campaignId: "c", library: "worldbuilding", itemType: "document", name, icon: null, folderId: null,
  visibility: "default", createdAt: 1000, updatedAt: 2000, deletedAt: null,
});

const level = newDefinition("number", "f-level", "Level");
const home = newDefinition("link", "f-home", "Home");
const definitions: FieldDefinition[] = [level, home];
const ctx: TableContext = {
  definitions,
  values: new Map<string, Map<string, FieldValue>>([
    ["f-level", new Map([["a", 5]])],
    ["f-home", new Map([["a", ["h1", "h2"]]])],
  ]),
  itemName: (id) => ({ h1: "Ashgrove", h2: "Barovia" })[id as "h1" | "h2"],
  typeLabel: () => "Document",
  date: (ms) => `d${ms}`,
};

describe("cells", () => {
  const a = item("a", "Ash");
  it("show each kind of column as text", () => {
    expect(cellText(a, { by: "type" }, ctx)).toBe("Document");
    expect(cellText(a, { by: "created" }, ctx)).toBe("d1000");
    expect(cellText(a, { by: "updated" }, ctx)).toBe("d2000");
    expect(cellText(a, { by: "field", fieldId: "f-level" }, ctx)).toBe("5");
    expect(cellText(a, { by: "field", fieldId: "f-home" }, ctx)).toBe("Ashgrove, Barovia");
  });
  it("are empty when there is no value, and for a field that is gone", () => {
    const b = item("b", "Birch");
    expect(cellText(b, { by: "field", fieldId: "f-level" }, ctx)).toBe("");
    expect(cellText(a, { by: "field", fieldId: "gone" }, ctx)).toBe("");
    expect(columnLabel({ by: "field", fieldId: "gone" }, definitions)).toBe("(missing field)");
    expect(columnLabel({ by: "field", fieldId: "f-level" }, definitions)).toBe("Level");
  });
  it("build one row per item", () => {
    const columns: Column[] = [{ by: "type" }, { by: "field", fieldId: "f-level" }];
    const rows = buildRows([a, item("b", "Birch")], columns, ctx);
    expect(rows.map((r) => r.cells)).toEqual([["Document", "5"], ["Document", ""]]);
  });
});

describe("filterRows", () => {
  const rows = buildRows([item("a", "Ash"), item("b", "Birch")], [{ by: "field", fieldId: "f-home" }], ctx);
  it("keeps rows with every word in the name or a cell, ignoring case", () => {
    expect(filterRows(rows, "").length).toBe(2);
    expect(filterRows(rows, "ASH").map((r) => r.item.id)).toEqual(["a"]);
    expect(filterRows(rows, "ash barovia").map((r) => r.item.id)).toEqual(["a"]);
    expect(filterRows(rows, "birch barovia")).toEqual([]);
  });
});

describe("header clicks", () => {
  const q = (sort: Query["sort"]): Query => ({ ...emptyQuery(), sort });
  it("sort by the column, then flip, dropping the rest of the sort", () => {
    const start = q([{ by: "updated", dir: "desc" }, { by: "type", dir: "asc" }]);
    expect(nextSort(start, null)).toEqual([{ by: "name", dir: "asc" }]);
    expect(nextSort(q([{ by: "name", dir: "asc" }]), null)).toEqual([{ by: "name", dir: "desc" }]);
    expect(nextSort(q([{ by: "name", dir: "desc" }]), null)).toEqual([{ by: "name", dir: "asc" }]);
    const field: Column = { by: "field", fieldId: "f-level" };
    expect(nextSort(start, field)).toEqual([{ by: "field", fieldId: "f-level", dir: "asc" }]);
    expect(nextSort(q([{ by: "field", fieldId: "f-level", dir: "asc" }]), field)).toEqual([{ by: "field", fieldId: "f-level", dir: "desc" }]);
    expect(nextSort(q([{ by: "field", fieldId: "other", dir: "asc" }]), field)).toEqual([{ by: "field", fieldId: "f-level", dir: "asc" }]);
  });
  it("say which way a column is sorted", () => {
    const sorted = q([{ by: "field", fieldId: "f-level", dir: "desc" }]);
    expect(sortDirection(sorted, { by: "field", fieldId: "f-level" })).toBe("desc");
    expect(sortDirection(sorted, { by: "field", fieldId: "f-home" })).toBeNull();
    expect(sortDirection(sorted, null)).toBeNull();
    expect(sortDirection(q([{ by: "name", dir: "asc" }]), null)).toBe("asc");
  });
  it("always produce a sort the reader accepts", () => {
    const columns: (Column | null)[] = [null, { by: "type" }, { by: "created" }, { by: "updated" }, { by: "field", fieldId: "f" }];
    for (const column of columns) {
      expect(normalizeQuery({ ...emptyQuery(), sort: nextSort(emptyQuery(), column) }).ok).toBe(true);
    }
  });
});

describe("columns", () => {
  const cols: Column[] = [{ by: "type" }, { by: "updated" }, { by: "field", fieldId: "f" }];
  it("add without repeating, remove and move", () => {
    expect(addColumn(cols, { by: "type" })).toBe(cols);
    expect(addColumn(cols, { by: "field", fieldId: "g" }).length).toBe(4);
    expect(removeColumn(cols, 1).map((c) => c.by)).toEqual(["type", "field"]);
    expect(moveColumn(cols, 0, 1).map((c) => c.by)).toEqual(["updated", "type", "field"]);
    expect(moveColumn(cols, 0, -1)).toBe(cols);
    expect(moveColumn(cols, 2, 1)).toBe(cols);
  });
});

describe("a query's view", () => {
  const withView = (view: unknown) => normalizeQuery({ ...emptyQuery(), view });
  it("is left out until chosen, and kept in its proper form", () => {
    const plain = normalizeQuery(emptyQuery());
    expect(plain.ok && "view" in plain.query).toBe(false);
    const r = withView({ mode: "table", columns: [{ by: "type" }, { by: "type" }, { by: "field", fieldId: " f " }] });
    expect(r.ok && r.query.view).toEqual({ mode: "table", columns: [{ by: "type" }, { by: "field", fieldId: "f" }] });
    const odd = withView({ mode: "gallery" });
    expect(odd.ok && odd.query.view).toEqual({ mode: "list", columns: [] });
  });
  it("is refused when it can't be used", () => {
    expect(withView(5).ok).toBe(false);
    expect(withView({ columns: [{ by: "mood" }] }).ok).toBe(false);
    expect(withView({ columns: [{ by: "field" }] }).ok).toBe(false);
    const many = Array.from({ length: MAX_COLUMNS + 1 }, (_, i) => ({ by: "field", fieldId: `f${i}` }));
    expect(withView({ columns: many }).ok).toBe(false);
  });
});
