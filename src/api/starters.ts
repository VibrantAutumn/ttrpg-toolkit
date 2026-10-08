import { invoke } from "@tauri-apps/api/core";
import type { BundleJson } from "../lib/cards/starters";

/** Mirrors the Rust `InstallResult`. */
export interface InstallResult {
  folderId: string;
  deckId: string;
  cards: number;
  sets: number;
}

/**
 * Adds a starter deck to a campaign in one all-or-nothing step. The bundle is
 * sent as one piece of text (pictures inside it as base64), never raw bytes.
 */
export const installCardBundle = (campaignId: string, bundle: BundleJson) =>
  invoke<InstallResult>("install_card_bundle", { campaignId, bundleJson: JSON.stringify(bundle) });

/** The ids (like `starter:tarokka`) of the starter decks this campaign already has. */
export const listInstalledStarters = (campaignId: string) =>
  invoke<string[]>("list_installed_starters", { campaignId });
