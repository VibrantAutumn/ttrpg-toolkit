import { describe, expect, it } from "vitest";
import { docToMarkdown, markdownToDoc, normalizeDoc } from "./markdown";
import type { DocNode } from "./types";

const t = (text: string): DocNode => ({ type: "text", text });
const p = (...content: DocNode[]): DocNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const column = (...content: DocNode[]): DocNode => ({ type: "column", content });
const columns = (...cols: DocNode[]): DocNode => ({ type: "columns", content: cols });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
const blocks = (md: string) => markdownToDoc(md).content;

const TWO = "::::columns\n:::column\nA\n:::\n\n:::column\nB\n:::\n::::";

describe("reading columns", () => {
  it("reads columns made of column blocks", () => {
    expect(blocks(TWO)).toEqual([columns(column(p(t("A"))), column(p(t("B"))))]);
  });

  it("reads any blocks inside a column", () => {
    expect(blocks("::::columns\n:::column\n# Title\n\n- a\n- b\n:::\n::::")[0]).toEqual(
      columns(
        column(
          { type: "heading", attrs: { level: 1 }, content: [t("Title")] },
          { type: "bulletList", content: [{ type: "listItem", content: [p(t("a"))] }, { type: "listItem", content: [p(t("b"))] }] },
        ),
      ),
    );
  });

  it("puts loose content in the columns block into a column instead of losing it", () => {
    expect(blocks("::::columns\nhello\n::::")).toEqual([columns(column(p(t("hello"))))]);
  });

  it("gives an empty columns block one empty column", () => {
    expect(blocks("::::columns\n::::")).toEqual([columns(column(p()))]);
  });

  it("closes a directive that is still open at the end of the text", () => {
    expect(blocks("::::columns\n:::column\nA")).toEqual([columns(column(p(t("A"))))]);
  });

  it("is not closed early by a ::: line inside a code block", () => {
    const md = "::::columns\n:::column\n```\n:::\n```\n:::\n::::";
    const result = blocks(md);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(columns(column({ type: "codeBlock", attrs: { language: null }, content: [t(":::")] })));
  });

  it("keeps a directive it does not know, whole, as raw Markdown", () => {
    expect(blocks(":::mystery\nx\n:::")).toEqual([{ type: "rawMarkdown", attrs: { text: ":::mystery\nx\n:::" } }]);
  });

  it("reads a stray closing line as text", () => {
    expect(blocks(":::")).toEqual([p(t(":::"))]);
  });

  it("ends a paragraph where a directive starts", () => {
    expect(blocks("before\n::::columns\n:::column\nA\n:::\n::::").map((b) => b.type)).toEqual(["paragraph", "columns"]);
  });

  it("reads columns inside a list item and a quote", () => {
    expect(blocks("> ::::columns\n> :::column\n> A\n> :::\n> ::::")[0]).toEqual({
      type: "blockquote",
      content: [columns(column(p(t("A"))))],
    });
  });
});

describe("writing columns", () => {
  it("writes a longer fence for the outer block", () => {
    expect(docToMarkdown(doc(columns(column(p(t("A"))), column(p(t("B"))))))).toBe(TWO);
  });

  it("gives each outer level a longer fence than what it contains", () => {
    const md = docToMarkdown(doc(columns(column({ type: "blockquote", content: [columns(column(p(t("deep"))))] }))));
    // columns (6) > column (5) > quote > columns (4) > column (3)
    expect(md.split("\n")[0]).toBe("::::::columns");
    expect(blocks(md)).toEqual(normalizeDoc(doc(columns(column({ type: "blockquote", content: [columns(column(p(t("deep"))))] })))).content);
  });

  it("writes raw directive text exactly as it was", () => {
    const raw: DocNode = { type: "rawMarkdown", attrs: { text: ":::mystery\nx\n:::" } };
    expect(docToMarkdown(doc(raw))).toBe(":::mystery\nx\n:::");
  });

  it("escapes text that looks like a directive", () => {
    const md = docToMarkdown(doc(p(t(":::columns"))));
    expect(md).toBe("\\:::columns");
    expect(blocks(md)).toEqual([p(t(":::columns"))]);
  });

  it("keeps an empty column", () => {
    const original = doc(columns(column(p()), column(p(t("B")))));
    expect(blocks(docToMarkdown(original))).toEqual(normalizeDoc(original).content);
  });
});
