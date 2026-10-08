import type { CommandDefinition } from "../registry/types";

/**
 * How well one search word fits a command, lower is better; null = no match.
 * Label start (0) beats the start of a later word in the label (1), which beats
 * anywhere in the label (2), which beats a keyword (3).
 */
function termScore(command: CommandDefinition, term: string): number | null {
  const label = command.label.toLowerCase();
  if (label.startsWith(term)) return 0;
  if (label.split(/\s+/).some((word) => word.startsWith(term))) return 1;
  if (label.includes(term)) return 2;
  if (command.keywords?.some((k) => k.toLowerCase().includes(term))) return 3;
  return null;
}

/**
 * The commands matching what was typed, best first. Every word typed must match
 * (in the label or keywords). An empty query returns every command alphabetically.
 */
export function matchCommands(
  commands: CommandDefinition[],
  query: string,
): CommandDefinition[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { command: CommandDefinition; score: number }[] = [];
  for (const command of commands) {
    let total = 0;
    let matches = true;
    for (const term of terms) {
      const score = termScore(command, term);
      if (score === null) {
        matches = false;
        break;
      }
      total += score;
    }
    if (matches) scored.push({ command, score: total });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.command.label.localeCompare(b.command.label))
    .map((s) => s.command);
}
