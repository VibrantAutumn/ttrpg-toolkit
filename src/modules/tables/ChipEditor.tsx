import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { UndoRedo } from "@tiptap/extensions";
import { Fragment, Slice } from "@tiptap/pm/model";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { docToModel, modelToDoc } from "../../lib/tables/editorDoc";
import { describeSlots, entryToModel, modelToEntry, type InlineNode } from "../../lib/tables/editorModel";
import { FORMATTABLE_KINDS, FORMAT_LABELS, SLOT_FORMATS, withFormat, type SlotFormat } from "../../lib/tables/slotFormat";
import { InsertSlotMenu } from "./InsertSlotMenu";
import { SlotNode } from "./slotNode";

/** Enter makes a new line inside the entry (an entry is one block of text, not paragraphs). */
const EnterBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return { ...this.parent?.(), Enter: () => this.editor.commands.setHardBreak() };
  },
});

const EXTENSIONS = [Document, Paragraph, Text, EnterBreak, UndoRedo, SlotNode];

const entryOf = (editor: Editor) => modelToEntry(docToModel(editor.getJSON()));

/** The slots in the document, in order, with where each sits. */
function slotsIn(editor: Editor): { pos: number; source: string }[] {
  const found: { pos: number; source: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "slot") found.push({ pos, source: String(node.attrs.source) });
  });
  return found;
}

type Panel = { kind: "insert"; labels: string[] } | { kind: "chip"; pos: number; draft: string } | null;

/**
 * The entry as editable text with slots as chips. Tap a chip to change or remove
 * it; "Insert slot" adds one at the cursor. Everything is reported back as the
 * entry's plain text (see `lib/tables/editorModel.ts`), which is what gets saved.
 */
export function ChipEditor({
  value,
  onChange,
  ariaLabel,
  namesVersion = 0,
}: {
  value: string;
  onChange: (text: string) => void;
  ariaLabel: string;
  /** Changes when the names linked pages are shown with changed, so the chips are drawn again. */
  namesVersion?: number;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [panel, setPanel] = useState<Panel>(null);

  // Only the first value starts the editor; later changes arrive through the effect below.
  const initial = useMemo(() => {
    const model = entryToModel(value);
    return modelToDoc(model.ok ? model.nodes : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = useEditor({
    extensions: EXTENSIONS,
    content: initial,
    autofocus: "end",
    editorProps: {
      attributes: { class: "entry-editor", role: "textbox", "aria-multiline": "true", "aria-label": ariaLabel },
      handleClickOn: (_view, _pos, node, nodePos) => {
        if (node.type.name !== "slot") return false;
        setPanel({ kind: "chip", pos: nodePos, draft: String(node.attrs.source) });
        return true;
      },
      // Pasted plain text with [slots] in it becomes chips; text that doesn't parse pastes as it is.
      clipboardTextParser: (text, _context, _plain, view) => {
        const { schema } = view.state;
        const parsed = entryToModel(text);
        const nodes: InlineNode[] = parsed.ok
          ? parsed.nodes
          : text.split(/\r\n|\n|\r/).flatMap((line, i): InlineNode[] => [
              ...(i > 0 ? [{ type: "break" as const }] : []),
              ...(line !== "" ? [{ type: "text" as const, text: line }] : []),
            ]);
        const made = nodes.map((n) =>
          n.type === "text"
            ? schema.text(n.text)
            : n.type === "slot"
              ? schema.nodes.slot.create({ source: n.source })
              : schema.nodes.hardBreak.create(),
        );
        return new Slice(Fragment.fromArray(made), 0, 0);
      },
    },
    onUpdate: ({ editor: e }) => {
      setPanel((p) => (p?.kind === "chip" ? null : p)); // positions may have moved
      onChangeRef.current(entryOf(e));
    },
  });

  // Show changes made elsewhere (never the editor's own, which already match).
  useEffect(() => {
    if (!editor || entryOf(editor) === value) return;
    const model = entryToModel(value);
    if (model.ok) editor.commands.setContent(modelToDoc(model.nodes), { emitUpdate: false });
  }, [editor, value]);

  // Redraw the chips when a linked page's name changed (an empty change recomputes their decorations).
  useEffect(() => {
    if (editor && namesVersion > 0) editor.view.dispatch(editor.state.tr);
  }, [editor, namesVersion]);

  if (!editor) return null;

  function insertChip(source: string) {
    editor!.chain().focus().insertContent({ type: "slot", attrs: { source } }).run();
    setPanel(null);
  }

  function openInsert() {
    const slots = slotsIn(editor!);
    const described = describeSlots(slots.map((s) => ({ type: "slot" as const, source: s.source })));
    const labels = described.flatMap((d) => (d && d.ok && d.label ? [d.label] : []));
    setPanel({ kind: "insert", labels });
  }

  let chipPanel = null;
  if (panel?.kind === "chip") {
    const slots = slotsIn(editor);
    const before = slots.filter((s) => s.pos < panel.pos).map((s) => ({ type: "slot" as const, source: s.source }));
    const described = describeSlots([...before, { type: "slot", source: panel.draft }]);
    const now = described[described.length - 1];
    const chipAt = editor.state.doc.nodeAt(panel.pos);
    const stillThere = chipAt?.type.name === "slot";
    chipPanel = (
      <form
        className="insert-slot"
        onSubmit={(e) => {
          e.preventDefault();
          if (!stillThere || panel.draft.trim() === "") return;
          editor
            .chain()
            .focus()
            .command(({ tr }) => {
              tr.setNodeMarkup(panel.pos, undefined, { source: panel.draft.trim() });
              return true;
            })
            .run();
          setPanel(null);
        }}
      >
        {now && now.ok && FORMATTABLE_KINDS.has(now.type) && (
          <label className="field">
            <span>Format</span>
            <select
              value={now.format ?? ""}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setPanel({ ...panel, draft: withFormat(panel.draft, value === "" ? undefined : (value as SlotFormat)) });
              }}
            >
              <option value="">As written</option>
              {SLOT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Slot text (what goes between the brackets)</span>
          <input
            value={panel.draft}
            onChange={(e) => setPanel({ ...panel, draft: e.currentTarget.value })}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
        </label>
        {now && (
          <p className={now.ok ? "meta" : "error"} role="status">
            {now.ok ? `✓ ${now.display}` : `⚠ ${now.message}`}
          </p>
        )}
        <div className="row wrap">
          <button type="submit" disabled={!stillThere || panel.draft.trim() === ""}>
            Save slot
          </button>
          <button
            type="button"
            onClick={() => {
              if (stillThere) editor.chain().focus().deleteRange({ from: panel.pos, to: panel.pos + 1 }).run();
              setPanel(null);
            }}
          >
            Remove slot
          </button>
          <button type="button" onClick={() => setPanel(null)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="chip-editor">
      <EditorContent editor={editor} />
      <div className="row wrap mini-actions">
        <button type="button" onClick={openInsert} aria-expanded={panel?.kind === "insert"}>
          Insert slot
        </button>
        <small className="meta">Tap a chip to change it.</small>
      </div>
      {panel?.kind === "insert" && (
        <InsertSlotMenu labels={panel.labels} onInsert={insertChip} onClose={() => setPanel(null)} />
      )}
      {chipPanel}
    </div>
  );
}
