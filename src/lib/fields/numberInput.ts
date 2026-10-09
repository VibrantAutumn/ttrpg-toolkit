import type { FieldDefinition } from "./definition";
import { coerceValue, type CoerceResult } from "./value";

/**
 * Reads what someone typed into a number field. A single comma counts as a decimal point
 * ("1,5"), and the typographic minus is accepted. Empty text means no value. The field's own
 * rules (rounding, smallest and largest) then apply.
 */
export function parseNumberInput(def: Extract<FieldDefinition, { kind: "number" }>, text: string): CoerceResult {
  const typed = text.trim().replace(/−/g, "-");
  if (typed === "") return coerceValue(def, null);
  const normal = /^[+-]?\d*,\d+$/.test(typed) ? typed.replace(",", ".") : typed;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normal)) return { ok: false, error: "Type a number." };
  return coerceValue(def, Number(normal));
}
