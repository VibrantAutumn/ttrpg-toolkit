import { useState } from "react";
import { describeParseError, QUICK_ROLLS } from "../../lib/dice/formula";
import { rollLog } from "../../state/rollLog";

/** A formula box with a Roll button, and the one-tap quick rolls. Results go to the roll log. */
export function RollControls() {
  const [formula, setFormula] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    </div>
  );
}
