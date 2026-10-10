import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  createFolder,
  createItem,
  deleteFolder,
  deleteItem,
  emptyTrash,
  listFolders,
  listItems,
  listTagLinks,
  listTags,
  listTrash,
  moveFolder,
  moveItem,
  renameFolder,
  restoreFolder,
  restoreItem,
  searchItems,
  type Folder,
  type Item,
  type Tag,
  type TagLink,
  type Trash,
} from "../../api/library";
import type { ItemTypeDefinition } from "../../registry/types";
import { useCurrentProject } from "../../state/CurrentProject";
import { useNavigation } from "../../state/Navigation";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useRenameItem } from "../../state/renameReview";
import { ConfirmButton } from "../ConfirmButton";
import { childFolders, folderOptions, folderPath, tagsByItem } from "./helpers";
import { TagChips } from "./TagChips";
import { TagEditor } from "./TagEditor";
import { TrashPanel } from "./TrashPanel";

type EditMode = "rename" | "move" | "tags";
interface Notice {
  text: string;
  undo: () => Promise<unknown>;
}

/**
 * The generic library screen any tool can use: folders, items, tags, search
 * and trash for one `library` (the owning tool's id), in the open project.
 */
export function LibraryScreen({
  library,
  title,
  itemTypes,
  allowNewItems = true,
  extraCreate,
  showTitle = true,
}: {
  library: string;
  title: string;
  /** False when the screen's own tab or header already says where you are (no big heading, and the
   * root crumb only appears once you are inside a folder). */
  showTitle?: boolean;
  itemTypes: ItemTypeDefinition[];
  /** Another way to make items (for example "New from template"), drawn under the "New item" form. */
  extraCreate?: (context: { folderId: string | null }) => ReactNode;
  /** False for libraries whose items are made elsewhere (e.g. saved rolls): hides the "New item" form. */
  allowNewItems?: boolean;
}) {
  const { project, loading } = useCurrentProject();
  const { openItem } = useNavigation();
  const renameReviewed = useRenameItem();
  const projectId = project?.id ?? null;
  // Changes made elsewhere (an item's page, saving a roll) make this list reload.
  const dataVersion = useDataVersion();

  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [links, setLinks] = useState<TagLink[]>([]);
  const [trash, setTrash] = useState<Trash>({ folders: [], items: [] });
  const [version, setVersion] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editing, setEditing] = useState<{ id: string; mode: EditMode } | null>(null);
  const [editName, setEditName] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Item[] | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [newItem, setNewItem] = useState("");
  // Types made elsewhere (saved draws...) are listed and shown but not offered in the "New item" form.
  const creatableTypes = itemTypes.filter((t) => t.creatable !== false);
  const [newItemType, setNewItemType] = useState(creatableTypes[0]?.id ?? "");

  const reload = useCallback(async () => {
    if (!projectId) return;
    const [f, i, t, l, tr] = await Promise.all([
      listFolders(projectId, library),
      listItems(projectId, library, folderId),
      listTags(projectId),
      listTagLinks(projectId, library),
      listTrash(projectId, library),
    ]);
    setFolders(f);
    setItems(i);
    setAllTags(t);
    setLinks(l);
    setTrash(tr);
    setVersion((v) => v + 1);
  }, [projectId, library, folderId, dataVersion]);

  /** Runs a change, then reloads everything. Shows any error from Rust. */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await reload();
        // Other screens built from library data (the Draw tab's games, formulas...)
        // stay mounted too, so tell them: they would otherwise list things that are gone.
        bumpDataVersion();
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [reload],
  );

  // A different project starts from a clean slate.
  useEffect(() => {
    setFolderId(null);
    setEditing(null);
    setNotice(null);
    setSearchText("");
    setShowTrash(false);
  }, [projectId]);

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, [reload]);

  // If the folder we're in disappears (trashed, or undone), go back to the top.
  useEffect(() => {
    if (folderId && !folders.some((f) => f.id === folderId)) setFolderId(null);
  }, [folders, folderId]);

  // Search as you type (after a short pause), and again whenever data changes.
  useEffect(() => {
    const text = searchText.trim();
    if (!projectId || !text) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchItems(projectId, text, library, 100)
        .then((results) => !cancelled && setSearchResults(results))
        .catch((e) => !cancelled && setError(String(e)));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchText, projectId, library, version]);

  if (loading) return <p>Loading...</p>;
  if (!projectId) {
    return (
      <section>
        {showTitle && <h1>{title}</h1>}
        <p className="empty">
          No project is open. Tap the bar at the top to choose one.
        </p>
      </section>
    );
  }

  const tagMap = tagsByItem(links);
  const typeOf = (item: Item) => itemTypes.find((t) => t.id === item.itemType);
  const itemIcon = (item: Item) => item.icon ?? typeOf(item)?.icon ?? "📄";
  const trashCount = trash.folders.length + trash.items.length;
  const path = folderPath(folders, folderId);
  const subfolders = childFolders(folders, folderId);

  function startEditing(id: string, mode: EditMode, name = "") {
    setEditing({ id, mode });
    setEditName(name);
  }

  function renameForm(onSave: (name: string) => Promise<unknown>) {
    return (
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await onSave(editName);
            setEditing(null);
          });
        }}
      >
        <input
          value={editName}
          onChange={(e) => setEditName(e.currentTarget.value)}
          aria-label="New name"
          autoFocus
        />
        <button type="submit">Save</button>
        <button type="button" onClick={() => setEditing(null)}>
          Cancel
        </button>
      </form>
    );
  }

  function moveForm(
    currentParent: string | null,
    exclude: string | null,
    onMove: (target: string | null) => Promise<unknown>,
  ) {
    return (
      <div className="row">
        <select
          aria-label="Move to"
          value={currentParent ?? ""}
          onChange={(e) => {
            const target = e.currentTarget.value || null;
            run(async () => {
              await onMove(target);
              setEditing(null);
            });
          }}
        >
          <option value="">Top level</option>
          {folderOptions(folders, exclude).map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setEditing(null)}>
          Cancel
        </button>
      </div>
    );
  }

  function removeFolder(f: Folder) {
    run(async () => {
      await deleteFolder(f.id);
      setNotice({
        text: `Deleted folder “${f.name}” and its contents.`,
        undo: () => restoreFolder(f.id),
      });
    });
  }

  function removeItem(item: Item) {
    run(async () => {
      await deleteItem(item.id);
      setNotice({
        text: `Deleted “${item.name}”.`,
        undo: () => restoreItem(item.id),
      });
    });
  }

  function renderFolder(f: Folder) {
    const mode = editing?.id === f.id ? editing.mode : null;
    return (
      <li key={f.id}>
        {mode === "rename" ? (
          renameForm((name) => renameFolder(f.id, name))
        ) : mode === "move" ? (
          moveForm(f.parentId, f.id, (target) => moveFolder(f.id, target))
        ) : (
          <div className="row wrap">
            <button className="link name" onClick={() => setFolderId(f.id)}>
              📁 {f.name}
            </button>
            <button onClick={() => startEditing(f.id, "rename", f.name)}>Rename</button>
            <button onClick={() => startEditing(f.id, "move")}>Move</button>
            <ConfirmButton label="Delete" onConfirm={() => removeFolder(f)} />
          </div>
        )}
      </li>
    );
  }

  function renderItem(item: Item, inSearch = false) {
    const mode = editing?.id === item.id ? editing.mode : null;
    const itemTags = tagMap.get(item.id) ?? [];
    return (
      <li key={item.id}>
        {mode === "rename" ? (
          renameForm((name) => renameReviewed(item, name))
        ) : mode === "move" ? (
          moveForm(item.folderId, null, (target) => moveItem(item.id, target))
        ) : (
          <div className="row wrap">
            <span className="name">
              <button className="link name" onClick={() => openItem(item.id)}>
                {itemIcon(item)} {item.name}
              </button>{" "}
              <TagChips tags={itemTags} />
            </span>
            {inSearch && (
              <button
                onClick={() => {
                  setSearchText("");
                  setFolderId(item.folderId);
                }}
              >
                Show in folder
              </button>
            )}
            <button onClick={() => startEditing(item.id, "rename", item.name)}>Rename</button>
            <button onClick={() => startEditing(item.id, "move")}>Move</button>
            <button
              aria-expanded={mode === "tags"}
              onClick={() =>
                mode === "tags" ? setEditing(null) : startEditing(item.id, "tags")
              }
            >
              Tags
            </button>
            <ConfirmButton label="Delete" onConfirm={() => removeItem(item)} />
          </div>
        )}
        {mode === "tags" && projectId && (
          <TagEditor
            projectId={projectId}
            itemId={item.id}
            itemTags={itemTags}
            allTags={allTags}
            run={run}
          />
        )}
      </li>
    );
  }

  const searching = searchResults !== null;
  const typeLabel = creatableTypes.find((t) => t.id === newItemType)?.label ?? "item";

  return (
    <section>
      {showTitle && <h1>{title}</h1>}

      <input
        className="search"
        type="search"
        value={searchText}
        onChange={(e) => setSearchText(e.currentTarget.value)}
        placeholder="Search names, text and tags..."
        aria-label={`Search ${title}`}
      />

      {error && <p className="error">{error}</p>}

      {notice && (
        <p className="notice">
          {notice.text}{" "}
          <button
            className="link"
            onClick={() =>
              run(async () => {
                await notice.undo();
                setNotice(null);
              })
            }
          >
            Undo
          </button>
        </p>
      )}

      {searching ? (
        searchResults.length === 0 ? (
          <p className="empty">Nothing matches “{searchText.trim()}”.</p>
        ) : (
          <ul className="list">{searchResults.map((i) => renderItem(i, true))}</ul>
        )
      ) : (
        <>
          {(showTitle || path.length > 0) && (
            <nav className="crumbs" aria-label="Folder path">
              <button className="link" onClick={() => setFolderId(null)}>
                {showTitle ? title : "All pages"}
              </button>
              {path.map((f) => (
                <span key={f.id}>
                  {" › "}
                  <button className="link" onClick={() => setFolderId(f.id)}>
                    {f.name}
                  </button>
                </span>
              ))}
            </nav>
          )}

          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await createFolder(projectId, library, folderId, newFolder);
                setNewFolder("");
              });
            }}
          >
            <input
              value={newFolder}
              onChange={(e) => setNewFolder(e.currentTarget.value)}
              placeholder="New folder..."
              aria-label="New folder name"
            />
            <button type="submit">New folder</button>
          </form>

          {allowNewItems && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await createItem(projectId, library, newItemType, newItem, folderId);
                setNewItem("");
              });
            }}
          >
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.currentTarget.value)}
              placeholder={`New ${typeLabel.toLowerCase()}...`}
              aria-label="New item name"
            />
            {creatableTypes.length > 1 && (
              <select
                aria-label="Item type"
                value={newItemType}
                onChange={(e) => setNewItemType(e.currentTarget.value)}
              >
                {creatableTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" disabled={!newItemType}>
              New {typeLabel.toLowerCase()}
            </button>
          </form>
          )}

          {extraCreate?.({ folderId })}

          {subfolders.length === 0 && items.length === 0 ? (
            <p className="empty">
              {folderId
                ? "This folder is empty."
                : allowNewItems
                  ? `Nothing here yet. Create a folder or a ${typeLabel.toLowerCase()} above.`
                  : "Nothing here yet. Create a folder above, or add a formula or save a roll in the Roll tab."}
            </p>
          ) : (
            <ul className="list">
              {subfolders.map(renderFolder)}
              {items.map((i) => renderItem(i))}
            </ul>
          )}
        </>
      )}

      <p>
        <button onClick={() => setShowTrash((s) => !s)} aria-expanded={showTrash}>
          {showTrash ? "Hide trash" : `Trash (${trashCount})`}
        </button>
      </p>
      {showTrash && (
        <TrashPanel
          trash={trash}
          run={run}
          emptyAll={() => emptyTrash(projectId, library)}
        />
      )}
    </section>
  );
}
