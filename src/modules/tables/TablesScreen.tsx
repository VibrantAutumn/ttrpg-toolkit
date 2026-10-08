import { useState } from "react";
import { LibraryScreen } from "../../components/library/LibraryScreen";
import { TableList } from "./TableList";
import { tableType } from "./tableType";

/** The Tables tool: roll any table (with the log of table rolls), and the library of tables. */
export function TablesScreen() {
  const [tab, setTab] = useState<"roll" | "library">("roll");
  return (
    <section>
      <h1>Tables</h1>
      <div className="row" role="tablist" aria-label="Tables sections">
        <button role="tab" aria-selected={tab === "roll"} className={tab === "roll" ? "active" : undefined} onClick={() => setTab("roll")}>
          Roll
        </button>
        <button role="tab" aria-selected={tab === "library"} className={tab === "library" ? "active" : undefined} onClick={() => setTab("library")}>
          Library
        </button>
      </div>
      {/* Both stay mounted (just hidden) so the library keeps its folder and search. */}
      <div hidden={tab !== "roll"}>
        <TableList />
      </div>
      <div hidden={tab !== "library"}>
        <LibraryScreen library="tables" title="Tables library" itemTypes={[tableType]} />
      </div>
    </section>
  );
}
