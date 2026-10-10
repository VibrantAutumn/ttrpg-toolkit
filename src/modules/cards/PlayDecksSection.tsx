import { useEffect, useState } from "react";
import { listPlayDecks, type PlayDeckEntry } from "../../api/cards";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { drawFromPlayDeck } from "../../state/playActions";
import { cardTypeIcon } from "./icons";

/**
 * Your decks in play with how many cards are left, and a Draw button for each.
 * Used by the Draw tab and by the quick tools panel (`compact` drops the heading).
 */
export function PlayDecksSection({ compact = false }: { compact?: boolean }) {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;
  const [plays, setPlays] = useState<PlayDeckEntry[]>([]);
  const [countText, setCountText] = useState("1");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setPlays([]);
      return;
    }
    let active = true;
    listPlayDecks(projectId)
      .then((list) => active && setPlays(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  async function draw(playId: string) {
    const outcome = await drawFromPlayDeck(playId, countText.trim() === "" ? NaN : Number(countText));
    setError(outcome.ok ? null : outcome.message);
    // If the game turned out to be gone, reload the list so it stops being offered.
    if (!outcome.ok) bumpDataVersion();
  }

  return (
    <div>
      {!compact && <h2>Decks in play</h2>}
      {error && <p className="error" role="alert">{error}</p>}
      {!projectId ? (
        <p className="empty">No project is open.</p>
      ) : plays.length === 0 ? (
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
              value={countText}
              onChange={(e) => setCountText(e.currentTarget.value)}
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
                <button onClick={() => void draw(p.itemId)} disabled={p.remaining === 0}>
                  Draw
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
