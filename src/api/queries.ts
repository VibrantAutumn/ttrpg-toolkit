import { invoke } from "@tauri-apps/api/core";
import type { Query } from "../lib/queries/query";
import type { Item } from "./library";

/** Mirrors the Rust `QueryResult`. */
export interface QueryResult {
  items: Item[];
  /** True when there were more matches than the engine returns. */
  truncated: boolean;
}

/** Mirrors the Rust `SmartCollection`. `queryJson` is read with `parseQuery` (`lib/queries/query.ts`). */
export interface SmartCollection {
  itemId: string;
  queryJson: string;
  createdAt: number;
  updatedAt: number;
}

/** Runs a query now (also one that isn't saved). `onlyType` keeps one kind of item. */
export const runQuery = (campaignId: string, query: Query, onlyType?: string) =>
  invoke<QueryResult>("run_query", { campaignId, queryJson: JSON.stringify(query), onlyType: onlyType ?? null });

export const getSmartCollection = (itemId: string) => invoke<SmartCollection>("get_smart_collection", { itemId });
export const setSmartCollectionQuery = (itemId: string, query: Query | string) =>
  invoke<void>("set_smart_collection_query", { itemId, queryJson: typeof query === "string" ? query : JSON.stringify(query) });
export const runSmartCollection = (itemId: string, onlyType?: string) =>
  invoke<QueryResult>("run_smart_collection", { itemId, onlyType: onlyType ?? null });
