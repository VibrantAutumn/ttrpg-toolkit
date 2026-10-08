/**
 * The table entry editor's view of an entry: a flat list of text, line breaks
 * and slot chips. The rich-text editor shows and edits this model; the stored
 * form is still the entry's plain text (see `parse.ts` for the slot syntax).
 * Pure logic, so the conversion is tested without the editor.
 *
 * Going from text to model and back never changes what an entry means (the same
 * text and slots), though it may write escapes differently: a backslash is
 * always written `\\`, for example.
 */

import { parseEntry, slotDisplay } from "./parse";
import type { EntryParseError, Slot } from "./parse";

export type InlineNode =
  | { type: "text"; text: string }
  /** `source` is what is between the brackets, e.g. `Person as A` or `dice:2d4`. */
  | { type: "slot"; source: string }
  | { type: "break" };

export type EntryModelResult = { ok: true; nodes: InlineNode[] } | { ok: false; error: EntryParseError };

/** Reads an entry's text into nodes, or gives the parser's error when the text has a problem. */
export function entryToModel(entry: string): EntryModelResult {
  const parsed = parseEntry(entry);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const nodes: InlineNode[] = [];
  for (const part of parsed.parts) {
    if (part.kind === "slot") {
      nodes.push({ type: "slot", source: part.source });
      continue;
    }
    part.text.split(/\r\n|\n|\r/).forEach((line, i) => {
      if (i > 0) nodes.push({ type: "break" });
      if (line !== "") nodes.push({ type: "text", text: line });
    });
  }
  return { ok: true, nodes };
}

/** `\`, `[` and `]` get a backslash so they read back as themselves. */
function escapeText(text: string): string {
  return text.replace(/[[\]\\]/g, (c) => `\\${c}`);
}

/** Writes nodes back as an entry's text. */
export function modelToEntry(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeText(node.text);
        case "break":
          return "\n";
        case "slot":
          return `[${escapeText(node.source)}]`;
      }
    })
    .join("");
}

export type SlotDescription =
  | {
      ok: true;
      type: Slot["type"];
      /** Short readable text for the chip, e.g. `3 unique Rumors` or `A.Faction`. */
      display: string;
      /** The name this slot gives its result (`as A`), if any. */
      label?: string;
    }
  | { ok: false; message: string };

/** Works out what one slot means, given the labels set by the slots before it. */
function describeSlot(source: string, labelsBefore: readonly string[]): SlotDescription {
  // Earlier labels are set up with throwaway slots of an unknown type, so the
  // parser sees `[A]` as a reference when (and only when) A was set before.
  const setup = labelsBefore.map((label) => `[x:1 as ${label}]`).join("");
  const parsed = parseEntry(`${setup}[${escapeText(source)}]`);
  if (!parsed.ok) return { ok: false, message: parsed.error.message };
  const part = parsed.parts[parsed.parts.length - 1];
  if (part.kind !== "slot") return { ok: false, message: "This isn't a slot." };
  return {
    ok: true,
    type: part.slot.type,
    display: slotDisplay(part),
    ...(part.label !== undefined ? { label: part.label } : {}),
  };
}

/**
 * Describes every slot node in order, for drawing the chips (null for text and
 * breaks, so the result lines up with `nodes`). A slot that doesn't make sense
 * gets an error message and doesn't affect the others, and a label only counts
 * for the slots after the one that sets it.
 */
export function describeSlots(nodes: readonly InlineNode[]): (SlotDescription | null)[] {
  const labels: string[] = [];
  return nodes.map((node) => {
    if (node.type !== "slot") return null;
    const description = describeSlot(node.source, labels);
    if (description.ok && description.label !== undefined) labels.push(description.label);
    return description;
  });
}
