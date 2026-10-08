import { useEffect, useState } from "react";
import { listCollections, listPlayDecks, listSpreads, type PlayDeckEntry, type SpreadEntry } from "../../api/cards";
import type { Item } from "../../api/library";
import { RollLogList } from "../../components/results/RollLogList";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { drawFromPlayDeck } from "../../state/playActions";
import { drawSpreadById } from "../../state/spreadActions";
import { cardTypeIcon } from "./icons";
import { DrawPanel } from "./DrawPanel";

/** Pick any pool, deck or set and draw from it; recent draws are listed below. */
export function DrawTab() {
  const { campaign } = useCurrentCampaign();
  const dataVersion = useDataVersion();
  const { openItem } = useNavigation();
  const campaignId = campaign?.id ?? null;
  const [sources, setSources] = useState<Item[]>([]);
  const [plays, setPlays] = useState<PlayDeckEntry[]>([]);
  const [spreads, setSpreads] = useState<SpreadEntry[]>([]);
  const [playCount, setPlayCount] = useState("1");
  const [chosenId, setChosenId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setSources([]);
      setPlays([]);
      setSpreads([]);
      return;
    }
    let active = true;
    listCollections(campaignId)
      .then((list) => active && setSources(list))
      .catch((e) => active && setError(String(e)));
    listSpreads(campaignId)
      .then((list) => active && setSpreads(list))
      .catch((e) => active && setError(String(e)));
    listPlayDecks(campaignId)
      .then((list) => active && setPlays(list))
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

  async function drawFromGame(playId: string) {
    const outcome = await drawFromPlayDeck(playId, playCount.trim() === "" ? NaN : Number(playCount));
    setError(outcome.ok ? null : outcome.message);
    // If the game turned out to be gone, reload the list so it stops being offered.
    if (!outcome.ok) bumpDataVersion();
  }

  async function drawFromSpread(spreadId: string) {
    const outcome = await drawSpreadById(spreadId);
    setError(outcome.ok ? null : outcome.message);
    if (!outcome.ok) bumpDataVersion();
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

      <h2>Decks in play</h2>
      {plays.length === 0 ? (
        <p className="empty">
          No games running. Open a set, deck or pool and choose “Start playing” to make a shuffled copy to deal from.
        </p>
      ) : (
        <>
          <label className="row">
            Cards to draw{" "}
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              value={playCount}
              onChange={(e) => setPlayCount(e.currentTarget.value)}
              aria-label="How many cards to draw from a deck in play"
              className="narrow"
            />
          </label>
          <ul className="list">
            {plays.map((p) => (
              <li key={p.itemId} className="row wrap">
                <span className="name">
                  <button className="link name" onClick={() => openItem(p.itemId)}>
                    {cardTypeIcon("play")} {p.name}
                  </button>{" "}
                  <small className="meta">
                    {p.remaining} left · {p.drawn} drawn
                  </small>
                </span>
                <button onClick={() => void drawFromGame(p.itemId)} disabled={p.remaining === 0}>
                  Draw
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Recent draws</h2>
      <RollLogList kind="draw" emptyText="No draws yet. They also show in the Dice tool's roll log." />
    </div>
  );
}
