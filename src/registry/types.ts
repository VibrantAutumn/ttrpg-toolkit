import type { ComponentType } from "react";

/** What a command can do to the app when it runs. Grows as the app does. */
export interface AppContext {
  openTool: (toolId: string) => void;
}

/** A section of the app with its own screen (shown in the navigation). */
export interface ToolDefinition {
  id: string;
  label: string;
  /** Emoji for now; may become an icon name later. */
  icon: string;
  /** Lower numbers appear first in the navigation. */
  order: number;
  component: ComponentType;
}

/** A kind of library item (e.g. a document), owned by one tool. */
export interface ItemTypeDefinition {
  id: string;
  label: string;
  icon: string;
  toolId: string;
  /** The editor shown on the item's page, if this type has content to edit. */
  editor?: ComponentType<{ itemId: string }>;
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
}
