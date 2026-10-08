import { useState } from "react";
import { resolveCollectionCards, saveDraw } from "../../api/cards";
import { saveRoll } from "../../api/dice";
import { termTexts } from "../../lib/results/format";
import { copyText } from "../../lib/copyText";
import type { DiceLogEntry, DrawLogEntry, RollLogEntry } from "../../lib/results/rollLog";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { bumpDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { drawFromPlayDeck } from "../../state/playActions";
import { rollLog } from "../../state/rollLog";
import { DrawnCards } from "../cards/DrawnCards";

/**
 * One result in the roll log, whatever its kind: what happened, and what you
 * can do with it (roll or draw again, copy, save as a library item).
 */
export function LogEntryView({ entry }: { entry: RollLogEntry }) {
  const { campaign } = useCurrentCampaign();
  const { openItem } = useNavigation();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setError(null);
    setNote((await copyText(entry.text)) ? "Copied." : "Couldn't copy; select the text instead.");
  }

  async function save() {
    if (!campaign) return;
    try {
      const item =
        entry.kind === "dice"
          ? await saveRoll(
              campaign.id,
              entry.label ?? "",
              null,
              entry.notation,
              entry.seed,
              entry.text,
              JSON.stringify(entry.result),
            )
          : await saveDraw(
              campaign.id,
              "",
              null,
              entry.sourceName,
              entry.seed,
              entry.text,
              JSON.stringify({ sourceId: entry.sourceId, options: entry.options, cards: entry.cards }),
            );
      rollLog.markSaved(entry.id, item.id);
      bumpDataVersion();
      setError(null);
      setNote(entry.kind === "dice" ? "Saved to the Dice library." : "Saved to the Cards library.");
    } catch (e) {
      setError(String(e));
    }
  }

  /**
   * Draws again from the same place with the same options, using the cards as they
   * are now. For a deck in play that means the next cards from the top of that game.
   */
  async function drawAgain(e: DrawLogEntry) {
    setNote(null);
    if (e.playId) {
      const outcome = await drawFromPlayDeck(e.playId, e.options.count);
      setError(outcome.ok ? null : outcome.message);
      return;
    }
    try {
      const cards = await resolveCollectionCards(e.sourceId);
      const outcome = rollLog.drawFrom(
        { id: e.sourceId, name: e.sourceName },
        cards.map((c) => ({ id: c.id, name: c.name })),
        e.options,
      );
      setError(outcome.ok ? null : outcome.message);
    } catch {
      setError(`“${e.sourceName}” isn't available any more, so it can't be drawn from again.`);
    }
  }

  return (
    <li className="roll-entry">
      {entry.kind === "dice" && entry.label && <strong>{entry.label}</strong>}
      <div className="roll-text">{entry.text}</div>
      {entry.kind === "draw" && <DrawnCards cards={entry.cards} />}
      {entry.kind === "dice" && <LockButtons entry={entry} />}
      <div className="row wrap">
        {entry.kind === "dice" ? (
          <button onClick={() => rollLog.reroll(entry.id)}>Reroll</button>
        ) : (
          <button onClick={() => void drawAgain(entry)}>Draw again</button>
        )}
        <button onClick={() => void copy()}>Copy</button>
        {entry.savedItemId ? (
          <button onClick={() => openItem(entry.savedItemId!)}>Saved ✓ Open</button>
        ) : (
          <button onClick={() => void save()} disabled={!campaign}>
            Save
          </button>
        )}
      </div>
      {note && <p className="meta" role="status">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </li>
  );
}

/** For a dice result with more than one dice part: choose which parts a reroll keeps. */
function LockButtons({ entry }: { entry: DiceLogEntry }) {
  const diceTerms = entry.result.terms.filter((t) => t.kind === "dice").length;
  if (diceTerms < 2) return null;
  const texts = termTexts(entry.result);
  return (
    <div className="row wrap">
      <small className="meta">Keep when rerolling:</small>
      {entry.result.terms.map((term, i) =>
        term.kind === "dice" ? (
          <button
            key={i}
            aria-pressed={entry.locked.includes(i)}
            className={entry.locked.includes(i) ? "active" : undefined}
            onClick={() => rollLog.toggleLock(entry.id, i)}
          >
            {entry.locked.includes(i) ? "🔒" : "🔓"} {texts[i]}
          </button>
        ) : null,
      )}
    </div>
  );
}
