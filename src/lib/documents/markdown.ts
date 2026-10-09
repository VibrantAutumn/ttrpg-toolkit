import { normalizeInline, parseInline, serializeInline, textNode } from "./inline";
import { hasUnescapedPipe, isRuleRow, parseCell, serializeCell, splitRow } from "./tables";
import type { DocNode, DocRoot } from "./types";

/**
 * Document <-> Markdown. The stored form of a document is Markdown text (so packs and
 * search stay readable); the editor works on the JSON in `types.ts`.
 *
 *  - `markdownToDoc` never throws and never drops text. What it does not understand
 *    (HTML, directives it does not know) is kept whole as a `rawMarkdown` block and written
 *    back unchanged.
 *  - `docToMarkdown` followed by `markdownToDoc` gives the same document back, apart from
 *    the tidying in `normalizeDoc` (e.g. empty paragraphs between blocks are not kept).
 *
 * Line breaks inside a paragraph are real line breaks (the old plain editor stored text
 * that way), and are written as a backslash before the newline so other Markdown viewers
 * show them too.
 *
 * Tables are GFM tables (`| a | b |` with a `| --- | --- |` rule). Layout blocks are
 * "directives": a line of three or more colons and a name opens one, a line of colons closes
 * it, and the opening line has more colons than anything inside it:
 *
 *     ::::columns
 *     :::column
 *     Left
 *     :::
 *     :::column
 *     Right
 *     :::
 *     ::::
 */

const para = (content: DocNode[]): DocNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });

// ---------------------------------------------------------------- reading

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*?)[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)/;
const HTML = /^ {0,3}<(?!\/?(?:strong|b|em|i|del|s)>)[A-Za-z/!?]/i;
const DIRECTIVE_OPEN = /^ {0,3}(:{3,})[ \t]*([A-Za-z][\w-]*)[ \t]*(.*?)[ \t]*$/;
const DIRECTIVE_CLOSE = /^ {0,3}(:{3,})[ \t]*$/;

/** Blocks written as directives; their writing needs a fence longer than anything inside. */
const DIRECTIVES = new Set(["columns", "column", "callout", "toggle", "secret"]);
export const CALLOUT_KINDS = ["info", "tip", "warning", "danger"];
const calloutKind = (kind: unknown) => (CALLOUT_KINDS.includes(String(kind)) ? String(kind) : "info");
/** Who a secret block is for, as one line of text, or null. */
const secretTo = (to: unknown) => String(to ?? "").replace(/\s+/g, " ").trim() || null;

const indentOf = (line: string) => / */.exec(line)?.[0].length ?? 0;
const isBlank = (line: string) => line.trim() === "";

/** Could this line start a block that is allowed to interrupt a paragraph? */
function interruptsParagraph(line: string): boolean {
  if (FENCE.test(line) || HR.test(line) || QUOTE.test(line) || DIRECTIVE_OPEN.test(line)) return true;
  if (ATX.test(line)) return true;
  const m = LIST.exec(line);
  if (m && line.slice(m[0].length).trim() !== "") return !/^\d/.test(m[2]) || /^1[.)]$/.test(m[2]);
  return false;
}

/** Item content must start with a paragraph; the editor's list items require it. */
function itemBlocks(blocks: DocNode[]): DocNode[] {
  return blocks.length > 0 && blocks[0].type === "paragraph" ? blocks : [para([]), ...blocks];
}

/** Content of a `columns` block: loose blocks go together into a column; there is always at least one. */
function groupColumns(blocks: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  let loose: DocNode[] = [];
  const endLoose = () => {
    if (loose.length) out.push({ type: "column", content: loose });
    loose = [];
  };
  for (const b of blocks) {
    if (b.type === "column") {
      endLoose();
      out.push(b);
    } else loose.push(b);
  }
  endLoose();
  return out.length ? out : [{ type: "column", content: [para([])] }];
}

const nonEmpty = (blocks: DocNode[]) => (blocks.length ? blocks : [para([])]);

/** Index after the closing fence of a code block that opens at `lines[at]`. */
function skipFence(lines: string[], at: number): number {
  const open = FENCE.exec(lines[at]) as RegExpExecArray;
  let i = at + 1;
  while (i < lines.length) {
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
    i++;
    if (close && close[1][0] === open[1][0] && close[1].length >= open[1].length) break;
  }
  return i;
}

/** The line that closes a directive opened with `size` colons, or `lines.length` if it never closes. */
function findDirectiveEnd(lines: string[], from: number, size: number): number {
  let i = from;
  while (i < lines.length) {
    if (FENCE.test(lines[i])) {
      i = skipFence(lines, i);
      continue;
    }
    const close = DIRECTIVE_CLOSE.exec(lines[i]);
    if (close && close[1].length >= size) return i;
    i++;
  }
  return lines.length;
}

/** Reads a table that starts at `lines[at]`, or returns null if it is not one. */
function parseTable(lines: string[], at: number): { node: DocNode; next: number } | null {
  if (at + 1 >= lines.length || !hasUnescapedPipe(lines[at]) || !hasUnescapedPipe(lines[at + 1])) return null;
  const header = splitRow(lines[at]);
  if (!isRuleRow(splitRow(lines[at + 1])) || splitRow(lines[at + 1]).length !== header.length) return null;
  const rows = [header];
  let i = at + 2;
  while (i < lines.length && !isBlank(lines[i]) && hasUnescapedPipe(lines[i])) {
    rows.push(splitRow(lines[i]));
    i++;
  }
  const width = header.length;
  const node: DocNode = {
    type: "table",
    content: rows.map((cells, r) => ({
      type: "tableRow",
      content: Array.from({ length: width }, (_, c) => ({
        type: r === 0 ? "tableHeader" : "tableCell",
        content: [para(parseCell(cells[c] ?? ""))],
      })),
    })),
  };
  return { node, next: i };
}

function parseBlocks(lines: string[], inColumns = false): DocNode[] {
  const out: DocNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const end = skipFence(lines, i);
      const closed = end > i + 1 && /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(lines[end - 1]) && end - 1 > i && isClosing(fence[1], lines[end - 1]);
      const body = lines.slice(i + 1, closed ? end - 1 : end);
      const language = fence[2].split(/\s+/)[0] || null;
      const text = body.join("\n");
      out.push({ type: "codeBlock", attrs: { language }, ...(text ? { content: [textNode(text)] } : {}) });
      i = end;
      continue;
    }

    const directive = DIRECTIVE_OPEN.exec(line);
    if (directive) {
      const size = directive[1].length;
      const end = findDirectiveEnd(lines, i + 1, size);
      const inner = lines.slice(i + 1, end);
      const name = directive[2].toLowerCase();
      if (name === "columns" && directive[3] === "") {
        out.push({ type: "columns", content: groupColumns(parseBlocks(inner, true)) });
      } else if (name === "column" && directive[3] === "" && inColumns) {
        out.push({ type: "column", content: nonEmpty(parseBlocks(inner)) });
      } else if (name === "callout" && (directive[3] === "" || CALLOUT_KINDS.includes(directive[3].toLowerCase()))) {
        out.push({ type: "callout", attrs: { kind: calloutKind(directive[3].toLowerCase()) }, content: nonEmpty(parseBlocks(inner)) });
      } else if (name === "toggle") {
        const title = parseInline(directive[3]);
        out.push({ type: "toggle", content: [{ type: "toggleSummary", ...(title.length ? { content: title } : {}) }, ...parseBlocks(inner)] });
      } else if (name === "secret") {
        out.push({ type: "secret", attrs: { to: secretTo(directive[3]) }, content: nonEmpty(parseBlocks(inner)) });
      } else {
        // Not a block this app knows: keep every line, opening and closing included.
        out.push({ type: "rawMarkdown", attrs: { text: lines.slice(i, Math.min(end + 1, lines.length)).join("\n") } });
      }
      i = Math.min(end + 1, lines.length);
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      const text = (atx[2] ?? "").replace(/(^|[ \t]+)#+$/, "");
      const content = parseInline(text.trim());
      out.push({ type: "heading", attrs: { level: atx[1].length }, ...(content.length ? { content } : {}) });
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i++;
      }
      out.push({ type: "blockquote", content: nonEmpty(parseBlocks(inner)) });
      continue;
    }

    if (LIST.test(line)) {
      i = parseList(lines, i, out);
      continue;
    }

    const table = parseTable(lines, i);
    if (table) {
      out.push(table.node);
      i = table.next;
      continue;
    }

    if (HTML.test(line)) {
      const start = i;
      while (i < lines.length && !isBlank(lines[i])) i++;
      out.push({ type: "rawMarkdown", attrs: { text: lines.slice(start, i).join("\n") } });
      continue;
    }

    // A paragraph: lines up to a blank line or a block that may interrupt it.
    const body: string[] = [line.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "")];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !interruptsParagraph(lines[i]) && parseTable(lines, i) === null) {
      body.push(lines[i].replace(/^[ \t]+/, "").replace(/[ \t]+$/, ""));
      i++;
    }
    const content = parseInline(body.join("\n"));
    if (content.length) out.push(para(content));
  }
  return out;
}

/** Does `line` close a code fence that was opened with `open`? */
function isClosing(open: string, line: string): boolean {
  const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!close && close[1][0] === open[0] && close[1].length >= open.length;
}

/** Reads one whole list starting at `lines[start]`; returns the index after it. */
function parseList(lines: string[], start: number, out: DocNode[]): number {
  const firstMatch = LIST.exec(lines[start]) as RegExpExecArray;
  const ordered = /^\d/.test(firstMatch[2]);
  const bulletChar = firstMatch[2];
  const delimiter = ordered ? firstMatch[2].slice(-1) : "";
  const startNumber = ordered ? parseInt(firstMatch[2], 10) : 1;
  const items: DocNode[] = [];
  let i = start;

  for (;;) {
    const m = LIST.exec(lines[i]);
    if (!m) break;
    const sameKind = ordered ? /^\d/.test(m[2]) && m[2].slice(-1) === delimiter : m[2] === bulletChar;
    if (!sameKind) break;

    const rest = lines[i].slice(m[0].length);
    const spaces = m[3].length;
    const contentIndent = m[1].length + m[2].length + (rest === "" || spaces > 4 ? 1 : spaces);
    const itemLines: string[] = [rest];
    if (spaces > 4 && rest !== "") itemLines[0] = " ".repeat(spaces - 1) + rest;
    i++;
    while (i < lines.length) {
      if (isBlank(lines[i])) {
        let k = i;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k < lines.length && indentOf(lines[k]) >= contentIndent) {
          for (; i < k; i++) itemLines.push("");
          continue;
        }
        break;
      }
      if (indentOf(lines[i]) >= contentIndent) {
        itemLines.push(lines[i].slice(contentIndent));
        i++;
      } else break;
    }
    items.push({ type: "listItem", content: itemBlocks(parseBlocks(itemLines)) });

    // The list goes on after blank lines if the next line is another item of the same kind.
    let k = i;
    while (k < lines.length && isBlank(lines[k])) k++;
    if (k < lines.length && LIST.test(lines[k]) && !HR.test(lines[k])) {
      const nm = LIST.exec(lines[k]) as RegExpExecArray;
      const next = ordered ? /^\d/.test(nm[2]) && nm[2].slice(-1) === delimiter : nm[2] === bulletChar;
      if (next) {
        i = k;
        continue;
      }
    }
    break;
  }
  out.push(ordered ? { type: "orderedList", attrs: { start: startNumber }, content: items } : { type: "bulletList", content: items });
  return i;
}

/** Reads Markdown text as a document. Never throws; always returns at least one block. */
export function markdownToDoc(markdown: string): DocRoot {
  const lines = markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\t+/, (tabs) => "    ".repeat(tabs.length)));
  const content = parseBlocks(lines);
  return { type: "doc", content: content.length ? content : [para([])] };
}

// ---------------------------------------------------------------- tidying

/** Tidies a document into the form `markdownToDoc` produces, so two documents can be compared. */
export function normalizeDoc(doc: DocNode): DocRoot {
  const content = normalizeBlocks(doc.content ?? []);
  return { type: "doc", content: content.length ? content : [para([])] };
}

function textOf(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textOf).join("");
}

function normalizeBlocks(blocks: DocNode[], inColumns = false): DocNode[] {
  const out: DocNode[] = [];
  for (const b of blocks) {
    const n = normalizeBlock(b, inColumns);
    if (n) out.push(...n);
  }
  return out;
}

/** The inline content of a table cell: its paragraphs joined by line breaks. */
function cellInline(cell: DocNode): DocNode[] {
  const parts = (cell.content ?? []).map((c) => (c.type === "paragraph" ? (c.content ?? []) : [textNode(textOf(c))]));
  const joined: DocNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) joined.push({ type: "hardBreak" });
    joined.push(...part);
  });
  return normalizeInline(joined);
}

function normalizeTable(b: DocNode): DocNode[] | null {
  const rows = (b.content ?? []).filter((r) => r.type === "tableRow");
  if (rows.length === 0) return null;
  const width = Math.max(1, (rows[0].content ?? []).length);
  return [
    {
      type: "table",
      content: rows.map((row, r) => ({
        type: "tableRow",
        content: Array.from({ length: width }, (_, c) => ({
          type: r === 0 ? "tableHeader" : "tableCell",
          content: [para(cellInline((row.content ?? [])[c] ?? { type: "tableCell" }))],
        })),
      })),
    },
  ];
}

function normalizeBlock(b: DocNode, inColumns: boolean): DocNode[] | null {
  switch (b.type) {
    case "paragraph": {
      const content = normalizeInline(b.content ?? []);
      return content.length ? [para(content)] : null;
    }
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(b.attrs?.level ?? 1) || 1));
      const content = normalizeInline(b.content ?? [], true);
      return [{ type: "heading", attrs: { level }, ...(content.length ? { content } : {}) }];
    }
    case "bulletList":
    case "orderedList": {
      const items = (b.content ?? []).map(normalizeItem);
      if (items.length === 0) return null;
      return b.type === "bulletList"
        ? [{ type: "bulletList", content: items }]
        : [{ type: "orderedList", attrs: { start: Math.max(0, Math.floor(Number(b.attrs?.start ?? 1)) || 1) }, content: items }];
    }
    case "blockquote":
      return [{ type: "blockquote", content: nonEmpty(normalizeBlocks(b.content ?? [])) }];
    case "codeBlock": {
      const text = textOf(b);
      const language = typeof b.attrs?.language === "string" && b.attrs.language ? b.attrs.language : null;
      return [{ type: "codeBlock", attrs: { language }, ...(text ? { content: [textNode(text)] } : {}) }];
    }
    case "horizontalRule":
      return [{ type: "horizontalRule" }];
    case "rawMarkdown":
      return [{ type: "rawMarkdown", attrs: { text: String(b.attrs?.text ?? "") } }];
    case "table":
      return normalizeTable(b);
    case "columns":
      return [{ type: "columns", content: groupColumns(normalizeBlocks(b.content ?? [], true)) }];
    case "column":
      if (!inColumns) return normalizeBlocks(b.content ?? []); // a column only makes sense inside columns
      return [{ type: "column", content: nonEmpty(normalizeBlocks(b.content ?? [])) }];
    case "callout":
      return [{ type: "callout", attrs: { kind: calloutKind(b.attrs?.kind) }, content: nonEmpty(normalizeBlocks(b.content ?? [])) }];
    case "secret":
      return [{ type: "secret", attrs: { to: secretTo(b.attrs?.to) }, content: nonEmpty(normalizeBlocks(b.content ?? [])) }];
    case "toggle": {
      const [first, ...rest] = b.content ?? [];
      const hasSummary = first?.type === "toggleSummary";
      const title = normalizeInline(hasSummary ? (first.content ?? []) : [], true);
      const body = normalizeBlocks(hasSummary ? rest : (b.content ?? []));
      return [{ type: "toggle", content: [{ type: "toggleSummary", ...(title.length ? { content: title } : {}) }, ...body] }];
    }
    default:
      // A node type this converter does not know: keep what it contains.
      return b.content ? normalizeBlocks(b.content) : null;
  }
}

function normalizeItem(item: DocNode): DocNode {
  return { type: "listItem", content: itemBlocks(nonEmpty(normalizeBlocks(item.content ?? []))) };
}

// ---------------------------------------------------------------- writing

const isList = (n: DocNode) => n.type === "bulletList" || n.type === "orderedList";

/**
 * Can this list directly follow a paragraph without a blank line (inside a list item)?
 * Only if it would interrupt the paragraph: a bullet list or an ordered list starting at 1,
 * whose first item is not empty.
 */
function interruptsAParagraph(n: DocNode): boolean {
  const startsOk = n.type === "bulletList" || (n.type === "orderedList" && Number(n.attrs?.start ?? 1) === 1);
  const firstParagraph = n.content?.[0]?.content?.[0];
  return startsOk && (firstParagraph?.content?.length ?? 0) > 0;
}

/** How many colons a directive block must open with: more than anything inside it. */
function fenceSize(node: DocNode): number {
  let inner = 2;
  const visit = (n: DocNode) => {
    if (DIRECTIVES.has(n.type)) inner = Math.max(inner, fenceSize(n));
    else if (n.type === "rawMarkdown") {
      for (const m of String(n.attrs?.text ?? "").matchAll(/^ {0,3}(:{3,})/gm)) inner = Math.max(inner, m[1].length);
    } else (n.content ?? []).forEach(visit);
  };
  (node.content ?? []).forEach(visit);
  return inner + 1;
}

function blocksToLines(blocks: DocNode[], inItem: boolean): string[] {
  const out: string[] = [];
  let prev: DocNode | null = null;
  let alternate = false;
  for (const b of blocks) {
    alternate = prev !== null && prev.type === b.type && isList(b) ? !alternate : false;
    if (prev !== null && !(inItem && prev.type === "paragraph" && isList(b) && interruptsAParagraph(b))) out.push("");
    out.push(...blockToLines(b, alternate));
    prev = b;
  }
  return out;
}

function tableToLines(b: DocNode): string[] {
  const rows = (b.content ?? []).map((row) => (row.content ?? []).map((cell) => serializeCell(cell.content?.[0]?.content ?? [])));
  const width = rows[0]?.length ?? 1;
  const line = (cells: string[]) => "| " + cells.join(" | ") + " |";
  return [line(rows[0] ?? [""]), line(Array.from({ length: width }, () => "---")), ...rows.slice(1).map(line)];
}

function blockToLines(b: DocNode, alternate: boolean): string[] {
  switch (b.type) {
    case "paragraph":
      return serializeInline(b.content ?? []).split("\n");
    case "heading": {
      const text = serializeInline(b.content ?? [], true);
      return ["#".repeat(Number(b.attrs?.level ?? 1)) + (text ? " " + text : "")];
    }
    case "bulletList":
      return (b.content ?? []).flatMap((item) => itemToLines(item, alternate ? "* " : "- "));
    case "orderedList": {
      const start = Number(b.attrs?.start ?? 1);
      return (b.content ?? []).flatMap((item, i) => itemToLines(item, `${start + i}${alternate ? ")" : "."} `));
    }
    case "blockquote":
      return blocksToLines(b.content ?? [], false).map((l) => (l === "" ? ">" : "> " + l));
    case "codeBlock": {
      const text = textOf(b);
      let n = 3;
      for (const m of text.matchAll(/^ {0,3}(`{3,})[ \t]*$/gm)) n = Math.max(n, m[1].length + 1);
      const fence = "`".repeat(n);
      const language = typeof b.attrs?.language === "string" ? b.attrs.language : "";
      return [fence + language, ...(text ? text.split("\n") : []), fence];
    }
    case "horizontalRule":
      return ["---"];
    case "rawMarkdown":
      return String(b.attrs?.text ?? "").split("\n");
    case "table":
      return tableToLines(b);
    case "columns": {
      const fence = ":".repeat(fenceSize(b));
      const columns = (b.content ?? []).map((c) => blockToLines(c, false));
      return [fence + "columns", ...columns.flatMap((lines, i) => (i > 0 ? ["", ...lines] : lines)), fence];
    }
    case "column": {
      const fence = ":".repeat(fenceSize(b));
      return [fence + "column", ...blocksToLines(b.content ?? [], false), fence];
    }
    case "callout": {
      const fence = ":".repeat(fenceSize(b));
      const kind = calloutKind(b.attrs?.kind);
      return [fence + "callout" + (kind === "info" ? "" : " " + kind), ...blocksToLines(b.content ?? [], false), fence];
    }
    case "secret": {
      const fence = ":".repeat(fenceSize(b));
      const to = secretTo(b.attrs?.to);
      return [fence + "secret" + (to ? " " + to : ""), ...blocksToLines(b.content ?? [], false), fence];
    }
    case "toggle": {
      const fence = ":".repeat(fenceSize(b));
      const [first, ...rest] = b.content ?? [];
      const title = first ? serializeInline(first.content ?? [], true) : "";
      return [fence + "toggle" + (title ? " " + title : ""), ...blocksToLines(rest, false), fence];
    }
    default:
      return blocksToLines(normalizeBlocks([b]), false);
  }
}

function itemToLines(item: DocNode, marker: string): string[] {
  const inner = blocksToLines(item.content ?? [], true);
  const indent = " ".repeat(marker.length);
  return inner.map((l, i) => (i === 0 ? (l === "" ? marker.trimEnd() : marker + l) : l === "" ? "" : indent + l));
}

/** Writes a document as Markdown text (no trailing newline). */
export function docToMarkdown(doc: DocNode): string {
  return blocksToLines(normalizeDoc(doc).content, false).join("\n");
}
