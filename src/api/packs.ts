import { invoke } from "@tauri-apps/api/core";
import { base64ToBytes, bytesToBase64 } from "../lib/base64";
import type { Project } from "./projects";

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
  projectName: string;
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
  project: Project;
  counts: PackCounts;
  warnings: string[];
}

// Files travel to and from Rust as base64 text, not raw bytes: Android never
// delivers a raw request body to a command (Tauri sends JSON there), so raw
// bytes worked on Windows but failed on the phone. One text path works everywhere.

/** The pack file's contents for a project. Save them where the user chooses. */
export const exportProjectPack = async (projectId: string) =>
  base64ToBytes(await invoke<string>("export_project_pack", { projectId }));

/** Reads a pack file and describes it, without importing anything. */
export const previewPack = (bytes: Uint8Array) =>
  invoke<PackPreview>("preview_pack", { data: bytesToBase64(bytes) });

/** Imports a pack file as a new project. */
export const importPack = (bytes: Uint8Array) =>
  invoke<ImportResult>("import_pack", { data: bytesToBase64(bytes) });
