import { useEffect, useState } from "react";
import { createItem, searchItems, type Item } from "../../api/library";
import { registry } from "../../registry";
import { itemIcon, libraryLabel } from "./itemDisplay";

/**
 * Search the open project (every tool at once) and pick an item to link to, or
 * make a new item right here and link to that. Items in `excludeIds` (the item
 * itself, and ones already linked) are left out.
 */
export function LinkPicker({
  projectId,
  excludeIds,
  onPick,
  onClose,
}: {
  projectId: string;
  excludeIds: Set<string>;
  onPick: (item: Item) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newType, setNewType] = useState("");
  const [newName, setNewName] = useState("");

  // The kinds of item that can be made from just a name (some, like saved rolls, are made elsewhere).
  const creatable = registry.getItemTypes().filter((t) => t.creatable !== false);
  const chosenType = creatable.find((t) => t.id === newType) ?? creatable[0];

  async function createAndPick() {
    if (!chosenType || newName.trim() === "") return;
    try {
      const made = await createItem(projectId, chosenType.toolId, chosenType.id, newName, null);
      onPick(made);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    const query = text.trim();
    if (!query) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchItems(projectId, query, null, 20)
        .then((found) => !cancelled && setResults(found))
        .catch((e) => !cancelled && setError(String(e)));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, projectId]);

  const choices = results.filter((i) => !excludeIds.has(i.id));

  return (
    <div className="link-picker">
      <div className="row">
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder="Search for an item to link..."
          aria-label="Search for an item to link"
          autoFocus
        />
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {text.trim() && choices.length === 0 && (
        <p className="empty">Nothing to link to matches “{text.trim()}”.</p>
      )}
      <ul className="list">
        {choices.map((i) => (
          <li key={i.id}>
            <button className="link name" onClick={() => onPick(i)}>
              {itemIcon(i)} {i.name}
            </button>{" "}
            <small className="meta">{libraryLabel(i)}</small>
          </li>
        ))}
      </ul>
      {chosenType && (
        <div className="link-create">
          {creating ? (
            <form
              className="row wrap"
              onSubmit={(e) => {
                e.preventDefault();
                void createAndPick();
              }}
            >
              <select
                value={chosenType.id}
                onChange={(e) => setNewType(e.currentTarget.value)}
                aria-label="What kind of item to create"
              >
                {creatable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icon} {t.label} ({registry.getLibraryLabel(t.toolId)})
                  </option>
                ))}
              </select>
              <input
                value={newName}
                onChange={(e) => setNewName(e.currentTarget.value)}
                placeholder="Name of the new item"
                aria-label="Name of the new item"
                autoFocus
              />
              <button type="submit" disabled={newName.trim() === ""}>
                Create and link
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Back
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNewName(text.trim());
                setCreating(true);
              }}
            >
              Create a new item to link to…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
