import { describe, expect, it } from "vitest";
import { addCombatants, addStatus, adjustHealth, nextTurn, setDefeated, start, updateCombatant, type CombatantSpec, type Outcome } from "./engine";
import { publicView } from "./publicView";
import { newEncounterState, type EncounterState } from "./state";

const ok = (o: Outcome): EncounterState => {
  if (!o.ok) throw new Error(o.message);
  return o.state;
};
const spec = (name: string, side: "party" | "foes", extra: Partial<CombatantSpec> = {}): CombatantSpec => ({ name, side, ...extra });

function scene(type: "individual" | "group" | "popcorn" = "individual", foeHealth: "description" | "hidden" = "description"): EncounterState {
  let s = newEncounterState(3, { initiativeType: type, formula: "", foeHealth });
  s = ok(addCombatants(s, spec("Ana", "party", { health: { current: 12, max: 20 }, initiative: 18 })));
  s = ok(addCombatants(s, spec("Ogre", "foes", { health: { current: 30, max: 60 }, initiative: 12, notes: "Has the key" })));
  s = ok(addCombatants(s, spec("Assassin", "foes", { health: { current: 9, max: 9 }, initiative: 25, hidden: true, notes: "Poisoned blade" })));
  return s;
}

describe("publicView", () => {
  it("leaves hidden combatants out entirely, whatever the order", () => {
    for (const type of ["individual", "group", "popcorn"] as const) {
      const view = publicView(scene(type), "Ambush");
      expect(view.combatants.map((c) => c.name), type).not.toContain("Assassin");
      expect(view.combatants).toHaveLength(2);
    }
  });

  it("shows party health as numbers and foe health as a word, or not at all", () => {
    let s = scene();
    let view = publicView(s, "x");
    expect(view.combatants.find((c) => c.name === "Ana")?.health).toBe("12 / 20");
    expect(view.combatants.find((c) => c.name === "Ogre")?.health).toBe("Bloodied");
    s = ok(adjustHealth(s, s.combatants[1].id, -20));
    view = publicView(s, "x");
    expect(view.combatants.find((c) => c.name === "Ogre")?.health).toBe("Critical");
    view = publicView(scene("individual", "hidden"), "x");
    expect(view.combatants.find((c) => c.name === "Ogre")?.health).toBeNull();
  });

  it("never carries notes, initiative numbers, ids or status notes", () => {
    let s = scene();
    s = ok(addStatus(s, s.combatants[1].id, { name: "Poisoned", notes: "Disadvantage on attacks; GM: dies at 3", duration: 3, color: "#2f9e44" }));
    const text = JSON.stringify(publicView(s, "Ambush"));
    for (const secret of ["Has the key", "Poisoned blade", "Assassin", "Disadvantage", "dies at 3", "c1", "c2", "initiative"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain("Poisoned"); // the status name itself is shown
  });

  it("lists the individual order with defeated combatants last, and marks whose turn it is", () => {
    let s = ok(start(scene()));
    let view = publicView(s, "x");
    expect(view.combatants.map((c) => c.name)).toEqual(["Ana", "Ogre"]);
    // The hidden assassin acts first; the display doesn't say whose turn it is (it must not reveal them).
    expect(view.combatants.some((c) => c.current)).toBe(false);
    expect(view.round).toBe(1);
    s = ok(nextTurn(s));
    expect(publicView(s, "x").combatants[0].current).toBe(true);
    s = ok(setDefeated(s, s.combatants[0].id, true));
    view = publicView(s, "x");
    expect(view.combatants.map((c) => [c.name, c.defeated])).toEqual([["Ogre", false], ["Ana", true]]);
  });

  it("under group initiative lists the side whose turn it is first and says so", () => {
    const s = ok(start(scene("group")));
    const view = publicView(s, "x");
    expect(view.side).toBe("party");
    expect(view.sideLabel).toBe("Party");
    expect(view.combatants.map((c) => c.side)).toEqual(["party", "foes"]);
  });

  it("a combatant hidden later disappears from the view", () => {
    let s = scene();
    expect(publicView(s, "x").combatants).toHaveLength(2);
    s = ok(updateCombatant(s, s.combatants[1].id, { hidden: true }));
    expect(publicView(s, "x").combatants.map((c) => c.name)).toEqual(["Ana"]);
  });

  it("is plain data that survives being sent as text", () => {
    const view = publicView(ok(start(scene())), "Ambush");
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
