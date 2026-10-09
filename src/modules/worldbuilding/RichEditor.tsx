import { openUrl } from "@tauri-apps/plugin-opener";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { BlockCommand } from "../../lib/documents/blockCommands";
import { canOpenExternally, normalizeLinkAddress } from "../../lib/documents/links";
import { docToMarkdown, markdownToDoc } from "../../lib/documents/markdown";
import type { DocNode } from "../../lib/documents/types";
import { addColumn, Column, Columns, columnsContext, deleteColumn, insertColumns, insideNode, MAX_COLUMNS, unwrapColumns } from "./layoutNodes";
import { RawMarkdown } from "./rawMarkdownNode";
import { runBlockCommand, slashCommands, type SlashBridge } from "./slashCommands";

export interface RichEditorHandle {
  /** Turns the newest edits into Markdown and reports them right now. */
  commit(): void;
}

/** The "/" menu: what is offered, which is highlighted, and where to draw it. */
interface SlashView {
  items: BlockCommand[];
  index: number;
  rect: DOMRect | null;
  pick: (item: BlockCommand) => void;
}

// A table cell holds one paragraph (the Markdown table format has nothing more), and the first row is the header.
const MarkdownCell = TableCell.extend({ content: "paragraph+" });
const MarkdownHeader = TableHeader.extend({ content: "paragraph+" });

/** True on a phone or tablet, where the system shows its own menu above a selection. */
const touchScreen = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;

const BLOCK_OPTIONS:{ value: string; label: string }[] = [
  { value: "text", label: "Text" },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: `h${n}`, label: `Heading ${n}` })),
];

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
  ref,
}: {
  initial: string;
  onMarkdown: (markdown: string) => void;
  onFlush: () => void;
  ref?: Ref<RichEditorHandle>;
}) {
  const onMarkdownRef = useRef(onMarkdown);
  const onFlushRef = useRef(onFlush);
  onMarkdownRef.current = onMarkdown;
  onFlushRef.current = onFlush;

  const latestDoc = useRef<ProseNode | null>(null);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const editorRef = useRef<Editor | null>(null);

  const [slash, setSlash] = useState<SlashView | null>(null);
  const slashRef = useRef<SlashView | null>(null);
  const showSlash = useCallback((view: SlashView | null) => {
    slashRef.current = view;
    setSlash(view);
  }, []);

  const [linkDraft, setLinkDraft] = useState<string | null>(null);

  const commit = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current || !latestDoc.current) return;
    dirty.current = false;
    onMarkdownRef.current(docToMarkdown(latestDoc.current.toJSON() as DocNode));
  }, []);

  useImperativeHandle(ref, () => ({ commit }), [commit]);

  const bridge = useMemo<SlashBridge>(
    () => ({
      show: (props: SuggestionProps<BlockCommand, BlockCommand>) => {
        showSlash({
          items: props.items,
          index: 0,
          rect: props.clientRect?.() ?? null,
          pick: (item) => props.command(item),
        });
      },
      hide: () => showSlash(null),
      key: (event) => {
        const current = slashRef.current;
        if (!current || current.items.length === 0) return false;
        const count = current.items.length;
        if (event.key === "ArrowDown") {
          showSlash({ ...current, index: (current.index + 1) % count });
          return true;
        }
        if (event.key === "ArrowUp") {
          showSlash({ ...current, index: (current.index + count - 1) % count });
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          current.pick(current.items[current.index]);
          return true;
        }
        if (event.key === "Escape") {
          if (editorRef.current) exitSuggestion(editorRef.current.view);
          showSlash(null);
          return true;
        }
        return false;
      },
    }),
    [showSlash],
  );

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        underline: false, // Markdown has no underline, so it would be lost on saving
        link: { openOnClick: false, autolink: false, linkOnPaste: true },
      }),
      RawMarkdown,
      Table.configure({ resizable: false }),
      TableRow,
      MarkdownHeader,
      MarkdownCell,
      Columns,
      Column,
      slashCommands(bridge),
    ],
    [bridge],
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
          }
        : null,
  });

  if (!editor || !ui) return null;

  function setBlock(value: string) {
    const chain = editor!.chain().focus();
    if (value === "text") chain.setParagraph().run();
    else chain.setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  }

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

  return (
    <div className="rich-editor">
      <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
        <select aria-label="Block type" value={ui.block} onChange={(e) => setBlock(e.currentTarget.value)}>
          {BLOCK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
        <ToolButton label="Bulleted list" active={ui.bullet} onClick={() => run().toggleBulletList().run()}>
          •≡
        </ToolButton>
        <ToolButton label="Numbered list" active={ui.ordered} onClick={() => run().toggleOrderedList().run()}>
          1≡
        </ToolButton>
        <ToolButton label="Quote" active={ui.quote} onClick={() => run().toggleBlockquote().run()}>
          ❝
        </ToolButton>
        <ToolButton label="Code block" active={ui.codeBlock} onClick={() => run().toggleCodeBlock().run()}>
          {"{ }"}
        </ToolButton>
        <ToolButton label="Table" active={ui.inTable} onClick={() => runBlockCommand(editor, "table")}>
          ▦
        </ToolButton>
        <ToolButton label="Columns" active={ui.columnCount > 0} onClick={() => insertColumns(editor, 2)}>
          ◫
        </ToolButton>
        <ToolButton label="Divider" onClick={() => runBlockCommand(editor, "divider")}>
          ―
        </ToolButton>
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
      {slash &&slash.items.length > 0 && <SlashMenu view={slash} />}
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

function SlashMenu({ view }: { view: SlashView }) {
  const rect = view.rect;
  if (!rect) return null;
  const MENU_HEIGHT = 280;
  const above = rect.bottom + MENU_HEIGHT > window.innerHeight && rect.top > MENU_HEIGHT;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 268));
  const style = above ? { left, bottom: window.innerHeight - rect.top + 4 } : { left, top: rect.bottom + 4 };
  return (
    <ul className="slash-menu" role="listbox" aria-label="Insert a block" style={style}>
      {view.items.map((item, i) => (
        <li key={item.id} role="option" aria-selected={i === view.index}>
          <button
            type="button"
            className={i === view.index ? "on" : ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => view.pick(item)}
          >
            <strong>{item.label}</strong>
            <span>{item.hint}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
