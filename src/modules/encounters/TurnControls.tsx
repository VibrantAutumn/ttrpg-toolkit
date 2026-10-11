import { ConfirmButton } from "../../components/ConfirmButton";
import { SaveToSessionButton } from "../../components/time/SaveToSessionButton";
import { canUndo, finish, nextTurn, outcomeText, pickTurn, resume, undo, type Outcome } from "../../lib/encounters/engine";
import { combatantName, isActive, SIDE_LABELS, type EncounterState } from "../../lib/encounters/state";
import { copyText } from "../../lib/copyText";

type Apply = (change: (state: EncounterState) => Outcome) => boolean;

/**
 * The bar above a running encounter: the round, whose turn it is, and the buttons that move it on (what they are
 * depends on how initiative works: the next in order, the other side, or "who goes next?" for popcorn).
 */
export function TurnControls({ state, apply, title }: { state: EncounterState; apply: Apply; title?: string }) {
  const current = state.turn === null ? null : state.combatants.find((c) => c.id === state.turn) ?? null;
  const type = state.initiativeType;

  if (state.phase === "finished") {
    return (
      <div className="turn-controls">
        <p>
          <strong>The encounter is over</strong> after {state.round} {state.round === 1 ? "round" : "rounds"}.
        </p>
        <p className="meta">{outcomeText(state)}</p>
        <div className="row wrap">
          <button onClick={() => apply((s) => resume(s))}>Resume</button>
          <button onClick={() => void copyText(outcomeText(state))}>Copy the outcome</button>
          <SaveToSessionButton text={outcomeText(state)} title={title} />
          <button disabled={!canUndo(state)} onClick={() => apply((s) => undo(s))}>
            Undo
          </button>
        </div>
      </div>
    );
  }

  const eligible = state.combatants.filter((c) => isActive(c) && !state.acted.includes(c.id) && c.id !== state.turn);
  // Popcorn: once everyone has gone, anyone active (not the one acting) may start the next round.
  const choices = eligible.length > 0 ? eligible : state.combatants.filter((c) => isActive(c) && c.id !== state.turn);

  return (
    <div className="turn-controls" role="region" aria-label="Turn controls">
      <div className="row wrap">
        <strong className="round">Round {state.round}</strong>
        {type === "group" && state.side && <span>{SIDE_LABELS[state.side]}'s turn</span>}
        {type !== "group" && (
          <span>{current ? <>Turn: <strong>{combatantName(current)}</strong></> : type === "popcorn" ? "Pick who goes first" : ""}</span>
        )}
        <span className="grow" />
        <button disabled={!canUndo(state)} onClick={() => apply((s) => undo(s))}>
          Undo
        </button>
        <ConfirmButton label="End the encounter" onConfirm={() => apply((s) => finish(s))} />
      </div>
      {type === "individual" && (
        <button className="primary" onClick={() => apply((s) => nextTurn(s))}>
          Next turn ▶
        </button>
      )}
      {type === "group" && (
        <button className="primary" onClick={() => apply((s) => nextTurn(s))}>
          End the {state.side === "party" ? "party" : "foes"}' turn ▶
        </button>
      )}
      {type === "popcorn" && (
        <div>
          <p className="meta">{current ? `${combatantName(current)} is done. Who goes next?` : "Who goes first?"}</p>
          <div className="row wrap">
            {choices.map((c) => (
              <button key={c.id} onClick={() => apply((s) => (s.turn === null ? pickTurn(s, c.id) : nextTurn(s, c.id)))}>
                {combatantName(c)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
