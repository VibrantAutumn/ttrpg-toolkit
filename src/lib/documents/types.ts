/**
 * The shape of a document while it is being edited: the same JSON TipTap uses
 * (`editor.getJSON()` / `setContent`). Keeping the shape identical means the
 * converter in this folder is pure TypeScript and needs no editor to be tested.
 */
export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
}

/** A whole document: always has at least one block. */
export interface DocRoot extends DocNode {
  type: "doc";
  content: DocNode[];
}
