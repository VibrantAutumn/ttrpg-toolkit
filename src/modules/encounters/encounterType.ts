import type { ItemTypeDefinition } from "../../registry/types";
import { EncounterView } from "./EncounterView";

/** An encounter: a combat (or chase, or heist) set up and run under the project's ruleset. */
export const encounterType: ItemTypeDefinition = {
  id: "encounter",
  label: "Encounter",
  icon: "⚔️",
  toolId: "encounters",
  editor: EncounterView,
};
