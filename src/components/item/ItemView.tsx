import { useCallback, useEffect, useState } from "react";
import {
  addLink,
  deleteItem,
  getItem,
  listBacklinks,
  listItemTags,
  listLinks,
  listManualLinkIds,
  listTags,
  removeLink,
  restoreItem,
  type Item,
  type Tag,
} from "../../api/library";
import { registry } from "../../registry";
import { useNavigation } from "../../state/Navigation";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { ItemFieldsPanel } from "../fields/ItemFieldsPanel";
import { useRenameItem } from "../../state/renameReview";
import { ConfirmButton } from "../ConfirmButton";
import { TagChips } from "../library/TagChips";
import { TagEditor } from "../library/TagEditor";
import { itemIcon, itemTypeLabel, libraryLabel } from "./itemDisplay";
import { LinkPicker } from "./LinkPicker";

/** One item's page: what it is, what it links to, and what links to it. */
export function ItemView({ itemId, onBack }: { itemId: string; onBack: () => void }) {
  const { openItem } = useNavigation();
  const renameReviewed = useRenameItem();
  const [item, setItem] = useState<Item | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [outgoing, setOutgoing] = useState<Item[]>([]);
  const [backlinks, setBacklinks] = useState<Item[]>([]);
  // Which of the outgoing links were made by hand (the rest come from mentions in the text).
  const [manualIds, setManualIds] = useState<Set<string>>(new Set());
  const dataVersion = useDataVersion();
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingTags, setEditingTags] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const reload = useCallback(async () => {
    try {
      const [i, t, o, b, manual] = await Promise.all([
        getItem(itemId),
        listItemTags(itemId),
        listLinks(itemId),
        listBacklinks(itemId),
        listManualLinkIds(itemId),
      ]);
      setItem(i);
      setTags(t);
      setOutgoing(o);
      setBacklinks(b);
      setManualIds(new Set(manual));
      setError(null);
    } catch (e) {
      setItem(null);
      setError(String(e));
    }
  }, [itemId]);

  // Also reload when something elsewhere changed (an edited document's mentions change its links).
  useEffect(() => {
    reload();
  }, [reload, dataVersion]);

  /** Runs a change, then reloads. Shows any error from Rust. */
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await reload();
      // Library lists (kept mounted behind this page) must pick the change up.
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  /** Like `run`, for the tag editor: also refreshes the list of tags to choose from. */
  async function runTags(action: () => Promise<unknown>) {
    await run(action);
    if (item) {
      try {
        setAllTags(await listTags(item.campaignId));
      } catch (e) {
        setError(String(e));
      }
    }
  }

  async function toggleTagEditor() {
    if (!item) return;
    if (!editingTags) {
      try {
        setAllTags(await listTags(item.campaignId));
      } catch (e) {
        setError(String(e));
        return;
      }
    }
    setEditingTags(!editingTags);
  }

  function itemButton(other: Item) {
    return (
      <>
        <button className="link name" onClick={() => openItem(other.id)}>
          {itemIcon(other)} {other.name}
        </button>{" "}
        <small className="meta">{libraryLabel(other)}</small>
      </>
    );
  }

  // Each item type can bring its own editor (registered by its module).
  const Editor = item ? registry.getItemType(item.itemType)?.editor : undefined;
  const trashed = item?.deletedAt != null;

  return (
    <section>
      <button onClick={onBack}>← Back</button>

      {!item ? (
        <>
          <h1>Item not found</h1>
          <p className="error">{error ?? "Loading..."}</p>
        </>
      ) : (
        <>
          <h1>
            {itemIcon(item)} {item.name}
          </h1>
          <p className="meta">
            {itemTypeLabel(item)} in {libraryLabel(item)} <TagChips tags={tags} />
          </p>
          {error && <p className="error">{error}</p>}

          {trashed ? (
            <p className="notice">
              This {itemTypeLabel(item).toLowerCase()} is in the trash.{" "}
              <button onClick={() => run(() => restoreItem(item.id))}>Restore</button>
            </p>
          ) : renaming ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await renameReviewed(item, newName);
                  setRenaming(false);
                });
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.currentTarget.value)}
                aria-label="New name"
                autoFocus
              />
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
              <ConfirmButton
                label="Delete"
                confirmLabel="Tap again to delete"
                onConfirm={() => {
                  setEditingTags(false);
                  run(() => deleteItem(item.id));
                }}
              />
            </div>
          )}
          {editingTags && !trashed && (
            <TagEditor
              campaignId={item.campaignId}
              itemId={item.id}
              itemTags={tags}
              allTags={allTags}
              run={runTags}
            />
          )}

          {trashed ? null : Editor ? (
            <Editor key={item.id} itemId={item.id} />
          ) : (
            <p className="empty">
              This {itemTypeLabel(item).toLowerCase()} has nothing to edit yet.
            </p>
          )}

          {!trashed && <ItemFieldsPanel item={item} />}

          <h2>Links</h2>
          {outgoing.length === 0 && !picking && (
            <p className="empty">
              Not linked to anything yet. Links connect this to items in any tool.
            </p>
          )}
          <ul className="list">
            {outgoing.map((o) => (
              <li key={o.id} className="row wrap">
                <span className="name">{itemButton(o)}</span>
                {manualIds.has(o.id) ? (
                  <button onClick={() => run(() => removeLink(item.id, o.id))}>
                    Remove
                  </button>
                ) : (
                  <span className="meta" title="Made by a mention in this item's text or by a link field. Remove the mention or the field's value to remove the link.">
                    from text or a field
                  </span>
                )}
              </li>
            ))}
          </ul>
          {picking ? (
            <LinkPicker
              campaignId={item.campaignId}
              excludeIds={new Set([item.id, ...outgoing.map((o) => o.id)])}
              onPick={(target) =>
                run(async () => {
                  await addLink(item.id, target.id);
                  setPicking(false);
                })
              }
              onClose={() => setPicking(false)}
            />
          ) : (
            <button onClick={() => setPicking(true)} disabled={trashed}>
              Add link
            </button>
          )}

          <h2>Linked from</h2>
          {backlinks.length === 0 ? (
            <p className="empty">Nothing links here yet.</p>
          ) : (
            <ul className="list">
              {backlinks.map((b) => (
                <li key={b.id}>{itemButton(b)}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
