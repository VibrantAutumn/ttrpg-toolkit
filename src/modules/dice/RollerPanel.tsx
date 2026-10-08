import { useState } from "react";
import { RollLogList } from "../../components/results/RollLogList";
import type { ResultKind } from "../../lib/results/rollLog";
import { FormulaList } from "./FormulaList";
import { RollControls } from "./RollControls";

/** The roller: a formula box, quick rolls, your formulas, and the roll log. */
export function RollerPanel() {
  const [show, setShow] = useState<ResultKind | "all">("all");

  return (
    <div>
      <RollControls />

      <FormulaList />

      <div className="row wrap">
        <h2 className="grow">Roll log</h2>
        <select
          value={show}
          onChange={(e) => setShow(e.currentTarget.value as ResultKind | "all")}
          aria-label="Show which results"
        >
          <option value="all">All results</option>
          <option value="dice">Dice</option>
          <option value="draw">Card draws</option>
        </select>
      </div>
      <RollLogList
        kind={show}
        showClear
        emptyText="Nothing here yet. The log is cleared when the app restarts; save a result to keep it."
      />
    </div>
  );
}
