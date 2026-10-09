import { itemHref, itemIdFromHref } from "./mentions";
import type { DocMark, DocNode } from "./types";

/**
 * Inline Markdown (emphasis, code, links, line breaks) <-> text nodes with marks.
 *
 * Two promises:
 *  - Reading never throws and never drops text: anything not understood stays as text.
 *  - Text written by `serializeInline` reads back as the same nodes (after
 *    `normalizeInline`, which tidies things Markdown cannot say, like bold
 *    around a trailing space).
 */

const MARK_ORDER = ["link", "bold", "italic", "strike", "code"];
const EMPHASIS = new Set(["bold", "italic", "strike"]);

const ASCII_PUNCT = /^[!-/:-@[-`{-~]$/;
const isWs = (c: string) => /^\s$/.test(c);
const isAlnum = (c: string) => /^[\p{L}\p{N}]$/u.test(c);

export const markKey = (m: DocMark): string => (m.type === "link" ? `link:${String(m.attrs?.href ?? "")}` : m.type);

/** Marks without duplicates, in one fixed order (so two nodes with the same marks compare equal). */
export function sortMarks(marks: DocMark[]): DocMark[] {
  const seen = new Set<string>();
  const unique = marks.filter((m) => {
    const key = markKey(m);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rank = (m: DocMark) => {
    const r = MARK_ORDER.indexOf(m.type);
    return r < 0 ? MARK_ORDER.length : r;
  };
  // Only the address matters for a link; the editor adds attributes (target, rel) that Markdown cannot hold.
  const canonical = unique.map((m): DocMark => (m.type === "link" ? { type: "link", attrs: { href: String(m.attrs?.href ?? "") } } : { type: m.type }));
  return canonical.sort((a, b) => rank(a) - rank(b) || markKey(a).localeCompare(markKey(b)));
}

export function textNode(text: string, marks: DocMark[] = []): DocNode {
  const sorted = sortMarks(marks);
  return sorted.length ? { type: "text", text, marks: sorted } : { type: "text", text };
}

/** A mention in its one form: a plain one-line label, an id in lower case, emphasis marks only. */
function cleanMention(n: DocNode): DocNode {
  const label = String(n.attrs?.label ?? "").replace(/\s+/g, " ").trim() || "Untitled";
  const marks = sortMarks((n.marks ?? []).filter((m) => EMPHASIS.has(m.type)));
  return { type: "mention", attrs: { id: String(n.attrs?.id ?? "").toLowerCase(), label }, ...(marks.length ? { marks } : {}) };
}

const hasMark = (n: DocNode, type: string) => (n.marks ?? []).some((m) => m.type === type);
const marksKey = (n: DocNode) => (n.marks ?? []).map(markKey).sort().join("|");

// ---------------------------------------------------------------- reading

type Delim = { k: "delim"; ch: string; n: number; orig: number; open: boolean; close: boolean };
type Atom =
  | { k: "text"; s: string }
  | { k: "code"; s: string }
  | { k: "br" }
  | { k: "link"; href: string; children: DocNode[] }
  | Delim
  | { k: "tag"; mark: string; closing: boolean; raw: string }
  | { k: "wrap"; mark: DocMark; children: Atom[] };

/** The few HTML tags read as emphasis. Writing uses them when `*` and `_` would be ambiguous. */
const TAG = /^<(\/?)(strong|b|em|i|del|s)>/i;
const TAG_MARK: Record<string, string> = { strong: "bold", b: "bold", em: "italic", i: "italic", del: "strike", s: "strike" };

/** Index of the `]` that closes the `[` at `start`, or -1. Skips escapes and code spans. */
function findBracketEnd(src: string, start: number): number {
  let depth = 1;
  for (let j = start + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === "`") {
      let n = 1;
      while (src[j + n] === "`") n++;
      const close = findCodeEnd(src, j + n, n);
      j = close >= 0 ? close + n - 1 : j + n - 1;
    } else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return j;
  }
  return -1;
}

/** Index of the next run of exactly `n` backticks at or after `from`, or -1. */
function findCodeEnd(src: string, from: number, n: number): number {
  let j = from;
  while (j < src.length) {
    if (src[j] !== "`") {
      j++;
      continue;
    }
    let m = 0;
    while (src[j + m] === "`") m++;
    if (m === n) return j;
    j += m;
  }
  return -1;
}

/** Reads `address "optional title")` starting just after the `(`. */
function parseDestination(src: string, from: number): { href: string; end: number } | null {
  let j = from;
  while (src[j] === " " || src[j] === "\t") j++;
  let href = "";
  if (src[j] === "<") {
    j++;
    for (;;) {
      const c = src[j];
      if (c === undefined || c === "\n" || c === "<") return null;
      if (c === ">") {
        j++;
        break;
      }
      if (c === "\\" && src[j + 1] !== undefined && ASCII_PUNCT.test(src[j + 1])) {
        href += src[j + 1];
        j += 2;
      } else {
        href += c;
        j++;
      }
    }
  } else {
    let depth = 0;
    for (;;) {
      const c = src[j];
      if (c === undefined || isWs(c)) break;
      if (c === "\\" && src[j + 1] !== undefined && ASCII_PUNCT.test(src[j + 1])) {
        href += src[j + 1];
        j += 2;
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") {
        if (depth === 0) break;
        depth--;
      }
      href += c;
      j++;
    }
    if (depth !== 0) return null;
  }
  while (src[j] === " " || src[j] === "\t") j++;
  const quote = src[j];
  if (quote === '"' || quote === "'") {
    let k = j + 1;
    while (k < src.length && src[k] !== quote) k += src[k] === "\\" ? 2 : 1;
    if (k >= src.length) return null;
    j = k + 1;
    while (src[j] === " " || src[j] === "\t") j++;
  }
  return src[j] === ")" ? { href, end: j + 1 } : null;
}

function scan(src: string): Atom[] {
  const atoms: Atom[] = [];
  let buf = "";
  const flush = () => {
    if (buf) atoms.push({ k: "text", s: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        flush();
        atoms.push({ k: "br" });
        i += 2;
      } else if (next !== undefined && ASCII_PUNCT.test(next)) {
        buf += next;
        i += 2;
      } else {
        buf += c;
        i++;
      }
    } else if (c === "\n") {
      flush();
      atoms.push({ k: "br" });
      i++;
    } else if (c === "`") {
      let n = 1;
      while (src[i + n] === "`") n++;
      const end = findCodeEnd(src, i + n, n);
      if (end < 0) {
        buf += "`".repeat(n);
        i += n;
      } else {
        let s = src.slice(i + n, end).replace(/\n/g, " ");
        if (s.length >= 2 && s.startsWith(" ") && s.endsWith(" ") && s.trim() !== "") s = s.slice(1, -1);
        flush();
        atoms.push({ k: "code", s });
        i = end + n;
      }
    } else if (c === "[") {
      const close = findBracketEnd(src, i);
      const dest = close > 0 && src[close + 1] === "(" ? parseDestination(src, close + 2) : null;
      const children = dest ? stripLinks(readInline(src.slice(i + 1, close))) : [];
      if (dest && children.length > 0) {
        flush();
        atoms.push({ k: "link", href: dest.href, children });
        i = dest.end;
      } else {
        buf += c;
        i++;
      }
    } else if (c === "<") {
      const tag = TAG.exec(src.slice(i, i + 12));
      if (tag) {
        flush();
        atoms.push({ k: "tag", mark: TAG_MARK[tag[2].toLowerCase()], closing: tag[1] === "/", raw: tag[0] });
        i += tag[0].length;
      } else {
        buf += c;
        i++;
      }
    } else if (c === "*" || c === "_" || c === "~") {
      let n = 1;
      while (src[i + n] === c) n++;
      if (c === "~" && n !== 2) {
        buf += c.repeat(n);
        i += n;
        continue;
      }
      const prev = i > 0 ? src[i - 1] : "";
      const next = src[i + n] ?? "";
      // Deliberately a little looser than CommonMark: a run opens when text follows it
      // and closes when text precedes it, so what `serializeInline` writes always reads back.
      let open = next !== "" && !isWs(next);
      let close = prev !== "" && !isWs(prev);
      if (c === "_") {
        open = open && !isAlnum(prev);
        close = close && !isAlnum(next);
      }
      flush();
      atoms.push({ k: "delim", ch: c, n, orig: n, open, close });
      i += n;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return atoms;
}

/**
 * CommonMark's "rule of 3": when either run could both open and close, the two runs only
 * match if their original lengths do not add up to a multiple of 3 (unless both are).
 */
function blockedByRuleOfThree(opener: Delim, closer: Delim): boolean {
  if (!(opener.open && opener.close) && !(closer.open && closer.close)) return false;
  const sum = opener.orig + closer.orig;
  return sum % 3 === 0 && !(opener.orig % 3 === 0 && closer.orig % 3 === 0);
}

/** Matches closing delimiters with opening ones (the CommonMark "delimiter stack" idea). */
function resolveEmphasis(items: Atom[]): Atom[] {
  let c = 0;
  while (c < items.length) {
    const closer = items[c];
    if (closer.k !== "delim" || !closer.close) {
      c++;
      continue;
    }
    let o = c - 1;
    while (o >= 0) {
      const it = items[o];
      if (it.k === "delim" && it.ch === closer.ch && it.open && it.n > 0 && !blockedByRuleOfThree(it, closer)) break;
      o--;
    }
    if (o < 0) {
      c++;
      continue;
    }
    const opener = items[o] as Delim;
    const use = closer.ch === "~" ? 2 : opener.n >= 2 && closer.n >= 2 ? 2 : 1;
    const mark: DocMark = { type: closer.ch === "~" ? "strike" : use === 2 ? "bold" : "italic" };
    const inner = items.slice(o + 1, c);
    opener.n -= use;
    closer.n -= use;
    items.splice(o + 1, c - o - 1, { k: "wrap", mark, children: inner });
    c = o + 2;
    if (opener.n === 0) {
      items.splice(o, 1);
      c--;
    }
    if (closer.n === 0) items.splice(c, 1);
  }
  return items;
}

function flatten(items: Atom[], marks: DocMark[], out: DocNode[]): void {
  for (const it of items) {
    switch (it.k) {
      case "text":
        out.push(textNode(it.s, marks));
        break;
      case "code":
        out.push(textNode(it.s, [...marks, { type: "code" }]));
        break;
      case "br":
        out.push({ type: "hardBreak" });
        break;
      case "delim":
        if (it.n > 0) out.push(textNode(it.ch.repeat(it.n), marks));
        break;
      case "link": {
        const itemId = itemIdFromHref(it.href);
        if (itemId) {
          const label = it.children.map((c) => (c.type === "text" ? (c.text ?? "") : c.type === "mention" ? String(c.attrs?.label ?? "") : "")).join("");
          out.push(cleanMention({ type: "mention", attrs: { id: itemId, label }, marks }));
          break;
        }
        for (const child of it.children) {
          if (child.type === "text") {
            out.push(textNode(child.text ?? "", [...marks, ...(child.marks ?? []), { type: "link", attrs: { href: it.href } }]));
          } else out.push(child);
        }
        break;
      }
      case "tag":
        out.push(textNode(it.raw, marks)); // a tag with no partner is just text
        break;
      case "wrap":
        flatten(it.children, [...marks, it.mark], out);
        break;
    }
  }
}

const stripLinks = (nodes: DocNode[]): DocNode[] =>
  nodes.map((n) => (n.marks ? { ...n, marks: n.marks.filter((m) => m.type !== "link") } : n));

/**
 * Pairs `<em>`-style tags (nearest open tag of the same kind), then resolves `*`/`_`/`~~`
 * inside each pair and in what is left. A tag with no partner stays as the text it was.
 */
function resolveAll(items: Atom[]): Atom[] {
  const stack: { index: number; mark: string }[] = [];
  const out: Atom[] = [];
  for (const it of items) {
    if (it.k === "tag" && !it.closing) {
      stack.push({ index: out.length, mark: it.mark });
      out.push(it);
    } else if (it.k === "tag") {
      let s = stack.length - 1;
      while (s >= 0 && stack[s].mark !== it.mark) s--;
      if (s < 0) {
        out.push({ k: "text", s: it.raw });
        continue;
      }
      const { index } = stack[s];
      stack.length = s; // tags opened inside the pair are left as text
      const inner = out.splice(index + 1);
      out.pop(); // the opening tag
      out.push({ k: "wrap", mark: { type: it.mark }, children: resolveAll(inner) });
    } else out.push(it);
  }
  return resolveEmphasis(out);
}

function readInline(src: string): DocNode[] {
  const out: DocNode[] = [];
  flatten(resolveAll(scan(src)), [], out);
  return out;
}

/** Reads the inline Markdown of one paragraph or heading (line breaks are "\n"). */
export function parseInline(src: string): DocNode[] {
  return normalizeInline(readInline(src));
}

// ---------------------------------------------------------------- tidying

const leadingWs = /^\s+/;
const trailingWs = /\s+$/;

/**
 * Puts inline nodes in the one form Markdown can express and the reader produces:
 * no empty text, equal neighbours merged, marks in a fixed order, emphasis never
 * touching a space at its edge, no spaces at the edges of a line, one line break
 * at a time and none at the start or end.
 */
export function normalizeInline(nodes: DocNode[], inHeading = false): DocNode[] {
  let cur = nodes.map((n) => (inHeading && n.type === "hardBreak" ? textNode(" ") : n));
  for (let round = 0; round < 6; round++) {
    const next = tidyOnce(cur);
    if (JSON.stringify(next) === JSON.stringify(cur)) return next;
    cur = next;
  }
  return cur;
}

function tidyOnce(input: DocNode[]): DocNode[] {
  // Marks in order; code made only of spaces is just spaces.
  let nodes: DocNode[] = [];
  for (const n of input) {
    if (n.type === "mention") {
      nodes.push(cleanMention(n));
      continue;
    }
    if (n.type !== "text") {
      nodes.push(n);
      continue;
    }
    if (!n.text) continue;
    let marks = n.marks ?? [];
    if (hasMark(n, "code") && n.text.trim() === "") marks = marks.filter((m) => m.type !== "code");
    nodes.push(textNode(n.text, marks));
  }

  // Emphasis cannot start or end with a space (`** x**` is not bold). Spaces at the edge of a
  // piece of emphasised text are written without the emphasis; on screen nothing changes.
  const split: DocNode[] = [];
  for (const n of nodes) {
    if (n.type !== "text" || hasMark(n, "code") || !(n.marks ?? []).some((m) => EMPHASIS.has(m.type))) {
      split.push(n);
      continue;
    }
    const text = n.text ?? "";
    const lead = leadingWs.exec(text)?.[0] ?? "";
    const rest = text.slice(lead.length);
    const trail = rest ? (trailingWs.exec(rest)?.[0] ?? "") : "";
    const core = rest.slice(0, rest.length - trail.length);
    const plain = (n.marks ?? []).filter((m) => !EMPHASIS.has(m.type));
    if (!core) {
      split.push(textNode(text, plain));
      continue;
    }
    if (lead) split.push(textNode(lead, plain));
    split.push(textNode(core, n.marks ?? []));
    if (trail) split.push(textNode(trail, plain));
  }
  nodes = split;

  // Line breaks: none at the ends, never two in a row.
  const cleaned: DocNode[] = [];
  for (const n of nodes) {
    if (n.type === "hardBreak" && (cleaned.length === 0 || cleaned[cleaned.length - 1].type === "hardBreak")) continue;
    cleaned.push(n);
  }
  while (cleaned.length && cleaned[cleaned.length - 1].type === "hardBreak") cleaned.pop();
  nodes = cleaned;

  // Spaces and tabs at the start and end of every line.
  const lines: DocNode[][] = [[]];
  for (const n of nodes) {
    if (n.type === "hardBreak") lines.push([]);
    else lines[lines.length - 1].push(n);
  }
  const trimmed = lines.map((line) => {
    const out = [...line];
    while (out.length && out[0].type === "text" && !hasMark(out[0], "code")) {
      const text = (out[0].text ?? "").replace(/^[ \t]+/, "");
      if (text === (out[0].text ?? "")) break;
      if (text) out[0] = textNode(text, out[0].marks);
      else out.shift();
    }
    while (out.length && out[out.length - 1].type === "text" && !hasMark(out[out.length - 1], "code")) {
      const last = out[out.length - 1];
      const text = (last.text ?? "").replace(/[ \t]+$/, "");
      if (text === (last.text ?? "")) break;
      if (text) out[out.length - 1] = textNode(text, last.marks);
      else out.pop();
    }
    return out;
  });
  const flat: DocNode[] = [];
  trimmed.forEach((line, i) => {
    if (i > 0 && line.length > 0 && flat.length > 0) flat.push({ type: "hardBreak" });
    flat.push(...line);
  });

  // Merge neighbours with the same marks.
  const merged: DocNode[] = [];
  for (const n of flat) {
    const last = merged[merged.length - 1];
    if (last && last.type === "text" && n.type === "text" && marksKey(last) === marksKey(n)) {
      merged[merged.length - 1] = textNode((last.text ?? "") + (n.text ?? ""), last.marks);
    } else merged.push(n);
  }
  return merged;
}

// ---------------------------------------------------------------- writing

/** Characters that must be written with a backslash in ordinary text. */
function escapeText(text: string, atLineStart: boolean, inHeading: boolean): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" || c === "*" || c === "`" || c === "[" || c === "]" || c === "~" || c === "|") out += "\\" + c;
    else if (c === "_") {
      const bothSidesWord = i > 0 && i < text.length - 1 && isAlnum(text[i - 1]) && isAlnum(text[i + 1]);
      out += bothSidesWord ? c : "\\" + c;
    } else if (c === "#" && inHeading) out += "\\#";
    else if (c === "<" && /^<\/?(strong|b|em|i|del|s)>/i.test(text.slice(i, i + 12))) out += "\\<"; // would read as a tag
    else out += c;
  }
  if (atLineStart) out = escapeLineStart(text, out);
  return out;
}

/** Escapes a line start that would otherwise read as a heading, list, quote, rule or similar. */
function escapeLineStart(raw: string, escaped: string): string {
  if (/^<(?=[A-Za-z/!?])/.test(raw)) return escaped.startsWith("\\<") ? escaped : "\\" + escaped; // maybe already escaped as a tag
  if (/^#{1,6}([ \t]|$)/.test(raw) || /^>/.test(raw)) return "\\" + escaped;
  // A dash at the start can make a list item or a rule (and after a list marker, "- --" is a rule too).
  if (/^-([- \t]|$)/.test(raw) || /^\+([ \t]|$)/.test(raw)) return "\\" + escaped;
  if (/^:::/.test(raw)) return "\\" + escaped;
  const ordered = /^(\d{1,9})([.)])([ \t]|$)/.exec(raw);
  if (ordered) return ordered[1] + "\\" + escaped.slice(ordered[1].length);
  return escaped;
}

function codeSpan(text: string): string {
  const runs = new Set<number>();
  for (const m of text.matchAll(/`+/g)) runs.add(m[0].length);
  let n = 1;
  while (runs.has(n)) n++;
  const fence = "`".repeat(n);
  const pad = /^[ `]|[ `]$/.test(text) ? " " : "";
  return fence + pad + text + pad + fence;
}

function destination(href: string): string {
  if (href === "" || /[\s<>\u0000-\u001f]/.test(href)) {
    return "<" + href.replace(/\n/g, "%0A").replace(/[\\<>]/g, (m) => "\\" + m) + ">";
  }
  return href.replace(/[\\()]/g, (m) => "\\" + m);
}

/** Italic is a placeholder here; `resolveItalics` picks `_` or `*` once the neighbours are known. */
type Piece = string | { italic: "open" | "close" };
const TAG_NAME: Record<string, string> = { bold: "strong", italic: "em", strike: "del" };
const openToken = (m: DocMark, tags: boolean): Piece =>
  m.type === "link" ? "[" : tags ? `<${TAG_NAME[m.type]}>` : m.type === "bold" ? "**" : m.type === "italic" ? { italic: "open" } : "~~";
const closeToken = (m: DocMark, tags: boolean): Piece =>
  m.type === "link"
    ? `](${destination(String(m.attrs?.href ?? ""))})`
    : tags
      ? `</${TAG_NAME[m.type]}>`
      : m.type === "bold"
        ? "**"
        : m.type === "italic"
          ? { italic: "close" }
          : "~~";

/**
 * Italic is written with `_` (it can never be confused with the `**` of bold), except where
 * a word letter touches it from outside (`a*b*c`), where only `*` is read as emphasis.
 */
function resolveItalics(pieces: Piece[]): string {
  const open: number[] = [];
  const useStar = new Map<number, boolean>();
  const wordChar = (s: string | undefined) => s !== undefined && s !== "" && isAlnum(s);
  const lastCharBefore = (i: number): string | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      const p = pieces[j];
      if (typeof p === "string" && p !== "") return p[p.length - 1];
      if (typeof p !== "string") return "_";
    }
    return undefined;
  };
  const firstCharAfter = (i: number): string | undefined => {
    for (let j = i + 1; j < pieces.length; j++) {
      const p = pieces[j];
      if (typeof p === "string" && p !== "") return p[0];
      if (typeof p !== "string") return "_";
    }
    return undefined;
  };
  pieces.forEach((p, i) => {
    if (typeof p === "string") return;
    if (p.italic === "open") open.push(i);
    else {
      const o = open.pop();
      if (o === undefined) return;
      const star = wordChar(lastCharBefore(o)) || wordChar(firstCharAfter(i));
      useStar.set(o, star);
      useStar.set(i, star);
    }
  });
  return pieces.map((p, i) => (typeof p === "string" ? p : useStar.get(i) ? "*" : "_")).join("");
}

/**
 * Writes inline nodes as one string; line breaks become a backslash and a newline.
 *
 * Some combinations of marks next to punctuation are ambiguous in Markdown itself, so the
 * result is read back and compared. If it does not match, the marks are written one
 * piece at a time, and then with <strong>/<em>/<del> tags (valid in Markdown, and never
 * ambiguous). Only if even that fails is the emphasis dropped rather than letting the
 * text change; the tests make sure that does not happen.
 */
export function serializeInline(input: DocNode[], inHeading = false): string {
  const nodes = normalizeInline(input, inHeading);
  const same = (text: string) => JSON.stringify(normalizeInline(readInline(text), inHeading)) === JSON.stringify(nodes);
  for (const mode of ["nested", "isolated", "tags"] as const) {
    const text = emitInline(nodes, inHeading, mode);
    if (same(text)) return text;
  }
  const plain = nodes.map((n) => (n.type === "text" ? textNode(n.text ?? "", (n.marks ?? []).filter((m) => !EMPHASIS.has(m.type))) : n));
  return emitInline(normalizeInline(plain, inHeading), inHeading, "isolated");
}

type EmitMode = "nested" | "isolated" | "tags";

function emitInline(nodes: DocNode[], inHeading: boolean, mode: EmitMode): string {
  const isolated = mode === "isolated";
  const tags = mode === "tags";
  const out: Piece[] = [];
  const stack: DocMark[] = [];
  let lineStart = true;

  const closeDownTo = (height: number) => {
    while (stack.length > height) out.push(closeToken(stack.pop() as DocMark, tags));
  };

  /** How many of the following nodes (up to the next line break) carry this mark. */
  const run = (from: number, key: string) => {
    let len = 0;
    for (let j = from; j < nodes.length && (nodes[j].type === "text" || nodes[j].type === "mention") && (nodes[j].marks ?? []).some((m) => markKey(m) === key); j++) len++;
    return len;
  };

  nodes.forEach((node, idx) => {
    if (node.type === "hardBreak") {
      closeDownTo(0);
      out.push("\\\n");
      lineStart = true;
      return;
    }
    if (isolated) closeDownTo(0);
    const wanted = (node.marks ?? []).filter((m) => m.type !== "code");
    const wantedKeys = new Set(wanted.map(markKey));
    const firstWrong = stack.findIndex((m) => !wantedKeys.has(markKey(m)));
    if (firstWrong >= 0) closeDownTo(firstWrong);
    const have = new Set(stack.map(markKey));
    const toOpen = wanted
      .filter((m) => !have.has(markKey(m)))
      .map((m) => ({ m, len: run(idx, markKey(m)) }))
      .sort((a, b) => b.len - a.len || MARK_ORDER.indexOf(a.m.type) - MARK_ORDER.indexOf(b.m.type));
    let opened = false;
    for (const { m } of toOpen) {
      out.push(openToken(m, tags));
      stack.push(m);
      opened = true;
    }
    const text = node.text ?? "";
    if (node.type === "mention") out.push(`[${escapeText(String(node.attrs?.label ?? ""), false, false)}](${itemHref(String(node.attrs?.id ?? ""))})`);
    else if (hasMark(node, "code")) out.push(codeSpan(text));
    else out.push(escapeText(text, lineStart && !opened && stack.length === 0 && !inHeading, inHeading));
    lineStart = false;
  });
  closeDownTo(0);
  return resolveItalics(out);
}
