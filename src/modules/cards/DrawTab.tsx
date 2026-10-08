import { useEffect, useState } from "react";
import { listCollections } from "../../api/cards";
import type { Item } from "../../api/library";
import { RollLogList } from "../../components/results/RollLogList";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { useDataVersion } from "../../state/dataVersion";
import { cardTypeIcon } from "./icons";
import { DrawPanel } from "./DrawPanel";

/** Pick any pool, deck or set and draw from it; recent draws are listed below. */
export function DrawTab() {
  const { campaign } = useCurrentCampaign();
  const dataVersion = useDataVersion();
  const campaignId = campaign?.id ?? null;
  const [sources, setSources] = useState<Item[]>([]);
  const [chosenId, setChosenId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setSources([]);
      return;
    }
    let active = true;
    listCollections(campaignId)
      .then((list) => active && setSources(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  // Keep the choice valid: the first source by default, and another if it was deleted.
  const chosen = sources.find((s) => s.id === chosenId) ?? sources[0];

  if (!campaignId) {
    return <p className="empty">No campaign is open. Tap the bar at the top to choose one.</p>;
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      {sources.length === 0 ? (
        <p className="empty">
          Nothing to draw from yet. Make a pool, deck or set in the Library tab, and add some cards to it.
        </p>
      ) : (
        <>
          <label className="field">
            <span>Draw from</span>
            <select
              value={chosen?.id ?? ""}
              onChange={(e) => setChosenId(e.currentTarget.value)}
              aria-label="Draw from"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {cardTypeIcon(s.itemType)} {s.name} ({s.itemType})
                </option>
              ))}
            </select>
          </label>
          {chosen && <DrawPanel key={chosen.id} sourceId={chosen.id} sourceName={chosen.name} showResult={false} />}
        </>
      )}
      <h2>Recent draws</h2>
      <RollLogList kind="draw" emptyText="No draws yet. They also show in the Dice tool's roll log." />
    </div>
  );
}
