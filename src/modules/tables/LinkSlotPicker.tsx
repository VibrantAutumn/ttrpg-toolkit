import { useEffect, useState } from "react";
import { searchItems, type Item } from "../../api/library";
import { itemIcon, itemTypeLabel } from "../../components/item/itemDisplay";
import { useCurrentProject } from "../../state/CurrentProject";

/**
 * Finds one page (or any other item) by name, for a link slot: the entry then always gives that
 * item, and a generator's output links to it.
 */
export function LinkSlotPicker({ onPick, onClose }: { onPick: (item: Item) => void; onClose: () => void }) {
  const { project } = useCurrentProject();
  const projectId = project?.id ?? null;
  const [text, setText] = useState("");
  const [found, setFound] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || text.trim() === "") {
      setFound([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      searchItems(projectId, text, null, 12)
        .then((list) => active && setFound(list))
        .catch((e) => active && setError(String(e)));
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [projectId, text]);

  return (
    <div className="insert-slot" role="group" aria-label="Link to a page">
      <label className="field">
        <span>Find the page to link</span>
        <input value={text} onChange={(e) => setText(e.currentTarget.value)} placeholder="Syra Pyroc" autoFocus />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      {text.trim() !== "" && found.length === 0 && <p className="empty">Nothing found.</p>}
      <ul className="list">
        {found.map((item) => (
          <li key={item.id} className="row wrap">
            <button type="button" className="link name" onClick={() => onPick(item)}>
              {itemIcon(item)} {item.name}
            </button>
            <small className="meta">{itemTypeLabel(item)}</small>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  );
}
