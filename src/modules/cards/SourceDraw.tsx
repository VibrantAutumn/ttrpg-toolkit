import { useEffect, useState } from "react";
import { listCollections } from "../../api/cards";
import type { Item } from "../../api/library";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { useDataVersion } from "../../state/dataVersion";
import { DrawPanel } from "./DrawPanel";
import { cardTypeIcon } from "./icons";

/**
 * Choose any pool, deck or set and draw from it. Used by the Draw tab and by the
 * quick tools panel. The newest result is shown wherever the roll log is shown
 * (`showResult` adds it right here too).
 */
export function SourceDraw({
  showResult = false,
  showHeading = true,
}: {
  showResult?: boolean;
  showHeading?: boolean;
}) {
  const { campaign } = useCurrentCampaign();
  const dataVersion = useDataVersion();
  const campaignId = campaign?.id ?? null;
  const [sources, setSources] = useState<Item[]>([]);
  const [chosenId, setChosenId] = useState("");
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

  if (!campaignId) return <p className="empty">No campaign is open.</p>;
  return (
    <div>
      {error && <p className="error">{error}</p>}
      {sources.length === 0 ? (
        <p className="empty">
          Nothing to draw from yet. Make a pool, deck or set in the Cards tool, and add some cards to it.
        </p>
      ) : (
        <>
          <label className="field">
            <span>Draw from</span>
            <select value={chosen?.id ?? ""} onChange={(e) => setChosenId(e.currentTarget.value)} aria-label="Draw from">
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {cardTypeIcon(s.itemType)} {s.name} ({s.itemType})
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <DrawPanel
              key={chosen.id}
              sourceId={chosen.id}
              sourceName={chosen.name}
              showResult={showResult}
              showHeading={showHeading}
            />
          )}
        </>
      )}
    </div>
  );
}
