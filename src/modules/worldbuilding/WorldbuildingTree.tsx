import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createFolder,
  createFromTemplate,
  createItem,
  deleteFolder,
  deleteItem,
  listFolders,
  listItems,
  listItemsOfType,
  moveFolder,
  moveItem,
  renameFolder,
  restoreFolder,
  restoreItem,
  type Folder,
  type Item,
} from "../../api/library";
import { ConfirmButton } from "../../components/ConfirmButton";
import { itemIcon } from "../../components/item/itemDisplay";
import { childFolders, folderOptions } from "../../components/library/helpers";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { useRenameItem } from "../../state/renameReview";
import { StarterTemplates } from "./StarterTemplates";

const LIBRARY = "worldbuilding";

/** What the "⋯" menu is doing right now: showing its buttons, or asking for a new name or folder. */
type Menu = { kind: "folder" | "item"; id: string; mode: "menu" | "rename" | "move"; value: string };

/**
 * The project's pages as a tree in the sidebar (under Home): folders and documents, always shown.
 * Folders open and close (a folder's documents load when it is first opened). "+ Page" makes an
 * "Untitled" page at the top (or inside a folder with that folder's "+") and opens it, "+ Folder"
 * makes a folder, and the "⋯" on each row renames, moves or deletes it (a delete can be undone
 * right after, and sits in the Trash). Only documents are listed: templates have their own section
 * below, and filter sets are reached from search. No drag and drop yet.
 */
export function WorldbuildingTree() {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const renameReviewed = useRenameItem();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;

  const [folders, setFolders] = useState<Folder[]>([]);
  const [itemsByFolder, setItemsByFolder] = useState<Map<string | null, Item[]>>(new Map());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo: () => Promise<unknown> } | null>(null);

  const openKey = useMemo(() => [...open].sort().join(","), [open]);

  // Reload the folders and the documents of every open folder (and the top) whenever data changes.
  useEffect(() => {
    if (!projectId) {
      setFolders([]);
      setItemsByFolder(new Map());
      return;
    }
    let active = true;
    const wanted: (string | null)[] = [null, ...(openKey === "" ? [] : openKey.split(","))];
    Promise.all([listFolders(projectId, LIBRARY), ...wanted.map((f) => listItems(projectId, LIBRARY, f))])
      .then(([f, ...lists]) => {
        if (!active) return;
        setFolders(f as Folder[]);
        setItemsByFolder(new Map(wanted.map((id, i) => [id, (lists[i] as Item[]).filter((x) => x.itemType === "document")])));
        setError(null);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion, openKey]);

  const toggle = useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  /** Runs a change, then tells every list to reload. */
  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  async function addPage(folderId: string | null) {
    if (!projectId) return;
    await run(async () => {
      const made = await createItem(projectId, LIBRARY, "document", "Untitled", folderId);
      if (folderId) setOpen((current) => new Set(current).add(folderId));
      openItem(made.id);
    });
  }

  async function addFolder(name: string) {
    if (!projectId) return;
    await run(async () => {
      await createFolder(projectId, LIBRARY, null, name);
      setNewFolderName(null);
    });
  }

  const openMenu = (kind: Menu["kind"], id: string) =>
    setMenu((m) => (m && m.id === id ? null : { kind, id, mode: "menu", value: "" }));

  function removeFolder(f: Folder) {
    void run(async () => {
      await deleteFolder(f.id);
      setMenu(null);
      setNotice({ text: `Deleted folder “${f.name}”.`, undo: () => restoreFolder(f.id) });
    });
  }

  function removeItem(item: Item) {
    void run(async () => {
      await deleteItem(item.id);
      setMenu(null);
      setNotice({ text: `Deleted “${item.name}”.`, undo: () => restoreItem(item.id) });
    });
  }

  /** The row's rename and move forms, shown under the row while its menu is open. */
  function menuBody(kind: Menu["kind"], id: string, name: string, parentId: string | null, item?: Item, folder?: Folder) {
    if (!menu || menu.id !== id) return null;
    if (menu.mode === "rename") {
      return (
        <form
          className="tree-menu"
          onSubmit={(e) => {
            e.preventDefault();
            const next = menu.value.trim();
            if (!next) return;
            void run(async () => {
              if (item) await renameReviewed(item, next);
              else if (folder) await renameFolder(folder.id, next);
              setMenu(null);
            });
          }}
        >
          <input
            value={menu.value}
            onChange={(e) => setMenu({ ...menu, value: e.currentTarget.value })}
            onKeyDown={(e) => e.key === "Escape" && setMenu(null)}
            aria-label={`New name for ${name}`}
            autoFocus
          />
        </form>
      );
    }
    if (menu.mode === "move") {
      return (
        <div className="tree-menu">
          <select
            aria-label={`Move ${name} to`}
            value={parentId ?? ""}
            onChange={(e) => {
              const target = e.currentTarget.value === "" ? null : e.currentTarget.value;
              void run(async () => {
                if (item) await moveItem(item.id, target);
                else if (folder) await moveFolder(folder.id, target);
                setMenu(null);
              });
            }}
          >
            <option value="">Top level</option>
            {folderOptions(folders, kind === "folder" ? id : null).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <div className="tree-menu">
        <button type="button" onClick={() => setMenu({ ...menu, mode: "rename", value: name })}>
          Rename
        </button>
        <button type="button" onClick={() => setMenu({ ...menu, mode: "move" })}>
          Move
        </button>
        <ConfirmButton
          label="Delete"
          confirmLabel="Tap again"
          onConfirm={() => (item ? removeItem(item) : folder && removeFolder(folder))}
        />
      </div>
    );
  }

  function renderLevel(parentId: string | null, depth: number) {
    const subfolders = childFolders(folders, parentId);
    const pages = itemsByFolder.get(parentId) ?? [];
    return (
      <ul className="tree-level" role={depth === 0 ? "tree" : "group"}>
        {subfolders.map((f) => {
          const isOpen = open.has(f.id);
          return (
            <li key={f.id} role="treeitem" aria-expanded={isOpen}>
              <div className="tree-row" style={{ paddingLeft: `${depth * 0.9}rem` }}>
                <button type="button" className="tree-label" onClick={() => toggle(f.id)}>
                  <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span> <span aria-hidden="true">📁</span> {f.name}
                </button>
                <button type="button" className="tree-add" aria-label={`New page in ${f.name}`} title="New page here" onClick={() => void addPage(f.id)}>
                  +
                </button>
                <button type="button" className="tree-add" aria-label={`More for ${f.name}`} aria-expanded={menu?.id === f.id} onClick={() => openMenu("folder", f.id)}>
                  ⋯
                </button>
              </div>
              {menuBody("folder", f.id, f.name, f.parentId, undefined, f)}
              {isOpen && renderLevel(f.id, depth + 1)}
            </li>
          );
        })}
        {pages.map((p) => (
          <li key={p.id} role="treeitem">
            <div className="tree-row" style={{ paddingLeft: `${depth * 0.9}rem` }}>
              <button type="button" className="tree-label" onClick={() => openItem(p.id)}>
                <span aria-hidden="true">{itemIcon(p)}</span> {p.name}
              </button>
              <button type="button" className="tree-add" aria-label={`More for ${p.name}`} aria-expanded={menu?.id === p.id} onClick={() => openMenu("item", p.id)}>
                ⋯
              </button>
            </div>
            {menuBody("item", p.id, p.name, p.folderId, p)}
          </li>
        ))}
        {subfolders.length === 0 && pages.length === 0 && depth > 0 && <li className="tree-empty">Empty</li>}
      </ul>
    );
  }

  if (!projectId) return null;
  return (
    <div className="sidebar-tree" aria-label="Pages">
      <div className="tree-tools">
        <button type="button" onClick={() => void addPage(null)}>
          + Page
        </button>
        <button type="button" onClick={() => setNewFolderName("")}>
          + Folder
        </button>
      </div>
      {newFolderName !== null && (
        <form
          className="tree-new-folder"
          onSubmit={(e) => {
            e.preventDefault();
            if (newFolderName.trim()) void addFolder(newFolderName);
          }}
        >
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Escape" && setNewFolderName(null)}
            placeholder="Folder name"
            aria-label="New folder name"
            autoFocus
          />
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="notice">
          {notice.text}{" "}
          <button
            className="link"
            onClick={() =>
              void run(async () => {
                await notice.undo();
                setNotice(null);
              })
            }
          >
            Undo
          </button>
        </p>
      )}
      {renderLevel(null, 0)}
      <TemplatesSection projectId={projectId} onError={setError} />
    </div>
  );
}

/**
 * Every template, flat, under its own heading. "+ Template" makes one and opens it; the "+" on a
 * template makes a new page from it (named "New <template>", renamed on its page) and opens it.
 * With no templates yet, the ready-made starter templates can be added from here.
 */
function TemplatesSection({ projectId, onError }: { projectId: string; onError: (message: string) => void }) {
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const [templates, setTemplates] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false); // collapsed until asked for

  useEffect(() => {
    let active = true;
    listItemsOfType(projectId, LIBRARY, "template")
      .then((found) => {
        if (!active) return;
        setTemplates(found);
        setLoaded(true);
      })
      .catch((e) => active && onError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion, onError]);

  async function addTemplate() {
    try {
      const made = await createItem(projectId, LIBRARY, "template", "New template", null);
      bumpDataVersion();
      openItem(made.id);
    } catch (e) {
      onError(String(e));
    }
  }

  async function usePage(t: Item) {
    try {
      const made = await createFromTemplate(t.id, `New ${t.name}`, null);
      bumpDataVersion();
      openItem(made.id);
    } catch (e) {
      onError(String(e));
    }
  }

  return (
    <section className="tree-templates" aria-label="Templates">
      <h2 className="sidebar-heading">
        <button type="button" className="sidebar-heading-toggle" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> Templates{loaded ? ` (${templates.length})` : ""}
        </button>
      </h2>
      {expanded && (
        <>
      <div className="tree-tools">
        <button type="button" onClick={() => void addTemplate()}>
          + Template
        </button>
      </div>
      <ul className="tree-level">
        {templates.map((t) => (
          <li key={t.id}>
            <div className="tree-row">
              <button type="button" className="tree-label" onClick={() => openItem(t.id)}>
                <span aria-hidden="true">{itemIcon(t)}</span> {t.name}
              </button>
              <button type="button" className="tree-add" aria-label={`New page from ${t.name}`} title="New page from this template" onClick={() => void usePage(t)}>
                +
              </button>
            </div>
          </li>
        ))}
      </ul>
      {loaded && templates.length === 0 && (
        <details className="tree-starters">
          <summary>No templates yet. Add the ready-made ones</summary>
          <StarterTemplates />
        </details>
      )}
        </>
      )}
    </section>
  );
}
