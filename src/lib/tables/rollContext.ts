import { emptyQuery, type Query, type Rule } from "../queries/query";

/**
 * Roll context: tags that limit what entity slots may pick for a whole roll ("only documents tagged
 * Sword Coast"). An item must carry every chosen tag (a tag nested under a chosen one counts).
 * Pure logic; the choice itself is remembered per device by `state/rollContext.ts`.
 */

export const MAX_CONTEXT_TAGS = 10;

/** Reads the stored text back into tag ids; anything unreadable means no context. */
export function parseContext(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    const ids = raw.filter((x): x is string => typeof x === "string" && x !== "");
    return [...new Set(ids)].slice(0, MAX_CONTEXT_TAGS);
  } catch {
    return [];
  }
}

export function serializeContext(tagIds: readonly string[]): string {
  return JSON.stringify([...new Set(tagIds)].slice(0, MAX_CONTEXT_TAGS));
}

export function toggleContextTag(tagIds: readonly string[], tagId: string): string[] {
  if (tagIds.includes(tagId)) return tagIds.filter((t) => t !== tagId);
  return tagIds.length >= MAX_CONTEXT_TAGS ? [...tagIds] : [...tagIds, tagId];
}

/** The query that finds the items carrying every context tag (null when there is no context). */
export function contextQuery(tagIds: readonly string[]): Query | null {
  if (tagIds.length === 0) return null;
  const rules: Rule[] = tagIds.map((tagId) => ({ kind: "tag", tagId, subtags: true, not: false }));
  const q = emptyQuery();
  return { ...q, where: { op: "all", not: false, rules } };
}

/** Keeps the items that are in `allowed`, or all of them when there is no context. */
export function narrowItems<T extends { id: string }>(items: readonly T[], allowed: ReadonlySet<string> | null): T[] {
  return allowed === null ? [...items] : items.filter((i) => allowed.has(i.id));
}
