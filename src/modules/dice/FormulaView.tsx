import { useEffect, useState } from "react";
import { getFormula, setFormulaNotation } from "../../api/dice";
import { getItem } from "../../api/library";
import { checkFormula, describeParseError } from "../../lib/dice/formula";
import { bumpDataVersion } from "../../state/dataVersion";
import { rollLog } from "../../state/rollLog";

/** What a formula's page shows (its type's editor): edit the notation, and roll it. */
export function FormulaView({ itemId }: { itemId: string }) {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null>(null); // the stored notation; null while loading
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rolled, setRolled] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getFormula(itemId), getItem(itemId)])
      .then(([formula, item]) => {
        if (!active) return;
        setSaved(formula.notation);
        setText(formula.notation);
        setName(item.name);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [itemId]);

  if (saved === null) {
    return error ? <p className="error">{error}</p> : <p className="empty">Loading...</p>;
  }

  async function save() {
    setNote(null);
    const check = checkFormula(text);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    try {
      await setFormulaNotation(itemId, check.notation);
      setSaved(check.notation);
      setText(check.notation);
      setError(null);
      setNote("Saved.");
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  function roll() {
    // Roll what is in the box (it may not be saved yet), so you can try a change first.
    const outcome = rollLog.roll(text, undefined, name);
    if (outcome.ok) {
      setError(null);
      setRolled(outcome.entry.text);
    } else {
      setError(describeParseError(outcome.error));
    }
  }

  return (
    <div className="formula-view">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          aria-label="Formula"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" disabled={text.trim() === saved}>
          Save formula
        </button>
        <button type="button" onClick={roll}>
          Roll
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {note && <p className="meta" role="status">{note}</p>}
      {rolled && (
        <p role="status">
          <strong>{name}</strong> <span className="roll-text">{rolled}</span>
        </p>
      )}
    </div>
  );
}
