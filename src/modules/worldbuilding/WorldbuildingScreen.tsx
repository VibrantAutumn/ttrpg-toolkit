import { LibraryScreen } from "../../components/library/LibraryScreen";
import { documentType } from "./documentType";

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
