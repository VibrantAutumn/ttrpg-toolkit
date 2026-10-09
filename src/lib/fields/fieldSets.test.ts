import { describe, expect, it } from "vitest";
import { newDefinition } from "./definition";
import { fieldsToShow, type FieldSet } from "./fieldSets";

const defs = ["Race", "Class", "Faction", "Age", "Zeal"].map((name, i) => newDefinition("text", `f${i + 1}`, name));
const [race, cls, faction, age, zeal] = defs;
const sets: FieldSet[] = [
  { id: "npc", name: "NPC", description: "", fieldIds: [race.id, cls.id, faction.id] },
  { id: "combat", name: "Combat", description: "", fieldIds: [cls.id, age.id] },
];

const names = (shown: ReturnType<typeof fieldsToShow>) => shown.map((s) => s.definition.name);

describe("fieldsToShow", () => {
  it("shows the fields of the applied sets, in the sets' order", () => {
    expect(names(fieldsToShow({ appliedSetIds: ["npc"], sets, definitions: defs, fieldIdsWithValues: new Set() }))).toEqual(["Race", "Class", "Faction"]);
  });

  it("shows a field once even if several sets have it, under the first set", () => {
    const shown = fieldsToShow({ appliedSetIds: ["npc", "combat"], sets, definitions: defs, fieldIdsWithValues: new Set() });
    expect(names(shown)).toEqual(["Race", "Class", "Faction", "Age"]);
    expect(shown.map((s) => s.setId)).toEqual(["npc", "npc", "npc", "combat"]);
  });

  it("uses the order the sets were applied in", () => {
    expect(names(fieldsToShow({ appliedSetIds: ["combat", "npc"], sets, definitions: defs, fieldIdsWithValues: new Set() }))).toEqual(["Class", "Age", "Race", "Faction"]);
  });

  it("also shows any other field that has a value, after the sets, alphabetically, outside any set", () => {
    const shown = fieldsToShow({ appliedSetIds: ["npc"], sets, definitions: defs, fieldIdsWithValues: new Set([zeal.id, age.id, race.id]) });
    expect(names(shown)).toEqual(["Race", "Class", "Faction", "Age", "Zeal"]);
    expect(shown.map((s) => s.setId)).toEqual(["npc", "npc", "npc", null, null]);
  });

  it("skips fields and sets that no longer exist", () => {
    const withGhost: FieldSet[] = [{ id: "npc", name: "NPC", description: "", fieldIds: ["gone", race.id] }];
    expect(names(fieldsToShow({ appliedSetIds: ["npc", "deleted-set"], sets: withGhost, definitions: defs, fieldIdsWithValues: new Set(["also-gone"]) }))).toEqual(["Race"]);
  });

  it("shows nothing for an item with no sets and no values", () => {
    expect(fieldsToShow({ appliedSetIds: [], sets, definitions: defs, fieldIdsWithValues: new Set() })).toEqual([]);
  });
});
