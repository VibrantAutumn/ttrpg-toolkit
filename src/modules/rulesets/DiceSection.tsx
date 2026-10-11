import { useState } from "react";
import { checkFormula } from "../../lib/dice/formula";
import type { SectionProps } from "./sectionTypes";

/** The ruleset's saved dice formulas ("Attack: 1d20+5"). They become formulas in the project's Dice tool. */
export function DiceSection({ ruleset, edit }: SectionProps) {
  const [name, setName] = useState("");
  const [notation, setNotation] = useState("");
  const check = notation.trim() === "" ? null : checkFormula(notation);

  const add = () => {
    const title = name.trim();
    if (title === "" || !check || !check.ok) return;
    edit((r) => ({ ...r, formulas: [...r.formulas, { name: title, notation: check.notation }] }));
    setName("");
    setNotation("");
  };

  return (
    <div>
      <p className="meta">
        Named formulas to roll often, like <code>Attack</code> = <code>1d20+5</code>. They are added to the project's Dice tool when you use this ruleset there.
      </p>
      <ul className="list">
        {ruleset.formulas.map((f, i) => (
          <li key={`${f.name}-${i}`} className="row">
            <span className="name">
              <strong>{f.name}</strong> <code>{f.notation}</code>
            </span>
            <button onClick={() => edit((r) => ({ ...r, formulas: r.formulas.filter((_, j) => j !== i) }))}>Remove</button>
          </li>
        ))}
      </ul>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input type="text" placeholder="Name (Attack)" aria-label="Formula name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <input type="text" placeholder="1d20+5" aria-label="Formula" value={notation} onChange={(e) => setNotation(e.currentTarget.value)} />
        <button type="submit" disabled={name.trim() === "" || !check || !check.ok}>
          Add formula
        </button>
      </form>
      {check && !check.ok && <p className="error">{check.message}</p>}
    </div>
  );
}
