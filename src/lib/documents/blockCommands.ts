/**
 * The blocks offered by the "/" menu (and the editor's block-type picker). This is only
 * the list and the typing filter; what each one does to the editor lives in the module,
 * so the list can be tested without an editor.
 */
export type BlockCommandId = "text" | "h1" | "h2" | "h3" | "h4" | "bullet" | "ordered" | "quote" | "code" | "divider" | "table" | "columns2" | "columns3" | "callout" | "warning" | "toggle" | "secret";

export interface BlockCommand {
  id: BlockCommandId;
  label: string;
  hint: string;
  /** The heading the "/" menu shows it under (when nothing has been typed yet). */
  group: string;
  /** Other words someone might type to find it. */
  keywords: string[];
}

// Listed by group, so the menu's headings are contiguous.
export const BLOCK_COMMANDS: BlockCommand[] = [
  { id: "text", label: "Text", hint: "Plain paragraph", group: "Basic blocks", keywords: ["paragraph", "plain", "normal"] },
  { id: "h1", label: "Heading 1", hint: "Big section title", group: "Basic blocks", keywords: ["title", "h1"] },
  { id: "h2", label: "Heading 2", hint: "Medium section title", group: "Basic blocks", keywords: ["subtitle", "h2"] },
  { id: "h3", label: "Heading 3", hint: "Small section title", group: "Basic blocks", keywords: ["h3"] },
  { id: "h4", label: "Heading 4", hint: "Smallest section title", group: "Basic blocks", keywords: ["h4"] },
  { id: "quote", label: "Quote", hint: "Set text apart", group: "Basic blocks", keywords: ["blockquote"] },
  { id: "code", label: "Code block", hint: "Text kept exactly as typed", group: "Basic blocks", keywords: ["monospace", "pre"] },
  { id: "divider", label: "Divider", hint: "A line across the page", group: "Basic blocks", keywords: ["rule", "hr", "line", "separator"] },
  { id: "bullet", label: "Bulleted list", hint: "A simple list", group: "Lists", keywords: ["ul", "unordered", "points"] },
  { id: "ordered", label: "Numbered list", hint: "A list with numbers", group: "Lists", keywords: ["ol", "ordered", "steps"] },
  { id: "table", label: "Table", hint: "Rows and columns of text", group: "Layout", keywords: ["grid", "rows", "spreadsheet"] },
  { id: "columns2", label: "2 columns", hint: "Side by side", group: "Layout", keywords: ["column", "layout", "split"] },
  { id: "columns3", label: "3 columns", hint: "Three side by side", group: "Layout", keywords: ["column", "layout"] },
  { id: "toggle", label: "Toggle", hint: "A section that opens and closes", group: "Layout", keywords: ["expand", "fold", "accordion", "details"] },
  { id: "callout", label: "Callout", hint: "A highlighted note", group: "Highlights", keywords: ["note", "info", "tip", "aside", "box"] },
  { id: "warning", label: "Warning callout", hint: "A highlighted warning", group: "Highlights", keywords: ["alert", "caution", "danger"] },
  { id: "secret", label: "Secret", hint: "GM-only block", group: "Highlights", keywords: ["gm", "hidden", "private"] },
];

/** An item of the "/" menu: one of the fixed blocks, or an extra the page offers (a stat block to add to it). */
export interface SlashCommand extends Omit<BlockCommand, "id"> {
  id: BlockCommandId | `statblock:${string}`;
  /** For a stat block: the property set it adds to the page. */
  setId?: string;
}

/** How well one typed word fits a command, lower is better; null = no match. */
function termScore(command: SlashCommand, term: string): number | null {
  const label = command.label.toLowerCase();
  if (label.startsWith(term)) return 0;
  if (label.split(/\s+/).some((word) => word.startsWith(term))) return 1;
  if (command.keywords.some((k) => k.startsWith(term))) return 2;
  return null;
}

/** The blocks (and `extra` items, listed after them) matching what was typed after "/", best first (ties keep the list's order). */
export function filterBlockCommands(query: string, extra: SlashCommand[] = []): SlashCommand[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const all: SlashCommand[] = [...BLOCK_COMMANDS, ...extra];
  if (terms.length === 0) return all;
  const scored: { command: SlashCommand; score: number; index: number }[] = [];
  all.forEach((command, index) => {
    let total = 0;
    for (const term of terms) {
      const score = termScore(command, term);
      if (score === null) return;
      total += score;
    }
    scored.push({ command, score: total, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.command);
}
