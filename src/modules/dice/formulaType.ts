import type { ItemTypeDefinition } from "../../registry/types";
import { FormulaView } from "./FormulaView";

export const formulaType: ItemTypeDefinition = {
  id: "formula",
  label: "Formula",
  icon: "🧮",
  toolId: "dice",
  creatable: false, // made from the Roll tab, which checks the notation
  editor: FormulaView,
};
