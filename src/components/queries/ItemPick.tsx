import { useEffect, useState } from "react";
import { searchItems, type Item } from "../../api/library";
import { itemIcon, libraryLabel } from "../item/itemDisplay";

/** Shows the chosen item (if any) and lets the person search the project to choose another. */
export function ItemPick({
  projectId,
  itemId,
  name,
  onPick,
}: {
  projectId: string;
  itemId: string;
  name: string | undefined;
  onPick: (item: Item) => void;
}) {
  const [searching, setSearching] = useState(itemId === "");
  const [text, setText] = useState("");
  const [results, setResults] = useState<Item[]>([]);

  useEffect(() => {
    const query = text.trim();
    if (!searching || !query) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchItems(projectId, query, null, 12)
        .then((found) => !cancelled && setResults(found))
        .catch(() => !cancelled && setResults([]));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, searching, projectId]);

  if (!searching) {
    return (
      <span className="row wrap">
        <strong>{itemId === "" ? "(nothing chosen)" : (name ?? "(missing)")}</strong>
        <button type="button" onClick={() => setSearching(true)}>
          Change
        </button>
      </span>
    );
  }
  return (
    <div className="item-pick">
      <div className="row">
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder="Search for an item..."
          aria-label="Search for an item"
          autoFocus={itemId === ""}
        />
        {itemId !== "" && (
          <button type="button" onClick={() => setSearching(false)}>
            Cancel
          </button>
        )}
      </div>
      {text.trim() && results.length === 0 && <p className="empty">Nothing matches “{text.trim()}”.</p>}
      <ul className="list">
        {results.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              className="link name"
              onClick={() => {
                onPick(i);
                setSearching(false);
                setText("");
              }}
            >
              {itemIcon(i)} {i.name}
            </button>{" "}
            <small className="meta">{libraryLabel(i)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
