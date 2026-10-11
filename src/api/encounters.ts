import { invoke } from "@tauri-apps/api/core";
import type { EncounterState } from "../lib/encounters/state";

/** Mirrors the Rust `Encounter`. `stateJson` is read with `parseEncounterState` (`lib/encounters/state.ts`). */
export interface EncounterRecord {
  itemId: string;
  stateJson: string;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors the Rust `EncounterEntry` (a row of the encounter list). */
export interface EncounterEntry {
  itemId: string;
  name: string;
  phase: "setup" | "running" | "finished";
  round: number;
  combatants: number;
  updatedAt: number;
}

/** The saved state, or null for an encounter that is new (the app makes one from the project's ruleset). */
export const getEncounter = (itemId: string) => invoke<EncounterRecord | null>("get_encounter", { itemId });
export const setEncounterState = (itemId: string, state: EncounterState | string) =>
  invoke<void>("set_encounter_state", { itemId, stateJson: typeof state === "string" ? state : JSON.stringify(state) });
export const listEncounters = (projectId: string) => invoke<EncounterEntry[]>("list_encounters", { projectId });
