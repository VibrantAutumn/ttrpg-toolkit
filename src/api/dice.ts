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
  projectId: string,
  name: string,
  folderId: string | null,
  notation: string,
  seed: number,
  text: string,
  resultJson: string,
) =>
  invoke<Item>("save_roll", { projectId, name, folderId, notation, seed, text, resultJson });

export const getSavedRoll = (itemId: string) =>
  invoke<SavedRoll>("get_saved_roll", { itemId });

/** Mirrors the Rust `Formula`. */
export interface Formula {
  itemId: string;
  notation: string;
  createdAt: number;
  updatedAt: number;
}

/** One row of the roller's flat list of formulas. */
export interface FormulaEntry {
  itemId: string;
  name: string;
  notation: string;
  folderId: string | null;
}

/** Saves a formula as a new Dice library item. Check the notation with `checkFormula` first. */
export const createFormula = (
  projectId: string,
  name: string,
  folderId: string | null,
  notation: string,
) => invoke<Item>("create_formula", { projectId, name, folderId, notation });

export const getFormula = (itemId: string) => invoke<Formula>("get_formula", { itemId });

export const setFormulaNotation = (itemId: string, notation: string) =>
  invoke<void>("set_formula_notation", { itemId, notation });

export const listFormulas = (projectId: string) =>
  invoke<FormulaEntry[]>("list_formulas", { projectId });
