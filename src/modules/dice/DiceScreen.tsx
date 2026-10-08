import { useState } from "react";
import { LibraryScreen } from "../../components/library/LibraryScreen";
import { RollerPanel } from "./RollerPanel";
import { savedRollType } from "./savedRollType";

const itemTypes = [savedRollType];

/** The Dice tool: the roller and log, and the library of saved rolls. */
export function DiceScreen() {
  const [tab, setTab] = useState<"roll" | "saved">("roll");
  return (
    <section>
      <h1>Dice</h1>
      <div className="row" role="tablist" aria-label="Dice sections">
        <button role="tab" aria-selected={tab === "roll"} className={tab === "roll" ? "active" : undefined} onClick={() => setTab("roll")}>
          Roll
        </button>
        <button role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "active" : undefined} onClick={() => setTab("saved")}>
          Saved rolls
        </button>
      </div>
      {/* Both stay mounted (just hidden) so the library keeps its folder and search. */}
      <div hidden={tab !== "roll"}>
        <RollerPanel />
      </div>
      <div hidden={tab !== "saved"}>
        <LibraryScreen library="dice" title="Saved rolls" itemTypes={itemTypes} allowNewItems={false} />
      </div>
    </section>
  );
}
