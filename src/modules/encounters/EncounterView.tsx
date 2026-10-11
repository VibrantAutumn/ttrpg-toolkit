import { useEffect, useMemo, useState } from "react";
import { getItem, type Item } from "../../api/library";
import { currentDisplay, publishDisplay } from "../../lib/encounters/displayChannel";
import { publicView } from "../../lib/encounters/publicView";
import { turnOrder, type Combatant, type EncounterState } from "../../lib/encounters/state";
import { useEncounter } from "../../state/encounterState";
import { AddCombatants } from "./AddCombatants";
import { CombatantCard } from "./CombatantCard";
import { EncounterLog } from "./EncounterLog";
import { EncounterSettings } from "./EncounterSettings";
import { TurnControls } from "./TurnControls";
import { openDisplayWindow } from "./displayWindow";
import "./encounters.css";

/** Combatants in the order the screen lists them: initiative order, or by side (the side up first) for group and popcorn. */
function listed(state: EncounterState): Combatant[] {
  if (state.initiativeType === "individual") return turnOrder(state);
  const first = state.side ?? state.firstSide ?? "party";
  const sides = [first, first === "party" ? "foes" : "party"] as const;
  return sides.flatMap((side) => state.combatants.filter((c) => c.side === side));
}

/** The page of an encounter: set it up, run it, and show the turn order on the player display. */
export function EncounterView({ itemId }: { itemId: string }) {
  const [item, setItem] = useState<Item | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getItem(itemId)
      .then((i) => active && setItem(i))
      .catch((e) => active && setLoadError(String(e)));
    return () => {
      active = false;
    };
  }, [itemId]);

  if (loadError) return <p className="error">{loadError}</p>;
  if (!item) return <p className="empty">Loading...</p>;
  return <EncounterBody item={item} />;
}

function EncounterBody({ item }: { item: Item }) {
  const { state, rules, problem, message, status, apply, startOver } = useEncounter(item.id, item.projectId);
  const [sharing, setSharing] = useState(() => currentDisplay()?.title === item.name);
  const [displayError, setDisplayError] = useState<string | null>(null);

  // While sharing, the player display follows the encounter. It is given a `PublicView` (no secrets), never the encounter itself.
  const view = useMemo(() => (state ? publicView(state, item.name) : null), [state, item.name]);
  useEffect(() => {
    if (sharing && view) publishDisplay(view);
  }, [sharing, view]);

  if (problem)
    return (
      <div>
        <p className="error">This encounter's saved data can't be read ({problem}).</p>
        <button onClick={startOver}>Start over with an empty encounter</button>
      </div>
    );
  if (!state) return <p className="empty">Loading...</p>;

  const running = state.phase !== "setup";
  const order = listed(state);

  async function showOnDisplay() {
    setDisplayError(null);
    try {
      await openDisplayWindow();
      setSharing(true);
      if (view) publishDisplay(view);
    } catch (e) {
      setDisplayError(String(e));
    }
  }

  return (
    <div className="encounter">
      <p className="meta">
        {state.phase === "setup" ? "Setting up." : state.phase === "running" ? "Running." : "Over."}{" "}
        {status === "saved" ? "Saved." : status === "error" ? "Couldn't save yet; will try again." : "Saving..."}
        {rules ? ` Rules: ${rules.name}.` : " No ruleset in this project: statuses are made by hand and initiative is a plain d20."}
      </p>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}

      {running && <TurnControls state={state} apply={apply} />}

      <div className="encounter-columns">
        <div>
          <h3>Combatants ({state.combatants.length})</h3>
          {order.length === 0 && <p className="empty">No one is in this encounter yet. Add the party and the foes below.</p>}
          {order.length > 0 && (
            <ul className="combatant-list">
              {order.map((c) => (
                <CombatantCard key={c.id} combatant={c} state={state} rules={rules} apply={apply} />
              ))}
            </ul>
          )}
          {state.phase !== "finished" && <AddCombatants projectId={item.projectId} rules={rules} apply={apply} />}
        </div>
        <div>
          <EncounterSettings state={state} apply={apply} />
          <section className="display-controls" aria-label="Player display">
            <h3>Player display</h3>
            <p className="meta">
              A second window for a TV or monitor that shows the turn order. Players see names, whose turn it is, statuses and health in words; never anything marked
              hidden or your notes.
            </p>
            <div className="row wrap">
              <button onClick={() => void showOnDisplay()}>{sharing ? "Open the window again" : "Open the player display"}</button>
              {sharing && (
                <button
                  onClick={() => {
                    setSharing(false);
                    publishDisplay(null);
                  }}
                >
                  Stop showing
                </button>
              )}
            </div>
            {sharing && <p className="meta">Showing “{item.name}” to the players. It follows every change.</p>}
            {displayError && <p className="error">{displayError}</p>}
          </section>
          <EncounterLog log={state.log} />
        </div>
      </div>
    </div>
  );
}
