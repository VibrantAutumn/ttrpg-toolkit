import type { ItemTypeDefinition } from "../../registry/types";
import { NamePresetView } from "./NamePresetView";

/** A saved name generator setup. Made from the Names tab ("Save as…"), not the library's New item form. */
export const namePresetType: ItemTypeDefinition = {
  id: "name_preset",
  label: "Name setup",
  icon: "🏷️",
  toolId: "tables",
  creatable: false,
  editor: NamePresetView,
};
