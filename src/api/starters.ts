import { invoke } from "@tauri-apps/api/core";
import type { BundleJson } from "../lib/cards/starters";
import type { TableBundleJson } from "../lib/tables/starterTables";
import type { TemplateBundleJson } from "../lib/templates/starterTemplates";

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

/** Mirrors the Rust `TableInstallResult`. */
export interface TableInstallResult {
  folderId: string;
  tables: number;
  entries: number;
  presets: number;
}

/**
 * Adds a set of starter tables (and the name setups that use them) to a campaign
 * in one all-or-nothing step. Refuses if it was added before or a table with the
 * same name as one of its tables already exists.
 */
export const installTableBundle = (campaignId: string, bundle: TableBundleJson) =>
  invoke<TableInstallResult>("install_table_bundle", { campaignId, bundleJson: JSON.stringify(bundle) });

/** Mirrors the Rust `TemplateInstallResult`. */
export interface TemplateInstallResult {
  folderId: string;
  templates: number;
  fieldsMade: number;
  setsMade: number;
}

/**
 * Adds the starter templates (and the fields and field sets they use) to a campaign in one
 * all-or-nothing step. Refuses if they were added before, if a template with one of their names
 * exists, or if a field of one of their names exists with a different kind.
 */
export const installTemplateBundle = (campaignId: string, bundle: TemplateBundleJson) =>
  invoke<TemplateInstallResult>("install_template_bundle", { campaignId, bundleJson: JSON.stringify(bundle) });
