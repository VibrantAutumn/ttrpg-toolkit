import { useState } from "react";
import { LibraryScreen } from "../../components/library/LibraryScreen";
import { formulaType } from "./formulaType";
import { RollerPanel } from "./RollerPanel";
import { savedRollType } from "./savedRollType";

const itemTypes = [formulaType, savedRollType];

/** The Dice tool: the roller (quick rolls, formulas, log), and the library of formulas and saved rolls. */
export function DiceScreen() {
  const [tab, setTab] = useState<"roll" | "library">("roll");
  return (
    <section>
      <h1>Dice</h1>
      <div className="row" role="tablist" aria-label="Dice sections">
        <button role="tab" aria-selected={tab === "roll"} className={tab === "roll" ? "active" : undefined} onClick={() => setTab("roll")}>
          Roll
        </button>
        <button role="tab" aria-selected={tab === "library"} className={tab === "library" ? "active" : undefined} onClick={() => setTab("library")}>
          Library
        </button>
      </div>
      {/* Both stay mounted (just hidden) so the library keeps its folder and search. */}
      <div hidden={tab !== "roll"}>
        <RollerPanel />
      </div>
      <div hidden={tab !== "library"}>
        <LibraryScreen library="dice" title="Dice library" itemTypes={itemTypes} allowNewItems={false} />
      </div>
    </section>
  );
}
