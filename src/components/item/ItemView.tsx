import { useEffect, useState } from "react";
import { getTabFamily } from "../../api/tabs";
import { ItemPage } from "./ItemPage";

/**
 * One item's page. An item that is a document tab of another page (opened from a link, a
 * mention or a search) opens that page with the tab selected; everything else is its own page.
 */
export function ItemView({ itemId, onBack }: { itemId: string; onBack: () => void }) {
  const [resolved, setResolved] = useState<{ pageId: string; tab: string } | null>(null);

  useEffect(() => {
    let active = true;
    getTabFamily(itemId)
      .then((family) => active && setResolved(family ? { pageId: family.parent.id, tab: family.tabId } : { pageId: itemId, tab: "main" }))
      .catch(() => active && setResolved({ pageId: itemId, tab: "main" }));
    return () => {
      active = false;
    };
  }, [itemId]);

  if (!resolved) {
    return (
      <section>
        <button onClick={onBack}>← Back</button>
        <p className="empty">Loading...</p>
      </section>
    );
  }
  return <ItemPage key={resolved.pageId} pageId={resolved.pageId} openTab={resolved.tab} onBack={onBack} />;
}
