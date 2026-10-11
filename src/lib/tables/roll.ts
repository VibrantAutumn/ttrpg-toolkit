/**
 * Rolls a random table: picks an entry by weight, then fills in its slots
 * (nested tables, dice, card draws, labels). Pure logic: the tables, decks and
 * recent picks are handed in through a `TableWorld`, and all randomness comes
 * from an `Rng`, so a seed reproduces a roll while the tables are unchanged.
 *
 * Order of randomness (so a seed means the same thing every time):
 *   1. The entry: one `rng.int(1, total weight of the entries that may be picked)`,
 *      even when there is only one.
 *   2. Then the entry's slots, left to right, going all the way into a nested
 *      table before the next slot. A table slot asking for several picks does
 *      pick, fill in that entry, pick, fill in, and so on.
 *   3. A dice slot rolls its formula; a draw slot is exactly `drawCards`.
 *
 *   4. An entity slot (documents or other items from a smart collection or a tag) picks with
 *      `rng.int(1, items left)` per pick, over the source's items in the order the world lists them.
 *
 * Problems never stop a roll: a missing table, a bad draw or a nesting loop
 * shows a "⚠" in place of that slot and adds a warning to the result.
 */

import type { Rng } from "../dice/rng";
import { rollNotation } from "../dice/roll";
import type { DiceResult } from "../dice/roll";
import { DEFAULT_DRAW_OPTIONS, drawCards } from "../cards/draw";
import type { DrawCard, DrawnCard } from "../cards/draw";
import { applyFormat } from "./slotFormat";
import { parseEntry } from "./parse";
import type { Slot, SlotPart } from "./parse";

/** Deepest nesting allowed: the table you roll is level 0, tables inside it level 1... */
export const MAX_DEPTH = 5;
/** Most entries one roll may pick across all nested tables (stops runaway nesting). */
export const MAX_EVALUATIONS = 500;

export interface RollableEntry {
  id: string;
  text: string;
  /** How many places the entry takes up in the roll; 0 means it is never picked. */
  weight: number;
}

export interface RollableTable {
  id: string;
  name: string;
  entries: RollableEntry[];
  /** Skip the last N entries rolled from this table (0 = off). */
  avoidRecent: number;
}

export interface RollableDeck {
  id: string;
  name: string;
  cards: readonly DrawCard[];
}

/** A document or other item an entity slot can pick. */
export interface EntityItem {
  id: string;
  name: string;
}

/** Where an entity slot picks from: a smart collection or a tag, already narrowed by the roll context. */
export interface EntitySource {
  name: string;
  kind: "collection" | "tag";
  items: readonly EntityItem[];
}

/** What `[A.Field]` finds: the field's value as text, or a sentence saying why not. */
export type FieldLookup = { ok: true; text: string } | { ok: false; message: string };

/**
 * Everything a roll needs to look up. Tables, decks and entity sources are found by name, ignoring case.
 * A world without documents leaves `findEntities` and `entityField` out; entity slots then show a warning.
 */
export interface TableWorld {
  findTable(name: string): RollableTable | null;
  findDeck(name: string): RollableDeck | null;
  /** Entry ids recently rolled from a table, newest first. */
  recent(tableId: string): readonly string[];
  findEntities?(name: string): EntitySource | null;
  entityField?(itemId: string, field: string): FieldLookup;
  /** The current name of a page a link slot points at; unknown pages keep the name they were linked with. */
  itemName?(itemId: string): string | undefined;
}

/** One entry picked from a table slot, with its filled-in text. */
export interface TablePick {
  entryId: string;
  text: string;
  parts: ResultPart[];
}

export type SlotOutcome =
  | { type: "table"; tableId: string; tableName: string; picks: TablePick[] }
  | { type: "dice"; result: DiceResult }
  | { type: "draw"; sourceId: string; sourceName: string; cards: DrawnCard[] }
  | { type: "entity"; sourceName: string; kind: "collection" | "tag" | "link"; picks: EntityItem[] }
  | { type: "ref"; text: string }
  | { type: "missing"; kind: "table" | "deck" | "entity"; name: string }
  | { type: "unknown"; kind: string; args: string }
  | { type: "error"; message: string };

export type ResultPart =
  | { kind: "text"; text: string }
  | { kind: "slot"; slot: Slot; label?: string; source: string; outcome: SlotOutcome; text: string };

export interface PickedEntry {
  tableId: string;
  entryId: string;
}

export interface TableRoll {
  tableId: string;
  tableName: string;
  entryId: string;
  /** The entry's text as it was when rolled (so a roll can be rerolled after edits). */
  entryText: string;
  /** One result part per part of the entry, in order. */
  parts: ResultPart[];
  text: string;
  warnings: string[];
  /** Entries picked by this roll, in order, for the caller to remember as recent. */
  picked: PickedEntry[];
}

export type RollTableResult = { ok: true; roll: TableRoll } | { ok: false; message: string };

interface Context {
  world: TableWorld;
  rng: Rng;
  warnings: string[];
  picked: PickedEntry[];
  evaluations: number;
}

/** What a label stands for: its text, and the item behind it when it was an entity pick. */
interface LabelValue {
  text: string;
  itemId?: string;
}

function labelValueOf(part: ResultPart): LabelValue {
  if (part.kind === "slot" && part.outcome.type === "entity" && part.outcome.picks.length > 0) {
    return { text: part.text, itemId: part.outcome.picks[0].id };
  }
  return { text: part.text };
}

/**
 * The parts of a result with every table slot replaced by the parts of the entries it picked (several
 * picks are separated by ", "), all the way down. What is left is plain text and slots that don't
 * contain more slots, so a document picked deep inside a nested table can still be found.
 */
export function leafParts(parts: readonly ResultPart[]): ResultPart[] {
  const out: ResultPart[] = [];
  for (const part of parts) {
    if (part.kind === "slot" && part.outcome.type === "table") {
      part.outcome.picks.forEach((pick, i) => {
        if (i > 0) out.push({ kind: "text", text: ", " });
        out.push(...leafParts(pick.parts));
      });
    } else {
      out.push(part);
    }
  }
  return out;
}

/** The documents or other items a result picked anywhere in it, in order. */
export function pickedItemsOf(parts: readonly ResultPart[]): EntityItem[] {
  return leafParts(parts).flatMap((p) => (p.kind === "slot" && p.outcome.type === "entity" ? p.outcome.picks : []));
}

function warn(ctx: Context, message: string): void {
  if (!ctx.warnings.includes(message)) ctx.warnings.push(message);
}

export function rollTable(table: RollableTable, world: TableWorld, rng: Rng): RollTableResult {
  const ctx: Context = { world, rng, warnings: [], picked: [], evaluations: 0 };
  ctx.evaluations += 1;
  const entry = pickEntry(table, ctx, new Set());
  if (!entry) return { ok: false, message: `"${table.name}" has no entries that can be rolled.` };
  ctx.picked.push({ tableId: table.id, entryId: entry.id });
  const filled = fillEntry(entry.text, 0, ctx, new Map());
  return {
    ok: true,
    roll: {
      tableId: table.id,
      tableName: table.name,
      entryId: entry.id,
      entryText: entry.text,
      parts: filled.parts,
      text: filled.text,
      warnings: ctx.warnings,
      picked: ctx.picked,
    },
  };
}

/**
 * Rolls a result again, keeping the entry. Slots at the `locked` part indexes
 * stay exactly as they were; the others are rolled afresh. References always
 * follow their label, so they can't be locked. Uses the entry text saved in the
 * result, so it works even if the table has been edited or deleted since.
 */
export function rerollTable(
  previous: TableRoll,
  locked: ReadonlySet<number>,
  world: TableWorld,
  rng: Rng,
): RollTableResult {
  const ctx: Context = { world, rng, warnings: [], picked: [], evaluations: 0 };
  const keep = new Map<number, ResultPart>();
  previous.parts.forEach((part, i) => {
    if (locked.has(i) && part.kind === "slot" && part.slot.type !== "ref") keep.set(i, part);
  });
  const filled = fillEntry(previous.entryText, 0, ctx, keep);
  return {
    ok: true,
    roll: { ...previous, parts: filled.parts, text: filled.text, warnings: ctx.warnings, picked: ctx.picked },
  };
}

/**
 * Picks one entry by weight. `exclude` holds entry ids that can't be chosen
 * (used for unique picks). Returns null when nothing can be picked.
 */
function pickEntry(table: RollableTable, ctx: Context, exclude: ReadonlySet<string>): RollableEntry | null {
  const pool = table.entries.filter((e) => e.weight > 0 && !exclude.has(e.id));
  if (pool.length === 0) return null;

  let eligible = pool;
  if (table.avoidRecent > 0) {
    const inThisRoll = ctx.picked
      .filter((p) => p.tableId === table.id)
      .map((p) => p.entryId)
      .reverse();
    const recent = new Set([...inThisRoll, ...ctx.world.recent(table.id)].slice(0, table.avoidRecent));
    const fresh = pool.filter((e) => !recent.has(e.id));
    if (fresh.length > 0) eligible = fresh;
    else warn(ctx, `"${table.name}": every entry was rolled recently, so "avoid recent" was skipped for this pick.`);
  }

  const total = eligible.reduce((sum, e) => sum + e.weight, 0);
  let n = ctx.rng.int(1, total);
  for (const e of eligible) {
    if (n <= e.weight) return e;
    n -= e.weight;
  }
  return eligible[eligible.length - 1]; // unreachable: n is within the total
}

/** Fills in an entry's text. Parts in `keep` (by index) are reused instead of rolled. */
function fillEntry(
  text: string,
  depth: number,
  ctx: Context,
  keep: ReadonlyMap<number, ResultPart>,
): { parts: ResultPart[]; text: string } {
  const parsed = parseEntry(text);
  if (!parsed.ok) {
    warn(ctx, `An entry couldn't be read (${parsed.error.message}), so it is shown as plain text.`);
    return { parts: [{ kind: "text", text }], text };
  }
  const labels = new Map<string, LabelValue>();
  const parts: ResultPart[] = parsed.parts.map((part, i) => {
    if (part.kind === "text") return part;
    const kept = keep.get(i);
    const result: ResultPart =
      kept && kept.kind === "slot" && kept.source === part.source ? kept : fillSlot(part, depth, ctx, labels);
    if (result.kind === "slot" && part.label !== undefined) labels.set(part.label.toLowerCase(), labelValueOf(result));
    return result;
  });
  return { parts, text: parts.map((p) => p.text).join("") };
}

function fillSlot(part: SlotPart, depth: number, ctx: Context, labels: ReadonlyMap<string, LabelValue>): ResultPart {
  const { outcome, text } = evaluateSlot(part.slot, depth, ctx, labels);
  return {
    kind: "slot",
    slot: part.slot,
    ...(part.label !== undefined ? { label: part.label } : {}),
    source: part.source,
    outcome,
    // Only the shown words change; the picks inside the outcome keep their own text.
    text: applyFormat(text, part.format),
  };
}

interface Evaluated {
  outcome: SlotOutcome;
  text: string;
}

function problem(ctx: Context, message: string, shown: string): Evaluated {
  warn(ctx, message);
  return { outcome: { type: "error", message }, text: `⚠ ${shown}` };
}

function evaluateSlot(slot: Slot, depth: number, ctx: Context, labels: ReadonlyMap<string, LabelValue>): Evaluated {
  switch (slot.type) {
    case "dice": {
      const rolled = rollNotation(slot.notation, ctx.rng);
      if (!rolled.ok) return problem(ctx, `Dice "${slot.notation}": ${rolled.error.message}`, `${slot.notation} (bad formula)`);
      return { outcome: { type: "dice", result: rolled.result }, text: String(rolled.result.total) };
    }
    case "draw": {
      const deck = ctx.world.findDeck(slot.source);
      if (!deck) {
        warn(ctx, `The deck, set or pool "${slot.source}" was not found.`);
        return { outcome: { type: "missing", kind: "deck", name: slot.source }, text: `⚠ ${slot.source}` };
      }
      const drawn = drawCards(deck.cards, { ...DEFAULT_DRAW_OPTIONS, count: slot.count }, ctx.rng);
      if (!drawn.ok) return problem(ctx, `Drawing from "${deck.name}": ${drawn.message}`, `${deck.name} (can't draw)`);
      return {
        outcome: { type: "draw", sourceId: deck.id, sourceName: deck.name, cards: drawn.cards },
        text: drawn.cards.map((c) => (c.reversed ? `${c.name} (reversed)` : c.name)).join(", "),
      };
    }
    case "ref": {
      const value = labels.get(slot.label.toLowerCase());
      if (value === undefined) return problem(ctx, `The label ${slot.label} has no result yet.`, `${slot.label} (no result)`);
      if (slot.field === undefined) return { outcome: { type: "ref", text: value.text }, text: value.text };
      const shown = `${slot.label}.${slot.field}`;
      if (value.itemId === undefined) {
        return problem(ctx, `${slot.label} isn't a document or item, so it has no property “${slot.field}”.`, `${shown} (no properties here)`);
      }
      if (!ctx.world.entityField) return problem(ctx, `${shown}: properties aren't available here.`, `${shown} (properties not available)`);
      const found = ctx.world.entityField(value.itemId, slot.field);
      if (!found.ok) return problem(ctx, found.message, `${shown} (${found.message})`);
      return { outcome: { type: "ref", text: found.text }, text: found.text };
    }
    case "entity":
      return evaluateEntitySlot(slot.name, slot.count, slot.unique, true, ctx);
    case "link":
      // A fixed pick: the same page every time, shown by the name it was linked with.
      {
        const name = ctx.world.itemName?.(slot.itemId) ?? slot.name;
        return { outcome: { type: "entity", sourceName: name, kind: "link", picks: [{ id: slot.itemId, name }] }, text: name };
      }
    case "unknown": {
      warn(ctx, `This version doesn't know the slot type "${slot.kind}", so [${slot.kind}:${slot.args}] was skipped.`);
      return {
        outcome: { type: "unknown", kind: slot.kind, args: slot.args },
        text: `⚠ ${slot.kind}:${slot.args} (not supported)`,
      };
    }
    case "table":
      return evaluateTableSlot(slot, depth, ctx);
  }
}

function evaluateEntitySlot(name: string, count: number, unique: boolean, explicit: boolean, ctx: Context): Evaluated {
  const source = ctx.world.findEntities?.(name);
  if (!source) {
    warn(ctx, explicit ? `No filter set or tag called "${name}" was found.` : `The table "${name}" was not found.`);
    return { outcome: { type: "missing", kind: "entity", name }, text: `⚠ ${name}` };
  }
  const left = source.items.slice();
  if (left.length === 0) {
    return problem(ctx, `Nothing in "${source.name}" can be picked (it is empty, or the roll context leaves nothing).`, `${source.name} (nothing to pick)`);
  }
  const picks: EntityItem[] = [];
  for (let i = 0; i < count; i++) {
    if (left.length === 0) {
      warn(ctx, `"${source.name}" only has ${picks.length} item${picks.length === 1 ? "" : "s"} to pick, not ${count}.`);
      break;
    }
    const at = ctx.rng.int(1, left.length) - 1;
    picks.push(left[at]);
    if (unique) left.splice(at, 1);
  }
  return {
    outcome: { type: "entity", sourceName: source.name, kind: source.kind, picks },
    text: picks.map((p) => p.name).join(", "),
  };
}

function evaluateTableSlot(
  slot: Extract<Slot, { type: "table" }>,
  depth: number,
  ctx: Context,
): Evaluated {
  const table = ctx.world.findTable(slot.name);
  if (!table) {
    // [Person] with no table of that name: a smart collection or tag of that name, if there is one.
    if (ctx.world.findEntities?.(slot.name)) return evaluateEntitySlot(slot.name, slot.count, slot.unique, false, ctx);
    warn(ctx, `The table "${slot.name}" was not found.`);
    return { outcome: { type: "missing", kind: "table", name: slot.name }, text: `⚠ ${slot.name}` };
  }
  if (depth + 1 > MAX_DEPTH) {
    return problem(
      ctx,
      `"${table.name}" is nested more than ${MAX_DEPTH} levels deep (a table containing itself?), so it was skipped.`,
      `${table.name} (nested too deeply)`,
    );
  }

  const picks: TablePick[] = [];
  const chosen = new Set<string>();
  for (let i = 0; i < slot.count; i++) {
    if (ctx.evaluations >= MAX_EVALUATIONS) {
      warn(ctx, `This roll needed too many table picks (more than ${MAX_EVALUATIONS}), so the rest was skipped.`);
      if (picks.length === 0) return { outcome: { type: "error", message: "Too many rolls" }, text: `⚠ ${table.name} (too many rolls)` };
      break;
    }
    ctx.evaluations += 1;
    const entry = pickEntry(table, ctx, slot.unique ? chosen : new Set());
    if (!entry) {
      if (picks.length === 0) {
        return problem(ctx, `"${table.name}" has no entries that can be rolled.`, `${table.name} (nothing to pick)`);
      }
      warn(ctx, `"${table.name}" only has ${picks.length} unique ${picks.length === 1 ? "entry" : "entries"} to pick, not ${slot.count}.`);
      break;
    }
    chosen.add(entry.id);
    ctx.picked.push({ tableId: table.id, entryId: entry.id });
    const filled = fillEntry(entry.text, depth + 1, ctx, new Map());
    picks.push({ entryId: entry.id, text: filled.text, parts: filled.parts });
  }
  return {
    outcome: { type: "table", tableId: table.id, tableName: table.name, picks },
    text: picks.map((p) => p.text).join(", "),
  };
}
