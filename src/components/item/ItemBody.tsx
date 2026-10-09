import { useCallback, useEffect, useState } from "react";
import { addLink, listBacklinks, listLinks, listManualLinkIds, removeLink, type Item } from "../../api/library";
import { registry } from "../../registry";
import { useNavigation } from "../../state/Navigation";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { ItemFieldsPanel } from "../fields/ItemFieldsPanel";
import { itemIcon, itemTypeLabel, libraryLabel } from "./itemDisplay";
import { LinkPicker } from "./LinkPicker";

/**
 * What one item shows below its title: its editor, its Fields, what it links to and what links
 * to it. It is the body of a page's Main tab and of each document tab (a tab's document is a
 * real item with its own fields and links).
 */
export function ItemBody({ item }: { item: Item }) {
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const [outgoing, setOutgoing] = useState<Item[]>([]);
  const [backlinks, setBacklinks] = useState<Item[]>([]);
  // Which of the outgoing links were made by hand (the rest come from mentions or link fields).
  const [manualIds, setManualIds] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [o, b, manual] = await Promise.all([listLinks(item.id), listBacklinks(item.id), listManualLinkIds(item.id)]);
      setOutgoing(o);
      setBacklinks(b);
      setManualIds(new Set(manual));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [item.id]);

  // Also reload when something elsewhere changed (an edited document's mentions change its links).
  useEffect(() => {
    void reload();
  }, [reload, dataVersion]);

  /** Runs a change, then reloads (and tells library lists kept mounted behind this page). */
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await reload();
      bumpDataVersion();
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
  const Editor = registry.getItemType(item.itemType)?.editor;
  const trashed = item.deletedAt != null;

  return (
    <>
      {error && <p className="error">{error}</p>}

      {trashed ? null : Editor ? (
        <Editor key={item.id} itemId={item.id} />
      ) : (
        <p className="empty">This {itemTypeLabel(item).toLowerCase()} has nothing to edit yet.</p>
      )}

      {!trashed && <ItemFieldsPanel item={item} />}

      <h2>Links</h2>
      {outgoing.length === 0 && !picking && (
        <p className="empty">Not linked to anything yet. Links connect this to items in any tool.</p>
      )}
      <ul className="list">
        {outgoing.map((o) => (
          <li key={o.id} className="row wrap">
            <span className="name">{itemButton(o)}</span>
            {manualIds.has(o.id) ? (
              <button onClick={() => run(() => removeLink(item.id, o.id))}>Remove</button>
            ) : (
              <span
                className="meta"
                title="Made by a mention in this item's text or by a link field. Remove the mention or the field's value to remove the link."
              >
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
  );
}
