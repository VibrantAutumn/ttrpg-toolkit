import { openUrl } from "@tauri-apps/plugin-opener";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { Item } from "../../api/library";
import { itemIcon, itemTypeLabel, libraryLabel } from "../../components/item/itemDisplay";
import { BLOCK_COMMANDS, type BlockCommand } from "../../lib/documents/blockCommands";
import { canOpenExternally, normalizeLinkAddress } from "../../lib/documents/links";
import { docToMarkdown, markdownToDoc } from "../../lib/documents/markdown";
import type { DocNode } from "../../lib/documents/types";
import { ancestorOf, CALLOUT_KINDS, Callout, Secret, Toggle, ToggleSummary, unwrapBlock } from "./containerNodes";
import { addColumn, Column, Columns, columnsContext, deleteColumn, insideNode, MAX_COLUMNS, unwrapColumns } from "./layoutNodes";
import { createMention, type MentionSupport } from "./mentionNode";
import { PickerMenu, usePickerMenu } from "./PickerMenu";
import { RawMarkdown } from "./rawMarkdownNode";
import { runBlockCommand, slashCommands } from "./slashCommands";

export interface RichEditorHandle {
  /** Turns the newest edits into Markdown and reports them right now. */
  commit(): void;
}

// A table cell holds one paragraph (the Markdown table format has nothing more), and the first row is the header.
const MarkdownCell = TableCell.extend({ content: "paragraph+" });
const MarkdownHeader = TableHeader.extend({ content: "paragraph+" });

/** True on a phone or tablet, where the system shows its own menu above a selection. */
const touchScreen = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;

/**
 * The rich text editor for a document: formatting buttons, a "/" menu for blocks, links.
 * It reads and writes the document's Markdown (`lib/documents/markdown.ts`), so what is
 * saved stays plain, readable text. Edits are converted shortly after you pause and
 * reported with `onMarkdown`; leaving the editor reports them at once and calls `onFlush`.
 */
export function RichEditor({
  initial,
  onMarkdown,
  onFlush,
  mentions,
  ref,
}: {
  initial: string;
  onMarkdown: (markdown: string) => void;
  onFlush: () => void;
  /** What "@" needs to find, show and open items; without it "@" does nothing. */
  mentions?: MentionSupport;
  ref?: Ref<RichEditorHandle>;
}) {
  const onMarkdownRef = useRef(onMarkdown);
  const onFlushRef = useRef(onFlush);
  onMarkdownRef.current = onMarkdown;
  onFlushRef.current = onFlush;

  const latestDoc = useRef<ProseNode | null>(null);
  const dirty = useRef(false);
  const lastReported = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const editorRef = useRef<Editor | null>(null);

  const mentionsRef = useRef(mentions);
  mentionsRef.current = mentions;
  const slashMenu = usePickerMenu<BlockCommand>(() => editorRef.current);
  const mentionMenu = usePickerMenu<Item>(() => editorRef.current);

  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  // The block the handle in the gutter is next to (top-level blocks only), and its open menu.
  const handleBlock = useRef<{ node: ProseNode; pos: number } | null>(null);
  const [blockMenu, setBlockMenu] = useState<{ left: number; top: number; node: ProseNode; pos: number } | null>(null);

  const commit = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current || !latestDoc.current) return;
    dirty.current = false;
    const markdown = docToMarkdown(latestDoc.current.toJSON() as DocNode);
    if (markdown === lastReported.current) return; // e.g. only a toggle was opened or closed
    lastReported.current = markdown;
    onMarkdownRef.current(markdown);
  }, []);

  useImperativeHandle(ref, () => ({ commit }), [commit]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        underline: false, // Markdown has no underline, so it would be lost on saving
        link: { openOnClick: false, autolink: false, linkOnPaste: true },
      }),
      Placeholder.configure({ placeholder: "Type '/' for commands", includeChildren: true }),
      RawMarkdown,
      Table.configure({ resizable: false }),
      TableRow,
      MarkdownHeader,
      MarkdownCell,
      Columns,
      Column,
      Callout,
      Secret,
      ToggleSummary,
      Toggle,
      createMention(() => mentionsRef.current, mentionMenu.bridge),
      slashCommands(slashMenu.bridge),
    ],
    [slashMenu.bridge, mentionMenu.bridge],
  );

  // Only the first value starts the editor; the wrapper remounts it to load a different text.
  const initialDoc = useMemo(() => markdownToDoc(initial), []); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    extensions,
    content: initialDoc,
    editorProps: {
      attributes: { class: "rich-text", role: "textbox", "aria-multiline": "true", "aria-label": "Document text" },
    },
    onUpdate: ({ editor: e }) => {
      latestDoc.current = e.state.doc;
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(commit, 300);
    },
    onBlur: () => {
      commit();
      onFlushRef.current();
    },
  });
  editorRef.current = editor;

  // Don't lose the last edits when leaving, and when the app is hidden (Android may close it).
  useEffect(() => {
    const whenHidden = () => {
      if (document.visibilityState === "hidden") {
        commit();
        onFlushRef.current();
      }
    };
    document.addEventListener("visibilitychange", whenHidden);
    return () => {
      document.removeEventListener("visibilitychange", whenHidden);
      commit();
      onFlushRef.current();
    };
  }, [commit]);

  const ui = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            link: e.isActive("link"),
            linkHref: String(e.getAttributes("link").href ?? ""),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
            codeBlock: e.isActive("codeBlock"),
            block: e.isActive("heading") ? `h${e.getAttributes("heading").level}` : "text",
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
            inTable: insideNode(e, "table"),
            columnCount: columnsContext(e)?.columnsNode.childCount ?? 0,
            calloutKind: ancestorOf(e, "callout") ? String(ancestorOf(e, "callout")?.node.attrs.kind) : "",
            inToggle: ancestorOf(e, "toggle") !== null,
            inSecret: ancestorOf(e, "secret") !== null,
            secretTo: String(ancestorOf(e, "secret")?.node.attrs.to ?? ""),
          }
        : null,
  });

  if (!editor || !ui) return null;

  function applyLink(draft: string) {
    const href = normalizeLinkAddress(draft);
    const chain = editor!.chain().focus();
    if (href === "") {
      chain.extendMarkRange("link").unsetLink().run();
    } else if (editor!.state.selection.empty && !editor!.isActive("link")) {
      chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      chain.extendMarkRange("link").setLink({ href }).run();
    }
    setLinkDraft(null);
  }

  const run = () => editor.chain().focus();

  const closeBlockMenu = () => setBlockMenu(null);

  /** The "+" in the gutter: a new empty block under this one, with the "/" menu open. */
  function addBlockBelow() {
    const block = handleBlock.current;
    if (!block) return;
    const at = block.pos + block.node.nodeSize;
    editor
      .chain()
      .insertContentAt(at, { type: "paragraph", content: [{ type: "text", text: "/" }] })
      .focus(at + 2)
      .run();
  }

  function openBlockMenu(button: HTMLElement) {
    const block = handleBlock.current;
    if (!block) return;
    const rect = button.getBoundingClientRect();
    setBlockMenu({ left: Math.max(8, Math.min(rect.right + 4, window.innerWidth - 228)), top: Math.min(rect.top, window.innerHeight - 320), ...block });
  }

  const TURN_INTO_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock"];

  function turnBlockInto(menu: NonNullable<typeof blockMenu>, command: BlockCommand) {
    closeBlockMenu();
    // Select the block first; the commands act on the blocks the selection touches. Lists and
    // quotes are first taken apart into plain paragraphs, so "Turn into Heading" changes the
    // whole thing and "Turn into Bulleted list" on a list stays a list.
    const container = ["bulletList", "orderedList", "blockquote"].includes(menu.node.type.name);
    if (container) {
      const sizeBefore = editor.state.doc.content.size;
      editor.chain().setTextSelection({ from: menu.pos + 1, to: menu.pos + menu.node.nodeSize - 1 }).clearNodes().run();
      // The pieces are now plain paragraphs filling the same place (a different size): select them all again.
      const end = menu.pos + menu.node.nodeSize + (editor.state.doc.content.size - sizeBefore);
      editor.chain().setTextSelection({ from: menu.pos + 1, to: end - 1 }).run();
    } else {
      editor.chain().setTextSelection(menu.pos + 1).run();
    }
    runBlockCommand(editor, command.id);
  }

  function duplicateBlock(menu: NonNullable<typeof blockMenu>) {
    closeBlockMenu();
    editor.chain().focus().insertContentAt(menu.pos + menu.node.nodeSize, menu.node.toJSON()).run();
  }

  function deleteBlock(menu: NonNullable<typeof blockMenu>) {
    closeBlockMenu();
    editor.chain().focus().deleteRange({ from: menu.pos, to: menu.pos + menu.node.nodeSize }).run();
  }

  return (
    <div className="rich-editor">
      <div className="rich-top">
        <ToolButton label="Undo" disabled={!ui.canUndo} onClick={() => run().undo().run()}>
          ↶
        </ToolButton>
        <ToolButton label="Redo" disabled={!ui.canRedo} onClick={() => run().redo().run()}>
          ↷
        </ToolButton>
      </div>
      {linkDraft !== null ? (
        <form
          className="rich-link-form row"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink(linkDraft);
          }}
        >
          <input
            className="grow"
            type="text"
            inputMode="url"
            autoFocus
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.currentTarget.value)}
            placeholder="Paste or type an address"
            aria-label="Link address"
          />
          <button type="submit">Apply</button>
          {ui.link && (
            <button type="button" className="danger" onClick={() => applyLink("")}>
              Remove link
            </button>
          )}
          <button type="button" onClick={() => setLinkDraft(null)}>
            Cancel
          </button>
        </form>
      ) : (
        ui.link && (
          <div className="rich-link-bar row">
            <span className="grow rich-link-href" title={ui.linkHref}>
              {ui.linkHref}
            </span>
            <button type="button" onClick={() => setLinkDraft(ui.linkHref)}>
              Edit
            </button>
            {canOpenExternally(ui.linkHref) && (
              <button type="button" onClick={() => void openUrl(ui.linkHref).catch(() => {})}>
                Open
              </button>
            )}
            <button type="button" className="danger" onClick={() => applyLink("")}>
              Remove
            </button>
          </div>
        )
      )}

      {ui.inTable && (
        <div className="rich-context" role="toolbar" aria-label="Table">
          <ToolButton wide label="Row above" onClick={() => run().addRowBefore().run()}>
            Row above
          </ToolButton>
          <ToolButton wide label="Row below" onClick={() => run().addRowAfter().run()}>
            Row below
          </ToolButton>
          <ToolButton wide label="Column left" onClick={() => run().addColumnBefore().run()}>
            Column left
          </ToolButton>
          <ToolButton wide label="Column right" onClick={() => run().addColumnAfter().run()}>
            Column right
          </ToolButton>
          <ToolButton wide label="Delete row" onClick={() => run().deleteRow().run()}>
            Delete row
          </ToolButton>
          <ToolButton wide label="Delete column" onClick={() => run().deleteColumn().run()}>
            Delete column
          </ToolButton>
          <ToolButton wide danger label="Delete table" onClick={() => run().deleteTable().run()}>
            Delete table
          </ToolButton>
        </div>
      )}
      {ui.columnCount > 0 && (
        <div className="rich-context" role="toolbar" aria-label="Columns">
          <ToolButton wide label="Add column" disabled={ui.columnCount >= MAX_COLUMNS} onClick={() => addColumn(editor)}>
            Add column
          </ToolButton>
          <ToolButton wide label="Delete this column" disabled={ui.columnCount <= 1} onClick={() => deleteColumn(editor)}>
            Delete this column
          </ToolButton>
          <ToolButton wide label="Remove columns (keep the content)" onClick={() => unwrapColumns(editor)}>
            Remove columns
          </ToolButton>
        </div>
      )}

      {ui.calloutKind !== "" && (
        <div className="rich-context" role="toolbar" aria-label="Callout">
          <select
            aria-label="Callout kind"
            value={ui.calloutKind}
            onChange={(e) => run().updateAttributes("callout", { kind: e.currentTarget.value }).run()}
          >
            {CALLOUT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
          <ToolButton wide label="Remove callout (keep the content)" onClick={() => unwrapBlock(editor, "callout")}>
            Remove callout
          </ToolButton>
        </div>
      )}
      {ui.inToggle && (
        <div className="rich-context" role="toolbar" aria-label="Toggle">
          <ToolButton wide label="Remove toggle (keep the content)" onClick={() => unwrapBlock(editor, "toggle")}>
            Remove toggle
          </ToolButton>
        </div>
      )}
      {ui.inSecret && (
        <div className="rich-context" role="toolbar" aria-label="Secret block">
          <input
            type="text"
            className="secret-to"
            aria-label="Who this will be revealed to (optional)"
            placeholder="Reveal to (optional)"
            value={ui.secretTo}
            onChange={(e) => run().updateAttributes("secret", { to: e.currentTarget.value }).run()}
          />
          <ToolButton wide label="Remove secret block (keep the content)" onClick={() => unwrapBlock(editor, "secret")}>
            Remove secret block
          </ToolButton>
        </div>
      )}

      <BubbleMenu
        editor={editor}
        className="rich-bubble"
        options={{ placement: touchScreen() ? "bottom" : "top", offset: 8, flip: true, shift: { padding: 8 } }}
        shouldShow={({ editor: e, state }) =>
          // A text selection (not a selected block or cell): only those have a "$cursor" property.
          e.isEditable && "$cursor" in state.selection && !state.selection.empty && !e.isActive("codeBlock")
        }
      >
        <ToolButton label="Bold" active={ui.bold} onClick={() => run().toggleBold().run()}>
          <strong>B</strong>
        </ToolButton>
        <ToolButton label="Italic" active={ui.italic} onClick={() => run().toggleItalic().run()}>
          <em>I</em>
        </ToolButton>
        <ToolButton label="Strikethrough" active={ui.strike} onClick={() => run().toggleStrike().run()}>
          <s>S</s>
        </ToolButton>
        <ToolButton label="Inline code" active={ui.code} onClick={() => run().toggleCode().run()}>
          {"</>"}
        </ToolButton>
        <ToolButton label="Link" active={ui.link} onClick={() => setLinkDraft(ui.linkHref)}>
          🔗
        </ToolButton>
      </BubbleMenu>

      <EditorContent editor={editor} />
      <DragHandle
        editor={editor}
        className="block-handle"
        onNodeChange={({ node, pos }) => {
          handleBlock.current = node && pos >= 0 ? { node, pos } : null;
        }}
      >
        <button type="button" className="block-add" aria-label="Add a block below" title="Add a block below" onClick={addBlockBelow}>
          +
        </button>
        <button
          type="button"
          className="block-grip"
          aria-label="Block options (drag to move)"
          title="Drag to move, click for options"
          onClick={(e) => openBlockMenu(e.currentTarget)}
        >
          ⋮⋮
        </button>
      </DragHandle>
      {blockMenu && (
        <BlockMenu
          menu={blockMenu}
          canTurnInto={TURN_INTO_TYPES.includes(blockMenu.node.type.name)}
          onTurnInto={(c) => turnBlockInto(blockMenu, c)}
          onDuplicate={() => duplicateBlock(blockMenu)}
          onDelete={() => deleteBlock(blockMenu)}
          onClose={closeBlockMenu}
        />
      )}
      {slashMenu.view && (
        <PickerMenu
          view={slashMenu.view}
          label="Insert a block"
          itemKey={(c) => c.id}
          group={(c) => c.group}
          row={(c) => (
            <>
              <strong>{c.label}</strong>
              <span>{c.hint}</span>
            </>
          )}
        />
      )}
      {mentionMenu.view && (
        <PickerMenu
          view={mentionMenu.view}
          label="Mention an item"
          itemKey={(i) => i.id}
          hint={mentionMenu.view.query.trim() === "" ? "Type a name to link to it" : undefined}
          row={(i) => (
            <>
              <strong>
                {itemIcon(i)} {i.name}
              </strong>
              <span>
                {itemTypeLabel(i)} · {libraryLabel(i)}
              </span>
            </>
          )}
        />
      )}
    </div>
  );
}

function ToolButton({
  label,
  active,
  disabled,
  wide,
  danger,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  /** A text button (as opposed to a one-symbol one). */
  wide?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={["tool", active && "on", wide && "wide", danger && "danger"].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={active ?? false}
      title={label}
      disabled={disabled}
      // Keep the cursor in the text while the button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The menu behind a block's grip: turn it into another block, duplicate it, or delete it. */
function BlockMenu({
  menu,
  canTurnInto,
  onTurnInto,
  onDuplicate,
  onDelete,
  onClose,
}: {
  menu: { left: number; top: number };
  canTurnInto: boolean;
  onTurnInto: (command: BlockCommand) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [turning, setTurning] = useState(false);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  const turnOptions = BLOCK_COMMANDS.filter((c) => ["text", "h1", "h2", "h3", "h4", "bullet", "ordered", "quote", "code"].includes(c.id));

  return (
    <div ref={ref} className="block-menu" role="menu" aria-label="Block options" style={{ left: menu.left, top: menu.top }}>
      {turning ? (
        <>
          <button type="button" role="menuitem" onClick={() => setTurning(false)}>
            ← Back
          </button>
          {turnOptions.map((c) => (
            <button key={c.id} type="button" role="menuitem" onClick={() => onTurnInto(c)}>
              {c.label}
            </button>
          ))}
        </>
      ) : (
        <>
          {canTurnInto && (
            <button type="button" role="menuitem" onClick={() => setTurning(true)}>
              Turn into…
            </button>
          )}
          <button type="button" role="menuitem" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" role="menuitem" className="danger" onClick={onDelete}>
            Delete
          </button>
        </>
      )}
    </div>
  );
}
