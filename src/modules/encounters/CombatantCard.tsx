import { useEffect, useState } from "react";
import { ConfirmButton } from "../../components/ConfirmButton";
import {
  addStatus,
  removeCombatant,
  removeStatus,
  setDefeated,
  setHealth,
  setInitiative,
  toggleActed,
  updateCombatant,
  type Outcome,
} from "../../lib/encounters/engine";
import { combatantName, healthDescription, SIDE_LABELS, SIDES, type Combatant, type EncounterState, type Side } from "../../lib/encounters/state";
import { parseBarInput } from "../../lib/fields/bar";
import type { ProjectRules } from "../../lib/rulesets/projectRules";

type Apply = (change: (state: EncounterState) => Outcome) => boolean;

/**
 * One combatant: initiative, health (type `-5`, `+3`, `7/13` or a new number), statuses, and under "Details" the name,
 * side, initiative bonus, GM notes and whether the players can see it. Every change goes through the engine.
 */
export function CombatantCard({
  combatant: c,
  state,
  rules,
  apply,
}: {
  combatant: Combatant;
  state: EncounterState;
  rules: ProjectRules | null;
  apply: Apply;
}) {
  const [initText, setInitText] = useState(c.initiative === null ? "" : String(c.initiative));
  const [healthText, setHealthText] = useState("");
  const [healthError, setHealthError] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customRounds, setCustomRounds] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [nameText, setNameText] = useState(c.baseName);
  const [notesText, setNotesText] = useState(c.notes);
  const [bonusText, setBonusText] = useState(String(c.bonus));
  const [maxText, setMaxText] = useState(c.health ? String(c.health.max) : "");

  // The initiative can change from outside (a roll, an undo): follow it.
  useEffect(() => setInitText(c.initiative === null ? "" : String(c.initiative)), [c.initiative]);
  useEffect(() => setNameText(c.baseName), [c.baseName]);
  useEffect(() => setNotesText(c.notes), [c.notes]);
  useEffect(() => setBonusText(String(c.bonus)), [c.bonus]);
  useEffect(() => setMaxText(c.health ? String(c.health.max) : ""), [c.health]);

  const isTurn = state.turn === c.id;
  const acted = state.acted.includes(c.id);
  const running = state.phase === "running";
  const statusTypes = rules?.ruleset.encounter.statuses ?? [];
  const hasStatus = (name: string) => c.statuses.some((s) => s.name.toLowerCase() === name.toLowerCase());

  function commitInitiative() {
    const text = initText.trim();
    if (text === "") {
      if (c.initiative !== null) apply((s) => setInitiative(s, c.id, null));
      return;
    }
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n)) return setInitText(c.initiative === null ? "" : String(c.initiative));
    if (n !== c.initiative) apply((s) => setInitiative(s, c.id, n));
  }

  function changeHealth(e: React.FormEvent) {
    e.preventDefault();
    const read = parseBarInput(healthText, c.health);
    if (!read.ok) return setHealthError(read.error);
    setHealthError(null);
    if (apply((s) => setHealth(s, c.id, read.value))) setHealthText("");
  }

  const classes = ["combatant", `combatant-${c.side}`, isTurn ? "is-turn" : "", c.defeated ? "is-defeated" : "", acted && running ? "has-acted" : ""];

  return (
    <li className={classes.filter(Boolean).join(" ")} aria-current={isTurn ? "true" : undefined}>
      <div className="row wrap combatant-head">
        {isTurn && <span aria-label="Taking their turn">▶</span>}
        <strong className="grow">
          {combatantName(c)} {c.hidden && <span title="The players can't see this one">🙈</span>}
        </strong>
        <span className="meta">{SIDE_LABELS[c.side]}</span>
        {state.initiativeType !== "popcorn" && state.initiativeType !== "group" && (
          <label className="row">
            Initiative
            <input
              type="text"
              inputMode="decimal"
              aria-label={`Initiative of ${combatantName(c)}`}
              value={initText}
              style={{ maxWidth: "5rem" }}
              onChange={(e) => setInitText(e.currentTarget.value)}
              onBlur={commitInitiative}
              onKeyDown={(e) => e.key === "Enter" && commitInitiative()}
            />
          </label>
        )}
        {running && (state.initiativeType !== "individual") && (
          <label className="check">
            <input type="checkbox" checked={acted} onChange={() => apply((s) => toggleActed(s, c.id))} />
            Acted
          </label>
        )}
      </div>

      {c.stats.length > 0 && (
        <p className="meta combatant-stats">{c.stats.map((s) => `${s.label} ${s.value}`).join(" · ")}</p>
      )}

      <form className="row wrap" onSubmit={changeHealth}>
        {c.health ? (
          <span>
            Health <strong>{c.health.current}/{c.health.max}</strong> <span className="meta">({healthDescription(c.health)})</span>
          </span>
        ) : (
          <span className="meta">No health bar</span>
        )}
        <input
          type="text"
          aria-label={`Change health of ${combatantName(c)}`}
          placeholder={c.health ? "-5, +3 or 7/13" : "Max health, e.g. 13"}
          value={healthText}
          style={{ maxWidth: "9rem" }}
          onChange={(e) => setHealthText(e.currentTarget.value)}
        />
        <button type="submit" disabled={healthText.trim() === ""}>
          Apply
        </button>
      </form>
      {healthError && <p className="error">{healthError}</p>}

      <ul className="status-chips" aria-label={`Statuses of ${combatantName(c)}`}>
        {c.statuses.map((s) => (
          <li key={s.id} className="status-chip" style={s.color ? { borderColor: s.color } : undefined} title={s.notes || undefined}>
            {s.name}
            {s.remaining !== null && <span className="meta"> ({s.remaining})</span>}
            <button type="button" aria-label={`Remove ${s.name} from ${combatantName(c)}`} onClick={() => apply((st) => removeStatus(st, c.id, s.id))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {isTurn && c.statuses.some((s) => s.notes) && (
        <ul className="meta" aria-label="Reminders">
          {c.statuses.filter((s) => s.notes).map((s) => (
            <li key={s.id}>
              <strong>{s.name}:</strong> {s.notes}
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        <select
          aria-label={`Add a status to ${combatantName(c)}`}
          value=""
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === "__custom") return setShowCustom(true);
            const type = statusTypes.find((t) => t.id === v);
            if (type) apply((st) => addStatus(st, c.id, { statusId: type.id, name: type.name, notes: type.notes, color: type.color, duration: type.duration }));
          }}
        >
          <option value="">Add a status…</option>
          {statusTypes.map((t) => (
            <option key={t.id} value={t.id} disabled={hasStatus(t.name)}>
              {t.name}
              {t.duration ? ` (${t.duration} ${t.duration === 1 ? "round" : "rounds"})` : ""}
            </option>
          ))}
          <option value="__custom">Something else…</option>
        </select>
        <button type="button" onClick={() => apply((s) => setDefeated(s, c.id, !c.defeated))}>
          {c.defeated ? "Back in the fight" : "Defeated"}
        </button>
      </div>
      {showCustom && (
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            const rounds = customRounds.trim() === "" ? null : Number(customRounds);
            if (apply((s) => addStatus(s, c.id, { name: customName, duration: rounds }))) {
              setCustomName("");
              setCustomRounds("");
              setShowCustom(false);
            }
          }}
        >
          <input type="text" aria-label="Status name" placeholder="Status" value={customName} onChange={(e) => setCustomName(e.currentTarget.value)} />
          <input type="number" min={1} aria-label="Rounds" placeholder="Rounds" value={customRounds} style={{ maxWidth: "6rem" }} onChange={(e) => setCustomRounds(e.currentTarget.value)} />
          <button type="submit" disabled={customName.trim() === ""}>
            Add
          </button>
          <button type="button" onClick={() => setShowCustom(false)}>
            Cancel
          </button>
        </form>
      )}

      <details>
        <summary>Details</summary>
        <div className="row wrap">
          <label>
            Name
            <input
              type="text"
              value={nameText}
              onChange={(e) => setNameText(e.currentTarget.value)}
              onBlur={() => nameText.trim() !== c.baseName && apply((s) => updateCombatant(s, c.id, { name: nameText }))}
            />
          </label>
          <label>
            Side
            <select value={c.side} onChange={(e) => apply((s) => updateCombatant(s, c.id, { side: e.currentTarget.value as Side }))}>
              {SIDES.map((side) => (
                <option key={side} value={side}>
                  {SIDE_LABELS[side]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Initiative bonus
            <input
              type="text"
              inputMode="decimal"
              value={bonusText}
              style={{ maxWidth: "5rem" }}
              onChange={(e) => setBonusText(e.currentTarget.value)}
              onBlur={() => {
                const n = Number(bonusText.replace(",", "."));
                if (Number.isFinite(n) && n !== c.bonus) apply((s) => updateCombatant(s, c.id, { bonus: n }));
                else setBonusText(String(c.bonus));
              }}
            />
          </label>
          <label>
            Maximum health
            <input
              type="text"
              inputMode="numeric"
              value={maxText}
              placeholder="none"
              style={{ maxWidth: "6rem" }}
              onChange={(e) => setMaxText(e.currentTarget.value)}
              onBlur={() => {
                const n = Number(maxText);
                if (maxText.trim() === "") {
                  if (c.health) apply((s) => setHealth(s, c.id, null));
                } else if (Number.isFinite(n) && n > 0 && n !== c.health?.max) {
                  apply((s) => setHealth(s, c.id, { current: Math.min(c.health?.current ?? n, n), max: n }));
                } else setMaxText(c.health ? String(c.health.max) : "");
              }}
            />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={c.hidden} onChange={(e) => apply((s) => updateCombatant(s, c.id, { hidden: e.currentTarget.checked }))} />
          Hide from the players (they won't see this one on the player display)
        </label>
        <label>
          GM notes (never shown to the players)
          <textarea
            rows={2}
            value={notesText}
            onChange={(e) => setNotesText(e.currentTarget.value)}
            onBlur={() => notesText !== c.notes && apply((s) => updateCombatant(s, c.id, { notes: notesText }))}
          />
        </label>
        <ConfirmButton label="Remove from the encounter" onConfirm={() => apply((s) => removeCombatant(s, c.id))} />
      </details>
    </li>
  );
}
