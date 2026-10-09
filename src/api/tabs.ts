import { invoke } from "@tauri-apps/api/core";
import type { Item } from "./library";

/**
 * A tab of a page. A document tab's `item` is its document (a real item with its own text,
 * fields and links, kept inside the page); an embed tab's `item` is what it shows (it may be in
 * the trash), or null for an empty slot waiting to be filled.
 */
export interface Tab {
  id: string;
  parentId: string;
  kind: "document" | "embed";
  position: number;
  /** An embed tab's name; a document tab is named by its document. */
  title: string;
  item: Item | null;
}

/** Where a child document lives: its page, and which tab it is. */
export interface TabFamily {
  parent: Item;
  tabId: string;
}

export const listTabs = (parentId: string) => invoke<Tab[]>("list_tabs", { parentId });

/** The page an item is a document tab of (null if it isn't one). */
export const getTabFamily = (itemId: string) => invoke<TabFamily | null>("get_tab_family", { itemId });

export const addDocumentTab = (parentId: string, name: string) => invoke<Tab>("add_document_tab", { parentId, name });

/** Adds an embed: a live view of `targetId`, or an empty slot (null) to fill later. */
export const addEmbedTab = (parentId: string, title: string, targetId: string | null) =>
  invoke<Tab>("add_embed_tab", { parentId, title, targetId });

/** Changes an embed tab's name and what it shows (null empties the slot). */
export const updateEmbedTab = (tabId: string, title: string, targetId: string | null) =>
  invoke<Tab>("update_embed_tab", { tabId, title, targetId });

/** Removes a tab. A document tab's document goes to the trash (restore it there to bring the tab back). */
export const removeTab = (tabId: string) => invoke<void>("remove_tab", { tabId });

/** Moves a tab one place earlier (-1) or later (1). */
export const moveTab = (tabId: string, delta: number) => invoke<void>("move_tab", { tabId, delta });
