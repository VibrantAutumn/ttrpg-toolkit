import { RollerPanel } from "./RollerPanel";

/**
 * The Dice tool: tap dice, roll, pick a saved formula or saved roll from the dropdown, and the
 * roll log. Formulas and saved rolls are managed right there (no separate library tab).
 */
export function DiceScreen() {
  return (
    <section>
      <h1>Dice</h1>
      <RollerPanel />
    </section>
  );
}
