import { useState } from "react";
import { restoreItem } from "../../api/library";
import { removeTab, updateEmbedTab, type Tab } from "../../api/tabs";
import { registry } from "../../registry";
import { useNavigation } from "../../state/Navigation";
import { ConfirmButton } from "../ConfirmButton";
import { itemIcon, itemTypeLabel, libraryLabel } from "./itemDisplay";
import { LinkPicker } from "./LinkPicker";

/**
 * An embed tab: a live view of another item, which is that item's own editor (so it works for
 * whatever tool the item is from, and editing it here changes the same item as editing it there).
 * An empty slot asks you to pick what goes in it.
 */
export function EmbedBody({
  tab,
  parentId,
  campaignId,
  run,
  moveButtons,
}: {
  tab: Tab;
  parentId: string;
  campaignId: string;
  /** Makes a change and refreshes the page. */
  run: (action: () => Promise<unknown>) => Promise<void>;
  /** Buttons to move the tab left or right, drawn in the toolbar. */
  moveButtons: React.ReactNode;
}) {
  const { openItem } = useNavigation();
  const target = tab.item;
  const [choosing, setChoosing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(tab.title);

  const Editor = target ? registry.getItemType(target.itemType)?.editor : undefined;
  const inTrash = target?.deletedAt != null;

  const picker = (
    <LinkPicker
      campaignId={campaignId}
      excludeIds={new Set([parentId])}
      onPick={(item) =>
        run(async () => {
          await updateEmbedTab(tab.id, tab.title, item.id);
          setChoosing(false);
        })
      }
      onClose={() => setChoosing(false)}
    />
  );

  return (
    <div className="embed">
      <div className="row wrap embed-toolbar">
        {renaming ? (
          <form
            className="row grow"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await updateEmbedTab(tab.id, title, target?.id ?? null);
                setRenaming(false);
              });
            }}
          >
            <input className="grow" value={title} onChange={(e) => setTitle(e.currentTarget.value)} aria-label="Name of the tab" autoFocus />
            <button type="submit">Save name</button>
            <button type="button" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <span className="grow">
              {target ? (
                <>
                  <strong>
                    {itemIcon(target)} {target.name}
                  </strong>{" "}
                  <small className="meta">
                    {itemTypeLabel(target)} in {libraryLabel(target)}
                  </small>
                </>
              ) : (
                <em className="meta">An empty slot: “{tab.title}”</em>
              )}
            </span>
            {target && <button onClick={() => openItem(target.id)}>Open</button>}
            <button
              onClick={() => {
                setTitle(tab.title);
                setRenaming(true);
              }}
            >
              Rename tab
            </button>
            <button onClick={() => setChoosing((c) => !c)} aria-expanded={choosing}>
              {target ? "Change item" : "Choose an item"}
            </button>
            {moveButtons}
            <ConfirmButton label="Remove tab" confirmLabel="Tap again to remove" onConfirm={() => void run(() => removeTab(tab.id))} />
          </>
        )}
      </div>

      {(choosing || !target) && !renaming && picker}

      {target && inTrash && (
        <p className="notice">
          This is in the trash. <button onClick={() => run(() => restoreItem(target.id))}>Restore</button>
        </p>
      )}
      {target && !inTrash && (Editor ? <Editor key={target.id} itemId={target.id} /> : <p className="empty">This {itemTypeLabel(target).toLowerCase()} has nothing to show here yet. Use Open to see it.</p>)}
    </div>
  );
}
