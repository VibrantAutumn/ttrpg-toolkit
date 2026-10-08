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

/** Mirrors the Rust `SavedDraw`. */
export interface SavedDraw {
  itemId: string;
  sourceName: string;
  seed: number;
  /** The readable one-line form, e.g. `Tarot → The Fool, Two of Cups (reversed)`. */
  text: string;
  /** The finished draw as JSON text: `{ sourceId, options, cards: [{ id, name, reversed }] }`. */
  resultJson: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

/** Saves a finished draw as a new item in the Cards library. A blank name uses "<source> draw". */
export const saveDraw = (
  campaignId: string,
  name: string,
  folderId: string | null,
  sourceName: string,
  seed: number,
  text: string,
  resultJson: string,
) => invoke<Item>("save_draw", { campaignId, name, folderId, sourceName, seed, text, resultJson });
export const getSavedDraw = (itemId: string) => invoke<SavedDraw>("get_saved_draw", { itemId });
export const setSavedDrawNotes = (itemId: string, notes: string) =>
  invoke<void>("set_saved_draw_notes", { itemId, notes });

/** Every set, deck and pool in the campaign: what can be drawn from. */
export const listCollections = (campaignId: string) =>
  invoke<Item[]>("list_collections", { campaignId });

/** Mirrors the Rust `PlayDeck`: a running game (see `lib/cards/play.ts` for the state's shape). */
export interface PlayDeck {
  itemId: string;
  sourceId: string | null;
  sourceName: string;
  stateJson: string;
  createdAt: number;
  updatedAt: number;
}

/** One row of the list of decks in play. */
export interface PlayDeckEntry {
  itemId: string;
  name: string;
  sourceName: string;
  remaining: number;
  drawn: number;
}

/** Starts a deck in play. `stateJson` comes from `startPlay`; a blank name uses "<source> in play". */
export const createPlayDeck = (
  campaignId: string,
  name: string,
  folderId: string | null,
  sourceId: string | null,
  sourceName: string,
  stateJson: string,
) => invoke<Item>("create_play_deck", { campaignId, name, folderId, sourceId, sourceName, stateJson });
export const getPlayDeck = (itemId: string) => invoke<PlayDeck>("get_play_deck", { itemId });
export const setPlayDeckState = (itemId: string, stateJson: string) =>
  invoke<void>("set_play_deck_state", { itemId, stateJson });
export const listPlayDecks = (campaignId: string) =>
  invoke<PlayDeckEntry[]>("list_play_decks", { campaignId });
