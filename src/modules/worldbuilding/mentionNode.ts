import { Node } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import type { Item } from "../../api/library";
import { itemIcon, itemTypeLabel, libraryLabel } from "../../components/item/itemDisplay";
import type { PickerBridge } from "./PickerMenu";

/** The "@" menu's plugin key, shared so the editor can close the menu when it loses focus. */
export const mentionSuggestionKey = new PluginKey("mentionSuggestion");

/** What the editor needs from the rest of the app to support mentions. */
export interface MentionSupport {
  /** Items whose name matches what was typed after "@" (never the document itself). */
  search(query: string): Promise<Item[]>;
  /** The items with these ids, in the trash or not; ids that no longer exist are left out. */
  lookup(ids: string[]): Promise<Item[]>;
  /** Opens an item's page. */
  open(id: string): void;
}

/**
 * Looks items up for the chips in one editor: asks for several at once, remembers the answers.
 * (A rename shows after the document is reopened; the saved text keeps the name it was given.)
 */
function createResolver(support: () => MentionSupport | undefined) {
  const cache = new Map<string, Item | null>();
  const waiting = new Map<string, Set<(item: Item | null) => void>>();
  let timer: number | undefined;

  function flush() {
    timer = undefined;
    const ids = [...waiting.keys()];
    const callbacks = new Map(waiting);
    waiting.clear();
    const lookup = support()?.lookup(ids) ?? Promise.resolve<Item[]>([]);
    lookup
      .catch(() => [] as Item[])
      .then((found) => {
        for (const id of ids) {
          const item = found.find((i) => i.id === id) ?? null;
          cache.set(id, item);
          callbacks.get(id)?.forEach((cb) => cb(item));
        }
      });
  }

  return (id: string, callback: (item: Item | null) => void) => {
    if (cache.has(id)) {
      callback(cache.get(id) ?? null);
      return;
    }
    const set = waiting.get(id) ?? new Set();
    set.add(callback);
    waiting.set(id, set);
    if (timer === undefined) timer = window.setTimeout(flush, 30);
  };
}

/**
 * A mention: a chip linking to another item, shown with the item's current name and icon.
 * Saved in the document's Markdown as `[Name](item:<id>)` (see lib/documents/mentions.ts).
 * Typing "@" opens a search for the item. Bold, italic and strikethrough can apply to it;
 * links and code cannot.
 */
export function createMention(getSupport: () => MentionSupport | undefined, bridge: PickerBridge<Item>) {
  const resolve = createResolver(getSupport);

  return Node.create({
    name: "mention",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    marks: "bold italic strike",

    addAttributes() {
      return { id: { default: "" }, label: { default: "Untitled" } };
    },

    parseHTML() {
      return [
        {
          tag: "span[data-mention]",
          getAttrs: (el) => ({ id: el.getAttribute("data-mention") ?? "", label: el.getAttribute("data-label") ?? el.textContent ?? "Untitled" }),
        },
      ];
    },

    renderHTML({ node }) {
      return ["span", { class: "mention", "data-mention": String(node.attrs.id), "data-label": String(node.attrs.label) }, String(node.attrs.label)];
    },

    addNodeView() {
      return ({ node }) => {
        let current = node;
        const dom = document.createElement("span");
        dom.className = "mention pending";
        dom.contentEditable = "false";
        dom.setAttribute("role", "link");
        dom.dataset.mention = String(node.attrs.id);

        const show = (item: Item | null | undefined) => {
          dom.classList.remove("pending", "mention-missing", "mention-trashed");
          if (item === undefined) {
            dom.classList.add("pending");
            dom.textContent = String(current.attrs.label);
          } else if (item === null) {
            dom.classList.add("mention-missing");
            dom.textContent = String(current.attrs.label);
            dom.title = "This item no longer exists";
          } else {
            if (item.deletedAt !== null) dom.classList.add("mention-trashed");
            dom.textContent = `${itemIcon(item)} ${item.name}`;
            dom.title = item.deletedAt !== null ? "In the trash" : `${itemTypeLabel(item)} in ${libraryLabel(item)}`;
          }
        };
        show(undefined);
        resolve(String(node.attrs.id), (item) => {
          if (dom.isConnected || dom.parentElement === null) show(item);
        });

        dom.addEventListener("click", (e) => {
          e.preventDefault();
          getSupport()?.open(String(current.attrs.id));
        });

        return {
          dom,
          update(updated) {
            if (updated.type !== current.type) return false;
            if (updated.attrs.id !== current.attrs.id) {
              current = updated;
              dom.dataset.mention = String(updated.attrs.id);
              show(undefined);
              resolve(String(updated.attrs.id), show);
            } else current = updated;
            return true;
          },
        };
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion<Item, Item>({
          editor: this.editor,
          char: "@",
          pluginKey: mentionSuggestionKey,
          // Item names have spaces, so keep matching while typing them.
          allowSpaces: true,
          items: async ({ query }) => (query.trim() === "" ? [] : ((await getSupport()?.search(query.trim())) ?? [])),
          allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== "codeBlock",
          command: ({ editor, range, props }) => {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: "mention", attrs: { id: props.id, label: props.name } },
                { type: "text", text: " " },
              ])
              .run();
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
