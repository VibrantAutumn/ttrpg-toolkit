import { useState } from "react";
import { addDocumentTab, addEmbedTab, type Tab } from "../../api/tabs";
import { itemIcon } from "./itemDisplay";
import { LinkPicker } from "./LinkPicker";

/** The name a tab is shown under. */
export function tabLabel(tab: Tab): string {
  if (tab.kind === "document") return tab.item?.name ?? "Tab";
  return tab.title || tab.item?.name || "Empty slot";
}

const tabIcon = (tab: Tab) => (tab.item ? itemIcon(tab.item) : "▫️");

type Adding = null | "menu" | "document" | "embed" | "slot";

/**
 * The tabs under a page's title: Main, then each tab in order, then a "+" to add one. A tab is a
 * nested document (a real document of its own that lives in this page) or an embed (a live view
 * of another item, or an empty slot to fill in later).
 */
export function TabStrip({
  parentId,
  projectId,
  tabs,
  selected,
  onSelect,
  onChanged,
  canAdd,
}: {
  parentId: string;
  projectId: string;
  tabs: Tab[];
  /** `"main"` or a tab's id. */
  selected: string;
  onSelect: (id: string) => void;
  /** Called after a tab was added (so the page reloads its tabs), with the new tab. */
  onChanged: (added: Tab) => void;
  canAdd: boolean;
}) {
  const [adding, setAdding] = useState<Adding>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function attempt(action: () => Promise<Tab>) {
    try {
      const tab = await action();
      setAdding(null);
      setName("");
      setError(null);
      onChanged(tab);
    } catch (e) {
      setError(String(e));
    }
  }

  const close = () => {
    setAdding(null);
    setName("");
    setError(null);
  };

  return (
    <div className="tabs">
      <div className="tab-strip" role="tablist" aria-label="Page tabs">
        <button role="tab" aria-selected={selected === "main"} className={selected === "main" ? "tab active" : "tab"} onClick={() => onSelect("main")}>
          Main
        </button>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected === tab.id}
            className={selected === tab.id ? "tab active" : "tab"}
            onClick={() => onSelect(tab.id)}
          >
            {tabIcon(tab)} {tabLabel(tab)}
          </button>
        ))}
        {canAdd && (
          <button className="tab add" aria-label="Add a tab" aria-expanded={adding !== null} onClick={() => (adding ? close() : setAdding("menu"))}>
            ＋
          </button>
        )}
      </div>

      {adding === "menu" && (
        <div className="tab-menu row wrap">
          <button onClick={() => setAdding("document")}>New document tab</button>
          <button onClick={() => setAdding("embed")}>Embed an item…</button>
          <button onClick={() => setAdding("slot")}>Empty embed slot</button>
          <button onClick={close}>Cancel</button>
        </div>
      )}

      {adding === "document" && (
        <form
          className="tab-menu row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(() => addDocumentTab(parentId, name));
          }}
        >
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Name of the tab (e.g. Relationships)" aria-label="Name of the new tab" autoFocus />
          <button type="submit">Add tab</button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </form>
      )}

      {adding === "slot" && (
        <form
          className="tab-menu row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(() => addEmbedTab(parentId, name, null));
          }}
        >
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="What goes here? (e.g. Hometown map)" aria-label="Name of the empty slot" autoFocus />
          <button type="submit">Add slot</button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </form>
      )}

      {adding === "embed" && (
        <div className="tab-menu">
          <LinkPicker
            projectId={projectId}
            excludeIds={new Set([parentId])}
            onPick={(item) => void attempt(() => addEmbedTab(parentId, "", item.id))}
            onClose={close}
          />
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
