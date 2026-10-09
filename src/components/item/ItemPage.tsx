import { useCallback, useEffect, useState } from "react";
import { deleteItem, getItem, listItemTags, restoreItem, type Item, type Tag } from "../../api/library";
import { listTabs, moveTab, removeTab, type Tab } from "../../api/tabs";
import { registry } from "../../registry";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { TagChips } from "../library/TagChips";
import { EmbedBody } from "./EmbedBody";
import { ItemActions } from "./ItemActions";
import { ItemBody } from "./ItemBody";
import { itemIcon, itemTypeLabel, libraryLabel } from "./itemDisplay";
import { tabLabel, TabStrip } from "./TabStrip";

/**
 * A page: the item's title, type and tags with Rename / Tags / Delete, then (for documents and
 * templates) the tabs, then the body of the selected tab. The title row stays while tabs switch;
 * a nested-document tab shows that document's own text, fields and links, and an embed tab
 * shows another item's editor.
 */
export function ItemPage({ pageId, openTab, onBack }: { pageId: string; openTab: string; onBack: () => void }) {
  const dataVersion = useDataVersion();
  const [item, setItem] = useState<Item | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tabsLoaded, setTabsLoaded] = useState(false);
  const [selected, setSelected] = useState(openTab);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [i, t, tabList] = await Promise.all([getItem(pageId), listItemTags(pageId), listTabs(pageId)]);
      setItem(i);
      setTags(t);
      setTabs(tabList);
      setTabsLoaded(true);
      setError(null);
    } catch (e) {
      setItem(null);
      setError(String(e));
    }
  }, [pageId]);

  // Also reload when something elsewhere changed (an edit in a tab, a restored document...).
  useEffect(() => {
    void reload();
  }, [reload, dataVersion]);

  // Opening a link to one of this page's tabs selects it.
  useEffect(() => setSelected(openTab), [openTab]);

  // A tab that is gone (removed, or its document trashed) returns to Main.
  useEffect(() => {
    if (tabsLoaded && selected !== "main" && !tabs.some((t) => t.id === selected)) setSelected("main");
  }, [tabs, tabsLoaded, selected]);

  /** Runs a change, then reloads. Shows any error from Rust. */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await reload();
        // Library lists (kept mounted behind this page) must pick the change up.
        bumpDataVersion();
      } catch (e) {
        setError(String(e));
      }
    },
    [reload],
  );

  const trashed = item?.deletedAt != null;
  const canHaveTabs = item ? registry.getItemType(item.itemType)?.tabs === true : false;
  const current = tabs.find((t) => t.id === selected);

  /** The buttons that move a tab one place left or right. */
  const moveButtons = (tab: Tab) => {
    const index = tabs.findIndex((t) => t.id === tab.id);
    return (
      <>
        <button aria-label={`Move ${tabLabel(tab)} left`} disabled={index <= 0} onClick={() => run(() => moveTab(tab.id, -1))}>
          ◀
        </button>
        <button aria-label={`Move ${tabLabel(tab)} right`} disabled={index < 0 || index >= tabs.length - 1} onClick={() => run(() => moveTab(tab.id, 1))}>
          ▶
        </button>
      </>
    );
  };

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
              This {itemTypeLabel(item).toLowerCase()} is in the trash. <button onClick={() => run(() => restoreItem(item.id))}>Restore</button>
            </p>
          ) : (
            <ItemActions item={item} run={run} onDelete={() => deleteItem(item.id)} />
          )}

          {!trashed && canHaveTabs && (
            <TabStrip
              parentId={item.id}
              campaignId={item.campaignId}
              tabs={tabs}
              selected={current ? current.id : "main"}
              onSelect={setSelected}
              onChanged={(added) => {
                setSelected(added.id);
                void run(async () => undefined);
              }}
              canAdd
            />
          )}

          {trashed || !current ? (
            <ItemBody item={item} />
          ) : current.kind === "document" && current.item ? (
            <div className="tab-body">
              <ItemActions item={current.item} run={run} deleteLabel="Remove tab" onDelete={() => removeTab(current.id)}>
                {moveButtons(current)}
              </ItemActions>
              <ItemBody key={current.item.id} item={current.item} />
            </div>
          ) : (
            <div className="tab-body">
              <EmbedBody key={current.id} tab={current} parentId={item.id} campaignId={item.campaignId} run={run} moveButtons={moveButtons(current)} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
