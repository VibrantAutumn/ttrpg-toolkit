import { parseInline, serializeInline } from "./inline";
import type { DocNode } from "./types";

/**
 * The text side of Markdown (GFM) tables: splitting a row into cells, and turning one cell's
 * text into inline nodes and back. A cell holds one paragraph; a line break is `<br>`, and a
 * pipe that is part of the text is written `\|` (also inside code, as GFM requires).
 */

/** How many backslashes sit directly before position `i`. */
function backslashesBefore(s: string, i: number): number {
  let n = 0;
  while (i - 1 - n >= 0 && s[i - 1 - n] === "\\") n++;
  return n;
}

/** A `|` that separates cells: not escaped by a backslash. */
const isSeparator = (s: string, i: number) => s[i] === "|" && backslashesBefore(s, i) % 2 === 0;

export function hasUnescapedPipe(line: string): boolean {
  for (let i = 0; i < line.length; i++) if (isSeparator(line, i)) return true;
  return false;
}

/** The text of each cell in one row; outer pipes are optional. */
export function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const body = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    if (isSeparator(body, i)) {
      cells.push(current);
      current = "";
    } else current += body[i];
  }
  cells.push(current);
  const endsWithPipe = body.length > 0 && isSeparator(body, body.length - 1);
  if (endsWithPipe && cells.length > 1) cells.pop();
  return cells.map((c) => c.trim());
}

/** Is this the `---|:---:` row under the header? */
export function isRuleRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** `<br>` (not escaped) becomes a line break; `\|` becomes `|`. */
function prepareCell(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const br = /^<br\s*\/?>/i.exec(text.slice(i, i + 8));
    if (br && backslashesBefore(text, i) % 2 === 0) {
      out += "\n";
      i += br[0].length;
    } else {
      out += text[i];
      i++;
    }
  }
  return out.replace(/\\\|/g, "|");
}

export function parseCell(text: string): DocNode[] {
  return parseInline(prepareCell(text));
}

/** One cell's inline nodes as text that is safe inside a table row. */
export function serializeCell(content: DocNode[]): string {
  const text = serializeInline(content).split("\\\n").join("<br>");
  let out = "";
  for (const c of text) out += c === "|" && !out.endsWith("\\") ? "\\|" : c;
  return out;
}
