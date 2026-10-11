import type { Calendar } from "./definition";
import { formatDateTime, type DateTime } from "./math";

/**
 * "Save to session": a result (a roll, a draw, an encounter's outcome) is added to the end of the current
 * session's log page as a dated entry. The log is an ordinary page, so the entry is plain Markdown:
 * the in-game moment in bold, a dash, then the text (line breaks stay line breaks).
 */
export function logEntry(calendar: Calendar, at: DateTime, text: string, title?: string): string {
  // The page editor writes a line break inside a paragraph as a backslash and a newline, so that is how it is stored.
  const clean = text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\\\n"),
    )
    .join("\n\n");
  const head = formatDateTime(calendar, at);
  const label = title && title.trim() !== "" ? `${head} · ${title.trim()}` : head;
  return `**${label}** — ${clean}`;
}

/** Adds an entry after what the log already says, with a blank line between entries. */
export function appendEntry(body: string, entry: string): string {
  const existing = body.replace(/\s+$/, "");
  return existing === "" ? `${entry}\n` : `${existing}\n\n${entry}\n`;
}
