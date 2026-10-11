import { useState } from "react";
import { checkFormula } from "../../lib/dice/formula";
import { INITIATIVE_LABELS, uniqueKey, type EncounterRules, type InitiativeType, type StatusType } from "../../lib/rulesets/ruleset";
import type { SectionProps } from "./sectionTypes";

/**
 * The rules encounters follow under this ruleset: how initiative works, the statuses a combatant
 * can have, which bar is health and which properties show on each combatant's row. An encounter
 * can change the initiative type for itself and add one-off statuses.
 */
export function EncounterRulesSection({ ruleset, edit }: SectionProps) {
  const rules = ruleset.encounter;
  const setRules = (change: (e: EncounterRules) => EncounterRules) => edit((r) => ({ ...r, encounter: change(r.encounter) }));

  // The formula box keeps what is typed; the ruleset only changes when it is a formula (or blank).
  const [formulaText, setFormulaText] = useState(rules.initiative.formula);
  const formulaCheck = formulaText.trim() === "" ? null : checkFormula(formulaText);

  const numberFields = ruleset.fields.filter((f) => f.kind === "number");
  const barFields = ruleset.fields.filter((f) => f.kind === "bar");
  const shownFields = ruleset.fields.filter((f) => f.kind !== "bar" && f.kind !== "list" && f.kind !== "link" && f.key !== rules.healthField);

  const changeStatus = (id: string, update: (s: StatusType) => StatusType) =>
    setRules((e) => ({ ...e, statuses: e.statuses.map((s) => (s.id === id ? update(s) : s)) }));

  return (
    <div>
      <h3>Initiative</h3>
      <label>
        How turn order works
        <select value={rules.initiative.type} onChange={(e) => setRules((x) => ({ ...x, initiative: { ...x.initiative, type: e.currentTarget.value as InitiativeType } }))}>
          {(Object.keys(INITIATIVE_LABELS) as InitiativeType[]).map((t) => (
            <option key={t} value={t}>
              {INITIATIVE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <p className="meta">Each encounter can change this for itself.</p>
      <div className="row wrap">
        <label>
          Roll
          <input
            type="text"
            value={formulaText}
            placeholder="1d20 (leave blank to enter turn order by hand)"
            onChange={(e) => {
              const text = e.currentTarget.value;
              setFormulaText(text);
              const check = text.trim() === "" ? null : checkFormula(text);
              if (check === null) setRules((x) => ({ ...x, initiative: { ...x.initiative, formula: "" } }));
              else if (check.ok) setRules((x) => ({ ...x, initiative: { ...x.initiative, formula: check.notation } }));
            }}
          />
        </label>
        <label>
          Add the property
          <select value={rules.initiative.bonusField ?? ""} onChange={(e) => setRules((x) => ({ ...x, initiative: { ...x.initiative, bonusField: e.currentTarget.value || null } }))}>
            <option value="">None</option>
            {numberFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Goes first
          <select value={rules.initiative.order} onChange={(e) => setRules((x) => ({ ...x, initiative: { ...x.initiative, order: e.currentTarget.value === "low" ? "low" : "high" } }))}>
            <option value="high">The highest result</option>
            <option value="low">The lowest result</option>
          </select>
        </label>
      </div>
      {formulaCheck && !formulaCheck.ok && <p className="error">{formulaCheck.message}</p>}
      {numberFields.length === 0 && <p className="meta">Make a number property (like Dexterity) to add it to the roll.</p>}

      <h3>Health and the combat row</h3>
      <label>
        Health bar
        <select value={rules.healthField ?? ""} onChange={(e) => setRules((x) => ({ ...x, healthField: e.currentTarget.value || null, combatFields: x.combatFields.filter((k) => k !== e.currentTarget.value) }))}>
          <option value="">None</option>
          {barFields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      {barFields.length === 0 && <p className="meta">Make a bar property (like Hit points) to use it as health.</p>}
      <fieldset>
        <legend>Also shown on each combatant's row</legend>
        {shownFields.length === 0 && <p className="meta">No numbers or text properties to show yet.</p>}
        {shownFields.map((f) => (
          <label key={f.key} className="check">
            <input
              type="checkbox"
              checked={rules.combatFields.includes(f.key)}
              onChange={(e) =>
                setRules((x) => ({
                  ...x,
                  combatFields: e.currentTarget.checked ? [...x.combatFields, f.key].slice(0, 12) : x.combatFields.filter((k) => k !== f.key),
                }))
              }
            />
            {f.name}
          </label>
        ))}
      </fieldset>

      <h3>Statuses</h3>
      <p className="meta">Conditions a combatant can have. A duration counts down in rounds; leave it blank to last until removed.</p>
      <ul className="list">
        {rules.statuses.map((s) => (
          <li key={s.id} className="row wrap">
            <input type="text" aria-label="Status name" className="grow" value={s.name} onChange={(e) => changeStatus(s.id, (x) => ({ ...x, name: e.currentTarget.value }))} />
            <input
              type="number"
              aria-label={`Rounds ${s.name} lasts`}
              min={1}
              max={1000}
              placeholder="Rounds"
              value={s.duration ?? ""}
              style={{ maxWidth: "6rem" }}
              onChange={(e) => changeStatus(s.id, (x) => ({ ...x, duration: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) }))}
            />
            <input type="color" aria-label={`Colour of ${s.name}`} value={s.color ?? "#808080"} onChange={(e) => changeStatus(s.id, (x) => ({ ...x, color: e.currentTarget.value }))} />
            <input type="text" aria-label={`What ${s.name} does`} className="grow" placeholder="What it does" value={s.notes} onChange={(e) => changeStatus(s.id, (x) => ({ ...x, notes: e.currentTarget.value }))} />
            <button onClick={() => setRules((x) => ({ ...x, statuses: x.statuses.filter((y) => y.id !== s.id) }))}>Remove</button>
          </li>
        ))}
      </ul>
      <button
        onClick={() =>
          setRules((x) => {
            const name = `Status ${x.statuses.length + 1}`;
            return { ...x, statuses: [...x.statuses, { id: uniqueKey(name, x.statuses.map((s) => s.id)), name, notes: "", duration: null, color: null }] };
          })
        }
      >
        + Add a status
      </button>
    </div>
  );
}
