import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { renameItem, type Item } from "../api/library";
import { registry } from "../registry";
import type { RenameReview } from "../registry/types";
import { bumpDataVersion } from "./dataVersion";

type Choice = "update" | "only" | "cancel";

interface Pending {
  item: Item;
  newName: string;
  review: RenameReview;
  choose: (choice: Choice) => void;
}

interface Done {
  message: string;
  undo: () => Promise<void>;
}

/** How long the Undo notice stays (an undo later could overwrite edits made since). */
const UNDO_MS = 30_000;

type Rename = (item: Item, newName: string) => Promise<void>;

const RenameContext = createContext<Rename>(async (item, newName) => {
  await renameItem(item.id, newName);
});

/**
 * Renames an item the way every screen should: if the item's type has a
 * `renameReview` (tables do: slots in other tables use a table's name), the
 * person first sees what would change and chooses to rename with the update,
 * rename only, or cancel. Throws if the rename fails, like `renameItem`.
 */
export const useRenameItem = () => useContext(RenameContext);

export function RenameReviewProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  const rename = useCallback<Rename>(async (item, newName) => {
    const reviewer = registry.getItemType(item.itemType)?.renameReview;
    const review = reviewer ? await reviewer(item, newName) : null;
    if (!review) {
      await renameItem(item.id, newName);
      return;
    }
    const choice = await new Promise<Choice>((resolve) => {
      setPending({ item, newName, review, choose: resolve });
    });
    setPending(null);
    if (choice === "cancel") return;

    await renameItem(item.id, newName);
    if (choice === "only") return;
    try {
      await review.update();
    } catch (e) {
      await renameItem(item.id, item.name).catch(() => undefined); // all or nothing
      throw e;
    }
    bumpDataVersion();
    setUndoError(null);
    setDone({
      message: `Renamed “${item.name}” to “${newName.trim()}”. ${review.summary}`,
      undo: async () => {
        await renameItem(item.id, item.name); // first, so a name clash stops everything
        await review.undo();
        bumpDataVersion();
      },
    });
  }, []);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [done]);

  async function undo() {
    if (!done) return;
    try {
      await done.undo();
      setDone(null);
      setUndoError(null);
    } catch (e) {
      setUndoError(String(e));
    }
  }

  return (
    <RenameContext.Provider value={rename}>
      {children}
      {pending && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Rename ${pending.item.name}`}
            onKeyDown={(e) => {
              if (e.key === "Escape") pending.choose("cancel");
            }}
          >
            <h2>
              Rename “{pending.item.name}” to “{pending.newName.trim()}”?
            </h2>
            {pending.review.preview}
            <div className="row wrap">
              {pending.review.canUpdate && (
                <button autoFocus onClick={() => pending.choose("update")}>
                  Rename and update
                </button>
              )}
              <button autoFocus={!pending.review.canUpdate} onClick={() => pending.choose("only")}>
                Rename only
              </button>
              <button onClick={() => pending.choose("cancel")}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {done && (
        <div className="toast" role="status">
          {done.message}{" "}
          <button onClick={() => void undo()}>Undo</button>{" "}
          <button onClick={() => setDone(null)} aria-label="Dismiss">
            ✕
          </button>
          {undoError && <span className="error"> {undoError}</span>}
        </div>
      )}
    </RenameContext.Provider>
  );
}
