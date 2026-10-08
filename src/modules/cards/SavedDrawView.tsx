import { useEffect, useRef, useState } from "react";
import { getSavedDraw, setSavedDrawNotes, type SavedDraw } from "../../api/cards";
import { DrawnCards } from "../../components/cards/DrawnCards";
import { createAutosaver, type Autosaver, type SaveStatus } from "../../lib/autosave";
import type { DrawnCard } from "../../lib/cards/draw";
import { copyText } from "../../lib/copyText";

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving...",
  error: "Couldn't save",
};

/** The cards of a saved draw, read defensively from its stored JSON. */
function cardsOf(resultJson: string): DrawnCard[] {
  try {
    const parsed: unknown = JSON.parse(resultJson);
    const list = (parsed as { cards?: unknown }).cards;
    if (!Array.isArray(list)) return [];
    return list.map((c) => {
      const card = c as Partial<DrawnCard>;
      return { id: String(card.id ?? ""), name: String(card.name ?? "?"), reversed: card.reversed === true };
    });
  } catch {
    return [];
  }
}

/** The position names of a saved spread reading, if it has them (one per card). */
function positionsOf(resultJson: string, cardCount: number): string[] | null {
  try {
    const list = (JSON.parse(resultJson) as { positions?: unknown }).positions;
    if (!Array.isArray(list) || list.length !== cardCount) return null;
    return list.map((p) => String(p));
  } catch {
    return null;
  }
}

/** A saved draw's page: the cards as drawn (reversed ones upside-down), and your notes on them. */
export function SavedDrawView({ itemId }: { itemId: string }) {
  const [draw, setDraw] = useState<SavedDraw | null>(null); // null while loading
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const saver = useRef<Autosaver | null>(null);

  useEffect(() => {
    let active = true;
    const autosaver = createAutosaver({
      save: (text) => setSavedDrawNotes(itemId, text),
      delayMs: 800,
      onStatus: (s, e) => {
        if (!active) return;
        setStatus(s);
        setError(e ? String(e) : null);
      },
    });
    saver.current = autosaver;
    getSavedDraw(itemId)
      .then((d) => {
        if (!active) return;
        setDraw(d);
        setNotes(d.notes);
      })
      .catch((e) => active && setError(String(e)));
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") void autosaver.flush();
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", saveWhenHidden);
      void autosaver.flush(); // don't lose the last edits when leaving the page
      saver.current = null;
    };
  }, [itemId]);

  if (!draw) {
    return error ? <p className="error">{error}</p> : <p className="empty">Loading...</p>;
  }

  return (
    <div className="saved-draw">
      <p className="roll-text">{draw.text}</p>
      <DrawnCards
        cards={cardsOf(draw.resultJson)}
        positions={positionsOf(draw.resultJson, cardsOf(draw.resultJson).length)}
      />
      <p className="meta">
        Drawn from {draw.sourceName} · seed {draw.seed} · saved {new Date(draw.createdAt).toLocaleString()}
      </p>
      <div className="row wrap">
        <button
          onClick={async () =>
            setNote((await copyText(draw.text)) ? "Copied." : "Couldn't copy; select the text instead.")
          }
        >
          Copy
        </button>
      </div>
      {note && <p className="meta" role="status">{note}</p>}

      <label className="field">
        <span>Notes</span>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.currentTarget.value);
            saver.current?.change(e.currentTarget.value);
          }}
          onBlur={() => void saver.current?.flush()}
          placeholder="What this draw means..."
          rows={5}
        />
      </label>
      <p className={status === "error" ? "error" : "meta"} role="status">
        {STATUS_LABEL[status]}
        {status === "error" && error ? `: ${error}` : ""}
      </p>
    </div>
  );
}
