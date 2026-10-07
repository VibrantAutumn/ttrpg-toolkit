import type {
  CommandDefinition,
  ItemTypeDefinition,
  ModuleDefinition,
  ToolDefinition,
} from "./types";

/**
 * Collects what modules contribute. The core app only reads from here, so a
 * new module plugs in by being registered, with no changes to core code.
 */
export function createRegistry() {
  const modules = new Map<string, ModuleDefinition>();
  const tools = new Map<string, ToolDefinition>();
  const itemTypes = new Map<string, ItemTypeDefinition>();
  const commands = new Map<string, CommandDefinition>();

  /** Adds each item to `target`, refusing duplicate ids. */
  function addAll<T extends { id: string }>(
    kind: string,
    moduleId: string,
    target: Map<string, T>,
    items: T[] = [],
  ) {
    for (const item of items) {
      if (target.has(item.id)) {
        throw new Error(
          `Duplicate ${kind} id "${item.id}" (module "${moduleId}")`,
        );
      }
      target.set(item.id, item);
    }
  }

  function register(module: ModuleDefinition) {
    if (modules.has(module.id)) {
      throw new Error(`Module "${module.id}" is already registered`);
    }
    // Validate against copies first so a bad module leaves the registry unchanged.
    const nextTools = new Map(tools);
    const nextItemTypes = new Map(itemTypes);
    const nextCommands = new Map(commands);
    addAll("tool", module.id, nextTools, module.tools);
    addAll("item type", module.id, nextItemTypes, module.itemTypes);
    addAll("command", module.id, nextCommands, module.commands);

    modules.set(module.id, module);
    nextTools.forEach((v, k) => tools.set(k, v));
    nextItemTypes.forEach((v, k) => itemTypes.set(k, v));
    nextCommands.forEach((v, k) => commands.set(k, v));
  }

  return {
    register,
    /** Tools in navigation order (by `order`, then label). */
    getTools: () =>
      [...tools.values()].sort(
        (a, b) => a.order - b.order || a.label.localeCompare(b.label),
      ),
    getTool: (id: string) => tools.get(id),
    getItemTypes: () => [...itemTypes.values()],
    getItemType: (id: string) => itemTypes.get(id),
    getCommands: () => [...commands.values()],
    getCommand: (id: string) => commands.get(id),
  };
}

export type Registry = ReturnType<typeof createRegistry>;
