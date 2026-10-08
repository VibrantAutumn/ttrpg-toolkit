import { FormulaList } from "./FormulaList";
import { RollControls } from "./RollControls";

/** The quick tools panel's roller: a formula box, quick rolls, and your saved formulas. */
export function QuickRollerWidget() {
  return (
    <div>
      <RollControls />
      <FormulaList compact />
    </div>
  );
}
