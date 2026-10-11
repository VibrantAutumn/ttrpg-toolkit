import { describe, expect, it } from "vitest";
import {
  addOption,
  defaultConfig,
  FIELD_KINDS,
  LIMITS,
  moveOption,
  newDefinition,
  normalizeDefinition,
  removeOption,
  renameOption,
  setOptionColor,
  validateDefinition,
  type FieldDefinition,
} from "./definition";

const dropdown = (...labels: string[]): Extract<FieldDefinition, { kind: "dropdown" }> => {
  let def = newDefinition("dropdown", "d1", "Status") as Extract<FieldDefinition, { kind: "dropdown" }>;
  labels.forEach((label, i) => {
    def = addOption(def, label, `o${i + 1}`) as typeof def;
  });
  return def;
};

describe("new definitions", () => {
  it("has plain defaults for every kind", () => {
    expect(defaultConfig("text")).toEqual({ multiline: false });
    expect(defaultConfig("number")).toEqual({ min: null, max: null, decimals: 0, unit: "" });
    expect(defaultConfig("bar")).toEqual({ decimals: 0 });
    expect(defaultConfig("formula")).toEqual({});
    expect(defaultConfig("dropdown")).toEqual({ options: [] });
    expect(defaultConfig("list")).toEqual({});
    expect(defaultConfig("link")).toEqual({ many: false, library: null, itemTypes: [] });
  });

  it("makes a definition of any kind, which is valid once it has a name", () => {
    for (const kind of FIELD_KINDS) {
      const def = newDefinition(kind, "f1", "Thing");
      expect(def).toMatchObject({ id: "f1", name: "Thing", kind, description: "" });
      expect(validateDefinition(def)).toEqual([]);
    }
  });

  it("offers a date field but not a map location yet (that waits for maps)", () => {
    expect(FIELD_KINDS).toContain("date");
    expect([...FIELD_KINDS].sort()).toEqual(["bar", "date", "dropdown", "formula", "link", "list", "number", "text"]);
  });
});

describe("validateDefinition", () => {
  it("needs a name of reasonable length", () => {
    expect(validateDefinition(newDefinition("text", "f", "   "))).toEqual(["Give the property a name."]);
    expect(validateDefinition(newDefinition("text", "f", "x".repeat(LIMITS.name + 1)))[0]).toMatch(/at most 60/);
  });

  it("refuses a number range that is backwards, and too many decimals", () => {
    const def = { ...newDefinition("number", "f", "STR"), config: { min: 10, max: 1, decimals: 0, unit: "" } } as FieldDefinition;
    expect(validateDefinition(def)).toEqual(["The smallest value can't be bigger than the largest."]);
    const decimals = { ...newDefinition("number", "f", "STR"), config: { min: null, max: null, decimals: 9, unit: "" } } as FieldDefinition;
    expect(validateDefinition(decimals)[0]).toMatch(/decimal/);
  });

  it("refuses a dropdown with blank or repeated choices", () => {
    const blank = { ...dropdown("Alive"), config: { options: [{ id: "o1", label: "Alive", color: null }, { id: "o2", label: " ", color: null }] } };
    expect(validateDefinition(blank)).toEqual(["Every choice needs a name."]);
    expect(validateDefinition(dropdown("Alive", "alive"))).toEqual(["Two choices are called “alive”."]);
    expect(validateDefinition(dropdown("Alive", "Dead"))).toEqual([]);
  });

  it("refuses too many choices", () => {
    const labels = Array.from({ length: LIMITS.options + 1 }, (_, i) => `Choice ${i}`);
    expect(validateDefinition(dropdown(...labels))[0]).toMatch(/at most 100/);
  });
});

describe("dropdown choices", () => {
  it("adds choices with the ids it is given, trimming the name", () => {
    const def = dropdown("Alive", "  Dead ");
    expect(def.config.options).toEqual([
      { id: "o1", label: "Alive", color: null },
      { id: "o2", label: "Dead", color: null },
    ]);
  });

  it("ignores an empty choice", () => {
    expect(dropdown("Alive", "  ").config.options).toHaveLength(1);
  });

  it("renames a choice without changing its id (so saved values stay right)", () => {
    const def = renameOption(dropdown("Alive", "Dead"), "o2", "Deceased") as ReturnType<typeof dropdown>;
    expect(def.config.options.map((o) => [o.id, o.label])).toEqual([
      ["o1", "Alive"],
      ["o2", "Deceased"],
    ]);
  });

  it("removes and moves choices", () => {
    const def = dropdown("A", "B", "C");
    expect((removeOption(def, "o2") as typeof def).config.options.map((o) => o.id)).toEqual(["o1", "o3"]);
    expect((moveOption(def, "o3", -1) as typeof def).config.options.map((o) => o.id)).toEqual(["o1", "o3", "o2"]);
    expect((moveOption(def, "o1", -1) as typeof def).config.options.map((o) => o.id)).toEqual(["o1", "o2", "o3"]);
    expect((moveOption(def, "o3", 1) as typeof def).config.options.map((o) => o.id)).toEqual(["o1", "o2", "o3"]);
  });

  it("sets a colour, or none", () => {
    const def = setOptionColor(dropdown("A"), "o1", "#aa0000") as ReturnType<typeof dropdown>;
    expect(def.config.options[0].color).toBe("#aa0000");
    expect((setOptionColor(def, "o1", null) as typeof def).config.options[0].color).toBeNull();
    expect((setOptionColor(def, "o1", "red") as typeof def).config.options[0].color).toBe("#aa0000"); // not a colour: unchanged
  });

  it("leaves a definition alone when the id is unknown or it is not a dropdown", () => {
    const def = dropdown("A");
    expect(renameOption(def, "nope", "X")).toEqual(def);
    expect(removeOption(def, "nope")).toEqual(def);
    const text = newDefinition("text", "t", "Notes");
    expect(addOption(text, "x", "o1")).toEqual(text);
  });

  it("never changes the definition it was given", () => {
    const def = dropdown("A", "B");
    const copy = JSON.parse(JSON.stringify(def));
    removeOption(def, "o1");
    renameOption(def, "o1", "Z");
    moveOption(def, "o2", -1);
    expect(def).toEqual(copy);
  });
});

describe("normalizeDefinition (reading what was stored)", () => {
  it("gives null for anything that is not a definition", () => {
    for (const bad of [null, 3, "x", [], {}, { id: "a", name: "A", kind: "location" }, { id: "", name: "A", kind: "text" }, { id: "a", kind: "text" }]) {
      expect(normalizeDefinition(bad)).toBeNull();
    }
  });

  it("fills in a missing config and description", () => {
    expect(normalizeDefinition({ id: "a", name: " Age ", kind: "number" })).toEqual({
      id: "a",
      name: "Age",
      kind: "number",
      description: "",
      config: { min: null, max: null, decimals: 0, unit: "" },
    });
  });

  it("keeps good settings and repairs bad ones", () => {
    const def = normalizeDefinition({
      id: "a",
      name: "Age",
      kind: "number",
      description: "In years",
      config: { min: "x", max: 120, decimals: 99, unit: 5 },
    });
    expect(def).toMatchObject({ description: "In years", config: { min: null, max: 120, decimals: LIMITS.decimals, unit: "" } });
  });

  it("drops dropdown choices that are not usable, keeps the rest in order", () => {
    const def = normalizeDefinition({
      id: "a",
      name: "S",
      kind: "dropdown",
      config: { options: [{ id: "x", label: "One" }, { id: "x", label: "Again" }, { id: "", label: "No id" }, { id: "y" }, { id: "z", label: "Two", color: "nope" }, 7] },
    }) as ReturnType<typeof dropdown>;
    expect(def.config.options).toEqual([
      { id: "x", label: "One", color: null },
      { id: "z", label: "Two", color: null },
    ]);
  });

  it("reads a link field's settings", () => {
    expect(normalizeDefinition({ id: "a", name: "Faction", kind: "link", config: { many: true, library: "worldbuilding", itemTypes: ["document", 3] } })).toMatchObject({
      config: { many: true, library: "worldbuilding", itemTypes: ["document"] },
    });
  });

  it("is stable: normalizing twice changes nothing", () => {
    const once = normalizeDefinition({ id: "a", name: " X ", kind: "dropdown", config: { options: [{ id: "q", label: " Q " }] } });
    expect(normalizeDefinition(once)).toEqual(once);
  });
});
