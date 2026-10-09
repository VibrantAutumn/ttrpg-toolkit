import { describe, expect, it } from "vitest";
import { docToMarkdown, markdownToDoc, normalizeDoc } from "./markdown";
import { itemHref, itemIdFromHref, mentionIds } from "./mentions";
import type { DocMark, DocNode } from "./types";

const A = "0a1b2c3d-1111-4222-8333-444455556666";
const B = "ffffffff-aaaa-4bbb-8ccc-000000000001";

const t = (text: string, ...marks: string[]): DocNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((type): DocMark => ({ type })) } : {}),
});
const mention = (id: string, label: string, ...marks: string[]): DocNode => ({
  type: "mention",
  attrs: { id, label },
  ...(marks.length ? { marks: marks.map((type): DocMark => ({ type })) } : {}),
});
const p = (...content: DocNode[]): DocNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
const blocks = (md: string) => markdownToDoc(md).content;

describe("item addresses", () => {
  it("makes and reads the address of an item", () => {
    expect(itemHref(A)).toBe(`item:${A}`);
    expect(itemIdFromHref(`item:${A}`)).toBe(A);
    expect(itemIdFromHref(`ITEM:${A.toUpperCase()}`)).toBe(A);
  });

  it("does not take anything else for an item", () => {
    expect(itemIdFromHref("item:xyz")).toBeNull();
    expect(itemIdFromHref("https://example.com")).toBeNull();
    expect(itemIdFromHref(`item:${A}/more`)).toBeNull();
  });
});

describe("reading mentions", () => {
  it("reads a link to an item as a mention", () => {
    expect(blocks(`See [Strahd](item:${A}) now.`)).toEqual([p(t("See "), mention(A, "Strahd"), t(" now."))]);
  });

  it("keeps bold and italic around a mention", () => {
    expect(blocks(`**[Strahd](item:${A})**`)).toEqual([p(mention(A, "Strahd", "bold"))]);
    expect(blocks(`_see **[Strahd](item:${A})**_`)).toEqual([
      p(t("see", "italic"), t(" "), mention(A, "Strahd", "bold", "italic")),
    ]);
  });

  it("uses the plain text of the label", () => {
    expect(blocks(`[**S**trahd](item:${A})`)).toEqual([p(mention(A, "Strahd"))]);
  });

  it("leaves a link whose address is not an item as an ordinary link", () => {
    expect(blocks("[x](item:xyz)")).toEqual([p({ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "item:xyz" } }] })]);
  });

  it("reads mentions in a heading, a list, a table cell and a toggle title", () => {
    const md = `# [A](item:${A})\n\n- [B](item:${B})\n\n| [A](item:${A}) |\n| --- |\n\n:::toggle [B](item:${B})\n:::`;
    expect(mentionIds(markdownToDoc(md))).toEqual([A, B]);
  });
});

describe("writing mentions", () => {
  it("writes a mention as a link", () => {
    expect(docToMarkdown(doc(p(t("See "), mention(A, "Strahd"), t(" now."))))).toBe(`See [Strahd](item:${A}) now.`);
  });

  it("keeps emphasis around it", () => {
    expect(docToMarkdown(doc(p(mention(A, "Strahd", "bold"))))).toBe(`**[Strahd](item:${A})**`);
  });

  it("escapes brackets and other characters in the label", () => {
    const md = docToMarkdown(doc(p(mention(A, "The [Dark] Lord *1*"))));
    expect(md).toBe(`[The \\[Dark\\] Lord \\*1\\*](item:${A})`);
    expect(blocks(md)).toEqual([p(mention(A, "The [Dark] Lord *1*"))]);
  });

  it("tidies the label: spaces collapse, and an empty one becomes Untitled", () => {
    expect(normalizeDoc(doc(p(mention(A, "  a \n b ")))).content).toEqual([p(mention(A, "a b"))]);
    expect(normalizeDoc(doc(p(mention(A, "   ")))).content).toEqual([p(mention(A, "Untitled"))]);
  });

  it("drops link and code marks, which a mention cannot have", () => {
    const withLink: DocNode = { type: "mention", attrs: { id: A, label: "X" }, marks: [{ type: "link", attrs: { href: "https://x" } }, { type: "code" }] };
    expect(docToMarkdown(doc(p(withLink)))).toBe(`[X](item:${A})`);
  });

  it("works in a table cell, with a pipe in the label", () => {
    const md = docToMarkdown(
      doc({ type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p(mention(A, "a|b"))] }] }] }),
    );
    expect(md).toBe(`| [a\\|b](item:${A}) |\n| --- |`);
    expect(mentionIds(markdownToDoc(md))).toEqual([A]);
  });
});

describe("mentionIds", () => {
  it("lists each mentioned item once, in order of first appearance", () => {
    const d = doc(p(mention(B, "b"), t(" "), mention(A, "a"), mention(B, "b again")));
    expect(mentionIds(d)).toEqual([B, A]);
  });

  it("does not count a link written inside code or a raw block", () => {
    const md = "```\n[x](item:" + A + ")\n```\n\n`[y](item:" + A + ")`\n\n<div>[z](item:" + A + ")</div>";
    expect(mentionIds(markdownToDoc(md))).toEqual([]);
  });
});
