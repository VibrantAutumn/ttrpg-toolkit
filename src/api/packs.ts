import { invoke } from "@tauri-apps/api/core";
import type { Campaign } from "./campaigns";

/** Mirrors the Rust `Counts` in the pack format. */
export interface PackCounts {
  folders: number;
  items: number;
  tags: number;
  itemTags: number;
  links: number;
  documents: number;
}

/** What the import preview shows about a pack file. */
export interface PackPreview {
  campaignName: string;
  createdAt: number;
  appVersion: string;
  formatVersion: number;
  counts: PackCounts;
  /** How many of the folders, items and tags were in the pack's trash. */
  trashed: number;
  /** Plain-language notes about anything that had to be fixed or skipped. */
  warnings: string[];
}

export interface ImportResult {
  campaign: Campaign;
  counts: PackCounts;
  warnings: string[];
}

// Files travel to and from Rust as raw bytes (not JSON), so big packs stay fast.

/** The pack file's contents for a campaign. Save them where the user chooses. */
export const exportCampaignPack = async (campaignId: string) =>
  new Uint8Array(await invoke<ArrayBuffer>("export_campaign_pack", { campaignId }));

/** Reads a pack file and describes it, without importing anything. */
export const previewPack = (bytes: Uint8Array) =>
  invoke<PackPreview>("preview_pack", bytes);

/** Imports a pack file as a new campaign. */
export const importPack = (bytes: Uint8Array) =>
  invoke<ImportResult>("import_pack", bytes);
