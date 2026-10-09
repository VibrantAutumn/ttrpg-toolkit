import { mergeAttributes, Node, type Editor } from "@tiptap/core";
import { Fragment, type Node as ProseNode } from "@tiptap/pm/model";
import { CALLOUT_KINDS } from "../../lib/documents/markdown";

export { CALLOUT_KINDS };

/** A highlighted note. Saved as a `:::callout` directive (see lib/documents/markdown.ts). */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: "info",
        parseHTML: (el) => el.getAttribute("data-callout") ?? "info",
        renderHTML: (attrs) => ({ "data-callout": String(attrs.kind) }),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-callout]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes({ class: "callout" }, HTMLAttributes), 0],
});

/**
 * A block for the GM only (`:::secret`). `to` is an optional note of who it will be revealed
 * to. Hiding it from players happens with sharing (Phase 9); for now it is stored and shown.
 */
export const Secret = Node.create({
  name: "secret",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      to: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-secret-to"),
        renderHTML: (attrs) => (attrs.to ? { "data-secret-to": String(attrs.to) } : {}),
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-secret]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes({ class: "secret", "data-secret": "" }, HTMLAttributes), 0],
});

/** The always-visible title line of a toggle. */
export const ToggleSummary = Node.create({
  name: "toggleSummary",
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "div[data-toggle-summary]" }],
  renderHTML: () => ["div", { class: "toggle-summary", "data-toggle-summary": "" }, 0],
});

/**
 * A section that opens and closes (`:::toggle Title`). Whether it is open is only how it is
 * shown right now; it is not saved, so a document always opens with its toggles open.
 */
export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "toggleSummary block*",
  defining: true,
  isolating: true,
  addAttributes() {
    return { open: { default: true, rendered: false } };
  },
  parseHTML: () => [{ tag: "div[data-toggle]" }],
  renderHTML: () => ["div", { class: "toggle", "data-toggle": "" }, 0],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "toggle";
      dom.dataset.open = String(node.attrs.open);
      const arrow = document.createElement("button");
      arrow.type = "button";
      arrow.className = "toggle-arrow";
      arrow.contentEditable = "false";
      arrow.setAttribute("aria-label", "Open or close this section");
      arrow.setAttribute("aria-expanded", String(node.attrs.open));
      arrow.addEventListener("mousedown", (e) => e.preventDefault()); // keep the cursor where it is
      arrow.addEventListener("click", () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor
          .chain()
          .command(({ tr }) => {
            const current = tr.doc.nodeAt(pos);
            if (!current) return false;
            tr.setNodeMarkup(pos, undefined, { ...current.attrs, open: !current.attrs.open });
            tr.setMeta("addToHistory", false);
            return true;
          })
          .run();
      });
      const content = document.createElement("div");
      content.className = "toggle-content";
      dom.append(arrow, content);
      return {
        dom,
        contentDOM: content,
        update(updated) {
          if (updated.type !== node.type) return false;
          dom.dataset.open = String(updated.attrs.open);
          arrow.setAttribute("aria-expanded", String(updated.attrs.open));
          return true;
        },
      };
    };
  },
});

/** The nearest block of this type around the cursor, with where it starts. */
export function ancestorOf(editor: Editor, typeName: string): { node: ProseNode; pos: number } | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === typeName) return { node: $from.node(depth), pos: $from.before(depth) };
  }
  return null;
}

export function wrapInCallout(editor: Editor, kind: string): void {
  editor.chain().focus().wrapIn("callout", { kind }).run();
}

export function wrapInSecret(editor: Editor): void {
  editor.chain().focus().wrapIn("secret", { to: null }).run();
}

/** Adds an empty toggle and puts the cursor in its title. */
export function insertToggle(editor: Editor): void {
  editor
    .chain()
    .focus()
    .insertContent({ type: "toggle", attrs: { open: true }, content: [{ type: "toggleSummary" }, { type: "paragraph" }] })
    .run();
  const toggle = ancestorOf(editor, "toggle");
  if (toggle) editor.chain().focus().setTextSelection(toggle.pos + 2).run();
}

/** Replaces the callout, secret block or toggle around the cursor with what was inside it. */
export function unwrapBlock(editor: Editor, typeName: "callout" | "secret" | "toggle"): void {
  const target = ancestorOf(editor, typeName);
  if (!target) return;
  const blocks: ProseNode[] = [];
  target.node.forEach((child) => {
    if (child.type.name === "toggleSummary") {
      // The title becomes an ordinary paragraph (if it had any text).
      if (child.content.size > 0) blocks.push(editor.schema.nodes.paragraph.create(null, child.content));
    } else blocks.push(child);
  });
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const content = blocks.length ? Fragment.from(blocks) : Fragment.from(editor.schema.nodes.paragraph.create());
      tr.replaceWith(target.pos, target.pos + target.node.nodeSize, content);
      return true;
    })
    .run();
}
