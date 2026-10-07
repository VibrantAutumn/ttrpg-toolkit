import type { Folder, Tag, TagLink } from "../../api/library";

/**
 * The chain of folders from the top level down to `folderId`, for breadcrumbs.
 * Returns [] for the top level (null) or an unknown id. Guards against loops.
 */
export function folderPath(folders: Folder[], folderId: string | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  const seen = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Folders directly inside `parentId` (null = top level), alphabetical. */
export function childFolders(folders: Folder[], parentId: string | null): Folder[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Every folder as a flat list for a "move to" menu, with nesting shown by
 * indentation in `label`. Folders in `exclude` (and everything below them) are
 * left out, so a folder can't be offered a move into itself.
 */
export function folderOptions(
  folders: Folder[],
  exclude: string | null = null,
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childFolders(folders, parentId)) {
      if (f.id === exclude) continue;
      out.push({ id: f.id, label: `${"  ".repeat(depth)}${f.name}` });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Groups tag links by item id, e.g. to draw each item's tag chips. */
export function tagsByItem(links: TagLink[]): Map<string, Tag[]> {
  const map = new Map<string, Tag[]>();
  for (const { itemId, tag } of links) {
    const list = map.get(itemId);
    if (list) list.push(tag);
    else map.set(itemId, [tag]);
  }
  return map;
}
