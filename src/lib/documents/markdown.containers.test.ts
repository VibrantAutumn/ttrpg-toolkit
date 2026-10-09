import { describe, expect, it } from "vitest";
import { docToMarkdown, markdownToDoc, normalizeDoc } from "./markdown";
import type { DocMark, DocNode } from "./types";

const t = (text: string, ...marks: string[]): DocNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((type): DocMark => ({ type })) } : {}),
});
const p = (...content: DocNode[]): DocNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const callout = (kind: string, ...content: DocNode[]): DocNode => ({ type: "callout", attrs: { kind }, content });
const summary = (...content: DocNode[]): DocNode => (content.length ? { type: "toggleSummary", content } : { type: "toggleSummary" });
const toggle = (s: DocNode, ...body: DocNode[]): DocNode => ({ type: "toggle", content: [s, ...body] });
const secret = (to: string | null, ...content: DocNode[]): DocNode => ({ type: "secret", attrs: { to }, content });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
const blocks = (md: string) => markdownToDoc(md).content;

describe("callouts", () => {
  it("reads a callout, which is an info callout unless it says otherwise", () => {
    expect(blocks(":::callout\nRemember this\n:::")).toEqual([callout("info", p(t("Remember this")))]);
    expect(blocks(":::callout warning\nCareful\n:::")).toEqual([callout("warning", p(t("Careful")))]);
    expect(blocks(":::callout TIP\nx\n:::")).toEqual([callout("tip", p(t("x")))]);
  });

  it("holds any blocks", () => {
    expect(blocks(":::callout danger\n# Title\n\n- a\n:::")[0].content?.map((b) => b.type)).toEqual(["heading", "bulletList"]);
  });

  it("keeps a callout of a kind it does not know, whole, as raw Markdown", () => {
    expect(blocks(":::callout fancy\nx\n:::")).toEqual([{ type: "rawMarkdown", attrs: { text: ":::callout fancy\nx\n:::" } }]);
  });

  it("gives an empty callout one empty paragraph", () => {
    expect(blocks(":::callout\n:::")).toEqual([callout("info", p())]);
  });

  it("writes the kind unless it is info", () => {
    expect(docToMarkdown(doc(callout("info", p(t("a")))))).toBe(":::callout\na\n:::");
    expect(docToMarkdown(doc(callout("warning", p(t("a")))))).toBe(":::callout warning\na\n:::");
  });

  it("falls back to info for a kind it does not know when writing", () => {
    expect(docToMarkdown(doc(callout("bogus", p(t("a")))))).toBe(":::callout\na\n:::");
  });
});

describe("toggles", () => {
  it("reads the summary and the body", () => {
    expect(blocks(":::toggle More **detail**\nHidden text\n:::")).toEqual([
      toggle(summary(t("More "), t("detail", "bold")), p(t("Hidden text"))),
    ]);
  });

  it("allows an empty summary and an empty body", () => {
    expect(blocks(":::toggle\n:::")).toEqual([toggle(summary())]);
    expect(blocks(":::toggle Title\n:::")).toEqual([toggle(summary(t("Title")))]);
  });

  it("writes the summary on the opening line", () => {
    expect(docToMarkdown(doc(toggle(summary(t("A "), t("b", "italic")), p(t("body")))))).toBe(":::toggle A _b_\nbody\n:::");
  });

  it("writes a toggle whose first child is not a summary as one with an empty summary", () => {
    expect(docToMarkdown(doc({ type: "toggle", content: [p(t("body"))] }))).toBe(":::toggle\nbody\n:::");
  });

  it("keeps the summary on one line", () => {
    const md = docToMarkdown(doc(toggle(summary(t("a"), { type: "hardBreak" }, t("b")))));
    expect(md).toBe(":::toggle a b\n:::");
  });
});

describe("secret blocks", () => {
  it("reads a secret block, with an optional note of who it is for", () => {
    expect(blocks(":::secret\nOnly the GM\n:::")).toEqual([secret(null, p(t("Only the GM")))]);
    expect(blocks(":::secret Ireena, Ed\nx\n:::")).toEqual([secret("Ireena, Ed", p(t("x")))]);
  });

  it("writes it back the same way", () => {
    expect(docToMarkdown(doc(secret(null, p(t("a")))))).toBe(":::secret\na\n:::");
    expect(docToMarkdown(doc(secret("Ed", p(t("a")))))).toBe(":::secret Ed\na\n:::");
  });
});

describe("nesting", () => {
  it("lets these blocks hold each other, with longer fences outside", () => {
    const original = doc(callout("tip", p(t("a")), toggle(summary(t("s")), secret(null, p(t("deep"))))));
    const md = docToMarkdown(original);
    // secret (3) inside toggle (4) inside callout (5)
    expect(md.split("\n")[0]).toBe(":::::callout tip");
    expect(blocks(md)).toEqual(normalizeDoc(original).content);
  });

  it("works inside a list item and a column", () => {
    const original = doc({ type: "bulletList", content: [{ type: "listItem", content: [p(t("x")), callout("info", p(t("in list")))] }] });
    expect(blocks(docToMarkdown(original))).toEqual(normalizeDoc(original).content);
    const inColumn = doc({ type: "columns", content: [{ type: "column", content: [secret(null, p(t("s")))] }] });
    expect(blocks(docToMarkdown(inColumn))).toEqual(normalizeDoc(inColumn).content);
  });
});
