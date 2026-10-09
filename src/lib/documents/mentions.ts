import type { DocNode } from "./types";

/**
 * Mentions: a link to another item written in a document's text. In the stored Markdown it is
 * an ordinary link, `[Strahd](item:<id>)`, so it stays readable anywhere; the editor shows it
 * as a chip with the item's current name.
 */

const ITEM_HREF = /^item:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const itemHref = (id: string) => `item:${id}`;

/** The item an address points at, or null if it is not an item address. */
export function itemIdFromHref(href: string): string | null {
  const m = ITEM_HREF.exec(href.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Every item mentioned in the document, once each, in order of first appearance. */
export function mentionIds(doc: DocNode): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (node: DocNode) => {
    if (node.type === "mention") {
      const id = String(node.attrs?.id ?? "");
      if (!seen.has(id)) {
        seen.add(id);
        found.push(id);
      }
    }
    (node.content ?? []).forEach(visit);
  };
  visit(doc);
  return found;
}
