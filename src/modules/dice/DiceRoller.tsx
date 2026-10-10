import { useEffect, useState } from "react";
import { createFormula, getSavedRoll, listFormulas, setFormulaNotation, type FormulaEntry } from "../../api/dice";
import { deleteItem, listItemsOfType, renameItem, restoreItem, type Item } from "../../api/library";
import { ConfirmButton } from "../../components/ConfirmButton";
import { addDie, DIE_BUTTONS, getModifier, setModifier } from "../../lib/dice/builder";
import { checkFormula, describeParseError } from "../../lib/dice/formula";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { rollLog } from "../../state/rollLog";

/** What the dropdown has picked: a saved formula, a saved roll, or the "New formula" form. */
type Picked = { kind: "formula"; id: string; name: string; notation: string } | { kind: "roll"; id: string; name: string } | { kind: "new" } | null;

const NEW = "__new";

/**
 * The roller: tap a die to add it to the formula (d6, d6 gives 2d6), a modifier box, Roll and
 * Clear, and a dropdown of saved formulas and saved rolls. Picking a formula loads it into the
 * box, where it can be rolled, changed and saved, renamed or deleted in place; "New formula…"
 * saves what is in the box under a name. Results go to the roll log. The formula text is the
 * only state, so typing by hand and tapping dice mix freely.
 */
export function DiceRoller() {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;

  const [formula, setFormula] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo: () => Promise<void> } | null>(null);
  const [formulas, setFormulas] = useState<FormulaEntry[]>([]);
  const [rolls, setRolls] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Picked>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!projectId) {
      setFormulas([]);
      setRolls([]);
      return;
    }
    let active = true;
    Promise.all([listFormulas(projectId), listItemsOfType(projectId, "dice", "saved_roll")])
      .then(([f, r]) => {
        if (!active) return;
        setFormulas(f);
        setRolls(r);
        // A formula deleted elsewhere (or renamed) must not stay picked.
        setPicked((p) => (p && p.kind === "formula" && !f.some((x) => x.itemId === p.id) ? null : p));
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  const savedNotation = picked?.kind === "formula" ? picked.notation : null;
  // The picked formula's name labels the roll only while the box still holds its formula.
  const label = picked?.kind === "formula" && formula.trim() === picked.notation ? picked.name : picked?.kind === "roll" ? picked.name : undefined;

  function roll() {
    const outcome = rollLog.roll(formula, undefined, label);
    setError(outcome.ok ? null : describeParseError(outcome.error));
  }

  function clear() {
    setFormula("");
    setError(null);
    setPicked(null);
  }

  async function pick(value: string) {
    setError(null);
    setNotice(null);
    if (value === "") return setPicked(null);
    if (value === NEW) {
      setName("");
      return setPicked({ kind: "new" });
    }
    const f = formulas.find((x) => x.itemId === value);
    if (f) {
      setFormula(f.notation);
      setName(f.name);
      return setPicked({ kind: "formula", id: f.itemId, name: f.name, notation: f.notation });
    }
    const r = rolls.find((x) => x.id === value);
    if (r) {
      try {
        const saved = await getSavedRoll(r.id);
        setFormula(saved.notation);
        setPicked({ kind: "roll", id: r.id, name: r.name });
      } catch (e) {
        setError(String(e));
      }
    }
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  const saveNew = () =>
    run(async () => {
      if (!projectId) return;
      const check = checkFormula(formula);
      if (!check.ok) throw check.message;
      const made = await createFormula(projectId, name, null, check.notation);
      setFormula(check.notation);
      setName(made.name);
      setPicked({ kind: "formula", id: made.id, name: made.name, notation: check.notation });
      bumpDataVersion();
    });

  const saveChanges = () =>
    run(async () => {
      if (picked?.kind !== "formula") return;
      const check = checkFormula(formula);
      if (!check.ok) throw check.message;
      if (check.notation !== picked.notation) await setFormulaNotation(picked.id, check.notation);
      const newName = name.trim() === "" ? picked.name : name.trim();
      if (newName !== picked.name) await renameItem(picked.id, newName);
      setFormula(check.notation);
      setName(newName);
      setPicked({ ...picked, name: newName, notation: check.notation });
      bumpDataVersion();
    });

  const remove = () =>
    run(async () => {
      if (picked?.kind !== "formula" && picked?.kind !== "roll") return;
      const { id, name: removed } = picked;
      await deleteItem(id);
      setPicked(null);
      setNotice({
        text: `Deleted “${removed}”.`,
        undo: async () => {
          await restoreItem(id);
          setNotice(null);
          bumpDataVersion();
        },
      });
      bumpDataVersion();
    });

  const changed = picked?.kind === "formula" && (formula.trim() !== picked.notation || (name.trim() !== "" && name.trim() !== picked.name));

  return (
    <div className="dice-roller">
      <div className="row wrap quick-rolls" role="group" aria-label="Add a die">
        {DIE_BUTTONS.map((sides) => (
          <button
            key={sides}
            type="button"
            onClick={() => {
              setError(null);
              setFormula(addDie(formula, sides));
            }}
          >
            d{sides}
          </button>
        ))}
      </div>

      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          roll();
        }}
      >
        <input
          className="formula-box"
          value={formula}
          onChange={(e) => {
            setFormula(e.currentTarget.value);
            setError(null);
          }}
          placeholder="Tap dice, or type 2d6+3, 4d6kh3, d20 adv, 6d10>=8, 4dF..."
          aria-label="Dice formula"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <label className="modifier">
          <span className="meta">Modifier</span>{" "}
          <input
            type="number"
            inputMode="numeric"
            step={1}
            value={getModifier(formula)}
            onChange={(e) => setFormula(setModifier(formula, e.currentTarget.valueAsNumber))}
            aria-label="Modifier"
          />
        </label>
        <button type="submit">Roll</button>
        <button type="button" onClick={clear} disabled={formula === "" && picked === null}>
          Clear
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {projectId && (
        <div className="row wrap">
          <select value={picked?.kind === "new" ? NEW : (picked && "id" in picked ? picked.id : "")} onChange={(e) => void pick(e.currentTarget.value)} aria-label="Saved formulas and rolls">
            <option value="">Saved formulas and rolls…</option>
            {formulas.length > 0 && (
              <optgroup label="Formulas">
                {formulas.map((f) => (
                  <option key={f.itemId} value={f.itemId}>
                    {f.name} ({f.notation})
                  </option>
                ))}
              </optgroup>
            )}
            {rolls.length > 0 && (
              <optgroup label="Saved rolls">
                {rolls.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={NEW}>New formula…</option>
          </select>

          {picked?.kind === "new" && (
            <>
              <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Name (Attack)" aria-label="Formula name" />
              <button type="button" onClick={() => void saveNew()} disabled={formula.trim() === ""}>
                Save formula
              </button>
            </>
          )}
          {picked?.kind === "formula" && (
            <>
              <input value={name} onChange={(e) => setName(e.currentTarget.value)} aria-label="Formula name" />
              <button type="button" onClick={() => void saveChanges()} disabled={!changed}>
                Save changes
              </button>
              <button type="button" onClick={() => openItem(picked.id)}>
                Open
              </button>
              <ConfirmButton label="Delete" confirmLabel="Tap again to delete" onConfirm={() => void remove()} />
            </>
          )}
          {picked?.kind === "roll" && (
            <>
              <span className="meta">Saved roll “{picked.name}”: its formula is in the box.</span>
              <button type="button" onClick={() => openItem(picked.id)}>
                Open
              </button>
              <ConfirmButton label="Delete" confirmLabel="Tap again to delete" onConfirm={() => void remove()} />
            </>
          )}
        </div>
      )}
      {picked?.kind === "formula" && savedNotation !== null && !changed && <p className="meta">Saved as {savedNotation}.</p>}
      {notice && (
        <p className="notice">
          {notice.text}{" "}
          <button className="link" onClick={() => void run(notice.undo)}>
            Undo
          </button>
        </p>
      )}
    </div>
  );
}
