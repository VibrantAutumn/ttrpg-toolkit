import { useCallback, useEffect, useState } from "react";
import {
  addLink,
  getItem,
  listBacklinks,
  listItemTags,
  listLinks,
  removeLink,
  type Item,
  type Tag,
} from "../../api/library";
import { registry } from "../../registry";
import { useNavigation } from "../../state/Navigation";
import { TagChips } from "../library/TagChips";
import { itemIcon, itemTypeLabel, libraryLabel } from "./itemDisplay";
import { LinkPicker } from "./LinkPicker";

/** One item's page: what it is, what it links to, and what links to it. */
export function ItemView({ itemId, onBack }: { itemId: string; onBack: () => void }) {
  const { openItem } = useNavigation();
  const [item, setItem] = useState<Item | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [outgoing, setOutgoing] = useState<Item[]>([]);
  const [backlinks, setBacklinks] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [i, t, o, b] = await Promise.all([
        getItem(itemId),
        listItemTags(itemId),
        listLinks(itemId),
        listBacklinks(itemId),
      ]);
      setItem(i);
      setTags(t);
      setOutgoing(o);
      setBacklinks(b);
      setError(null);
    } catch (e) {
      setItem(null);
      setError(String(e));
    }
  }, [itemId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Runs a change, then reloads. Shows any error from Rust. */
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await reload();
    } catch (e) {
      setError(String(e));
    }
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

          {Editor ? (
            <Editor key={item.id} itemId={item.id} />
          ) : (
            <p className="empty">
              This {itemTypeLabel(item).toLowerCase()} has nothing to edit yet.
            </p>
          )}

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
                <button onClick={() => run(() => removeLink(item.id, o.id))}>
                  Remove
                </button>
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
            <button onClick={() => setPicking(true)}>Add link</button>
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
