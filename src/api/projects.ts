import { invoke } from "@tauri-apps/api/core";

/** Mirrors the Rust `Project` struct. Timestamps are ms since the Unix epoch (UTC). */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export const listProjects = () => invoke<Project[]>("list_projects");

export const createProject = (name: string) =>
  invoke<Project>("create_project", { name });

export const renameProject = (id: string, name: string) =>
  invoke<Project>("rename_project", { id, name });

/** Soft delete: moves the project to the trash. */
export const deleteProject = (id: string) =>
  invoke<void>("delete_project", { id });

export const restoreProject = (id: string) =>
  invoke<Project>("restore_project", { id });

/** The project open on this device, or null if none is chosen. */
export const getCurrentProject = () =>
  invoke<Project | null>("get_current_project");

export const setCurrentProject = (id: string) =>
  invoke<Project>("set_current_project", { id });

export const getSchemaVersion = () => invoke<number>("db_schema_version");
