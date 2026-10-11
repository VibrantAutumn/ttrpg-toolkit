import { useState } from "react";
import { LibraryScreen } from "../../components/library/LibraryScreen";
import { GeneratorsHome } from "./GeneratorsHome";
import { StarterGenerators } from "./StarterGenerators";
import { StarterTables } from "./StarterTables";
import { generatorType } from "./generatorType";
import { tableType } from "./tableType";

/** The Generators tool: a home that asks what you want to generate, and the library of tables and generators. */
export function GeneratorsScreen() {
  const [tab, setTab] = useState<"home" | "library">("home");
  return (
    <section>
      <h1>Generators</h1>
      <div className="row" role="tablist" aria-label="Generators sections">
        <button role="tab" aria-selected={tab === "home"} className={tab === "home" ? "active" : undefined} onClick={() => setTab("home")}>
          Generate
        </button>
        <button role="tab" aria-selected={tab === "library"} className={tab === "library" ? "active" : undefined} onClick={() => setTab("library")}>
          Library
        </button>
      </div>
      {/* Both stay mounted (just hidden) so the library keeps its folder and search. */}
      <div hidden={tab !== "home"}>
        <GeneratorsHome onOpenLibrary={() => setTab("library")} />
      </div>
      <div hidden={tab !== "library"}>
        <StarterTables />
        <StarterGenerators />
        <LibraryScreen library="tables" title="Tables and generators" itemTypes={[tableType, generatorType]} />
      </div>
    </section>
  );
}
