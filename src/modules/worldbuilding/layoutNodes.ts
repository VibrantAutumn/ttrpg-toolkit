import { Node, type Editor } from "@tiptap/core";
import { Fragment, type Node as ProseNode } from "@tiptap/pm/model";

export const MAX_COLUMNS = 4;

/** Blocks laid out side by side. Saved as a `::::columns` directive (see lib/documents/markdown.ts). */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: "div[data-columns]" }],
  renderHTML: () => ["div", { "data-columns": "", class: "columns" }, 0],
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML: () => [{ tag: "div[data-column]" }],
  renderHTML: () => ["div", { "data-column": "", class: "column" }, 0],
});

const emptyColumn = () => ({ type: "column", content: [{ type: "paragraph" }] });

/** Is the cursor somewhere inside a node of this type (at any depth)? */
export function insideNode(editor: Editor, typeName: string): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === typeName) return true;
  return false;
}

export function insertColumns(editor: Editor, count: number): void {
  editor
    .chain()
    .focus()
    .insertContent({ type: "columns", content: Array.from({ length: count }, emptyColumn) })
    .run();
  // Start typing in the first column (inserting leaves the cursor in the last one).
  const ctx = columnsContext(editor);
  if (ctx) editor.chain().focus().setTextSelection(ctx.columnsPos + 3).run();
}

/** The columns block the cursor is in, and the column within it. */
export interface ColumnsContext {
  columnsNode: ProseNode;
  columnsPos: number;
  columnPos: number;
  columnNode: ProseNode;
}

export function columnsContext(editor: Editor): ColumnsContext | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 1; depth--) {
    if ($from.node(depth).type.name === "column" && $from.node(depth - 1).type.name === "columns") {
      return {
        columnNode: $from.node(depth),
        columnPos: $from.before(depth),
        columnsNode: $from.node(depth - 1),
        columnsPos: $from.before(depth - 1),
      };
    }
  }
  return null;
}

export function addColumn(editor: Editor): void {
  const ctx = columnsContext(editor);
  if (!ctx || ctx.columnsNode.childCount >= MAX_COLUMNS) return;
  editor.chain().focus().insertContentAt(ctx.columnPos + ctx.columnNode.nodeSize, emptyColumn()).run();
}

export function deleteColumn(editor: Editor): void {
  const ctx = columnsContext(editor);
  if (!ctx || ctx.columnsNode.childCount <= 1) return;
  editor
    .chain()
    .focus()
    .deleteRange({ from: ctx.columnPos, to: ctx.columnPos + ctx.columnNode.nodeSize })
    .run();
}

/** Replaces the columns block with what was in it, one block after another. */
export function unwrapColumns(editor: Editor): void {
  const ctx = columnsContext(editor);
  if (!ctx) return;
  const blocks: ProseNode[] = [];
  ctx.columnsNode.forEach((column) => column.forEach((block) => blocks.push(block)));
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith(ctx.columnsPos, ctx.columnsPos + ctx.columnsNode.nodeSize, Fragment.from(blocks));
      return true;
    })
    .run();
}
