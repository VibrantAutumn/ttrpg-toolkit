import { useState } from "react";
import { LibraryScreen } from "../../components/library/LibraryScreen";
import { documentType } from "./documentType";
import { FilterSets } from "./FilterSets";
import { NewFromTemplate } from "./NewFromTemplate";
import { smartCollectionType } from "./smartCollectionType";
import { templateType } from "./templateType";

const itemTypes = [documentType, templateType, smartCollectionType];

/**
 * The Worldbuilding tool: the pages (documents and templates), and the filter sets. Properties
 * are managed on the pages themselves (see `ItemFieldsPanel`), so there is no tab for them.
 */
export function WorldbuildingScreen() {
  const [tab, setTab] = useState<"pages" | "filters">("pages");
  return (
    <section>
      <div className="row" role="tablist" aria-label="Worldbuilding sections">
        <button role="tab" aria-selected={tab === "pages"} className={tab === "pages" ? "active" : undefined} onClick={() => setTab("pages")}>
          Pages
        </button>
        <button role="tab" aria-selected={tab === "filters"} className={tab === "filters" ? "active" : undefined} onClick={() => setTab("filters")}>
          Filter sets
        </button>
      </div>
      {/* Both stay mounted (just hidden) so the library keeps its folder and search. */}
      <div hidden={tab !== "pages"}>
        <LibraryScreen
          library="worldbuilding"
          title="Worldbuilding"
          showTitle={false}
          itemTypes={itemTypes}
          extraCreate={({ folderId }) => <NewFromTemplate folderId={folderId} />}
        />
      </div>
      <div hidden={tab !== "filters"}>
        <h1>Filter sets</h1>
        <FilterSets />
      </div>
    </section>
  );
}
