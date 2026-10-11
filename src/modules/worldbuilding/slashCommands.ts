import { Extension, type Editor } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { filterBlockCommands, type BlockCommandId, type SlashCommand } from "../../lib/documents/blockCommands";
import { insertToggle, wrapInCallout, wrapInSecret } from "./containerNodes";
import { insertColumns } from "./layoutNodes";
import type { PickerBridge } from "./PickerMenu";

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
    case "table":
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      break;
    case "columns2":
      insertColumns(editor, 2);
      break;
    case "columns3":
      insertColumns(editor, 3);
      break;
    case "callout":
      wrapInCallout(editor, "info");
      break;
    case "warning":
      wrapInCallout(editor, "warning");
      break;
    case "toggle":
      insertToggle(editor);
      break;
    case "secret":
      wrapInSecret(editor);
      break;
  }
}

/** Typing "/" at the start of a line or after a space opens a menu of blocks. */
export function slashCommands(
  bridge: PickerBridge<SlashCommand>,
  /** Extra items for this page (its project's stat blocks), read each time the menu opens. */
  getExtras: () => SlashCommand[],
  /** Adds a stat block (a property set) to the page. */
  addStatBlock: (setId: string) => void,
) {
  return Extension.create({
    name: "slashCommands",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommand, SlashCommand>({
          editor: this.editor,
          char: "/",
          items: ({ query }) => filterBlockCommands(query, getExtras()),
          allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "codeBlock",
          command: ({ editor, range, props }) => {
            editor.chain().focus().deleteRange(range).run();
            if (props.setId) addStatBlock(props.setId);
            else runBlockCommand(editor, props.id as BlockCommandId);
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
