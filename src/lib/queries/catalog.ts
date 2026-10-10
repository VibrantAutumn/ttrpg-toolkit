import { isGroup, type Node, type Query } from "./query";

/** "Parent / Child" for a nested tag or folder (an id that isn't in the list gives ""). */
export function pathLabel<T extends { id: string; parentId: string | null; name: string }>(all: T[], id: string): string {
  const byId = new Map(all.map((x) => [x.id, x]));
  const parts: string[] = [];
  let current = byId.get(id);
  for (let i = 0; current && i < 20; i++) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(" / ");
}

/** The ids of the items a query names (so their names can be loaded). */
export function itemIdsIn(query: Query): string[] {
  const ids = new Set<string>();
  const walk = (node: Node) => {
    if (isGroup(node)) return node.rules.forEach(walk);
    if (node.kind === "linksTo" || node.kind === "linkedFrom") ids.add(node.itemId);
    if (node.kind === "field" && node.test.check === "links") ids.add(node.test.itemId);
  };
  walk(query.where);
  ids.delete("");
  return [...ids];
}
