import { useState } from "react";
import { RollLogList } from "../../components/results/RollLogList";
import type { ResultKind } from "../../lib/results/rollLog";
import { DiceRoller } from "./DiceRoller";

/** The roller (dice, formula box, saved formulas) and the roll log. */
export function RollerPanel() {
  const [show, setShow] = useState<ResultKind | "all">("all");

  return (
    <div>
      <DiceRoller />

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
          <option value="table">Table rolls</option>
          <option value="name">Names</option>
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
