/**
 * The current names of the pages that link slots point at. A link slot stores the name it was linked
 * with, but shows (and rolls) the page's name as it is now, so a rename is followed. The names are loaded
 * by the app (`useLinkNames`, `loadTableWorld`) and kept here so the chip text, which is worked out in
 * pure code, can use them. A page that isn't found keeps the name it was linked with.
 */
const names = new Map<string, string>();

export const linkName = (itemId: string): string | undefined => names.get(itemId.toLowerCase());

/** Remembers names; returns true when any of them changed. */
export function rememberLinkNames(entries: Iterable<readonly [string, string]>): boolean {
  let changed = false;
  for (const [id, name] of entries) {
    const key = id.toLowerCase();
    if (names.get(key) !== name) {
      names.set(key, name);
      changed = true;
    }
  }
  return changed;
}
