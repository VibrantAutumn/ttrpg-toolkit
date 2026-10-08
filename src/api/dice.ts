import { invoke } from "@tauri-apps/api/core";
import type { Item } from "./library";

/** Mirrors the Rust `SavedRoll`. */
export interface SavedRoll {
  itemId: string;
  notation: string;
  seed: number;
  /** The readable one-line form, e.g. `2d6+3 → [4, 5] + 3 = 12`. */
  text: string;
  /** The finished roll as JSON text (see `DiceResult`). */
  resultJson: string;
  createdAt: number;
  updatedAt: number;
}

/** Saves a finished roll as a new item in the Dice library. A blank name uses the notation. */
export const saveRoll = (
  campaignId: string,
  name: string,
  folderId: string | null,
  notation: string,
  seed: number,
  text: string,
  resultJson: string,
) =>
  invoke<Item>("save_roll", { campaignId, name, folderId, notation, seed, text, resultJson });

export const getSavedRoll = (itemId: string) =>
  invoke<SavedRoll>("get_saved_roll", { itemId });
