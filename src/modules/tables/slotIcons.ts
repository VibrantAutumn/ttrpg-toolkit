import type { SlotDescription } from "../../lib/tables/editorModel";

/** One emoji per kind of slot, shown on its chip (may become real icons later). */
export const SLOT_ICONS: Record<string, string> = {
  table: "📋",
  entity: "🧑",
  dice: "🎲",
  draw: "🃏",
  ref: "↩",
  unknown: "❓",
  error: "⚠",
};

/**
 * The attributes that make a chip look right (see `.slot-chip` in App.css, which
 * draws the icon and text from them). Used by the editor and by the read-only view.
 */
export function chipAttributes(description: SlotDescription | null, source: string) {
  if (!description || !description.ok) {
    return {
      className: "slot-chip slot-error",
      "data-icon": SLOT_ICONS.error,
      "data-display": source || "(empty)",
      title: description && !description.ok ? description.message : "This slot has a problem",
    };
  }
  return {
    className: `slot-chip slot-${description.type}`,
    "data-icon": SLOT_ICONS[description.type] ?? "",
    "data-display": description.display,
    title: description.display,
  };
}
