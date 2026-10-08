import { invoke } from "@tauri-apps/api/core";
import type { Item } from "./library";

/**
 * Saved name generator setups. The setup is JSON text; its shape is read and
 * written by `parseSetup` / `serializeSetup` in `lib/tables/nameSetup.ts`.
 */

/** Mirrors the Rust `NamePreset`. */
export interface NamePreset {
  itemId: string;
  setupJson: string;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `PresetEntry`: one row of the list of presets. */
export interface PresetEntry {
  itemId: string;
  name: string;
  setupJson: string;
  folderId: string | null;
}

/** Saves a setup as a new preset in the Tables library. */
export const createNamePreset = (campaignId: string, name: string, folderId: string | null, setupJson: string) =>
  invoke<Item>("create_name_preset", { campaignId, name, folderId, setupJson });
export const getNamePreset = (itemId: string) => invoke<NamePreset>("get_name_preset", { itemId });
export const setNamePresetSetup = (itemId: string, setupJson: string) =>
  invoke<void>("set_name_preset_setup", { itemId, setupJson });
export const listNamePresets = (campaignId: string) => invoke<PresetEntry[]>("list_name_presets", { campaignId });
