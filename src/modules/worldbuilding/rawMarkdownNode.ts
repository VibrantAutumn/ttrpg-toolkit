import { Node } from "@tiptap/core";

/**
 * A block of Markdown the editor does not understand (a table, HTML). It is shown as it was
 * written and saved back unchanged, so opening and editing a document never loses it. To
 * change one, use the editor's Markdown view.
 */
export const RawMarkdown = Node.create({
  name: "rawMarkdown",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { text: { default: "" } };
  },

  parseHTML() {
    return [{ tag: "pre[data-raw-markdown]", getAttrs: (el) => ({ text: el.textContent ?? "" }) }];
  },

  renderHTML({ node }) {
    return ["pre", { "data-raw-markdown": "", class: "raw-markdown", title: "Shown as written. Edit it in the Markdown view." }, String(node.attrs.text)];
  },
});
