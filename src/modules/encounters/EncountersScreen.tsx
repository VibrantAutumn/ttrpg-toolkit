import { LibraryScreen } from "../../components/library/LibraryScreen";
import { encounterType } from "./encounterType";

/** The Encounters tool: the library of encounters. Open one to set it up and run it. */
export function EncountersScreen() {
  return (
    <section>
      <h1>Encounters</h1>
      <p className="meta">
        Build and run combat, chases or heists. Add combatants from your pages (their health and stats are copied in from a stat block) or by name, roll
        initiative, and track health, statuses and rounds. Statuses and initiative follow the project's ruleset.
      </p>
      <LibraryScreen library="encounters" title="Encounters" showTitle={false} itemTypes={[encounterType]} />
    </section>
  );
}
