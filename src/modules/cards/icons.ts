const ICONS: Record<string, string> = { card: "🃏", set: "🗃️", deck: "🎴", pool: "🧺", draw: "🔮", play: "▶️", spread: "📜", smart_collection: "🔎" };

/** The emoji for a cards-library item type (a plain card icon for anything unknown). */
export const cardTypeIcon = (itemType: string): string => ICONS[itemType] ?? "🃏";
