import { describe, expect, it } from "vitest";
import { createRegistry } from "./registry";
import type { ModuleDefinition, ToolDefinition } from "./types";

const Dummy = () => null;

function tool(id: string, order = 100, label = id): ToolDefinition {
  return { id, label, icon: "T", order, component: Dummy };
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
});
