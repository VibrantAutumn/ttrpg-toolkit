import { normalizeInline, parseInline, serializeInline, textNode } from "./inline";
import type { DocNode, DocRoot } from "./types";

/**
 * Document <-> Markdown. The stored form of a document is Markdown text (so packs and
 * search stay readable); the editor works on the JSON in `types.ts`.
 *
 *  - `markdownToDoc` never throws and never drops text. What it does not understand
 *    (tables, HTML) is kept whole as a `rawMarkdown` block and written back unchanged.
 *  - `docToMarkdown` followed by `markdownToDoc` gives the same document back, apart from
 *    the tidying in `normalizeDoc` (e.g. empty paragraphs between blocks are not kept).
 *
 * Line breaks inside a paragraph are real line breaks (the old plain editor stored text
 * that way), and are written as a backslash before the newline so other Markdown viewers
 * show them too.
 */

const para = (content: DocNode[]): DocNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });

// ---------------------------------------------------------------- reading

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*?)[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+|$)/;
const HTML = /^ {0,3}<(?!\/?(?:strong|b|em|i|del|s)>)[A-Za-z/!?]/i;
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const indentOf = (line: string) => /^ */.exec(line)?.[0].length ?? 0;
const isBlank = (line: string) => line.trim() === "";

/** Could this line start a block that is allowed to interrupt a paragraph? */
function interruptsParagraph(line: string): boolean {
  if (FENCE.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  if (ATX.test(line)) return true;
  const m = LIST.exec(line);
  if (m && line.slice(m[0].length).trim() !== "") return !/^\d/.test(m[2]) || /^1[.)]$/.test(m[2]);
  return false;
}

function isTableStart(lines: string[], i: number): boolean {
  const unescapedPipe = /(^|[^\\])\|/;
  return (
    i + 1 < lines.length &&
    unescapedPipe.test(lines[i]) &&
    unescapedPipe.test(lines[i + 1]) &&
    lines[i + 1].includes("-") &&
    TABLE_RULE.test(lines[i + 1])
  );
}

/** Item content must start with a paragraph; the editor's list items require it. */
function itemBlocks(blocks: DocNode[]): DocNode[] {
  return blocks.length > 0 && blocks[0].type === "paragraph" ? blocks : [para([]), ...blocks];
}

function parseBlocks(lines: string[]): DocNode[] {
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
      const mark = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (close && close[1][0] === mark[0] && close[1].length >= mark.length) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      const language = fence[2].split(/\s+/)[0] || null;
      const text = body.join("\n");
      out.push({ type: "codeBlock", attrs: { language }, ...(text ? { content: [textNode(text)] } : {}) });
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
      const content = parseBlocks(inner);
      out.push({ type: "blockquote", content: content.length ? content : [para([])] });
      continue;
    }

    const first = LIST.exec(line);
    if (first) {
      i = parseList(lines, i, out);
      continue;
    }

    if (HTML.test(line) || isTableStart(lines, i)) {
      const start = i;
      while (i < lines.length && !isBlank(lines[i])) i++;
      out.push({ type: "rawMarkdown", attrs: { text: lines.slice(start, i).join("\n") } });
      continue;
    }

    // A paragraph: lines up to a blank line or a block that may interrupt it.
    const body: string[] = [line.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "")];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !interruptsParagraph(lines[i])) {
      body.push(lines[i].replace(/^[ \t]+/, "").replace(/[ \t]+$/, ""));
      i++;
    }
    const content = parseInline(body.join("\n"));
    if (content.length) out.push(para(content));
  }
  return out;
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
    const itemLines: string[] = [rest === "" ? "" : rest + ""];
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

function normalizeBlocks(blocks: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  for (const b of blocks) {
    const n = normalizeBlock(b);
    if (n) out.push(...n);
  }
  return out;
}

function normalizeBlock(b: DocNode): DocNode[] | null {
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
    case "blockquote": {
      const content = normalizeBlocks(b.content ?? []);
      return [{ type: "blockquote", content: content.length ? content : [para([])] }];
    }
    case "codeBlock": {
      const text = textOf(b);
      const language = typeof b.attrs?.language === "string" && b.attrs.language ? b.attrs.language : null;
      return [{ type: "codeBlock", attrs: { language }, ...(text ? { content: [textNode(text)] } : {}) }];
    }
    case "horizontalRule":
      return [{ type: "horizontalRule" }];
    case "rawMarkdown":
      return [{ type: "rawMarkdown", attrs: { text: String(b.attrs?.text ?? "") } }];
    default:
      // A node type this converter does not know: keep what it contains.
      return b.content ? normalizeBlocks(b.content) : null;
  }
}

function normalizeItem(item: DocNode): DocNode {
  let blocks = normalizeBlocks(item.content ?? []);
  blocks = blocks.length > 0 ? blocks : [para([])];
  return { type: "listItem", content: itemBlocks(blocks) };
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
  return blocksToLines(normalizeDoc(doc).content ?? [], false).join("\n");
}
