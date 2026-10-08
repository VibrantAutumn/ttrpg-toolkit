import { invoke } from "@tauri-apps/api/core";

// Types mirror the Rust structs. Timestamps are ms since the Unix epoch (UTC).

export interface Folder {
  id: string;
  campaignId: string;
  library: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Item {
  id: string;
  campaignId: string;
  library: string;
  itemType: string;
  name: string;
  icon: string | null;
  folderId: string | null;
  visibility: "default" | "visible" | "secret";
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface Tag {
  id: string;
  campaignId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface TagLink {
  itemId: string;
  tag: Tag;
}

export interface Trash {
  folders: Folder[];
  items: Item[];
}

// Folders
export const listFolders = (campaignId: string, library: string) =>
  invoke<Folder[]>("list_folders", { campaignId, library });
export const createFolder = (
  campaignId: string,
  library: string,
  parentId: string | null,
  name: string,
) => invoke<Folder>("create_folder", { campaignId, library, parentId, name });
export const renameFolder = (id: string, name: string) =>
  invoke<Folder>("rename_folder", { id, name });
export const moveFolder = (id: string, parentId: string | null) =>
  invoke<Folder>("move_folder", { id, parentId });
export const deleteFolder = (id: string) => invoke<void>("delete_folder", { id });

// Items
export const listItems = (
  campaignId: string,
  library: string,
  folderId: string | null,
) => invoke<Item[]>("list_items", { campaignId, library, folderId });
export const createItem = (
  campaignId: string,
  library: string,
  itemType: string,
  name: string,
  folderId: string | null,
) =>
  invoke<Item>("create_item", { campaignId, library, itemType, name, folderId });
export const renameItem = (id: string, name: string) =>
  invoke<Item>("rename_item", { id, name });
export const moveItem = (id: string, folderId: string | null) =>
  invoke<Item>("move_item", { id, folderId });
export const deleteItem = (id: string) => invoke<void>("delete_item", { id });

export const getItem = (id: string) => invoke<Item>("get_item", { id });

// Document text (Markdown)
export const getDocumentBody = (itemId: string) =>
  invoke<string>("get_document_body", { itemId });
export const setDocumentBody = (itemId: string, body: string) =>
  invoke<void>("set_document_body", { itemId, body });

// Links (items this item links to) and backlinks (items that link to it)
export const listLinks = (itemId: string) =>
  invoke<Item[]>("list_links", { itemId });
export const listBacklinks = (itemId: string) =>
  invoke<Item[]>("list_backlinks", { itemId });
export const addLink = (sourceItemId: string, targetItemId: string) =>
  invoke<void>("add_link", { sourceItemId, targetItemId });
export const removeLink = (sourceItemId: string, targetItemId: string) =>
  invoke<void>("remove_link", { sourceItemId, targetItemId });

// Trash
export const listTrash = (campaignId: string, library: string) =>
  invoke<Trash>("list_trash", { campaignId, library });
export const restoreItem = (id: string) => invoke<Item>("restore_item", { id });
export const restoreFolder = (id: string) =>
  invoke<Folder>("restore_folder", { id });
export const purgeItem = (id: string) => invoke<void>("purge_item", { id });
export const purgeFolder = (id: string) => invoke<void>("purge_folder", { id });
export const emptyTrash = (campaignId: string, library: string) =>
  invoke<number>("empty_trash", { campaignId, library });

// Tags
export const listTags = (campaignId: string) =>
  invoke<Tag[]>("list_tags", { campaignId });
export const createTag = (
  campaignId: string,
  parentId: string | null,
  name: string,
  color: string | null,
) => invoke<Tag>("create_tag", { campaignId, parentId, name, color });
export const listItemTags = (itemId: string) =>
  invoke<Tag[]>("list_item_tags", { itemId });
export const addTagToItem = (itemId: string, tagId: string) =>
  invoke<void>("add_tag_to_item", { itemId, tagId });
export const removeTagFromItem = (itemId: string, tagId: string) =>
  invoke<void>("remove_tag_from_item", { itemId, tagId });
export const listTagLinks = (campaignId: string, library: string) =>
  invoke<TagLink[]>("list_tag_links", { campaignId, library });

// Search
export const searchItems = (
  campaignId: string,
  text: string,
  library: string | null,
  limit?: number,
) => invoke<Item[]>("search_items", { campaignId, text, library, limit });
