/**
 * What the "Insert slot" menu asks for, and the slot text it makes. The text is
 * the explicit `type:arguments` form (see `parse.ts`), so it never depends on
 * guessing whether a name is dice or a table. Pure logic.
 */

import { MAX_DRAW } from "../cards/draw";
import { parseDice } from "../dice/parse";
import { MAX_PICKS } from "./parse";

export type SlotChoice =
  | { type: "dice"; notation: string; label?: string }
  | { type: "table"; name: string; count: number; unique: boolean; label?: string }
  | { type: "entity"; name: string; count: number; unique: boolean; label?: string }
  | { type: "draw"; source: string; count: number; label?: string }
  | { type: "ref"; label: string; field?: string };

/** What goes between the brackets for this choice. */
export function buildSlotSource(choice: SlotChoice): string {
  let body: string;
  switch (choice.type) {
    case "dice":
      body = `dice:${choice.notation.trim()}`;
      break;
    case "table": {
      const count = choice.count !== 1 || choice.unique ? `${choice.count} ${choice.unique ? "unique " : ""}` : "";
      body = `table:${count}${choice.name.trim()}`;
      break;
    }
    case "entity": {
      const count = choice.count !== 1 || choice.unique ? `${choice.count} ${choice.unique ? "unique " : ""}` : "";
      body = `entity:${count}${choice.name.trim()}`;
      break;
    }
    case "draw":
      body = `draw:${choice.count} from ${choice.source.trim()}`;
      break;
    case "ref":
      return `ref:${choice.label}${choice.field ? `.${choice.field.trim()}` : ""}`;
  }
  const label = choice.label?.trim();
  return label ? `${body} as ${label}` : body;
}

const LABEL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function checkCount(count: number, max: number, what: string): string | null {
  if (!Number.isInteger(count)) return "How many has to be a whole number.";
  if (count < 1) return `Ask for at least 1 ${what}.`;
  if (count > max) return `Ask for at most ${max} ${what}s at a time.`;
  return null;
}

/** Says what is wrong with a choice (before building it), or null when it is fine. */
export function checkSlotChoice(choice: SlotChoice): string | null {
  if (choice.type !== "ref") {
    const label = choice.label?.trim();
    if (label && !LABEL_NAME.test(label)) {
      return "A label uses letters, digits or _, starting with a letter (like A or Hero).";
    }
  }
  switch (choice.type) {
    case "dice": {
      if (choice.notation.trim() === "") return "Type a dice formula, like 2d4.";
      const parsed = parseDice(choice.notation);
      return parsed.ok ? null : `That isn't a dice formula: ${parsed.error.message}`;
    }
    case "table":
      if (choice.name.trim() === "") return "Choose a table.";
      return checkCount(choice.count, MAX_PICKS, "pick");
    case "entity":
      if (choice.name.trim() === "") return "Choose a filter set or a tag.";
      return checkCount(choice.count, MAX_PICKS, "pick");
    case "draw":
      if (choice.source.trim() === "") return "Choose a deck, set or pool.";
      return checkCount(choice.count, MAX_DRAW, "card");
    case "ref":
      return choice.label.trim() === "" ? "Choose which earlier result to reuse." : null;
  }
}
