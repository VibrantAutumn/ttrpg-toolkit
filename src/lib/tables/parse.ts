/**
 * Slot parser for random table entries. Turns an entry's text, like
 * "[Person as A] is missing [2d4] [Objects]", into parts: plain text and slots.
 * Pure logic: nothing is rolled here (see the evaluator for that).
 *
 * Writing a slot: `[ ... ]`. Each kind has an explicit form `type:arguments`
 * (always unambiguous) and, for the common kinds, a shorthand:
 *   dice     [dice:2d4]            [2d4]             (shorthand: must contain a die)
 *   table    [table:Rumors]        [Rumors]
 *            [table:3 unique Rumors]   [3 Rumors]   [3 unique Rumors]
 *   entity   [entity:Person]  [entity:2 unique Person]   (documents or other items, from a smart
 *            collection or a tag of that name; there is no shorthand, but a table slot whose
 *            table doesn't exist is tried as an entity when it is rolled, so [Person] works too)
 *   draw     [draw:1 from Tarot]   [draw 1 from Tarot]
 *   ref      [ref:A]  [ref:A.Faction]   [A]  [A.Faction]   (shorthand: only if A was
 *            set earlier in the same entry, otherwise it is a table name)
 * Any slot can end with ` as Label` to name its result for later reuse.
 * A type this version does not know (`[mood:Calm]`) is kept as an "unknown"
 * slot, not an error, so newer data survives in an older app.
 *
 * Escapes: `\[`, `\]` and `\\` give a literal character; a backslash before
 * anything else stays a backslash. An explicit type is lowercase letters,
 * digits or underscores followed straight away by a colon, so a table named
 * "Loot: rare" still works as a shorthand name.
 */

import { parseDice } from "../dice/parse";
import { MAX_DRAW } from "../cards/draw";

/** Most slots one entry may hold. */
export const MAX_SLOTS = 30;
/** Most rolls one table slot may ask for (`[20 unique Rumors]`). */
export const MAX_PICKS = 20;

export type Slot =
  | { type: "table"; name: string; count: number; unique: boolean }
  | { type: "entity"; name: string; count: number; unique: boolean }
  | { type: "dice"; notation: string }
  | { type: "draw"; count: number; source: string }
  | { type: "ref"; label: string; field?: string }
  | { type: "unknown"; kind: string; args: string };

export interface TextPart {
  kind: "text";
  text: string;
}

export interface SlotPart {
  kind: "slot";
  slot: Slot;
  /** The name this slot's result is given (`as A`), spelled as written. */
  label?: string;
  /** What was written between the brackets, trimmed (escapes resolved). */
  source: string;
  /** Index of the `[` in the original text. */
  start: number;
  /** Index just after the `]` in the original text. */
  end: number;
}

export type EntryPart = TextPart | SlotPart;

export interface EntryParseError {
  message: string;
  /** Index in the original text where the problem is. */
  position: number;
}

export type EntryParseResult = { ok: true; parts: EntryPart[] } | { ok: false; error: EntryParseError };

class SlotError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

export function parseEntry(text: string): EntryParseResult {
  try {
    return { ok: true, parts: scan(text) };
  } catch (e) {
    if (e instanceof SlotError) return { ok: false, error: { message: e.message, position: e.position } };
    throw e;
  }
}

function isEscapable(c: string | undefined): boolean {
  return c === "[" || c === "]" || c === "\\";
}

function scan(text: string): EntryPart[] {
  const parts: EntryPart[] = [];
  /** Lowercased label -> label as first written. */
  const labels = new Map<string, string>();
  let buffer = "";
  let slots = 0;
  let i = 0;

  const flush = () => {
    if (buffer !== "") parts.push({ kind: "text", text: buffer });
    buffer = "";
  };

  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      if (isEscapable(text[i + 1])) {
        buffer += text[i + 1];
        i += 2;
      } else {
        buffer += c;
        i += 1;
      }
    } else if (c === "]") {
      throw new SlotError("Unexpected ]: write \\] for a literal bracket", i);
    } else if (c === "[") {
      const start = i;
      let inner = "";
      i += 1;
      for (;;) {
        if (i >= text.length) throw new SlotError("This [ has no closing ]", start);
        const d = text[i];
        if (d === "\\" && isEscapable(text[i + 1])) {
          inner += text[i + 1];
          i += 2;
        } else if (d === "[") {
          throw new SlotError("A slot can't hold another [ inside it: write \\[ for a literal bracket", i);
        } else if (d === "]") {
          i += 1;
          break;
        } else {
          inner += d;
          i += 1;
        }
      }
      slots += 1;
      if (slots > MAX_SLOTS) throw new SlotError(`An entry can hold at most ${MAX_SLOTS} slots`, start);
      const source = inner.trim();
      const { slot, label } = interpret(source, start, labels);
      if (label !== undefined) labels.set(label.toLowerCase(), label);
      flush();
      parts.push({ kind: "slot", slot, ...(label !== undefined ? { label } : {}), source, start, end: i });
    } else {
      buffer += c;
      i += 1;
    }
  }
  flush();
  return parts;
}

interface Interpreted {
  slot: Slot;
  label?: string;
}

const LABEL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const REF = /^([A-Za-z][A-Za-z0-9_]*)(?:\.(.+))?$/;

/** Works out what one slot means. `labels` holds the labels set earlier in the entry. */
function interpret(source: string, at: number, labels: Map<string, string>): Interpreted {
  if (source === "") throw new SlotError("This slot is empty: put a table name, dice or a draw between the brackets", at);

  const explicit = /^([a-z][a-z0-9_]*):([\s\S]*)$/.exec(source);
  const { base, label } = splitLabel(source, explicit ? explicit[2].trim() : undefined, at);
  const kind = explicit ? explicit[1] : undefined;
  const args = base;

  if (label !== undefined) {
    if (!LABEL_NAME.test(label)) {
      throw new SlotError(`"${label}" can't be used as a label: use letters, digits or _, starting with a letter (like A or Hero)`, at);
    }
    if (labels.has(label.toLowerCase())) {
      throw new SlotError(`The label ${label} is already used earlier in this entry`, at);
    }
  }

  let slot: Slot;
  if (kind !== undefined) {
    slot = explicitSlot(kind, args, at, labels);
  } else if (/^draw\s+\d/i.test(args)) {
    slot = drawSlot(args.replace(/^draw\s+/i, ""), at);
  } else {
    const dice = parseDice(args);
    const ref = REF.exec(args);
    if (dice.ok && dice.expression.terms.some((t) => t.kind === "dice")) {
      slot = { type: "dice", notation: dice.expression.notation };
    } else if (ref && labels.has(ref[1].toLowerCase())) {
      slot = refSlot(ref, labels);
    } else {
      slot = tableSlot(args, at);
    }
  }

  if (slot.type === "ref" && label !== undefined) {
    throw new SlotError("A reference reuses an earlier result, so it can't get a label of its own", at);
  }
  return label !== undefined ? { slot, label } : { slot };
}

/**
 * Splits a trailing ` as Label` off the slot. For an explicit slot the part
 * after the colon is split; for shorthand the whole text is. A trailing `as`
 * with no name is an error.
 */
function splitLabel(source: string, explicitArgs: string | undefined, at: number): { base: string; label?: string } {
  const text = explicitArgs ?? source;
  const m = /^(.+)\s+as(?:\s+([\s\S]*))?$/i.exec(text);
  if (!m) return { base: text };
  const label = (m[2] ?? "").trim();
  if (label === "") throw new SlotError('"as" needs a label after it, like [Person as A]', at);
  return { base: m[1].trim(), label };
}

function explicitSlot(kind: string, args: string, at: number, labels: Map<string, string>): Slot {
  switch (kind) {
    case "table":
      return tableSlot(args, at);
    case "entity": {
      const picked = tableSlot(args, at, "An entity slot needs the name of a smart collection or a tag");
      return picked.type === "table" ? { type: "entity", name: picked.name, count: picked.count, unique: picked.unique } : picked;
    }
    case "dice": {
      if (args === "") throw new SlotError("Dice slot needs a formula, like [dice:2d4]", at);
      const result = parseDice(args);
      if (!result.ok) throw new SlotError(`Dice formula in this slot: ${result.error.message}`, at);
      return { type: "dice", notation: result.expression.notation };
    }
    case "draw":
      return drawSlot(args, at);
    case "ref": {
      const ref = REF.exec(args);
      if (!ref || !labels.has(ref[1].toLowerCase())) {
        throw new SlotError(`[ref:${args}] needs a label set earlier in this entry (like [Person as A])`, at);
      }
      return refSlot(ref, labels);
    }
    default:
      return { type: "unknown", kind, args };
  }
}

function refSlot(ref: RegExpExecArray, labels: Map<string, string>): Slot {
  const label = labels.get(ref[1].toLowerCase()) as string;
  return ref[2] !== undefined ? { type: "ref", label, field: ref[2].trim() } : { type: "ref", label };
}

function tableSlot(args: string, at: number, emptyMessage = "A table slot needs a table name"): Slot {
  if (args === "") throw new SlotError(emptyMessage, at);
  if (/^unique\s+\S/i.test(args)) {
    throw new SlotError("Say how many to pick: [3 unique Rumors]", at);
  }
  const m = /^(\d+)\s+(unique\s+)?(\S[\s\S]*)$/i.exec(args);
  if (!m) return { type: "table", name: args, count: 1, unique: false };
  const count = checkCount(m[1], MAX_PICKS, "pick", "picks", at);
  return { type: "table", name: m[3].trim(), count, unique: m[2] !== undefined };
}

function drawSlot(args: string, at: number): Slot {
  const m = /^(\d+)\s+from\s+(\S[\s\S]*)$/i.exec(args);
  if (!m) throw new SlotError("A draw says how many and from where: [draw 2 from Tarot]", at);
  const count = checkCount(m[1], MAX_DRAW, "draw", "draws", at);
  return { type: "draw", count, source: m[2].trim() };
}

function checkCount(digits: string, max: number, one: string, many: string, at: number): number {
  const n = Number(digits);
  if (!(n >= 1)) throw new SlotError(`Ask for at least 1 ${one}`, at);
  if (n > max) throw new SlotError(`Ask for at most ${max} ${many} at a time`, at);
  return n;
}

function escapeText(text: string): string {
  return text.replace(/[[\]\\]/g, (c) => `\\${c}`);
}

/** The explicit form of a slot, without brackets: `dice:2d4`, `table:Rumors as R`. */
export function slotCanonical(part: SlotPart): string {
  const { slot } = part;
  let body: string;
  switch (slot.type) {
    case "table":
      body = `table:${slot.count !== 1 || slot.unique ? `${slot.count} ${slot.unique ? "unique " : ""}` : ""}${escapeText(slot.name)}`;
      break;
    case "entity":
      body = `entity:${slot.count !== 1 || slot.unique ? `${slot.count} ${slot.unique ? "unique " : ""}` : ""}${escapeText(slot.name)}`;
      break;
    case "dice":
      body = `dice:${slot.notation}`;
      break;
    case "draw":
      body = `draw:${slot.count} from ${escapeText(slot.source)}`;
      break;
    case "ref":
      return `ref:${slot.label}${slot.field !== undefined ? `.${escapeText(slot.field)}` : ""}`;
    case "unknown":
      body = `${slot.kind}:${escapeText(slot.args)}`;
      break;
  }
  return part.label !== undefined ? `${body} as ${part.label}` : body;
}

/** Short readable text for a slot chip (the editor adds the type's icon). */
export function slotDisplay(part: SlotPart): string {
  const { slot } = part;
  let body: string;
  switch (slot.type) {
    case "table":
      body = `${slot.count !== 1 || slot.unique ? `${slot.count} ${slot.unique ? "unique " : ""}` : ""}${slot.name}`;
      break;
    case "entity":
      body = `${slot.count !== 1 || slot.unique ? `${slot.count} ${slot.unique ? "unique " : ""}` : ""}${slot.name}`;
      break;
    case "dice":
      body = slot.notation;
      break;
    case "draw":
      body = `draw ${slot.count} from ${slot.source}`;
      break;
    case "ref":
      return slot.field !== undefined ? `${slot.label}.${slot.field}` : slot.label;
    case "unknown":
      body = `${slot.kind}: ${slot.args}`;
      break;
  }
  return part.label !== undefined ? `${body} as ${part.label}` : body;
}
