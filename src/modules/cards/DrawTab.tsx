import { RollLogList } from "../../components/results/RollLogList";
import { PlayDecksSection } from "./PlayDecksSection";
import { PoolDraw } from "./PoolDraw";
import { SpreadDraw } from "./SpreadDraw";

/**
 * Draw from a pool (three cards ready to go, or a custom pool), draw or edit a spread, deal from a
 * deck in play; recent draws are listed below.
 */
export function DrawTab() {
  return (
    <div>
      <PoolDraw />
      <SpreadDraw />
      <PlayDecksSection />

      <h2>Recent draws</h2>
      <RollLogList kind="draw" emptyText="No draws yet. They also show in the Dice tool's roll log." />
    </div>
  );
}
