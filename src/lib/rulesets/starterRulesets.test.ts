import { describe, expect, it } from "vitest";
import { STARTER_RULESETS } from "../../starter/rulesets";
import { normalizeRuleset, problemsWith, toBundle } from "./ruleset";

describe("every starter ruleset", () => {
  it("has some, with different ids and names", () => {
    expect(STARTER_RULESETS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(STARTER_RULESETS.map((s) => s.id)).size).toBe(STARTER_RULESETS.length);
    expect(new Set(STARTER_RULESETS.map((s) => s.name.toLowerCase())).size).toBe(STARTER_RULESETS.length);
  });

  for (const starter of STARTER_RULESETS) {
    describe(starter.name, () => {
      it("has an id the database accepts, a name and a description", () => {
        expect(starter.id.startsWith("starter:")).toBe(true);
        expect(starter.name.trim()).not.toBe("");
        expect(starter.name.length).toBeLessThanOrEqual(60);
        expect(starter.description.trim()).not.toBe("");
        expect(starter.description.length).toBeLessThanOrEqual(500);
      });

      it("is already in the form the reader gives (nothing is repaired or dropped)", () => {
        const read = normalizeRuleset(JSON.parse(JSON.stringify(starter.ruleset)));
        if (!read.ok) throw new Error(read.error);
        expect(read.warnings).toEqual([]);
        expect(read.ruleset).toEqual(starter.ruleset);
      });

      it("has no problems the editor would point out", () => {
        expect(problemsWith(starter.name, starter.ruleset)).toEqual([]);
      });

      it("installs every property its rules use", () => {
        const bundle = toBundle(starter.ruleset);
        const installed = new Set(bundle.fields.map((f) => f.key));
        const { healthField, combatFields, initiative } = starter.ruleset.encounter;
        for (const key of [healthField, ...combatFields, initiative.bonusField]) if (key) expect(installed.has(key), key).toBe(true);
        for (const set of bundle.sets) for (const key of set.fieldKeys) expect(installed.has(key), key).toBe(true);
      });
    });
  }

  it("the blank ruleset is empty and the others have stat blocks, dice and statuses", () => {
    const by = (id: string) => STARTER_RULESETS.find((s) => s.id === id)!.ruleset;
    expect(by("starter:blank").statBlocks).toEqual([]);
    for (const id of ["starter:generic-d20", "starter:generic-narrative"]) {
      const r = by(id);
      expect(r.statBlocks.length).toBeGreaterThan(0);
      expect(r.formulas.length).toBeGreaterThan(0);
      expect(r.encounter.statuses.length).toBeGreaterThan(0);
      expect(r.encounter.healthField).not.toBeNull();
    }
  });
});
