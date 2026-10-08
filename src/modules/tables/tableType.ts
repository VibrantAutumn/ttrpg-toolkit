import type { ItemTypeDefinition } from "../../registry/types";
import { TableEditor } from "./TableEditor";

export const tableType: ItemTypeDefinition = {
  id: "table",
  label: "Table",
  icon: "📋",
  toolId: "tables",
  editor: TableEditor,
};
