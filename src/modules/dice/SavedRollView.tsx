import { useEffect, useState } from "react";
import { getSavedRoll, type SavedRoll } from "../../api/dice";
import { rollLog } from "../../state/rollLog";
import { copyText } from "./copyText";

/** What a saved roll's page shows (its type's editor): the roll as it was, and a way to roll it again. */
export function SavedRollView({ itemId }: { itemId: string }) {
  const [roll, setRoll] = useState<SavedRoll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [again, setAgain] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSavedRoll(itemId)
      .then((r) => active && setRoll(r))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [itemId]);

  if (!roll) {
    return error ? <p className="error">{error}</p> : <p className="empty">Loading...</p>;
  }

  return (
    <div className="saved-roll">
      <p className="roll-text">{roll.text}</p>
      <p className="meta">
        Formula {roll.notation} · seed {roll.seed} · saved {new Date(roll.createdAt).toLocaleString()}
      </p>
      <div className="row wrap">
        <button
          onClick={async () =>
            setNote((await copyText(roll.text)) ? "Copied." : "Couldn't copy; select the text instead.")
          }
        >
          Copy
        </button>
        <button
          onClick={() => {
            const outcome = rollLog.roll(roll.notation);
            setAgain(outcome.ok ? outcome.entry.text : outcome.error.message);
          }}
        >
          Roll this again
        </button>
      </div>
      {note && <p className="meta" role="status">{note}</p>}
      {again && (
        <p role="status">
          New roll: <span className="roll-text">{again}</span>
        </p>
      )}
    </div>
  );
}
