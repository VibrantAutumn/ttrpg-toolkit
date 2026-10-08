import type { ItemTypeDefinition } from "../../registry/types";
import { DocumentEditor } from "./DocumentEditor";

export const documentType: ItemTypeDefinition = {
  id: "document",
  label: "Document",
  icon: "📄",
  toolId: "worldbuilding",
  editor: DocumentEditor,
};
