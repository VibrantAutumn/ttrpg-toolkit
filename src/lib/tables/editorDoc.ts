/**
 * Converts between the entry editor's nodes (see `editorModel.ts`) and the
 * rich-text editor's document JSON. Kept apart from the editor itself so the
 * conversion is tested without a browser. The document is one paragraph; line
 * breaks are `hardBreak` nodes (Enter inserts one).
 */

import type { InlineNode } from "./editorModel";

/** The part of the editor's JSON this app uses. */
export interface DocJson {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: DocJson[];
}

export function modelToDoc(nodes: readonly InlineNode[]): DocJson {
  const content: DocJson[] = nodes.map((node): DocJson => {
    switch (node.type) {
      case "text":
        return { type: "text", text: node.text };
      case "slot":
        return { type: "slot", attrs: { source: node.source } };
      case "break":
        return { type: "hardBreak" };
    }
  });
  return { type: "doc", content: [content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" }] };
}

/** Reads the document back. Extra paragraphs (from pasted rich text) become line breaks. */
export function docToModel(doc: DocJson): InlineNode[] {
  const nodes: InlineNode[] = [];
  (doc.content ?? []).forEach((block, i) => {
    if (i > 0) nodes.push({ type: "break" });
    for (const node of block.content ?? []) {
      if (node.type === "text" && node.text) nodes.push({ type: "text", text: node.text });
      else if (node.type === "slot") nodes.push({ type: "slot", source: String(node.attrs?.source ?? "") });
      else if (node.type === "hardBreak") nodes.push({ type: "break" });
    }
  });
  return nodes;
}
