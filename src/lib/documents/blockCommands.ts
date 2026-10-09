/**
 * The blocks offered by the "/" menu (and the editor's block-type picker). This is only
 * the list and the typing filter; what each one does to the editor lives in the module,
 * so the list can be tested without an editor.
 */
export type BlockCommandId = "text" | "h1" | "h2" | "h3" | "h4" | "bullet" | "ordered" | "quote" | "code" | "divider" | "table" | "columns2" | "columns3";

export interface BlockCommand {
  id: BlockCommandId;
  label: string;
  hint: string;
  /** Other words someone might type to find it. */
  keywords: string[];
}

export const BLOCK_COMMANDS: BlockCommand[] = [
  { id: "text", label: "Text", hint: "Plain paragraph", keywords: ["paragraph", "plain", "normal"] },
  { id: "h1", label: "Heading 1", hint: "Big section title", keywords: ["title", "h1"] },
  { id: "h2", label: "Heading 2", hint: "Medium section title", keywords: ["subtitle", "h2"] },
  { id: "h3", label: "Heading 3", hint: "Small section title", keywords: ["h3"] },
  { id: "h4", label: "Heading 4", hint: "Smallest section title", keywords: ["h4"] },
  { id: "bullet", label: "Bulleted list", hint: "A simple list", keywords: ["ul", "unordered", "points"] },
  { id: "ordered", label: "Numbered list", hint: "A list with numbers", keywords: ["ol", "ordered", "steps"] },
  { id: "quote", label: "Quote", hint: "Set text apart", keywords: ["blockquote", "callout"] },
  { id: "code", label: "Code block", hint: "Text kept exactly as typed", keywords: ["monospace", "pre"] },
  { id: "table", label: "Table", hint: "Rows and columns of text", keywords: ["grid", "rows", "spreadsheet"] },
  { id: "columns2", label: "2 columns", hint: "Side by side", keywords: ["column", "layout", "split"] },
  { id: "columns3", label: "3 columns", hint: "Three side by side", keywords: ["column", "layout"] },
  { id: "divider", label: "Divider", hint: "A line across the page", keywords: ["rule", "hr", "line", "separator"] },
];

/** How well one typed word fits a command, lower is better; null = no match. */
function termScore(command: BlockCommand, term: string): number | null {
  const label = command.label.toLowerCase();
  if (label.startsWith(term)) return 0;
  if (label.split(/\s+/).some((word) => word.startsWith(term))) return 1;
  if (command.keywords.some((k) => k.startsWith(term))) return 2;
  return null;
}

/** The blocks matching what was typed after "/", best first (ties keep the list's order). */
export function filterBlockCommands(query: string): BlockCommand[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...BLOCK_COMMANDS];
  const scored: { command: BlockCommand; score: number; index: number }[] = [];
  BLOCK_COMMANDS.forEach((command, index) => {
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
