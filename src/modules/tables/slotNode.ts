import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { describeSlots, modelToEntry } from "../../lib/tables/editorModel";
import { chipAttributes } from "./slotIcons";

/** Marks every slot chip in the document with its icon, text and any problem. */
function chipDecorations(doc: PMNode): DecorationSet {
  const found: { pos: number; size: number; source: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "slot") found.push({ pos, size: node.nodeSize, source: String(node.attrs.source) });
  });
  const described = describeSlots(found.map((f) => ({ type: "slot" as const, source: f.source })));
  return DecorationSet.create(
    doc,
    found.map((f, i) => {
      const { className, ...rest } = chipAttributes(described[i], f.source);
      return Decoration.node(f.pos, f.pos + f.size, { class: className, ...rest });
    }),
  );
}

/**
 * A slot inside an entry (`[2d4]`, `[table:Rumors as R]`...) as one chip. The
 * node only stores the text between the brackets; what the chip shows is worked
 * out from it (so labels set by earlier chips are understood).
 */
export const SlotNode = Node.create({
  name: "slot",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { source: { default: "", rendered: false } };
  },

  parseHTML() {
    return [{ tag: "span[data-slot]", getAttrs: (el) => ({ source: (el as HTMLElement).getAttribute("data-slot") ?? "" }) }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-slot": String(node.attrs.source), class: "slot-chip" })];
  },

  /** Copying a chip as text gives the slot as it is typed, so it pastes back as a chip. */
  renderText({ node }) {
    return modelToEntry([{ type: "slot", source: String(node.attrs.source) }]);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("slotChips"),
        props: { decorations: (state) => chipDecorations(state.doc) },
      }),
    ];
  },
});
