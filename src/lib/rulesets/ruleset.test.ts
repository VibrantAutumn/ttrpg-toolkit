import { describe, expect, it } from "vitest";
import { emptyRuleset, normalizeRuleset, parseRuleset, problemsWith, removeField, toBundle, uniqueKey, type Ruleset } from "./ruleset";

const sample = {
  version: 1,
  fields: [
    { key: "hp", name: "Hit points", kind: "bar", description: "", config: { decimals: 0 } },
    { key: "dex", name: "Dexterity", kind: "number", description: "", config: {} },
    { key: "ac", name: "Armor class", kind: "number", description: "", config: {} },
    { key: "notes", name: "Notes", kind: "text", description: "", config: {} },
  ],
  statBlocks: [{ key: "monster", name: "Monster", description: "", fields: ["hp", "dex", "ac"] }],
  formulas: [{ name: "Attack", notation: "1d20+5" }],
  encounter: {
    initiative: { type: "group", formula: "1d20", bonusField: "dex", order: "high" },
    statuses: [{ id: "poisoned", name: "Poisoned", notes: "Disadvantage on attacks", duration: 3, color: "#2f9e44" }],
    healthField: "hp",
    combatFields: ["ac"],
  },
};

function read(raw: unknown) {
  const r = normalizeRuleset(raw);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("normalizeRuleset", () => {
  it("reads a good ruleset without warnings", () => {
    const { ruleset, warnings } = read(sample);
    expect(warnings).toEqual([]);
    expect(ruleset.fields).toHaveLength(4);
    expect(ruleset.encounter.initiative.type).toBe("group");
    expect(ruleset.encounter.statuses[0].duration).toBe(3);
  });

  it("is stable: reading its own result changes nothing", () => {
    const once = read(sample).ruleset;
    expect(read(once).ruleset).toEqual(once);
  });

  it("gives the plain defaults for an empty object", () => {
    expect(read({}).ruleset).toEqual(emptyRuleset());
  });

  it("refuses things that are not rulesets and rulesets from a newer app", () => {
    for (const bad of [null, 5, "x", []]) expect(normalizeRuleset(bad).ok).toBe(false);
    const newer = normalizeRuleset({ version: 99 });
    expect(newer.ok).toBe(false);
  });

  it("drops stat block properties that don't exist, and says so", () => {
    const { ruleset, warnings } = read({ ...sample, statBlocks: [{ key: "m", name: "M", fields: ["hp", "nope", "hp"] }] });
    expect(ruleset.statBlocks[0].fields).toEqual(["hp"]);
    expect(warnings.length).toBe(1);
  });

  it("drops repeated property names and keys", () => {
    const { ruleset, warnings } = read({
      fields: [
        { key: "a", name: "Strength", kind: "number" },
        { key: "b", name: "strength", kind: "number" },
        { key: "a", name: "Other", kind: "number" },
      ],
    });
    expect(ruleset.fields.map((f) => f.key)).toEqual(["a"]);
    expect(warnings).toHaveLength(2);
  });

  it("clears a bonus that is not a number and a health property that is not a bar", () => {
    const { ruleset, warnings } = read({ ...sample, encounter: { ...sample.encounter, initiative: { ...sample.encounter.initiative, bonusField: "notes" }, healthField: "ac" } });
    expect(ruleset.encounter.initiative.bonusField).toBeNull();
    expect(ruleset.encounter.healthField).toBeNull();
    expect(warnings).toHaveLength(2);
  });

  it("resets an initiative formula that doesn't parse, but allows a blank one", () => {
    expect(read({ encounter: { initiative: { formula: "2d" } } }).ruleset.encounter.initiative.formula).toBe("1d20");
    expect(read({ encounter: { initiative: { formula: "" } } }).ruleset.encounter.initiative.formula).toBe("");
  });

  it("drops formulas that don't parse and repeated status names", () => {
    const { ruleset } = read({
      formulas: [{ name: "Bad", notation: "banana" }, { name: "Good", notation: "2d6" }],
      encounter: { statuses: [{ id: "a", name: "Prone" }, { id: "b", name: "prone" }] },
    });
    expect(ruleset.formulas.map((f) => f.name)).toEqual(["Good"]);
    expect(ruleset.encounter.statuses).toHaveLength(1);
  });

  it("keeps the health property out of the combat columns", () => {
    const { ruleset } = read({ ...sample, encounter: { ...sample.encounter, combatFields: ["hp", "ac", "ac"] } });
    expect(ruleset.encounter.combatFields).toEqual(["ac"]);
  });

  it("never throws on random junk", () => {
    const junk: unknown[] = [undefined, { fields: 4 }, { fields: [null, 3, {}] }, { statBlocks: [{ fields: "x" }] }, { encounter: 5 }, { encounter: { statuses: [1, { id: 1 }] } }];
    for (const j of junk) expect(() => normalizeRuleset(j)).not.toThrow();
  });
});

describe("parseRuleset", () => {
  it("reads stored text", () => {
    expect(parseRuleset(JSON.stringify(sample)).ok).toBe(true);
    expect(parseRuleset("not json").ok).toBe(false);
  });
});

describe("editing helpers", () => {
  it("uniqueKey makes keys that are not taken", () => {
    expect(uniqueKey("Hit Points", [])).toBe("hit-points");
    expect(uniqueKey("Hit Points", ["hit-points"])).toBe("hit-points-2");
    expect(uniqueKey("!!!", [])).toBe("item");
  });

  it("removeField takes the property out everywhere", () => {
    const base = read(sample).ruleset;
    const out = removeField(base, "dex");
    expect(out.fields.map((f) => f.key)).not.toContain("dex");
    expect(out.statBlocks[0].fields).toEqual(["hp", "ac"]);
    expect(out.encounter.initiative.bonusField).toBeNull();
    expect(removeField(base, "hp").encounter.healthField).toBeNull();
    expect(removeField(base, "ac").encounter.combatFields).toEqual([]);
  });

  it("problemsWith asks for a name and notices empty stat blocks", () => {
    const base = read(sample).ruleset;
    expect(problemsWith("D20", base)).toEqual([]);
    expect(problemsWith("  ", base)).toHaveLength(1);
    const empty: Ruleset = { ...base, statBlocks: [{ key: "x", name: "Ship", description: "", fields: [] }] };
    expect(problemsWith("D20", empty)).toHaveLength(1);
  });
});

describe("toBundle", () => {
  it("makes a property set per stat block and installs only the properties in use", () => {
    const bundle = toBundle(read(sample).ruleset);
    expect(bundle.sets).toEqual([{ key: "monster", name: "Monster", description: "", fieldKeys: ["hp", "dex", "ac"] }]);
    expect(bundle.fields.map((f) => f.key)).toEqual(["hp", "dex", "ac"]);
    expect(bundle.formulas).toEqual([{ name: "Attack", notation: "1d20+5" }]);
    expect(JSON.parse(bundle.fields[0].configJson)).toEqual({ decimals: 0 });
  });
});
