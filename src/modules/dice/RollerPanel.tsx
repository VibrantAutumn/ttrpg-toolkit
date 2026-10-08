import { useState } from "react";
import { RollLogList } from "../../components/results/RollLogList";
import { describeParseError, QUICK_ROLLS } from "../../lib/dice/formula";
import type { ResultKind } from "../../lib/results/rollLog";
import { rollLog } from "../../state/rollLog";
import { FormulaList } from "./FormulaList";

/** The roller: a formula box, quick rolls, your formulas, and the roll log. */
export function RollerPanel() {
  const [formula, setFormula] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<ResultKind | "all">("all");

  function roll() {
    const outcome = rollLog.roll(formula);
    setError(outcome.ok ? null : describeParseError(outcome.error));
  }

  return (
    <div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          roll();
        }}
      >
        <input
          value={formula}
          onChange={(e) => setFormula(e.currentTarget.value)}
          placeholder="2d6+3, 4d6kh3, d20 adv, 6d10>=8, 4dF..."
          aria-label="Dice formula"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit">Roll</button>
      </form>
      <div className="row wrap quick-rolls" role="group" aria-label="Quick rolls">
        {QUICK_ROLLS.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => {
              setError(null);
              rollLog.roll(q.notation);
            }}
          >
            {q.label}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

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
