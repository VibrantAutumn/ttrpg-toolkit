import { useEffect, useState } from "react";
import { listSpreads, type SpreadEntry } from "../../api/cards";
import { RollLogList } from "../../components/results/RollLogList";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { drawSpreadById } from "../../state/spreadActions";
import { cardTypeIcon } from "./icons";
import { PlayDecksSection } from "./PlayDecksSection";
import { SourceDraw } from "./SourceDraw";

/**
 * Draw from any pool, deck or set, draw a spread, deal from a deck in play;
 * recent draws are listed below.
 */
export function DrawTab() {
  const { project } = useCurrentProject();
  const dataVersion = useDataVersion();
  const { openItem } = useNavigation();
  const projectId = project?.id ?? null;
  const [spreads, setSpreads] = useState<SpreadEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setSpreads([]);
      return;
    }
    let active = true;
    listSpreads(projectId)
      .then((list) => active && setSpreads(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  if (!projectId) {
    return <p className="empty">No project is open. Choose one from the project name at the top of the sidebar.</p>;
  }

  async function drawFromSpread(spreadId: string) {
    const outcome = await drawSpreadById(spreadId);
    setError(outcome.ok ? null : outcome.message);
    if (!outcome.ok) bumpDataVersion();
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <SourceDraw />

      <h2>Spreads</h2>
      {spreads.length === 0 ? (
        <p className="empty">
          No spreads yet. Make one in the Library tab (New item, type Spread) and give each position a place to draw from.
        </p>
      ) : (
        <ul className="list">
          {spreads.map((s) => (
            <li key={s.itemId} className="row wrap">
              <span className="name">
                <button className="link name" onClick={() => openItem(s.itemId)}>
                  {cardTypeIcon("spread")} {s.name}
                </button>{" "}
                <small className="meta">
                  {s.positions} positions{s.ready ? "" : " · needs finishing"}
                </small>
              </span>
              <button
                onClick={() => void drawFromSpread(s.itemId)}
                disabled={!s.ready}
                title={s.ready ? "Draw every position" : "Open it to finish its positions"}
              >
                Draw
              </button>
            </li>
          ))}
        </ul>
      )}

      <PlayDecksSection />

      <h2>Recent draws</h2>
      <RollLogList kind="draw" emptyText="No draws yet. They also show in the Dice tool's roll log." />
    </div>
  );
}
