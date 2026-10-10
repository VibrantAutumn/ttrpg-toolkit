import { useState } from "react";
import { resolveCollectionCards, saveDraw } from "../../api/cards";
import { saveRoll } from "../../api/dice";
import { termTexts } from "../../lib/results/format";
import { copyText } from "../../lib/copyText";
import type { DiceLogEntry, DrawLogEntry, NameLogEntry, RollLogEntry, TableLogEntry } from "../../lib/results/rollLog";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { drawFromPlayDeck } from "../../state/playActions";
import { drawSpreadById } from "../../state/spreadActions";
import { rollLog } from "../../state/rollLog";
import { rerollTableResult, rollTableById } from "../../state/tableActions";
import { DrawnCards } from "../cards/DrawnCards";
import { SaveNameToList } from "./SaveNameToList";

/**
 * One result in the roll log, whatever its kind: what happened, and what you
 * can do with it (roll or draw again, copy, save as a library item).
 */
export function LogEntryView({ entry }: { entry: RollLogEntry }) {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setError(null);
    // A generated name is copied on its own, without the "Name → " in front.
    const text = entry.kind === "name" ? entry.name : entry.text;
    setNote((await copyText(text)) ? "Copied." : "Couldn't copy; select the text instead.");
  }

  async function save() {
    // Table results and names are copied for now (a name can be added to a table); saving them waits for sessions (Phase 6).
    if (!project || entry.kind === "table" || entry.kind === "name") return;
    try {
      const item =
        entry.kind === "dice"
          ? await saveRoll(
              project.id,
              entry.label ?? "",
              null,
              entry.notation,
              entry.seed,
              entry.text,
              JSON.stringify(entry.result),
            )
          : await saveDraw(
              project.id,
              "",
              null,
              entry.sourceName,
              entry.seed,
              entry.text,
              JSON.stringify({
                sourceId: entry.sourceId,
                options: entry.options,
                cards: entry.cards,
                positions: entry.positions,
                spreadId: entry.spreadId,
              }),
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
    if (e.spreadId) {
      const outcome = await drawSpreadById(e.spreadId);
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

  /** Rolls the whole table again (a new entry, possibly a different one). */
  async function rollAgain(e: TableLogEntry) {
    setNote(null);
    const outcome = await rollTableById(e.tableId);
    setError(outcome.ok ? null : outcome.message);
  }

  /** Rerolls the slots that aren't locked, keeping the entry. */
  async function rerollSlots(e: TableLogEntry) {
    if (!project) return;
    setNote(null);
    const outcome = await rerollTableResult(e.id, project.id);
    setError(outcome.ok ? null : outcome.message);
  }

  return (
    <li className="roll-entry">
      {entry.kind === "dice" && entry.label && <strong>{entry.label}</strong>}
      <div className="roll-text">{entry.text}</div>
      {entry.kind === "draw" && <DrawnCards cards={entry.cards} positions={entry.positions} />}
      {entry.kind === "dice" && <LockButtons entry={entry} />}
      {entry.kind === "table" && <TableDetails entry={entry} />}
      {entry.kind === "name" && <NameDetails entry={entry} />}
      <div className="row wrap">
        {entry.kind === "dice" && <button onClick={() => rollLog.reroll(entry.id)}>Reroll</button>}
        {entry.kind === "name" && <button onClick={() => rollLog.rerollName(entry.id)}>Reroll</button>}
        {entry.kind === "draw" && <button onClick={() => void drawAgain(entry)}>Draw again</button>}
        {entry.kind === "table" && (
          <>
            <button onClick={() => void rollAgain(entry)}>Roll again</button>
            {lockableSlots(entry).length > 0 && (
              <button onClick={() => void rerollSlots(entry)} disabled={!project}>
                Reroll slots
              </button>
            )}
          </>
        )}
        <button onClick={() => void copy()}>Copy</button>
        {entry.kind !== "table" &&
          entry.kind !== "name" &&
          (entry.savedItemId ? (
            <button onClick={() => openItem(entry.savedItemId!)}>Saved ✓ Open</button>
          ) : (
            <button onClick={() => void save()} disabled={!project}>
              Save
            </button>
          ))}
      </div>
      {note && <p className="meta" role="status">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </li>
  );
}

/** A generated name: which parts a reroll keeps, and a way to add the name to a table. */
function NameDetails({ entry }: { entry: NameLogEntry }) {
  return (
    <>
      {entry.picks.length > 1 && (
        <div className="row wrap">
          <small className="meta">Keep when rerolling:</small>
          {entry.picks.map((pick, i) => (
            <button
              key={pick.part}
              aria-pressed={entry.locked.includes(pick.part)}
              className={entry.locked.includes(pick.part) ? "active" : undefined}
              onClick={() => rollLog.toggleLock(entry.id, i)}
            >
              {entry.locked.includes(pick.part) ? "🔒" : "🔓"} {pick.text}
            </button>
          ))}
        </div>
      )}
      <SaveNameToList name={entry.name} />
    </>
  );
}

/** The slots of a table result that can be locked (text and references can't). */
function lockableSlots(entry: TableLogEntry) {
  return entry.roll.parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.kind === "slot" && part.slot.type !== "ref");
}

/** The documents an entity slot picked, as buttons that open them. */
function PickedItems({ items }: { items: { id: string; name: string }[] }) {
  const { openItem } = useNavigation();
  return (
    <div className="row wrap">
      <small className="meta">Open:</small>
      {items.map((i, index) => (
        <button key={`${i.id}-${index}`} type="button" className="link" onClick={() => openItem(i.id)}>
          {i.name}
        </button>
      ))}
    </div>
  );
}

/** What a table result adds to its text: the cards drawn, warnings, and which slots a reroll keeps. */
function TableDetails({ entry }: { entry: TableLogEntry }) {
  const slots = lockableSlots(entry);
  const cards = entry.roll.parts.flatMap((p) => (p.kind === "slot" && p.outcome.type === "draw" ? p.outcome.cards : []));
  const picked = entry.roll.parts.flatMap((p) => (p.kind === "slot" && p.outcome.type === "entity" ? p.outcome.picks : []));
  return (
    <>
      {cards.length > 0 && <DrawnCards cards={cards} />}
      {picked.length > 0 && <PickedItems items={picked} />}
      {entry.roll.warnings.length > 0 && (
        <ul className="meta">
          {entry.roll.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {slots.length > 1 && (
        <div className="row wrap">
          <small className="meta">Keep when rerolling:</small>
          {slots.map(({ part, index }) => (
            <button
              key={index}
              aria-pressed={entry.locked.includes(index)}
              className={entry.locked.includes(index) ? "active" : undefined}
              onClick={() => rollLog.toggleLock(entry.id, index)}
            >
              {entry.locked.includes(index) ? "🔒" : "🔓"} {part.kind === "slot" ? part.text : ""}
            </button>
          ))}
        </div>
      )}
    </>
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
