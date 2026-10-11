import { describe, expect, it } from "vitest";
import { parsePublicView, parsePublicViewText } from "./displayChannel";
import { addCombatants, start, type Outcome } from "./engine";
import { publicView } from "./publicView";
import { newEncounterState, type EncounterState } from "./state";

const ok = (o: Outcome): EncounterState => {
  if (!o.ok) throw new Error(o.message);
  return o.state;
};

describe("parsePublicView", () => {
  it("reads back exactly what publicView made", () => {
    let s = newEncounterState(1, { formula: "" });
    s = ok(addCombatants(s, { name: "Ana", side: "party", health: { current: 3, max: 9 }, initiative: 5 }));
    s = ok(addCombatants(s, { name: "Ogre", side: "foes", health: { current: 9, max: 9 }, initiative: 2 }));
    const view = publicView(ok(start(s)), "Ambush");
    expect(parsePublicView(JSON.parse(JSON.stringify(view)))).toEqual(view);
    expect(parsePublicViewText(JSON.stringify(view))).toEqual(view);
  });

  it("gives null for anything that isn't a view, and never throws", () => {
    for (const junk of [null, 5, "x", [], {}, { phase: "dancing" }]) expect(parsePublicView(junk)).toBeNull();
    expect(parsePublicViewText("not json")).toBeNull();
    expect(parsePublicViewText(null)).toBeNull();
  });

  it("drops combatants without a name and leaves out fields it doesn't know (so extra data can't ride along)", () => {
    const view = parsePublicView({
      title: "T",
      phase: "running",
      round: 2,
      combatants: [{ name: "A", side: "party", notes: "GM secret", initiative: 20, hidden: false }, { name: "" }, 4],
    })!;
    expect(view.combatants).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain("GM secret");
    expect(JSON.stringify(view)).not.toContain("initiative");
  });
});
