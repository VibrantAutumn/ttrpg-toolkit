import { describe, expect, it } from "vitest";
import { docToModel, modelToDoc } from "./editorDoc";
import type { InlineNode } from "./editorModel";

describe("modelToDoc", () => {
  it("puts everything in one paragraph, with slots and line breaks as inline nodes", () => {
    const nodes: InlineNode[] = [
      { type: "text", text: "Meet " },
      { type: "slot", source: "2d4" },
      { type: "break" },
      { type: "text", text: "now" },
    ];
    expect(modelToDoc(nodes)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Meet " },
            { type: "slot", attrs: { source: "2d4" } },
            { type: "hardBreak" },
            { type: "text", text: "now" },
          ],
        },
      ],
    });
  });

  it("gives an empty paragraph, without an empty content list, for no nodes", () => {
    expect(modelToDoc([])).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});

describe("docToModel", () => {
  it("reads the paragraph back into nodes", () => {
    const nodes: InlineNode[] = [
      { type: "text", text: "a" },
      { type: "slot", source: "Rumors" },
      { type: "break" },
      { type: "break" },
      { type: "text", text: "b" },
    ];
    expect(docToModel(modelToDoc(nodes))).toEqual(nodes);
  });

  it("treats the start of another paragraph (from pasted rich text) as a line break", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "three" }] },
      ],
    };
    expect(docToModel(doc)).toEqual([
      { type: "text", text: "one" },
      { type: "break" },
      { type: "break" },
      { type: "text", text: "three" },
    ]);
  });

  it("ignores things it doesn't know and empty text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "" }, { type: "mystery" }, { type: "text", text: "ok" }],
        },
      ],
    };
    expect(docToModel(doc)).toEqual([{ type: "text", text: "ok" }]);
  });

  it("handles a document with no content", () => {
    expect(docToModel({ type: "doc" })).toEqual([]);
  });

  it("gives a slot without a source an empty source (the chip then shows the problem)", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "slot" }] }] };
    expect(docToModel(doc)).toEqual([{ type: "slot", source: "" }]);
  });
});
