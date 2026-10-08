import { invoke } from "@tauri-apps/api/core";
import type { Item } from "./library";

/** Mirrors the Rust `CardDetails`. */
export interface CardDetails {
  itemId: string;
  value: string;
  notes: string;
}

/** A picture (bytes as base64 text) on its way to or from Rust. */
export interface ImageData {
  itemId: string;
  mime: string;
  data: string;
}

export const getCardDetails = (itemId: string) =>
  invoke<CardDetails>("get_card_details", { itemId });
export const setCardDetails = (itemId: string, value: string, notes: string) =>
  invoke<void>("set_card_details", { itemId, value, notes });

/** `image` and `thumb` are base64 text (see `prepareCardImage`). */
export const setCardImage = (itemId: string, mime: string, image: string, thumb: string) =>
  invoke<void>("set_card_image", { itemId, mime, image, thumb });
export const removeCardImage = (itemId: string) => invoke<void>("remove_card_image", { itemId });
export const getCardImage = (itemId: string) =>
  invoke<ImageData | null>("get_card_image", { itemId });
export const getCardThumbs = (itemIds: string[]) =>
  invoke<ImageData[]>("get_card_thumbs", { itemIds });

/** A picture as something an <img> can show. */
export const imageSrc = (image: ImageData) => `data:${image.mime};base64,${image.data}`;

export const addToCollection = (collectionId: string, memberId: string) =>
  invoke<void>("add_to_collection", { collectionId, memberId });
export const removeFromCollection = (collectionId: string, memberId: string) =>
  invoke<void>("remove_from_collection", { collectionId, memberId });
/** What is directly inside a set, deck or pool, in order. */
export const listCollectionMembers = (collectionId: string) =>
  invoke<Item[]>("list_collection_members", { collectionId });
/** The sets, decks and pools that directly hold an item. */
export const listContainers = (itemId: string) => invoke<Item[]>("list_containers", { itemId });
/** Every distinct card a set, deck or pool reaches. */
export const resolveCollectionCards = (collectionId: string) =>
  invoke<Item[]>("resolve_collection_cards", { collectionId });
/** What could still be added to a set, deck or pool. */
export const listCollectionCandidates = (collectionId: string) =>
  invoke<Item[]>("list_collection_candidates", { collectionId });
