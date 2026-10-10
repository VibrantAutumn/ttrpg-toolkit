/**
 * A tiny pretend backend for looking at screens in an ordinary browser (`npm run dev`, no Tauri
 * window). DEV ONLY: `main.tsx` loads it only when the app is not running inside Tauri, and the
 * production build drops it. It keeps a few things in memory (one project, items, formulas) and
 * answers every command it does not know with an empty list or null, so screens open instead of
 * failing. It is for checking layout, not behaviour: real saving, files and the keyboard are
 * only checked in the real app.
 */
import { mockIPC } from "@tauri-apps/api/mocks";

interface MockItem {
  id: string;
  projectId: string;
  library: string;
  itemType: string;
  name: string;
  icon: string | null;
  folderId: string | null;
  visibility: "default";
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

type Args = Record<string, unknown>;

export function installMockBackend(): void {
  const now = Date.now();
  const project = { id: "p1", name: "Curse of Strahd", createdAt: now, updatedAt: now, deletedAt: null };
  const items = new Map<string, MockItem>();
  const notations = new Map<string, string>();
  const bodies = new Map<string, string>();
  let counter = 0;

  const add = (library: string, itemType: string, name: string, notation?: string): MockItem => {
    counter += 1;
    const item: MockItem = {
      id: `i${counter}`,
      projectId: project.id,
      library,
      itemType,
      name,
      icon: null,
      folderId: null,
      visibility: "default",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    items.set(item.id, item);
    if (notation !== undefined) notations.set(item.id, notation);
    return item;
  };

  add("dice", "formula", "Attack", "1d20+5");
  add("dice", "formula", "Fireball", "8d6");
  add("dice", "saved_roll", "Crit damage", "2d8+4");
  add("worldbuilding", "document", "Strahd von Zarovich");
  add("worldbuilding", "document", "Castle Ravenloft");
  add("worldbuilding", "template", "NPC");
  add("worldbuilding", "smart_collection", "Living NPCs");
  const mockCards = ["The Fool", "The Magician", "Two of Cups", "The Tower", "Ace of Swords"].map((n) => add("cards", "card", n));
  add("cards", "deck", "Tarot");
  add("cards", "set", "Major Arcana");
  add("cards", "pool", "Omens");
  add("cards", "spread", "Three-card reading");

  const folders: { id: string; projectId: string; library: string; parentId: string | null; name: string; createdAt: number; updatedAt: number; deletedAt: null }[] = [];
  const addFolder = (library: string, name: string) => {
    counter += 1;
    const folder = { id: `f${counter}`, projectId: project.id, library, parentId: null, name, createdAt: now, updatedAt: now, deletedAt: null };
    folders.push(folder);
    return folder;
  };
  const npcs = addFolder("worldbuilding", "NPCs");
  addFolder("worldbuilding", "Places");
  add("worldbuilding", "document", "Ireena Kolyana").folderId = npcs.id;
  add("worldbuilding", "document", "Ismark the Lesser").folderId = npcs.id;

  bodies.set("i4", ["# Strahd", "", "The lord of Barovia.", "", "- First", "- Second", "", "A closing line.", ""].join(String.fromCharCode(10)));

  const live = (library: string, itemType?: string) =>
    [...items.values()].filter((i) => i.deletedAt === null && i.library === library && (itemType === undefined || i.itemType === itemType));

  const handlers: Record<string, (a: Args) => unknown> = {
    db_schema_version: () => 24,
    list_projects: () => [project],
    get_current_project: () => project,
    set_current_project: () => project,
    list_formulas: () =>
      live("dice", "formula").map((i) => ({ itemId: i.id, name: i.name, notation: notations.get(i.id) ?? "", folderId: null })),
    create_formula: (a) => add("dice", "formula", String(a.name || a.notation), String(a.notation)),
    get_formula: (a) => ({ itemId: a.itemId, notation: notations.get(String(a.itemId)) ?? "", createdAt: now, updatedAt: now }),
    set_formula_notation: (a) => void notations.set(String(a.itemId), String(a.notation)),
    get_saved_roll: (a) => ({
      itemId: a.itemId,
      notation: notations.get(String(a.itemId)) ?? "1d6",
      seed: 1,
      text: "",
      resultJson: "{}",
      createdAt: now,
      updatedAt: now,
    }),
    list_collections: () => [...items.values()].filter((i) => i.library === "cards" && ["deck", "set", "pool"].includes(i.itemType)),
    resolve_collection_cards: () => mockCards,
    list_spreads: () =>
      [...items.values()].filter((i) => i.itemType === "spread").map((i) => ({ itemId: i.id, name: i.name, positions: 3, ready: true })),
    list_items_of_type: (a) => live(String(a.library), String(a.itemType)),
    list_items: (a) => live(String(a.library)).filter((i) => i.folderId === (a.folderId ?? null)),
    get_item_fields: () => ({ setIds: [], values: [] }),
    get_document_body: (a) => bodies.get(String(a.itemId)) ?? "",
    set_document_body: (a) => void bodies.set(String(a.itemId), String(a.body)),
    list_trash: () => ({ folders: [], items: [] }),
    list_folders: (a) => folders.filter((f) => f.library === String(a.library)),
    create_folder: (a) => addFolder(String(a.library), String(a.name)),
    create_item: (a) => {
      const made = add(String(a.library), String(a.itemType), String(a.name));
      made.folderId = (a.folderId as string | null) ?? null;
      return made;
    },
    search_items: (a) => {
      const text = String(a.text ?? "").toLowerCase();
      return [...items.values()].filter((i) => i.deletedAt === null && i.name.toLowerCase().includes(text)).slice(0, 8);
    },
    get_item: (a) => items.get(String(a.id)) ?? null,
    rename_item: (a) => {
      const item = items.get(String(a.id));
      if (item) item.name = String(a.name);
      return item;
    },
    delete_item: (a) => {
      const item = items.get(String(a.id));
      if (item) item.deletedAt = Date.now();
    },
    restore_item: (a) => {
      const item = items.get(String(a.id));
      if (item) item.deletedAt = null;
      return item;
    },
  };

  mockIPC((cmd, payload) => {
    const handler = handlers[cmd];
    if (handler) return handler((payload ?? {}) as Args);
    if (cmd.startsWith("list_") || cmd.startsWith("search_") || cmd.startsWith("resolve_")) return [];
    if (!cmd.startsWith("plugin:")) console.warn(`[mock backend] no answer for "${cmd}"`);
    return null;
  });
}
