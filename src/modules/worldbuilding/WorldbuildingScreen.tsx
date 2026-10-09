import { useState } from "react";
import { FieldsManager } from "../../components/fields/FieldsManager";
import { LibraryScreen } from "../../components/library/LibraryScreen";
import { documentType } from "./documentType";

const itemTypes = [documentType];

/** The Worldbuilding tool: the document library, and the fields (and field sets) any item can use. */
export function WorldbuildingScreen() {
  const [tab, setTab] = useState<"documents" | "fields">("documents");
  return (
    <section>
      <div className="row" role="tablist" aria-label="Worldbuilding sections">
        <button role="tab" aria-selected={tab === "documents"} className={tab === "documents" ? "active" : undefined} onClick={() => setTab("documents")}>
          Documents
        </button>
        <button role="tab" aria-selected={tab === "fields"} className={tab === "fields" ? "active" : undefined} onClick={() => setTab("fields")}>
          Fields
        </button>
      </div>
      {/* Both stay mounted (just hidden) so the library keeps its folder and search. */}
      <div hidden={tab !== "documents"}>
        <LibraryScreen library="worldbuilding" title="Worldbuilding" itemTypes={itemTypes} />
      </div>
      <div hidden={tab !== "fields"}>
        <h1>Fields</h1>
        <FieldsManager />
      </div>
    </section>
  );
}
