import { useEffect, useMemo, useState } from "react";
import { resolveCollectionCards } from "../../api/cards";
import { CardThumb } from "../../components/cards/CardThumb";
import { useThumbs } from "../../components/cards/useThumbs";
import { ConfirmButton } from "../../components/ConfirmButton";
import { LogEntryView } from "../../components/results/LogEntryView";
import { MAX_DRAW } from "../../lib/cards/draw";
import {
  playSummary,
  reshuffleAll,
  restartWith,
  returnToDeck,
  setReversals,
  shuffleRemaining,
} from "../../lib/cards/play";
import { newSeed } from "../../lib/dice/rng";
import { useDataVersion } from "../../state/dataVersion";
import { changePlay, drawFromPlayDeck, loadPlay, type LoadedPlay } from "../../state/playActions";
import { useRollLog } from "../../state/rollLog";

/**
 * A deck in play: a shuffled copy of some cards. Draw from the top; drawn cards
 * wait in the discard pile until you return them or reshuffle. The game is read
 * from the database every time it changes, so this page, the Draw tab and the
 * roll log always agree.
 */
export function PlayDeckView({ itemId }: { itemId: string }) {
  const dataVersion = useDataVersion();
  const log = useRollLog();
  const [play, setPlay] = useState<LoadedPlay | null>(null); // null while loading
  const [error, setError] = useState<string | null>(null);
  const [countText, setCountText] = useState("1");
  const [percentText, setPercentText] = useState("50");

  useEffect(() => {
    let active = true;
    loadPlay(itemId)
      .then((loaded) => {
        if (!active) return;
        setPlay(loaded);
        setPercentText(String(loaded.state.reversalPercent));
        setError(null);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [itemId, dataVersion]);

  const discardIds = useMemo(() => (play ? play.state.drawn.map((c) => c.id) : []), [play]);
  const thumbs = useThumbs(discardIds);
  const latest = useMemo(
    () => log.find((e) => e.kind === "draw" && e.sourceId === itemId),
    [log, itemId],
  );

  if (!play) {
    return error ? <p className="error">{error}</p> : <p className="empty">Loading...</p>;
  }
  const { state } = play;
  const summary = playSummary(state);

  /** Runs a change to the game and shows why if it was refused. */
  async function change(rule: Parameters<typeof changePlay>[1]) {
    const result = await changePlay(itemId, rule);
    setError(result.ok ? null : result.message);
  }

  async function draw() {
    const count = countText.trim() === "" ? NaN : Number(countText);
    const outcome = await drawFromPlayDeck(itemId, count);
    setError(outcome.ok ? null : outcome.message);
  }

  async function restart() {
    if (!play?.sourceId) return;
    try {
      const cards = (await resolveCollectionCards(play.sourceId)).map((c) => ({ id: c.id, name: c.name }));
      if (cards.length === 0) {
        setError(`“${play.sourceName}” has no cards now, so there is nothing to restart with.`);
        return;
      }
      await change((s) => restartWith(s, cards, newSeed()));
    } catch {
      setError(`“${play.sourceName}” isn't available any more, so the game can't restart from it.`);
    }
  }

  return (
    <div className="play-deck">
      <p>
        <strong>
          {summary.remaining === 1 ? "1 card" : `${summary.remaining} cards`} left
        </strong>{" "}
        in the deck, {summary.drawn} drawn · shuffled {state.shuffles === 1 ? "once" : `${state.shuffles} times`}
      </p>
      <p className="meta">
        A copy of the {summary.total} cards from {play.sourceName || "its source"}, made{" "}
        {new Date(play.createdAt).toLocaleDateString()}. Changes to the original don't affect this game.
      </p>
      {error && <p className="error" role="alert">{error}</p>}

      <h2>Draw</h2>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          void draw();
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
        <button type="submit" disabled={summary.remaining === 0}>
          Draw from the top
        </button>
      </form>
      {summary.remaining === 0 && (
        <p className="empty">The deck is empty. Return some cards, or reshuffle everything.</p>
      )}
      {latest && (
        <ul className="list">
          <LogEntryView key={latest.id} entry={latest} />
        </ul>
      )}

      <h2>Reversals</h2>
      <form
        className="row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          const percent = percentText.trim() === "" ? NaN : Number(percentText);
          void change((s) => {
            const r = setReversals(s, s.reversals, percent);
            return r.ok ? r.state : { error: r.message };
          });
        }}
      >
        <label>
          <input
            type="checkbox"
            checked={state.reversals}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              void change((s) => {
                const r = setReversals(s, on, s.reversalPercent);
                return r.ok ? r.state : { error: r.message };
              });
            }}
          />{" "}
          Cards can come up reversed
        </label>
        {state.reversals && (
          <>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={percentText}
              onChange={(e) => setPercentText(e.currentTarget.value)}
              aria-label="Reversal chance in percent"
              className="narrow"
            />
            <span>%</span>
            <button type="submit">Set</button>
          </>
        )}
      </form>

      <h2>Discard pile</h2>
      {state.drawn.length === 0 ? (
        <p className="empty">Nothing drawn yet.</p>
      ) : (
        <ol className="drawn-cards">
          {state.drawn.map((card, i) => (
            <li key={`${card.id}-${i}`} className="drawn-card">
              <CardThumb src={thumbs.get(card.id)} name={card.name} reversed={card.reversed} large />
              <span className="card-grid-name">
                {card.name}
                {card.reversed && <small className="meta"> (reversed)</small>}
              </span>
              <span className="row wrap mini-actions" role="group" aria-label={`Return ${card.name}`}>
                <button onClick={() => void change((s) => returnToDeck(s, i, "top"))} title="Put it back on top">
                  Top
                </button>
                <button onClick={() => void change((s) => returnToDeck(s, i, "bottom"))} title="Put it at the bottom">
                  Bottom
                </button>
                <button onClick={() => void change((s) => returnToDeck(s, i, "shuffle"))} title="Shuffle it into the deck">
                  Shuffle in
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <h2>Shuffling</h2>
      <div className="row wrap">
        <button
          onClick={() => void change((s) => shuffleRemaining(s, newSeed()))}
          disabled={summary.remaining < 2}
          title="Shuffle only the cards still in the deck"
        >
          Shuffle the deck
        </button>
        <ConfirmButton
          label="Reshuffle everything"
          confirmLabel="Tap again to reshuffle"
          onConfirm={() => void change((s) => reshuffleAll(s, newSeed()))}
        />
        {play.sourceId && (
          <ConfirmButton
            label="Restart from the current cards"
            confirmLabel="Tap again to restart"
            onConfirm={() => void restart()}
          />
        )}
      </div>
      <p className="meta">
        “Reshuffle everything” gathers the discard pile back in. “Restart from the current cards” makes a new copy of
        what {play.sourceName || "the source"} holds now, and clears the discard pile.
      </p>
    </div>
  );
}
