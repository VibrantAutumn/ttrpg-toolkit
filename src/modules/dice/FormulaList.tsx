import { useEffect, useState } from "react";
import { createFormula, listFormulas, type FormulaEntry } from "../../api/dice";
import { checkFormula, describeParseError } from "../../lib/dice/formula";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { rollLog } from "../../state/rollLog";

/**
 * Your saved formulas, one tap to roll, plus a small form to add another. `compact`
 * (the quick tools panel) leaves out the heading and the form: make formulas in the Dice tool.
 */
export function FormulaList({ compact = false }: { compact?: boolean }) {
  const { campaign } = useCurrentCampaign();
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const campaignId = campaign?.id ?? null;

  const [formulas, setFormulas] = useState<FormulaEntry[]>([]);
  const [name, setName] = useState("");
  const [notation, setNotation] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setFormulas([]);
      return;
    }
    let active = true;
    listFormulas(campaignId)
      .then((list) => active && setFormulas(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  function rollFormula(f: FormulaEntry) {
    const outcome = rollLog.roll(f.notation, undefined, f.name);
    setError(
      outcome.ok ? null : `“${f.name}” can't be rolled: ${describeParseError(outcome.error)}`,
    );
  }

  async function add() {
    if (!campaignId) return;
    const check = checkFormula(notation);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    try {
      await createFormula(campaignId, name, null, check.notation);
      setName("");
      setNotation("");
      setError(null);
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      {!compact && <h2>Formulas</h2>}
      {!campaignId ? (
        <p className="empty">Choose a campaign to save formulas.</p>
      ) : (
        <>
          {formulas.length === 0 ? (
            <p className="empty">
              {compact
                ? "No saved formulas yet. Make them in the Dice tool."
                : "No formulas yet. Add one below, like “Attack” with 1d20+5."}
            </p>
          ) : (
            <ul className="list">
              {formulas.map((f) => (
                <li key={f.itemId} className="row wrap">
                  <span className="name">
                    <button className="link name" onClick={() => openItem(f.itemId)}>
                      {f.name}
                    </button>{" "}
                    <small className="meta roll-text">{f.notation}</small>
                  </span>
                  <button onClick={() => rollFormula(f)}>Roll</button>
                </li>
              ))}
            </ul>
          )}
          {!compact && (
          <form
            className="row wrap"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="Name (Attack)"
              aria-label="Formula name"
            />
            <input
              value={notation}
              onChange={(e) => setNotation(e.currentTarget.value)}
              placeholder="1d20+5"
              aria-label="New formula"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="submit">Add formula</button>
          </form>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
