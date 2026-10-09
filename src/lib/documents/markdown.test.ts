import { describe, expect, it } from "vitest";
import { docToMarkdown, markdownToDoc } from "./markdown";
import type { DocMark, DocNode } from "./types";

const t = (text: string, ...marks: (string | DocMark)[]): DocNode => ({
  type: "text",
  text,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const link = (href: string): DocMark => ({ type: "link", attrs: { href } });
const p = (...content: DocNode[]): DocNode => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const h = (level: number, ...content: DocNode[]): DocNode => ({ type: "heading", attrs: { level }, content });
const li = (...content: DocNode[]): DocNode => ({ type: "listItem", content });
const ul = (...items: DocNode[]): DocNode => ({ type: "bulletList", content: items });
const ol = (start: number, ...items: DocNode[]): DocNode => ({ type: "orderedList", attrs: { start }, content: items });
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
const br: DocNode = { type: "hardBreak" };

const parse = (md: string) => markdownToDoc(md);
const blocks = (md: string) => markdownToDoc(md).content;

describe("markdownToDoc: blocks", () => {
  it("reads an empty text as one empty paragraph (the editor always needs a block)", () => {
    expect(parse("")).toEqual(doc(p()));
    expect(parse("\n\n  \n")).toEqual(doc(p()));
  });

  it("reads paragraphs separated by blank lines", () => {
    expect(blocks("One\n\nTwo")).toEqual([p(t("One")), p(t("Two"))]);
  });

  it("keeps single line breaks as line breaks, so text from the old plain editor looks the same", () => {
    expect(blocks("Line one\nLine two")).toEqual([p(t("Line one"), br, t("Line two"))]);
    expect(blocks("a\\\nb")).toEqual([p(t("a"), br, t("b"))]);
  });

  it("reads headings 1 to 6, with or without closing hashes", () => {
    expect(blocks("# One\n## Two ##\n###### Six")).toEqual([h(1, t("One")), h(2, t("Two")), h(6, t("Six"))]);
  });

  it("does not read a hashtag or 7 hashes as a heading", () => {
    expect(blocks("#hashtag")).toEqual([p(t("#hashtag"))]);
    expect(blocks("####### seven")).toEqual([p(t("####### seven"))]);
  });

  it("keeps a trailing # that is part of the word", () => {
    expect(blocks("# C#")).toEqual([h(1, t("C#"))]);
  });

  it("reads bullet lists with any of - + *", () => {
    expect(blocks("- a\n- b")).toEqual([ul(li(p(t("a"))), li(p(t("b"))))]);
    expect(blocks("* a\n* b")).toEqual([ul(li(p(t("a"))), li(p(t("b"))))]);
  });

  it("starts a new list when the marker changes", () => {
    expect(blocks("- a\n* b")).toEqual([ul(li(p(t("a")))), ul(li(p(t("b"))))]);
  });

  it("reads ordered lists and remembers where they start", () => {
    expect(blocks("3. a\n4. b")).toEqual([ol(3, li(p(t("a"))), li(p(t("b"))))]);
    expect(blocks("1) a")).toEqual([ol(1, li(p(t("a"))))]);
  });

  it("reads nested lists by indentation", () => {
    expect(blocks("- a\n  - b\n  - c\n- d")).toEqual([
      ul(li(p(t("a")), ul(li(p(t("b"))), li(p(t("c"))))), li(p(t("d")))),
    ]);
  });

  it("keeps a list going across blank lines, and several paragraphs in one item", () => {
    expect(blocks("- a\n\n- b")).toEqual([ul(li(p(t("a"))), li(p(t("b"))))]);
    expect(blocks("- a\n\n  more\n- b")).toEqual([ul(li(p(t("a")), p(t("more"))), li(p(t("b"))))]);
  });

  it("reads an empty list item", () => {
    expect(blocks("-")).toEqual([ul(li(p()))]);
  });

  it("makes sure a list item starts with a paragraph", () => {
    expect(blocks("- # Title")).toEqual([ul(li(p(), h(1, t("Title"))))]);
  });

  it("does not make a list out of '2024. Something' in the middle of a paragraph", () => {
    expect(blocks("In the year\n2024. Something")).toEqual([p(t("In the year"), br, t("2024. Something"))]);
  });

  it("reads block quotes, including lists and nested quotes", () => {
    expect(blocks("> a\n> b")).toEqual([{ type: "blockquote", content: [p(t("a"), br, t("b"))] }]);
    expect(blocks("> - x\n> > deep")).toEqual([
      { type: "blockquote", content: [ul(li(p(t("x")))), { type: "blockquote", content: [p(t("deep"))] }] },
    ]);
  });

  it("reads fenced code blocks with a language, and keeps their contents exactly", () => {
    expect(blocks("```js\nlet a = *1*;\n\n# not a heading\n```")).toEqual([
      { type: "codeBlock", attrs: { language: "js" }, content: [t("let a = *1*;\n\n# not a heading")] },
    ]);
    expect(blocks("```\n```")).toEqual([{ type: "codeBlock", attrs: { language: null } }]);
  });

  it("closes an unclosed code fence at the end of the text", () => {
    expect(blocks("```\nabc")).toEqual([{ type: "codeBlock", attrs: { language: null }, content: [t("abc")] }]);
  });

  it("lets a longer fence contain a shorter one", () => {
    expect(blocks("````\n```\n````")).toEqual([{ type: "codeBlock", attrs: { language: null }, content: [t("```")] }]);
  });

  it("reads horizontal rules", () => {
    expect(blocks("---\n***\n_ _ _")).toEqual([{ type: "horizontalRule" }, { type: "horizontalRule" }, { type: "horizontalRule" }]);
  });

  it("keeps tables as raw Markdown instead of losing them", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(blocks(`Before\n\n${table}\n\nAfter`)).toEqual([
      p(t("Before")),
      { type: "rawMarkdown", attrs: { text: table } },
      p(t("After")),
    ]);
  });

  it("keeps HTML blocks as raw Markdown", () => {
    expect(blocks('<div class="x">\nhi\n</div>')).toEqual([
      { type: "rawMarkdown", attrs: { text: '<div class="x">\nhi\n</div>' } },
    ]);
  });

  it("does not treat '<3' as HTML", () => {
    expect(blocks("<3 you")).toEqual([p(t("<3 you"))]);
  });

  it("accepts Windows line endings and tabs", () => {
    expect(blocks("a\r\n\r\nb")).toEqual([p(t("a")), p(t("b"))]);
    expect(blocks("- a\n\t- b")).toEqual([ul(li(p(t("a")), ul(li(p(t("b"))))))]);
  });
});

describe("markdownToDoc: inline text", () => {
  const inline = (md: string) => (blocks(md)[0].content ?? []) as DocNode[];

  it("reads bold, italic, strike and code", () => {
    expect(inline("a **b** *c* ~~d~~ `e`")).toEqual([
      t("a "),
      t("b", "bold"),
      t(" "),
      t("c", "italic"),
      t(" "),
      t("d", "strike"),
      t(" "),
      t("e", "code"),
    ]);
  });

  it("reads underscores for emphasis too", () => {
    expect(inline("__b__ and _i_")).toEqual([t("b", "bold"), t(" and "), t("i", "italic")]);
  });

  it("does not read the underscores inside snake_case_words as emphasis", () => {
    expect(inline("snake_case_name")).toEqual([t("snake_case_name")]);
  });

  it("does not read spaced stars as emphasis", () => {
    expect(inline("2 * 3 * 4")).toEqual([t("2 * 3 * 4")]);
  });

  it("reads bold and italic together, in either nesting", () => {
    expect(inline("***both***")).toEqual([t("both", "bold", "italic")]);
    // A space at the edge of emphasis is kept without the emphasis (nothing changes on screen).
    expect(inline("**bold *and italic***")).toEqual([t("bold", "bold"), t(" "), t("and italic", "bold", "italic")]);
    expect(inline("*it **bold** it*")).toEqual([t("it", "italic"), t(" "), t("bold", "bold", "italic"), t(" "), t("it", "italic")]);
  });

  it("leaves unmatched delimiters as plain text", () => {
    expect(inline("**open")).toEqual([t("**open")]);
    expect(inline("a * b")).toEqual([t("a * b")]);
  });

  it("reads links, with emphasis inside and around", () => {
    expect(inline("[the **site**](http://x.com)")).toEqual([
      t("the ", link("http://x.com")),
      t("site", link("http://x.com"), "bold"),
    ]);
    expect(inline("**see [it](u) now**")).toEqual([t("see", "bold"), t(" "), t("it", link("u"), "bold"), t(" "), t("now", "bold")]);
  });

  it("reads link addresses in angle brackets, with parentheses, and ignores a title", () => {
    expect(inline("[a](<x y>)")).toEqual([t("a", link("x y"))]);
    expect(inline("[a](http://x.com/a_(b))")).toEqual([t("a", link("http://x.com/a_(b)"))]);
    expect(inline('[a](u "title")')).toEqual([t("a", link("u"))]);
  });

  it("leaves a bracket that is not a link alone", () => {
    expect(inline("[sic] and [x](")).toEqual([t("[sic] and [x](")]);
  });

  it("reads backslash escapes", () => {
    expect(inline("\\*not\\* \\[x\\] a\\b")).toEqual([t("*not* [x] a\\b")]);
  });

  it("reads code spans with backticks inside and padding", () => {
    expect(inline("`` a`b ``")).toEqual([t("a`b", "code")]);
    expect(inline("`` ` ``")).toEqual([t("`", "code")]);
  });

  it("does not look for emphasis inside code", () => {
    expect(inline("`*a*`")).toEqual([t("*a*", "code")]);
  });
});

describe("docToMarkdown", () => {
  it("writes blocks separated by blank lines", () => {
    expect(docToMarkdown(doc(h(2, t("Title")), p(t("Body")), ul(li(p(t("a"))), li(p(t("b"))))))).toBe(
      "## Title\n\nBody\n\n- a\n- b",
    );
  });

  it("writes nothing for an empty document", () => {
    expect(docToMarkdown(doc(p()))).toBe("");
  });

  it("writes marks, links and line breaks", () => {
    expect(docToMarkdown(doc(p(t("a "), t("b", "bold"), br, t("c", link("u")), t(" "), t("d", "italic", "bold"))))).toBe(
      "a **b**\\\n[c](u) **_d_**",
    );
  });

  it("keeps spaces outside emphasis so it still reads back", () => {
    const md = docToMarkdown(doc(p(t("bold ", "bold"), t("rest"))));
    expect(md).toBe("**bold** rest");
  });

  it("escapes characters that would change the meaning", () => {
    expect(docToMarkdown(doc(p(t("*a* [b] `c` ~~d~~ \\ | snake_case"))))).toBe(
      "\\*a\\* \\[b\\] \\`c\\` \\~\\~d\\~\\~ \\\\ \\| snake_case",
    );
  });

  it("escapes what would start a block at the start of a line", () => {
    expect(docToMarkdown(doc(p(t("# no"))))).toBe("\\# no");
    expect(docToMarkdown(doc(p(t("- no"))))).toBe("\\- no");
    expect(docToMarkdown(doc(p(t("1. no"))))).toBe("1\\. no");
    expect(docToMarkdown(doc(p(t("> no"))))).toBe("\\> no");
    expect(docToMarkdown(doc(p(t("a"), br, t("# no"))))).toBe("a\\\n\\# no");
  });

  it("writes ordered lists numbered from their start, nested lists indented", () => {
    expect(docToMarkdown(doc(ol(3, li(p(t("a")), ul(li(p(t("b"))))), li(p(t("c"))))))).toBe("3. a\n   - b\n4. c");
  });

  it("keeps two lists of the same kind apart", () => {
    const md = docToMarkdown(doc(ul(li(p(t("a")))), ul(li(p(t("b"))))));
    expect(md).toBe("- a\n\n* b");
    expect(blocks(md)).toEqual([ul(li(p(t("a")))), ul(li(p(t("b"))))]);
  });

  it("uses a longer fence when the code contains one", () => {
    const code: DocNode = { type: "codeBlock", attrs: { language: null }, content: [t("```\nx")] };
    expect(docToMarkdown(doc(code))).toBe("````\n```\nx\n````");
  });

  it("writes raw Markdown exactly as it was", () => {
    const raw: DocNode = { type: "rawMarkdown", attrs: { text: "| a |\n|---|" } };
    expect(docToMarkdown(doc(p(t("x")), raw))).toBe("x\n\n| a |\n|---|");
  });

  it("drops empty paragraphs between blocks", () => {
    expect(docToMarkdown(doc(p(t("a")), p(), p(), p(t("b"))))).toBe("a\n\nb");
  });

  it("writes text from node types it does not know instead of losing it", () => {
    const unknown: DocNode = { type: "mystery", content: [p(t("kept"))] };
    expect(docToMarkdown(doc(unknown))).toBe("kept");
  });
});

describe("a normal document survives a round trip unchanged", () => {
  const samples = [
    "# Title\n\nSome **bold**, _italic_, and a [link](http://x.com).\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n> quoted\n\n---\n\n```js\ncode\n```",
    "Plain text\\\nwith a break",
    "snake_case and 2 \\* 3",
  ];
  for (const md of samples) {
    it(JSON.stringify(md.slice(0, 30)), () => {
      expect(docToMarkdown(parse(md))).toBe(md);
    });
  }
});
