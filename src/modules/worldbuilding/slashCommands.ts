import { Extension, type Editor } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { filterBlockCommands, type BlockCommand, type BlockCommandId } from "../../lib/documents/blockCommands";

/** Applies a block to the block the cursor is in. */
export function runBlockCommand(editor: Editor, id: BlockCommandId): void {
  const chain = editor.chain().focus();
  switch (id) {
    case "text":
      chain.setParagraph().run();
      break;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      chain.setHeading({ level: Number(id.slice(1)) as 1 | 2 | 3 | 4 }).run();
      break;
    case "bullet":
      chain.toggleBulletList().run();
      break;
    case "ordered":
      chain.toggleOrderedList().run();
      break;
    case "quote":
      chain.toggleBlockquote().run();
      break;
    case "code":
      chain.toggleCodeBlock().run();
      break;
    case "divider":
      chain.setHorizontalRule().run();
      break;
  }
}

/** How the "/" menu (drawn by React) hears about the editor. */
export interface SlashBridge {
  show(props: SuggestionProps<BlockCommand, BlockCommand>): void;
  hide(): void;
  /** Returns true if the menu used the key. */
  key(event: KeyboardEvent): boolean;
}

/** Typing "/" at the start of a line or after a space opens a menu of blocks. */
export function slashCommands(bridge: SlashBridge) {
  return Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion<BlockCommand, BlockCommand>({
          editor: this.editor,
          char: "/",
          items: ({ query }) => filterBlockCommands(query),
          allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "codeBlock",
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            runBlockCommand(editor, props.id);
          },
          render: () => ({
            onStart: (props) => bridge.show(props),
            onUpdate: (props) => bridge.show(props),
            onKeyDown: ({ event }) => bridge.key(event),
            onExit: () => bridge.hide(),
          }),
        }),
      ];
    },
  });
}
