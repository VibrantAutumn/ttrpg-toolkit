import type { Editor } from "@tiptap/core";
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * The popup menu behind the editor's "/" and "@" triggers. TipTap's suggestion plugin tells a
 * `PickerBridge` what to show and which keys were pressed; `usePickerMenu` turns that into
 * React state, and `PickerMenu` draws it next to the cursor.
 */
export interface PickerBridge<T> {
  show(props: SuggestionProps<T, T>): void;
  hide(): void;
  /** Returns true if the menu used the key. */
  key(event: KeyboardEvent): boolean;
}

export interface PickerView<T> {
  items: T[];
  index: number;
  rect: DOMRect | null;
  /** What has been typed after the trigger character. */
  query: string;
  pick: (item: T) => void;
}

export function usePickerMenu<T>(getEditor: () => Editor | null): { view: PickerView<T> | null; bridge: PickerBridge<T> } {
  const [view, setView] = useState<PickerView<T> | null>(null);
  const current = useRef<PickerView<T> | null>(null);
  const getEditorRef = useRef(getEditor);
  getEditorRef.current = getEditor;

  const set = useCallback((next: PickerView<T> | null) => {
    current.current = next;
    setView(next);
  }, []);

  const bridge = useMemo<PickerBridge<T>>(
    () => ({
      show: (props) =>
        set({ items: props.items, index: 0, rect: props.clientRect?.() ?? null, query: props.query, pick: (item) => props.command(item) }),
      hide: () => set(null),
      key: (event) => {
        const menu = current.current;
        if (!menu || menu.items.length === 0) return false;
        const count = menu.items.length;
        if (event.key === "ArrowDown") {
          set({ ...menu, index: (menu.index + 1) % count });
          return true;
        }
        if (event.key === "ArrowUp") {
          set({ ...menu, index: (menu.index + count - 1) % count });
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          menu.pick(menu.items[menu.index]);
          return true;
        }
        if (event.key === "Escape") {
          const editor = getEditorRef.current();
          if (editor) exitSuggestion(editor.view);
          set(null);
          return true;
        }
        return false;
      },
    }),
    [set],
  );

  return { view, bridge };
}

const MENU_HEIGHT = 280;

export function PickerMenu<T>({
  view,
  label,
  itemKey,
  row,
  hint,
}: {
  view: PickerView<T>;
  label: string;
  itemKey: (item: T) => string;
  row: (item: T) => ReactNode;
  /** Shown when there is nothing to pick yet (for example before anything is typed). */
  hint?: string;
}) {
  const rect = view.rect;
  if (!rect) return null;
  if (view.items.length === 0 && !hint) return null;
  const above = rect.bottom + MENU_HEIGHT > window.innerHeight && rect.top > MENU_HEIGHT;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 308));
  const style = above ? { left, bottom: window.innerHeight - rect.top + 4 } : { left, top: rect.bottom + 4 };
  return (
    <ul className="slash-menu" role="listbox" aria-label={label} style={style}>
      {view.items.length === 0 && <li className="picker-hint">{hint}</li>}
      {view.items.map((item, i) => (
        <li key={itemKey(item)} role="option" aria-selected={i === view.index}>
          <button
            type="button"
            className={i === view.index ? "on" : ""}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => view.pick(item)}
          >
            {row(item)}
          </button>
        </li>
      ))}
    </ul>
  );
}
