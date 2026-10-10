import { invoke } from "@tauri-apps/api/core";

/** Mirrors the Rust `Entry`. */
export interface TableEntry {
  id: string;
  text: string;
  /** How many places the entry takes in the roll; 0 = never picked. */
  weight: number;
  /** Project tags on the entry (ids). */
  tagIds: string[];
}

/** Mirrors the Rust `TableDetail`. */
export interface TableDetail {
  itemId: string;
  notes: string;
  /** The printed die the ranges are shown against (d20, d100...), if any. */
  dieSize: number | null;
  /** Skip the last N entries rolled from this table (0 = off). */
  avoidRecent: number;
  entries: TableEntry[];
  /** Another live table in the project has this name (ignoring case). */
  duplicateName: boolean;
  /** Slots that name this table find it (it is the oldest with that name). */
  foundBySlots: boolean;
}

/** Mirrors the Rust `TableSummary`. */
export interface TableSummary {
  itemId: string;
  name: string;
  entries: number;
  duplicateName: boolean;
  foundBySlots: boolean;
}

/** Mirrors the Rust `RollableTable`: what the roller in `lib/tables/roll.ts` needs. */
export interface RollableTableData {
  id: string;
  name: string;
  avoidRecent: number;
  /** Each entry carries its live project tags (ids). */
  entries: { id: string; text: string; weight: number; tagIds: string[] }[];
  /** Entry ids recently rolled from this table, newest first. */
  recent: string[];
}

/** An entry whose text contains a name: a candidate for rewriting slots after a rename. */
export interface EntryRef {
  entryId: string;
  tableId: string;
  tableName: string;
  text: string;
}

export interface EntryInput {
  text: string;
  weight?: number;
}

export interface EntryTextUpdate {
  entryId: string;
  text: string;
}

export interface PickedEntry {
  tableId: string;
  entryId: string;
}

export const getTable = (itemId: string) => invoke<TableDetail>("get_table", { itemId });
export const setTableNotes = (itemId: string, notes: string) => invoke<void>("set_table_notes", { itemId, notes });
export const setTableOptions = (itemId: string, dieSize: number | null, avoidRecent: number) =>
  invoke<void>("set_table_options", { itemId, dieSize, avoidRecent });

/** Adds entries at the end of the table, all or nothing. */
export const addTableEntries = (tableId: string, entries: EntryInput[]) =>
  invoke<TableEntry[]>("add_table_entries", { tableId, entries });
export const updateTableEntry = (entryId: string, text: string, weight: number) =>
  invoke<void>("update_table_entry", { entryId, text, weight });
/** Rewrites the text of several entries together (all or nothing). */
export const setTableEntryTexts = (updates: EntryTextUpdate[]) =>
  invoke<void>("set_table_entry_texts", { updates });
export const deleteTableEntry = (entryId: string) => invoke<void>("delete_table_entry", { entryId });
export const restoreTableEntry = (entryId: string) => invoke<void>("restore_table_entry", { entryId });
/** Moves an entry to a place in the order (0 = first). */
export const moveTableEntry = (entryId: string, toIndex: number) =>
  invoke<void>("move_table_entry", { entryId, toIndex });
export const addTableEntryTag = (entryId: string, tagId: string) =>
  invoke<void>("add_table_entry_tag", { entryId, tagId });
export const removeTableEntryTag = (entryId: string, tagId: string) =>
  invoke<void>("remove_table_entry_tag", { entryId, tagId });

export const listTables = (projectId: string) => invoke<TableSummary[]>("list_tables", { projectId });
/** Every table with its entries and recent picks, oldest table first. */
export const loadRollableTables = (projectId: string) =>
  invoke<RollableTableData[]>("load_rollable_tables", { projectId });
export const findEntriesMentioning = (projectId: string, needle: string) =>
  invoke<EntryRef[]>("find_entries_mentioning", { projectId, needle });

/** Remembers the entries a roll picked (oldest first), for "avoid recent". */
export const recordTableRecent = (picks: PickedEntry[]) => invoke<void>("record_table_recent", { picks });
export const clearTableRecent = (tableId: string) => invoke<void>("clear_table_recent", { tableId });
