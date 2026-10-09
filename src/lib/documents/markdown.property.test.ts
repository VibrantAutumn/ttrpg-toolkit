import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "../dice/rng";
import { normalizeInline, parseInline, serializeInline } from "./inline";
import { docToMarkdown, markdownToDoc, normalizeDoc } from "./markdown";
import type { DocMark, DocNode } from "./types";

/**
 * The promise behind saving documents as Markdown: writing a document out and reading it
 * back gives the same document, whatever is in it. These tests build thousands of random
 * documents out of awkward characters and check that, and that reading arbitrary text
 * never throws and is stable.
 */

const pick = <T>(rng: Rng, items: readonly T[]): T => items[rng.int(0, items.length - 1)];

const ALPHABET = ["a", "b", "c", "é", " ", " ", "*", "_", "[", "]", "(", ")", "\\", "`", "#", ">", "-", "+", "1", ".", "|", "<", ":", "~", "!", '"', "&"];

function randomText(rng: Rng, alphabet: readonly string[] = ALPHABET): string {
  let s = "";
  for (let n = rng.int(1, 6); n > 0; n--) s += pick(rng, alphabet);
  return s;
}

const HREFS = ["http://x.com", "a b", "(x)", "y\\z", "", "http://x.com/a_(b)", "<>", "u\"v"];

function randomMarks(rng: Rng): DocMark[] {
  const marks: DocMark[] = [];
  if (rng.int(1, 5) === 1) marks.push({ type: "bold" });
  if (rng.int(1, 5) === 1) marks.push({ type: "italic" });
  if (rng.int(1, 8) === 1) marks.push({ type: "strike" });
  if (rng.int(1, 6) === 1) {
    // Sometimes with the extra attributes TipTap adds to every link.
    const extra = rng.int(1, 2) === 1 ? { target: "_blank", rel: "noopener", class: null } : {};
    marks.push({ type: "link", attrs: { href: pick(rng, HREFS), ...extra } });
  }
  return marks;
}

function randomInline(rng: Rng): DocNode[] {
  const nodes: DocNode[] = [];
  for (let n = rng.int(1, 6); n > 0; n--) {
    const roll = rng.int(1, 10);
    if (roll === 1) nodes.push({ type: "hardBreak" });
    else if (roll === 2) {
      const marks = randomMarks(rng);
      marks.push({ type: "code" });
      nodes.push({ type: "text", text: randomText(rng, ["a", "`", " ", "*", "\\", "b"]) + "x", marks });
    } else {
      const marks = randomMarks(rng);
      nodes.push(marks.length ? { type: "text", text: randomText(rng), marks } : { type: "text", text: randomText(rng) });
    }
  }
  return nodes;
}

function randomBlock(rng: Rng, depth: number): DocNode {
  const roll = rng.int(1, depth >= 3 ? 5 : 12);
  if (roll <= 4) return { type: "paragraph", content: randomInline(rng) };
  if (roll === 5) return { type: "heading", attrs: { level: rng.int(1, 6) }, content: randomInline(rng) };
  if (roll === 6 || roll === 7) {
    const items: DocNode[] = [];
    for (let n = rng.int(1, 3); n > 0; n--) items.push({ type: "listItem", content: randomBlocks(rng, depth + 1, 1, 3, true) });
    return roll === 6
      ? { type: "bulletList", content: items }
      : { type: "orderedList", attrs: { start: pick(rng, [1, 1, 1, 3, 10]) }, content: items };
  }
  if (roll === 8) return { type: "blockquote", content: randomBlocks(rng, depth + 1, 1, 3, false) };
  if (roll === 9) {
    const lines = Array.from({ length: rng.int(0, 3) }, () => pick(rng, ["a", "", "```", "~~~", "  x", "# h", "- i", "> q", "`", "````"]));
    const text = lines.join("\n");
    return {
      type: "codeBlock",
      attrs: { language: pick(rng, [null, null, "js", "text"]) },
      ...(text ? { content: [{ type: "text", text }] } : {}),
    };
  }
  if (roll === 10) return { type: "horizontalRule" };
  if (roll === 11) {
    return { type: "rawMarkdown", attrs: { text: pick(rng, ["| a | b |\n|---|---|\n| 1 | 2 |", "<div>\nhi\n</div>", "<!-- note -->"]) } };
  }
  return { type: "paragraph", content: [{ type: "text", text: pick(rng, ["# x", "1. x", "- x", "> x", "---", "```", ":::x", "| a |", "<b>"]) }] };
}

function randomBlocks(rng: Rng, depth: number, min: number, max: number, paragraphFirst: boolean): DocNode[] {
  const blocks: DocNode[] = [];
  for (let n = rng.int(min, max); n > 0; n--) blocks.push(randomBlock(rng, depth));
  if (paragraphFirst && blocks[0].type !== "paragraph") blocks.unshift({ type: "paragraph", content: randomInline(rng) });
  return blocks;
}

/** Where two documents first differ, so a failure in a big document is easy to find. */
function firstDifference(a: unknown, b: unknown, path = "doc"): string | null {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      if (d) return d;
    }
  }
  return `${path}: expected ${JSON.stringify(a)} but got ${JSON.stringify(b)}`;
}

const randomDoc = (rng: Rng): DocNode => ({ type: "doc", content: randomBlocks(rng, 0, 1, 5, false) });

describe("random inline text survives writing and reading", () => {
  it("reads back what was written, for text full of marks and punctuation", () => {
    const rng = createRng(2025);
    let worst: string | null = null;
    for (let n = 0; n < 20000; n++) {
      const nodes = randomInline(rng);
      const expected = normalizeInline(nodes);
      const text = serializeInline(nodes);
      const back = parseInline(text);
      if (JSON.stringify(back) !== JSON.stringify(expected)) {
        const report = ["Written: " + JSON.stringify(text), "Expected: " + JSON.stringify(expected), "Got:      " + JSON.stringify(back)].join("\n");
        if (worst === null || report.length < worst.length) worst = report;
      }
    }
    if (worst) throw new Error("Inline text changed.\n" + worst);
  });
});

describe("random documents survive writing and reading", () => {
  it("reads back exactly what was written (after tidying)", () => {
    const rng = createRng(4242);
    let worst: string | null = null; // the shortest failure is the easiest to read
    for (let n = 0; n < 3000; n++) {
      const doc = randomDoc(rng);
      const md = docToMarkdown(doc);
      const back = markdownToDoc(md);
      const expected = normalizeDoc(doc);
      if (JSON.stringify(back) !== JSON.stringify(expected)) {
        const report = ["Markdown: " + JSON.stringify(md), "First difference: " + firstDifference(expected, back), ...(md.length < 300 ? ["Expected: " + JSON.stringify(expected)] : [])].join("\n");
        if (worst === null || report.length < worst.length) worst = report;
      }
    }
    if (worst) throw new Error("Round trip changed the document.\n" + worst);
  });

  it("writes the same text the second time (writing is stable)", () => {
    const rng = createRng(77);
    for (let n = 0; n < 1000; n++) {
      const md = docToMarkdown(randomDoc(rng));
      expect(docToMarkdown(markdownToDoc(md))).toBe(md);
    }
  });

  it("tidying twice changes nothing more", () => {
    const rng = createRng(5);
    for (let n = 0; n < 1000; n++) {
      const once = normalizeDoc(randomDoc(rng));
      expect(normalizeDoc(once)).toEqual(once);
    }
  });
});

describe("reading arbitrary text", () => {
  const LINE_PIECES = ["# ", "## ", "- ", "* ", "1. ", "2) ", "> ", "```", "~~~", "---", "***", "    ", "  ", "\t", "|", "<", ":::", "**", "*", "_", "~~", "`", "[", "](", ")", "\\", "a", "b c", " ", "", "&"];

  function randomMarkdown(rng: Rng): string {
    const lines: string[] = [];
    for (let n = rng.int(1, 10); n > 0; n--) {
      let line = "";
      for (let k = rng.int(0, 5); k > 0; k--) line += pick(rng, LINE_PIECES);
      lines.push(line);
    }
    return lines.join(rng.int(1, 6) === 1 ? "\r\n" : "\n");
  }

  it("never throws, and reading what it wrote gives the same document", () => {
    const rng = createRng(31337);
    for (let n = 0; n < 4000; n++) {
      const md = randomMarkdown(rng);
      const doc = markdownToDoc(md);
      expect(doc.type).toBe("doc");
      expect(doc.content?.length).toBeGreaterThan(0);
      const written = docToMarkdown(doc);
      const again = markdownToDoc(written);
      if (JSON.stringify(again) !== JSON.stringify(doc)) {
        throw new Error(`Not stable.\nInput:\n${JSON.stringify(md)}\nWritten:\n${JSON.stringify(written)}\nFirst:  ${JSON.stringify(doc)}\nSecond: ${JSON.stringify(again)}`);
      }
    }
  });

  it("keeps all the words of ordinary text", () => {
    const rng = createRng(9);
    const words = ["alpha", "beta", "gamma", "delta", "Strahd", "Barovia"];
    for (let n = 0; n < 500; n++) {
      const chosen = Array.from({ length: rng.int(1, 6) }, () => pick(rng, words));
      const md = chosen.map((w) => (rng.int(1, 3) === 1 ? `**${w}**` : w)).join(rng.int(1, 2) === 1 ? " " : "\n");
      const text = JSON.stringify(markdownToDoc(md));
      for (const w of chosen) expect(text).toContain(w);
    }
  });
});
