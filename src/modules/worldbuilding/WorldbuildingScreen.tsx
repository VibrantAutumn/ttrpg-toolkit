import { LibraryScreen } from "../../components/library/LibraryScreen";
import type { ItemTypeDefinition } from "../../registry/types";

export const documentType: ItemTypeDefinition = {
  id: "document",
  label: "Document",
  icon: "📄",
  toolId: "worldbuilding",
};

const itemTypes = [documentType];

export function WorldbuildingScreen() {
  return (
    <LibraryScreen
      library="worldbuilding"
      title="Worldbuilding"
      itemTypes={itemTypes}
    />
  );
}
