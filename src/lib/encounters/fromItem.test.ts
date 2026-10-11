import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "../fields/definition";
import { readProjectRules } from "../rulesets/projectRules";
import { combatantFromValues } from "./fromItem";

const rules = readProjectRules({
  id: "pr",
  rulesetId: "r",
  name: "D20",
  rulesJson: JSON.stringify({
    fields: [
      { key: "hp", name: "Hit points", kind: "bar" },
      { key: "dex", name: "Dexterity", kind: "number" },
      { key: "ac", name: "Armor class", kind: "number" },
      { key: "speed", name: "Speed", kind: "number", config: { unit: "ft" } },
      { key: "class", name: "Class", kind: "text" },
    ],
    encounter: { initiative: { bonusField: "dex" }, healthField: "hp", combatFields: ["ac", "speed", "class"] },
  }),
  idsJson: JSON.stringify({ fields: { hp: "f-hp", dex: "f-dex", ac: "f-ac", speed: "f-speed", class: "f-class" }, sets: {} }),
})!;

const definitions: FieldDefinition[] = [
  { id: "f-hp", name: "Hit points", kind: "bar", description: "", config: { decimals: 0 } },
  { id: "f-dex", name: "Dexterity", kind: "number", description: "", config: { min: null, max: null, decimals: 0, unit: "" } },
  { id: "f-ac", name: "Armor class", kind: "number", description: "", config: { min: null, max: null, decimals: 0, unit: "" } },
  { id: "f-speed", name: "Speed", kind: "number", description: "", config: { min: null, max: null, decimals: 0, unit: "ft" } },
  { id: "f-class", name: "Class", kind: "text", description: "", config: { multiline: false } },
];

const base = { name: "Goblin", itemId: "item-1", side: "foes" as const, rules, definitions };

describe("combatantFromValues", () => {
  it("copies health, the initiative bonus and the combat properties", () => {
    const values = new Map<string, { raw: unknown }>([
      ["f-hp", { raw: { current: 7, max: 9 } }],
      ["f-dex", { raw: 3 }],
      ["f-ac", { raw: 15 }],
      ["f-speed", { raw: 30 }],
      ["f-class", { raw: "Skirmisher" }],
    ]);
    const spec = combatantFromValues({ ...base, values });
    expect(spec.health).toEqual({ current: 7, max: 9 });
    expect(spec.bonus).toBe(3);
    expect(spec.stats).toEqual([
      { label: "Armor class", value: "15" },
      { label: "Speed", value: "30 ft" },
      { label: "Class", value: "Skirmisher" },
    ]);
    expect([spec.name, spec.itemId, spec.side]).toEqual(["Goblin", "item-1", "foes"]);
  });

  it("leaves out what the page doesn't have, and values that don't fit", () => {
    const values = new Map<string, { raw: unknown }>([
      ["f-hp", { raw: "lots" }],
      ["f-dex", { raw: "high" }],
      ["f-ac", { raw: 12 }],
    ]);
    const spec = combatantFromValues({ ...base, values });
    expect(spec.health).toBeNull();
    expect(spec.bonus).toBe(0);
    expect(spec.stats).toEqual([{ label: "Armor class", value: "12" }]);
  });

  it("works without a ruleset: just a name", () => {
    const spec = combatantFromValues({ ...base, rules: null, values: new Map() });
    expect(spec.health).toBeNull();
    expect(spec.stats).toEqual([]);
  });

  it("ignores properties the project no longer has", () => {
    const spec = combatantFromValues({ ...base, definitions: [], values: new Map([["f-hp", { raw: { current: 1, max: 1 } }]]) });
    expect(spec.health).toBeNull();
  });
});
