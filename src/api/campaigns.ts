import { invoke } from "@tauri-apps/api/core";

/** Mirrors the Rust `Campaign` struct. Timestamps are ms since the Unix epoch (UTC). */
export interface Campaign {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export const listCampaigns = () => invoke<Campaign[]>("list_campaigns");

export const createCampaign = (name: string) =>
  invoke<Campaign>("create_campaign", { name });

export const renameCampaign = (id: string, name: string) =>
  invoke<Campaign>("rename_campaign", { id, name });

/** Soft delete: moves the campaign to the trash. */
export const deleteCampaign = (id: string) =>
  invoke<void>("delete_campaign", { id });

export const restoreCampaign = (id: string) =>
  invoke<Campaign>("restore_campaign", { id });

/** The campaign open on this device, or null if none is chosen. */
export const getCurrentCampaign = () =>
  invoke<Campaign | null>("get_current_campaign");

export const setCurrentCampaign = (id: string) =>
  invoke<Campaign>("set_current_campaign", { id });

export const getSchemaVersion = () => invoke<number>("db_schema_version");
