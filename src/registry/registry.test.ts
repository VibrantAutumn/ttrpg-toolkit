import { describe, expect, it } from "vitest";
import { createRegistry } from "./registry";
import type { ModuleDefinition, ToolDefinition, WidgetDefinition } from "./types";

const Dummy = () => null;

function tool(id: string, order = 100, label = id): ToolDefinition {
  return { id, label, icon: "T", order, component: Dummy };
}

function widget(id: string, order = 100, label = id): WidgetDefinition {
  return { id, label, icon: "W", order, component: Dummy };
}

describe("registry", () => {
  it("returns everything a module contributes", () => {
    const registry = createRegistry();
    registry.register({
      id: "docs",
      tools: [tool("worldbuilding")],
      itemTypes: [
        { id: "document", label: "Document", icon: "D", toolId: "worldbuilding" },
      ],
      commands: [{ id: "docs.new", label: "New document", run: () => {} }],
    });
    expect(registry.getTool("worldbuilding")?.id).toBe("worldbuilding");
    expect(registry.getItemType("document")?.toolId).toBe("worldbuilding");
    expect(registry.getCommand("docs.new")?.label).toBe("New document");
  });

  it("accepts modules that contribute nothing", () => {
    const registry = createRegistry();
    registry.register({ id: "empty" });
    expect(registry.getTools()).toEqual([]);
  });

  it("sorts tools by order, then by label", () => {
    const registry = createRegistry();
    registry.register({
      id: "m",
      tools: [tool("b", 20, "Beta"), tool("c", 10, "Charlie"), tool("a", 20, "Alpha")],
    });
    expect(registry.getTools().map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("rejects a module registered twice", () => {
    const registry = createRegistry();
    registry.register({ id: "m" });
    expect(() => registry.register({ id: "m" })).toThrow(/already registered/);
  });

  it("rejects duplicate ids across modules", () => {
    const registry = createRegistry();
    registry.register({ id: "one", tools: [tool("shared")] });
    expect(() =>
      registry.register({ id: "two", tools: [tool("shared")] }),
    ).toThrow(/Duplicate tool id "shared"/);
  });

  it("rejects duplicate ids inside one module", () => {
    const registry = createRegistry();
    const bad: ModuleDefinition = {
      id: "m",
      commands: [
        { id: "x", label: "X", run: () => {} },
        { id: "x", label: "X again", run: () => {} },
      ],
    };
    expect(() => registry.register(bad)).toThrow(/Duplicate command id "x"/);
  });

  it("leaves the registry unchanged when a module is rejected", () => {
    const registry = createRegistry();
    registry.register({ id: "one", tools: [tool("taken")] });
    expect(() =>
      registry.register({
        id: "two",
        tools: [tool("fresh"), tool("taken")],
      }),
    ).toThrow();
    expect(registry.getTool("fresh")).toBeUndefined();
    // And the failed module's id is free to be registered again once fixed.
    registry.register({ id: "two", tools: [tool("fresh")] });
    expect(registry.getTool("fresh")).toBeDefined();
  });

  describe("library labels", () => {
    it("uses the tool of the same id, then a tool's libraryLabels, then the id", () => {
      const registry = createRegistry();
      registry.register({
        id: "m",
        tools: [tool("dice"), { ...tool("home"), label: "Home", libraryLabels: { worldbuilding: "Pages" } }],
      });
      expect(registry.getLibraryLabel("dice")).toBe(tool("dice").label);
      expect(registry.getLibraryLabel("worldbuilding")).toBe("Pages");
      expect(registry.getLibraryLabel("unknown")).toBe("unknown");
    });
  });

  describe("widgets (the small tools in the quick tools panel)", () => {
    it("returns what a module contributes, by id", () => {
      const registry = createRegistry();
      registry.register({ id: "m", widgets: [widget("roller", 10, "Roller")] });
      expect(registry.getWidget("roller")?.label).toBe("Roller");
      expect(registry.getWidget("nope")).toBeUndefined();
    });

    it("has none until a module adds some", () => {
      const registry = createRegistry();
      registry.register({ id: "empty" });
      expect(registry.getWidgets()).toEqual([]);
    });

    it("sorts by order, then by label, across modules", () => {
      const registry = createRegistry();
      registry.register({ id: "a", widgets: [widget("b", 20, "Beta"), widget("c", 10, "Charlie")] });
      registry.register({ id: "b", widgets: [widget("a", 20, "Alpha")] });
      expect(registry.getWidgets().map((w) => w.id)).toEqual(["c", "a", "b"]);
    });

    it("rejects duplicate widget ids, and leaves the registry unchanged when it does", () => {
      const registry = createRegistry();
      registry.register({ id: "one", widgets: [widget("taken")] });
      expect(() =>
        registry.register({ id: "two", tools: [tool("fresh-tool")], widgets: [widget("fresh"), widget("taken")] }),
      ).toThrow(/Duplicate widget id "taken"/);
      expect(registry.getWidget("fresh")).toBeUndefined();
      expect(registry.getTool("fresh-tool")).toBeUndefined();
    });
  });
});
