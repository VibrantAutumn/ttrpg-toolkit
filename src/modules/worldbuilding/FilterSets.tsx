import { useEffect, useState } from "react";
import { createItem, listItemsOfType, type Item } from "../../api/library";
import { itemIcon } from "../../components/item/itemDisplay";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";

/** Where filter sets live (stored as the `smart_collection` item type in the worldbuilding library). */
export const FILTER_SET_LIBRARY = "worldbuilding";
export const FILTER_SET_TYPE = "smart_collection";

/** Makes an empty filter set (it finds everything until rules are added). */
export const createFilterSet = (projectId: string, name: string): Promise<Item> =>
  createItem(projectId, FILTER_SET_LIBRARY, FILTER_SET_TYPE, name.trim() || "New filter set", null);

/**
 * The Worldbuilding "Filter sets" tab: every filter set (a saved set of rules that is always up to
 * date), and a way to make one. Filter sets are made only where filters are useful, so they are
 * not in the library's "New item" list.
 */
export function FilterSets() {
  const { project } = useCurrentProject();
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const projectId = project?.id ?? null;
  const [sets, setSets] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    listItemsOfType(projectId, FILTER_SET_LIBRARY, FILTER_SET_TYPE)
      .then((found) => active && setSets(found))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, dataVersion]);

  if (!projectId) return <p className="empty">No project is open. Choose one first.</p>;

  async function make(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    try {
      const made = await createFilterSet(projectId, name);
      setName("");
      setError(null);
      bumpDataVersion();
      openItem(made.id);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="filter-sets">
      <p className="meta">
        A filter set finds pages by rules (a tag, a property, some words) and is always up to date. Use one to fill a card pool, as a
        table of pages, or as the source of a generator slot.
      </p>
      {error && <p className="error">{error}</p>}
      <form className="row" onSubmit={make}>
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Name of the new filter set"
          aria-label="Name of the new filter set"
        />
        <button type="submit">New filter set</button>
      </form>
      {sets.length === 0 ? (
        <p className="empty">No filter sets yet.</p>
      ) : (
        <ul className="list">
          {sets.map((s) => (
            <li key={s.id} className="row">
              <button className="link grow" onClick={() => openItem(s.id)}>
                {itemIcon(s)} {s.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
