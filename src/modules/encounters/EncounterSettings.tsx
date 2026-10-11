import { useEffect, useState } from "react";
import {
  rollInitiative,
  setFoeHealthDisplay,
  setInitiativeFormula,
  setInitiativeType,
  setSideInitiative,
  start,
  type Outcome,
} from "../../lib/encounters/engine";
import { SIDE_LABELS, SIDES, type EncounterState } from "../../lib/encounters/state";
import { INITIATIVE_LABELS, type InitiativeType } from "../../lib/rulesets/ruleset";

type Apply = (change: (state: EncounterState) => Outcome) => boolean;

/**
 * Setting up: how initiative works for this encounter (the ruleset's choice, changeable here), the roll, and how the
 * players see foe health. Under group initiative each side's result is shown here too, since there is no per-combatant
 * initiative to type.
 */
export function EncounterSettings({ state, apply }: { state: EncounterState; apply: Apply }) {
  const [formula, setFormula] = useState(state.formula);
  useEffect(() => setFormula(state.formula), [state.formula]);
  const setup = state.phase === "setup";
  const missing = state.combatants.filter((c) => c.initiative === null).length;

  return (
    <section className="encounter-settings" aria-label="Encounter settings">
      <h3>How it runs</h3>
      <div className="row wrap">
        <label>
          Turn order
          <select value={state.initiativeType} disabled={!setup} onChange={(e) => apply((s) => setInitiativeType(s, e.currentTarget.value as InitiativeType))}>
            {(Object.keys(INITIATIVE_LABELS) as InitiativeType[]).map((t) => (
              <option key={t} value={t}>
                {INITIATIVE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {state.initiativeType !== "popcorn" && (
          <label>
            Initiative roll
            <input
              type="text"
              value={formula}
              placeholder="1d20 (blank: by hand)"
              style={{ maxWidth: "11rem" }}
              onChange={(e) => setFormula(e.currentTarget.value)}
              onBlur={() => formula.trim() !== state.formula && !apply((s) => setInitiativeFormula(s, formula)) && setFormula(state.formula)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </label>
        )}
        <label>
          Players see foe health as
          <select value={state.foeHealth} onChange={(e) => apply((s) => setFoeHealthDisplay(s, e.currentTarget.value === "hidden" ? "hidden" : "description"))}>
            <option value="description">A word (Healthy, Bloodied…)</option>
            <option value="hidden">Nothing</option>
          </select>
        </label>
      </div>
      {!setup && <p className="meta">The way turns work can't change once the encounter has started.</p>}

      {setup && state.initiativeType === "group" && (
        <div className="row wrap">
          {SIDES.map((side) => (
            <label key={side}>
              {SIDE_LABELS[side]} initiative
              <input
                type="text"
                inputMode="decimal"
                defaultValue={state.sideInitiative[side] ?? ""}
                key={`${side}-${state.sideInitiative[side] ?? ""}`}
                style={{ maxWidth: "5rem" }}
                onBlur={(e) => {
                  const text = e.currentTarget.value.trim();
                  const n = text === "" ? null : Number(text.replace(",", "."));
                  if (n !== null && !Number.isFinite(n)) return;
                  if (n !== state.sideInitiative[side]) apply((s) => setSideInitiative(s, side, n));
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              />
            </label>
          ))}
          <button disabled={state.formula.trim() === ""} onClick={() => apply((s) => rollInitiative(s))}>
            Roll for both sides
          </button>
        </div>
      )}
      {setup && state.initiativeType === "individual" && (
        <div className="row wrap">
          <button disabled={state.formula.trim() === "" || state.combatants.length === 0} onClick={() => apply((s) => rollInitiative(s))}>
            Roll everyone's initiative
          </button>
          <button disabled={state.formula.trim() === "" || missing === 0} onClick={() => apply((s) => rollInitiative(s, { onlyMissing: true }))}>
            Roll for those without ({missing})
          </button>
        </div>
      )}
      {setup && (
        <button className="primary" disabled={state.combatants.length === 0} onClick={() => apply((s) => start(s))}>
          Start the encounter ▶
        </button>
      )}
    </section>
  );
}
