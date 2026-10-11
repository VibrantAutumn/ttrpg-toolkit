import type { ComponentType, ReactNode } from "react";
import type { Item } from "../api/library";

/** What a command can do to the app when it runs. Grows as the app does. */
export interface AppContext {
  openTool: (toolId: string) => void;
  /** Opens the quick tools panel (the small tools kept at hand over any screen). */
  openQuickTools: () => void;
}

/** A section of the app with its own screen (shown in the sidebar). */
export interface ToolDefinition {
  id: string;
  label: string;
  /** Emoji for now; may become an icon name later. */
  icon: string;
  /** Lower numbers appear first in the sidebar. */
  order: number;
  component: ComponentType;
  /** False for screens reached some other way (the project list, from the project switcher). Default true. */
  inSidebar?: boolean;
  /** Where the tool's icon goes in the sidebar: in the row under the search bar (default) or in the footer at the bottom. */
  placement?: "top" | "bottom";
  /** Whatever the tool wants drawn under its sidebar button (Home's pages tree and Templates section). */
  sidebar?: ComponentType;
  /** Names for libraries (the `library` of items) that have no tool of the same id, e.g. { worldbuilding: "Pages" }. */
  libraryLabels?: Record<string, string>;
}

/**
 * A small tool for the quick tools panel (a roller, a draw box...). It is just a
 * component; the panel supplies the frame, the collapse button and the order.
 */
export interface WidgetDefinition {
  id: string;
  label: string;
  /** Emoji for now; may become an icon name later. */
  icon: string;
  /** Lower numbers appear first in the panel. */
  order: number;
  component: ComponentType;
}

/**
 * What a type found that refers to an item by name, offered before the item is
 * renamed (e.g. table slots that use a table's name). The person sees `preview`
 * and chooses to rename with or without the update.
 */
export interface RenameReview {
  /** What would change, shown before renaming. */
  preview: ReactNode;
  /** One line for the notice after the update, e.g. "Updated 4 slots in 3 entries." */
  summary: string;
  /** False when nothing can be updated automatically (the review is then only a heads-up). */
  canUpdate: boolean;
  /** Makes the update (all or nothing). */
  update(): Promise<void>;
  /** Puts things back as they were before `update`. */
  undo(): Promise<void>;
}

/** Looks for things that refer to `item` by name; null when nothing needs attention. */
export type RenameReviewer = (item: Item, newName: string) => Promise<RenameReview | null>;

/** A kind of library item (e.g. a document), owned by one tool. */
export interface ItemTypeDefinition {
  id: string;
  label: string;
  icon: string;
  toolId: string;
  /** False for types made elsewhere (e.g. saved draws): the library's "New item" form leaves them out. */
  creatable?: boolean;
  /** True for items that are settings rather than content (a calendar): their page has no Tags or Properties. */
  plain?: boolean;
  /** True if a page of this type can have tabs (nested documents and embeds); only types that hold text do. */
  tabs?: boolean;
  /** The editor shown on the item's page, if this type has content to edit. */
  editor?: ComponentType<{ itemId: string }>;
  /** Offered before an item of this type is renamed, when other things refer to it by name. */
  renameReview?: RenameReviewer;
}

/** An action the command palette can list and run. */
export interface CommandDefinition {
  id: string;
  label: string;
  /** Extra words the palette matches on. */
  keywords?: string[];
  run: (ctx: AppContext) => void;
}

/** A module bundles everything one feature adds to the app. */
export interface ModuleDefinition {
  id: string;
  tools?: ToolDefinition[];
  itemTypes?: ItemTypeDefinition[];
  commands?: CommandDefinition[];
  widgets?: WidgetDefinition[];
}
