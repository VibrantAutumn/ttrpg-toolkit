import { describe, expect, it } from "vitest";
import { docToMarkdown, markdownToDoc, normalizeDoc } from "./markdown";
import type { DocMark, DocNode } from "./types";

const t = (text: string, ...marks: string[]): DocNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((type): DocMark => ({ type })) } : {}),
});
const p = (...content: DocNode[]): DocNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const cell = (...content: DocNode[]): DocNode => ({ type: "tableCell", content: [p(...content)] });
const head = (...content: DocNode[]): DocNode => ({ type: "tableHeader", content: [p(...content)] });
const row = (...cells: DocNode[]): DocNode => ({ type: "tableRow", content: cells });
const table = (...rows: DocNode[]): DocNode => ({ type: "table", content: rows });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
const blocks = (md: string) => markdownToDoc(md).content;
const br: DocNode = { type: "hardBreak" };

describe("reading tables", () => {
  it("reads a table with a header row", () => {
    expect(blocks("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |")).toEqual([
      table(row(head(t("a")), head(t("b"))), row(cell(t("1")), cell(t("2"))), row(cell(t("3")), cell(t("4")))),
    ]);
  });

  it("reads a header-only table", () => {
    expect(blocks("| a |\n| - |")).toEqual([table(row(head(t("a"))))]);
  });

  it("accepts alignment colons and tables without outer pipes", () => {
    expect(blocks("a | b\n:--|--:\n1 | 2")).toEqual([table(row(head(t("a")), head(t("b"))), row(cell(t("1")), cell(t("2"))))]);
  });

  it("reads emphasis, links and code inside cells", () => {
    expect(blocks("| **a** | `b` |\n|--|--|\n| x | y |")[0]).toEqual(
      table(row(head(t("a", "bold")), head(t("b", "code"))), row(cell(t("x")), cell(t("y")))),
    );
  });

  it("reads an escaped pipe as a character, in text and in code", () => {
    expect(blocks("| a \\| b | `c\\|d` |\n|--|--|")[0]).toEqual(table(row(head(t("a | b")), head(t("c|d", "code")))));
  });

  it("reads <br> as a line break inside a cell", () => {
    expect(blocks("| a<br>b |\n|--|")[0]).toEqual(table(row(head(t("a"), br, t("b")))));
  });

  it("makes every row as wide as the header", () => {
    expect(blocks("| a | b |\n|--|--|\n| 1 |\n| 1 | 2 | 3 |")).toEqual([
      table(row(head(t("a")), head(t("b"))), row(cell(t("1")), cell()), row(cell(t("1")), cell(t("2")))),
    ]);
  });

  it("ends the table at a blank line", () => {
    expect(blocks("| a |\n|--|\n| 1 |\n\nAfter")).toEqual([table(row(head(t("a"))), row(cell(t("1")))), p(t("After"))]);
  });

  it("ends the table at a line with no pipe", () => {
    expect(blocks("| a |\n|--|\n| 1 |\nplain")).toEqual([table(row(head(t("a"))), row(cell(t("1")))), p(t("plain"))]);
  });

  it("is not a table when the rule row has no pipe or a different number of columns", () => {
    expect(blocks("a | b\n---")[0].type).toBe("paragraph");
    expect(blocks("| a | b |\n|--|")[0].type).toBe("paragraph");
  });

  it("keeps text before and after a table", () => {
    expect(blocks("Before\n\n| a |\n|--|\n\nAfter").map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
  });
});

describe("writing tables", () => {
  it("writes a header row, a rule row and the rest", () => {
    const md = docToMarkdown(doc(table(row(head(t("a")), head(t("b"))), row(cell(t("1")), cell(t("2"))))));
    expect(md).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
  });

  it("always treats the first row as the header", () => {
    const md = docToMarkdown(doc(table(row(cell(t("a"))), row(cell(t("1"))))));
    expect(md).toBe("| a |\n| --- |\n| 1 |");
    expect(blocks(md)[0].content?.[0].content?.[0].type).toBe("tableHeader");
  });

  it("writes an empty cell, a pipe, and a line break so it reads back", () => {
    const original = table(row(head(t("a | b")), head()), row(cell(t("x"), br, t("y")), cell(t("`z`"))));
    const md = docToMarkdown(doc(original));
    expect(md).toBe("| a \\| b |  |\n| --- | --- |\n| x<br>y | \\`z\\` |");
    expect(blocks(md)).toEqual([normalizeDoc(doc(original)).content[0]]);
  });

  it("escapes a pipe inside code in a cell", () => {
    const original = table(row(head(t("c|d", "code"))));
    const md = docToMarkdown(doc(original));
    expect(md).toBe("| `c\\|d` |\n| --- |");
    expect(blocks(md)).toEqual([original]);
  });

  it("joins several paragraphs in a cell with a line break", () => {
    const original = table(row({ type: "tableHeader", content: [p(t("a")), p(t("b"))] }));
    expect(docToMarkdown(doc(original))).toBe("| a<br>b |\n| --- |");
  });

  it("fills short rows and cuts long ones to the header's width", () => {
    const md = docToMarkdown(doc(table(row(head(t("a")), head(t("b"))), row(cell(t("1"))), row(cell(t("1")), cell(t("2")), cell(t("3"))))));
    expect(md).toBe("| a | b |\n| --- | --- |\n| 1 |  |\n| 1 | 2 |");
  });

  it("separates a table from the blocks around it with blank lines", () => {
    const md = docToMarkdown(doc(p(t("x")), table(row(head(t("a")))), p(t("y"))));
    expect(md).toBe("x\n\n| a |\n| --- |\n\ny");
  });

  it("works inside a list item and a quote", () => {
    const tbl = table(row(head(t("a"))), row(cell(t("1"))));
    const inList = doc({ type: "bulletList", content: [{ type: "listItem", content: [p(t("item")), tbl] }] });
    expect(blocks(docToMarkdown(inList))).toEqual(normalizeDoc(inList).content);
    const inQuote = doc({ type: "blockquote", content: [tbl] });
    expect(blocks(docToMarkdown(inQuote))).toEqual(normalizeDoc(inQuote).content);
  });
});
