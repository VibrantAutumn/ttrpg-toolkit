import { useState } from "react";
import { saveRoll } from "../../api/dice";
import { ConfirmButton } from "../../components/ConfirmButton";
import { describeParseError, QUICK_ROLLS } from "../../lib/dice/formula";
import { termTexts } from "../../lib/results/format";
import type { RollLogEntry } from "../../lib/results/rollLog";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { bumpDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { rollLog, useRollLog } from "../../state/rollLog";
import { copyText } from "./copyText";
import { FormulaList } from "./FormulaList";

/** The roller: a formula box, and the roll log below it. */
export function RollerPanel() {
  const entries = useRollLog();
  const { campaign } = useCurrentCampaign();
  const { openItem } = useNavigation();
  const [formula, setFormula] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function roll() {
    setNote(null);
    const outcome = rollLog.roll(formula);
    if (outcome.ok) {
      setError(null);
    } else {
      setError(describeParseError(outcome.error));
    }
  }

  async function copy(entry: RollLogEntry) {
    setNote((await copyText(entry.text)) ? "Copied." : "Couldn't copy; select the text instead.");
  }

  async function save(entry: RollLogEntry) {
    if (!campaign) return;
    try {
      const item = await saveRoll(
        campaign.id,
        entry.label ?? "",
        null,
        entry.notation,
        entry.seed,
        entry.text,
        JSON.stringify(entry.result),
      );
      rollLog.markSaved(entry.id, item.id);
      bumpDataVersion();
      setError(null);
      setNote("Saved to the Dice library.");
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          roll();
        }}
      >
        <input
          value={formula}
          onChange={(e) => setFormula(e.currentTarget.value)}
          placeholder="2d6+3, 4d6kh3, d20 adv, 6d10>=8, 4dF..."
          aria-label="Dice formula"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit">Roll</button>
      </form>
      <div className="row wrap quick-rolls" role="group" aria-label="Quick rolls">
        {QUICK_ROLLS.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => {
              setError(null);
              setNote(null);
              rollLog.roll(q.notation);
            }}
          >
            {q.label}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {note && <p className="meta" role="status">{note}</p>}

      <FormulaList />

      <h2>Roll log</h2>
      {entries.length === 0 ? (
        <p className="empty">No rolls yet. The log is cleared when the app restarts; save a roll to keep it.</p>
      ) : (
        <>
          <ul className="list">
            {entries.map((entry) => {
              const diceTerms = entry.result.terms.filter((t) => t.kind === "dice").length;
              const texts = termTexts(entry.result);
              return (
                <li key={entry.id} className="roll-entry">
                  {entry.label && <strong>{entry.label}</strong>}
                  <div className="roll-text">{entry.text}</div>
                  {diceTerms > 1 && (
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
                  )}
                  <div className="row wrap">
                    <button onClick={() => rollLog.reroll(entry.id)}>Reroll</button>
                    <button onClick={() => copy(entry)}>Copy</button>
                    {entry.savedItemId ? (
                      <button onClick={() => openItem(entry.savedItemId!)}>Saved ✓ Open</button>
                    ) : (
                      <button onClick={() => save(entry)} disabled={!campaign}>
                        Save
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <ConfirmButton label="Clear log" confirmLabel="Tap again to clear" onConfirm={() => rollLog.clear()} />
        </>
      )}
      {!campaign && <p className="meta">Choose a campaign to save rolls.</p>}
    </div>
  );
}
