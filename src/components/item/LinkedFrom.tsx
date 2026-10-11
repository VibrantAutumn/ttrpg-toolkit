import { useEffect, useState } from "react";
import { listBacklinks, type Item } from "../../api/library";
import { useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { itemIcon, libraryLabel } from "./itemDisplay";

/**
 * "Linked from": the items that link to this one (mentions in text, link properties, and tables or
 * generators with a link slot to it). Shows nothing when there are none.
 */
export function LinkedFrom({ itemId }: { itemId: string }) {
  const { openItem } = useNavigation();
  const dataVersion = useDataVersion();
  const [from, setFrom] = useState<Item[]>([]);

  useEffect(() => {
    let active = true;
    listBacklinks(itemId)
      .then((list) => active && setFrom(list))
      .catch(() => active && setFrom([]));
    return () => {
      active = false;
    };
  }, [itemId, dataVersion]);

  if (from.length === 0) return null;
  return (
    <section className="linked-from" aria-label="Linked from">
      <h2>Linked from</h2>
      <ul className="list">
        {from.map((item) => (
          <li key={item.id} className="row wrap">
            <button type="button" className="link name" onClick={() => openItem(item.id)}>
              {itemIcon(item)} {item.name}
            </button>
            <small className="meta">{libraryLabel(item)}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
