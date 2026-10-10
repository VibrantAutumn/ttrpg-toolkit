import { useEffect, useState } from "react";
import { listItemTags, listTags, type Item, type Tag } from "../../api/library";
import { useDataVersion } from "../../state/dataVersion";
import { useRenameItem } from "../../state/renameReview";
import { ConfirmButton } from "../ConfirmButton";
import { TagEditor } from "../library/TagEditor";

/**
 * The Rename / Tags / Delete row of an item (the page's own, or a tab's document). `run` makes a
 * change and refreshes the screen; `onDelete` is what the delete button does (a tab's button
 * says "Remove tab" and removes the tab).
 */
export function ItemActions({
  item,
  run,
  deleteLabel = "Delete",
  onDelete,
  children,
}: {
  item: Item;
  run: (action: () => Promise<unknown>) => Promise<void>;
  deleteLabel?: string;
  onDelete: () => Promise<unknown>;
  /** More buttons, drawn before the delete button. */
  children?: React.ReactNode;
}) {
  const renameReviewed = useRenameItem();
  const dataVersion = useDataVersion();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listItemTags(item.id)
      .then((t) => active && setTags(t))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [item.id, dataVersion]);

  /** Like `run`, for the tag editor: also refreshes the list of tags to choose from. */
  async function runTags(action: () => Promise<unknown>) {
    await run(action);
    try {
      setAllTags(await listTags(item.projectId));
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleTagEditor() {
    if (!editingTags) {
      try {
        setAllTags(await listTags(item.projectId));
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    setEditingTags(!editingTags);
  }

  return (
    <>
      {error && <p className="error">{error}</p>}
      {renaming ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await renameReviewed(item, newName);
              setRenaming(false);
            });
          }}
        >
          <input value={newName} onChange={(e) => setNewName(e.currentTarget.value)} aria-label="New name" autoFocus />
          <button type="submit">Save name</button>
          <button type="button" onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="row wrap">
          <button
            onClick={() => {
              setNewName(item.name);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button onClick={toggleTagEditor} aria-expanded={editingTags}>
            {editingTags ? "Done with tags" : "Tags"}
          </button>
          {children}
          <ConfirmButton
            label={deleteLabel}
            confirmLabel="Tap again to confirm"
            onConfirm={() => {
              setEditingTags(false);
              void run(onDelete);
            }}
          />
        </div>
      )}
      {editingTags && <TagEditor projectId={item.projectId} itemId={item.id} itemTags={tags} allTags={allTags} run={runTags} />}
    </>
  );
}
