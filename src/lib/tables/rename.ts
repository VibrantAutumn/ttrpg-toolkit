/**
 * Fixing table slots after a table is renamed. A slot like `[3 unique Rumors]`
 * finds its table by name, so renaming "Rumors" would leave it pointing at
 * nothing; this works out the entries' new text. Only the name inside matching
 * table slots changes: everything else in an entry stays exactly as written, and
 * each slot keeps the form it was typed in (`[Rumors]` or `[table:Rumors]`)
 * unless the new name needs the explicit form to be read as a table.
 * Pure logic: nothing here touches the database.
 */

import { parseEntry } from "./parse";
import type { EntryPart, SlotPart } from "./parse";

const key = (name: string) => name.trim().toLowerCase();

export type Rewrite =
  /** Nothing in the entry refers to the table (or the entry isn't readable, so it is rolled as plain text). */
  | { kind: "unchanged" }
  | { kind: "rewritten"; text: string; slots: number }
  /** The entry refers to the table but no way of writing the new name is read back correctly. */
  | { kind: "manual" };

function escapeText(text: string): string {
  return text.replace(/[[\]\\]/g, (c) => `\\${c}`);
}

/** The slot the way it should read after the rename, for checking the result. */
function renamedPart(part: EntryPart, from: string, to: string): unknown {
  if (part.kind === "text") return part.text;
  const slot = part.slot.type === "table" && key(part.slot.name) === key(from) ? { ...part.slot, name: to.trim() } : part.slot;
  return { slot, label: part.label ?? null, format: part.format ?? null };
}

function plainPart(part: EntryPart): unknown {
  return part.kind === "text" ? part.text : { slot: part.slot, label: part.label ?? null, format: part.format ?? null };
}

/** The entry's text with the matching slots rewritten, in the explicit form if `explicit` forces it. */
function splice(text: string, parts: readonly EntryPart[], from: string, to: string, forceExplicit: boolean): string {
  let out = "";
  let cursor = 0;
  for (const part of parts) {
    if (part.kind !== "slot") continue;
    const slot = part.slot;
    if (slot.type !== "table" || key(slot.name) !== key(from)) continue;
    const wasExplicit = /^table:/.test(part.source);
    const prefix = slot.count !== 1 || slot.unique ? `${slot.count} ${slot.unique ? "unique " : ""}` : "";
    const inner =
      (wasExplicit || forceExplicit ? "table:" : "") +
      prefix +
      escapeText(to.trim()) +
      (part.label !== undefined ? ` as ${part.label}` : "") +
      (part.format !== undefined ? ` | ${part.format}` : "");
    out += text.slice(cursor, part.start) + `[${inner}]`;
    cursor = part.end;
  }
  return out + text.slice(cursor);
}

/** Rewrites one entry's text for a table renamed from `from` to `to`. */
export function rewriteTableName(text: string, from: string, to: string): Rewrite {
  if (key(from) === key(to)) return { kind: "unchanged" }; // slots find tables ignoring case
  const parsed = parseEntry(text);
  if (!parsed.ok) return { kind: "unchanged" };
  const matching = parsed.parts.filter(
    (p): p is SlotPart => p.kind === "slot" && p.slot.type === "table" && key(p.slot.name) === key(from),
  );
  if (matching.length === 0) return { kind: "unchanged" };

  const expected = JSON.stringify(parsed.parts.map((p) => renamedPart(p, from, to)));
  for (const forceExplicit of [false, true]) {
    const candidate = splice(text, parsed.parts, from, to, forceExplicit);
    const again = parseEntry(candidate);
    if (again.ok && JSON.stringify(again.parts.map(plainPart)) === expected) {
      return { kind: "rewritten", text: candidate, slots: matching.length };
    }
  }
  return { kind: "manual" };
}

export interface RenameCandidate {
  entryId: string;
  text: string;
}

export interface RenamePlan {
  /** The entries whose text changes, with the text they get. */
  updates: { entryId: string; text: string }[];
  /** How many entries change, and how many slots in them. */
  entries: number;
  slots: number;
  /** Entries that use the name but can't be fixed automatically (to be fixed by hand). */
  manual: RenameCandidate[];
}

/** Works out the whole rename over the entries that might use the old name. */
export function planRename(candidates: readonly RenameCandidate[], from: string, to: string): RenamePlan {
  const plan: RenamePlan = { updates: [], entries: 0, slots: 0, manual: [] };
  for (const c of candidates) {
    const r = rewriteTableName(c.text, from, to);
    if (r.kind === "rewritten") {
      plan.updates.push({ entryId: c.entryId, text: r.text });
      plan.entries += 1;
      plan.slots += r.slots;
    } else if (r.kind === "manual") {
      plan.manual.push(c);
    }
  }
  return plan;
}
