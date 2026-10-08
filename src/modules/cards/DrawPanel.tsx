import { useEffect, useMemo, useState } from "react";
import { resolveCollectionCards } from "../../api/cards";
import { LogEntryView } from "../../components/results/LogEntryView";
import { DEFAULT_DRAW_OPTIONS, MAX_DRAW, type DrawCard } from "../../lib/cards/draw";
import { useDataVersion } from "../../state/dataVersion";
import { rollLog, useRollLog } from "../../state/rollLog";

/**
 * Draw cards from a set, deck or pool: how many, whether cards may repeat, and
 * whether (and how often) they come up reversed. Every draw goes into the roll
 * log; the newest one from this source is shown here when `showResult` is on.
 */
export function DrawPanel({
  sourceId,
  sourceName,
  showResult = true,
  showHeading = true,
}: {
  sourceId: string;
  sourceName: string;
  showResult?: boolean;
  showHeading?: boolean;
}) {
  const dataVersion = useDataVersion();
  const log = useRollLog();
  const [cards, setCards] = useState<DrawCard[] | null>(null); // null while loading
  const [countText, setCountText] = useState(String(DEFAULT_DRAW_OPTIONS.count));
  const [repeats, setRepeats] = useState(DEFAULT_DRAW_OPTIONS.repeats);
  const [reversals, setReversals] = useState(DEFAULT_DRAW_OPTIONS.reversals);
  const [percentText, setPercentText] = useState(String(DEFAULT_DRAW_OPTIONS.reversalPercent));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    resolveCollectionCards(sourceId)
      .then((list) => active && setCards(list.map((c) => ({ id: c.id, name: c.name }))))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [sourceId, dataVersion]);

  const latest = useMemo(
    () => log.find((e) => e.kind === "draw" && e.sourceId === sourceId),
    [log, sourceId],
  );

  function draw() {
    if (!cards) return;
    const outcome = rollLog.drawFrom({ id: sourceId, name: sourceName }, cards, {
      // Empty or odd text becomes NaN, which the draw rejects with a clear message.
      count: countText.trim() === "" ? NaN : Number(countText),
      repeats,
      reversals,
      reversalPercent: percentText.trim() === "" ? NaN : Number(percentText),
    });
    setError(outcome.ok ? null : outcome.message);
  }

  const available = cards?.length ?? 0;

  return (
    <div className="draw-panel">
      {showHeading && <h2>Draw</h2>}
      <p className="meta">
        {cards === null
          ? "Loading..."
          : available === 0
            ? "No cards to draw from yet. Add some cards first."
            : `Drawing from ${available === 1 ? "1 card" : `${available} different cards`}.`}
      </p>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          draw();
        }}
      >
        <label>
          Cards{" "}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_DRAW}
            value={countText}
            onChange={(e) => setCountText(e.currentTarget.value)}
            aria-label="How many cards"
            className="narrow"
          />
        </label>
        <label>
          <input type="checkbox" checked={repeats} onChange={(e) => setRepeats(e.currentTarget.checked)} /> Allow
          repeats
        </label>
        <label>
          <input
            type="checkbox"
            checked={reversals}
            onChange={(e) => setReversals(e.currentTarget.checked)}
          />{" "}
          Reversals
        </label>
        {reversals && (
          <label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={percentText}
              onChange={(e) => setPercentText(e.currentTarget.value)}
              aria-label="Reversal chance in percent"
              className="narrow"
            />{" "}
            % reversed
          </label>
        )}
        <button type="submit" disabled={cards === null || available === 0}>
          Draw
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {showResult && latest && (
        <ul className="list">
          <LogEntryView key={latest.id} entry={latest} />
        </ul>
      )}
    </div>
  );
}
