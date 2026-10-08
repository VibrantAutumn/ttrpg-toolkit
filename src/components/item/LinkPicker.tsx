import { useEffect, useState } from "react";
import { searchItems, type Item } from "../../api/library";
import { itemIcon, libraryLabel } from "./itemDisplay";

/**
 * Search the open campaign (every tool at once) and pick an item to link to.
 * Items in `excludeIds` (the item itself, and ones already linked) are left out.
 */
export function LinkPicker({
  campaignId,
  excludeIds,
  onPick,
  onClose,
}: {
  campaignId: string;
  excludeIds: Set<string>;
  onPick: (item: Item) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = text.trim();
    if (!query) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchItems(campaignId, query, null, 20)
        .then((found) => !cancelled && setResults(found))
        .catch((e) => !cancelled && setError(String(e)));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, campaignId]);

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
    </div>
  );
}
