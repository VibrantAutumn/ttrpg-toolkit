import { describe, expect, it } from "vitest";
import {
  addCombatants,
  addStatus,
  adjustHealth,
  canUndo,
  finish,
  nextTurn,
  outcomeText,
  pickTurn,
  removeCombatant,
  removeStatus,
  resume,
  rollInitiative,
  setDefeated,
  setFoeHealthDisplay,
  setHealth,
  setInitiative,
  setInitiativeFormula,
  setInitiativeType,
  setSideInitiative,
  start,
  toggleActed,
  undo,
  updateCombatant,
  type CombatantSpec,
  type Outcome,
} from "./engine";
import { combatantName, newEncounterState, normalizeEncounterState, turnOrder, type EncounterState } from "./state";

/** Unwraps an outcome that should have worked. */
function ok(outcome: Outcome): EncounterState {
  if (!outcome.ok) throw new Error(`expected success, got: ${outcome.message}`);
  return outcome.state;
}
const refused = (outcome: Outcome): string => {
  if (outcome.ok) throw new Error("expected a refusal");
  return outcome.message;
};

const fresh = (options: Parameters<typeof newEncounterState>[1] = {}) => newEncounterState(7, options);
const spec = (name: string, side: "party" | "foes" = "foes", extra: Partial<CombatantSpec> = {}): CombatantSpec => ({ name, side, ...extra });
const names = (state: EncounterState) => state.combatants.map(combatantName);
const idOf = (state: EncounterState, name: string) => state.combatants.find((c) => combatantName(c) === name)!.id;
const lastLog = (state: EncounterState) => state.log[state.log.length - 1]?.text ?? "";

/** An encounter with a party of two and three goblins, initiative entered by hand: Ana 20, Bo 15, Goblin 1 10, Goblin 2 5, Goblin 3 1. */
function ready(type: "individual" | "group" | "popcorn" = "individual"): EncounterState {
  let s = fresh({ initiativeType: type, formula: "" });
  s = ok(addCombatants(s, spec("Ana", "party")));
  s = ok(addCombatants(s, spec("Bo", "party")));
  s = ok(addCombatants(s, spec("Goblin", "foes"), 3));
  if (type === "individual") {
    for (const [name, value] of [["Ana", 20], ["Bo", 15], ["Goblin 1", 10], ["Goblin 2", 5], ["Goblin 3", 1]] as const) s = ok(setInitiative(s, idOf(s, name), value));
  }
  return s;
}

describe("adding combatants", () => {
  it("numbers duplicates: a lone name stays plain, the second makes both numbered", () => {
    let s = ok(addCombatants(fresh(), spec("Goblin")));
    expect(names(s)).toEqual(["Goblin"]);
    s = ok(addCombatants(s, spec("goblin")));
    expect(names(s)).toEqual(["Goblin 1", "goblin 2"]);
    s = ok(addCombatants(s, spec("Orc")));
    expect(names(s)).toEqual(["Goblin 1", "goblin 2", "Orc"]);
  });

  it("adds several at once and numbers them from one", () => {
    const s = ok(addCombatants(fresh(), spec("Wolf"), 3));
    expect(names(s)).toEqual(["Wolf 1", "Wolf 2", "Wolf 3"]);
    expect(new Set(s.combatants.map((c) => c.id)).size).toBe(3);
  });

  it("never reuses a number after one leaves", () => {
    let s = ok(addCombatants(fresh(), spec("Wolf"), 3));
    s = ok(removeCombatant(s, idOf(s, "Wolf 2")));
    s = ok(addCombatants(s, spec("Wolf")));
    expect(names(s)).toEqual(["Wolf 1", "Wolf 3", "Wolf 4"]);
  });

  it("gives each copy its own health bar and statuses", () => {
    let s = ok(addCombatants(fresh(), spec("Wolf", "foes", { health: { current: 11, max: 11 } }), 2));
    s = ok(adjustHealth(s, idOf(s, "Wolf 1"), -4));
    s = ok(addStatus(s, idOf(s, "Wolf 1"), { name: "Prone" }));
    expect(s.combatants[0].health).toEqual({ current: 7, max: 11 });
    expect(s.combatants[1].health).toEqual({ current: 11, max: 11 });
    expect(s.combatants[1].statuses).toEqual([]);
  });

  it("refuses blank names, too many and a finished encounter", () => {
    expect(refused(addCombatants(fresh(), spec("  ")))).toMatch(/name/);
    expect(refused(addCombatants(fresh(), spec("X"), 61))).toMatch(/at most 60/);
    let s = ready();
    s = ok(start(s));
    s = ok(finish(s));
    expect(refused(addCombatants(s, spec("Late")))).toMatch(/over/);
  });

  it("never changes the state it was given", () => {
    const before = fresh();
    const frozen = JSON.stringify(before);
    ok(addCombatants(before, spec("Goblin"), 2));
    expect(JSON.stringify(before)).toBe(frozen);
  });
});

describe("initiative", () => {
  it("orders by result, then bonus, then the order added; blanks last", () => {
    let s = fresh({ formula: "" });
    for (const [n, i, b] of [["A", 10, 0], ["B", 10, 3], ["C", null, 0], ["D", 12, 0], ["E", 10, 0]] as const) {
      s = ok(addCombatants(s, spec(n, "foes", { initiative: i, bonus: b })));
    }
    expect(turnOrder(s).map(combatantName)).toEqual(["D", "B", "A", "E", "C"]);
    expect(turnOrder({ ...s, order: "low" }).map(combatantName)).toEqual(["B", "A", "E", "D", "C"]);
  });

  it("rolls with the formula and adds each combatant's bonus", () => {
    let s = fresh({ formula: "1d1+9" });
    s = ok(addCombatants(s, spec("A", "party", { bonus: 2 })));
    s = ok(addCombatants(s, spec("B", "foes")));
    s = ok(rollInitiative(s));
    expect(s.combatants.map((c) => c.initiative)).toEqual([12, 10]);
    expect(lastLog(s)).toMatch(/Initiative rolled/);
  });

  it("can roll only for those without a result", () => {
    let s = fresh({ formula: "1d1+9" });
    s = ok(addCombatants(s, spec("A", "party", { initiative: 3 })));
    s = ok(addCombatants(s, spec("B", "foes")));
    s = ok(rollInitiative(s, { onlyMissing: true }));
    expect(s.combatants.map((c) => c.initiative)).toEqual([3, 10]);
    expect(refused(rollInitiative(s, { onlyMissing: true }))).toMatch(/Nobody/);
  });

  it("rolls are reproducible from the seed and counter, and rerolling gives new numbers", () => {
    const make = () => ok(addCombatants(addCombatants(newEncounterState(99, { formula: "1d20" }), spec("A")).ok ? ok(addCombatants(newEncounterState(99, { formula: "1d20" }), spec("A"))) : fresh(), spec("B")));
    const a = ok(rollInitiative(make()));
    const b = ok(rollInitiative(make()));
    expect(a.combatants.map((c) => c.initiative)).toEqual(b.combatants.map((c) => c.initiative));
    expect(a.counter).toBe(2);
    const again = ok(rollInitiative(a));
    expect(again.counter).toBe(4);
  });

  it("says why it can't roll", () => {
    let s = ok(addCombatants(fresh({ formula: "" }), spec("A")));
    expect(refused(rollInitiative(s))).toMatch(/no initiative roll/);
    s = ok(addCombatants(fresh({ formula: "nope" }), spec("A")));
    expect(refused(rollInitiative(s))).toMatch(/isn't a dice formula/);
    expect(refused(rollInitiative(ok(addCombatants(fresh({ initiativeType: "popcorn" }), spec("A")))))).toMatch(/Popcorn/);
  });

  it("checks the formula before changing it", () => {
    expect(refused(setInitiativeFormula(fresh(), "banana"))).toMatch(/dice formula/);
    expect(ok(setInitiativeFormula(fresh(), " 2d6 ")).formula).toBe("2d6");
    expect(ok(setInitiativeFormula(fresh(), "")).formula).toBe("");
  });

  it("under group initiative each side rolls once and the higher goes first (ties to the party)", () => {
    let s = fresh({ initiativeType: "group", formula: "1d1+9" });
    s = ok(addCombatants(s, spec("A", "party")));
    s = ok(addCombatants(s, spec("B", "foes")));
    s = ok(rollInitiative(s));
    expect(s.sideInitiative).toEqual({ party: 10, foes: 10 });
    expect(s.firstSide).toBe("party");
    s = ok(setSideInitiative(s, "foes", 15));
    expect(s.firstSide).toBe("foes");
    s = ok(setSideInitiative(setInitiativeTypeLow(s), "foes", 15));
    expect(s.firstSide).toBe("party");
  });
});

function setInitiativeTypeLow(s: EncounterState): EncounterState {
  return { ...s, order: "low" };
}

describe("individual turns", () => {
  it("starts at the top of the order and walks down it, then a new round", () => {
    let s = ok(start(ready()));
    expect(s.phase).toBe("running");
    expect(s.round).toBe(1);
    expect(combatantName(s.combatants.find((c) => c.id === s.turn)!)).toBe("Ana");
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      s = ok(nextTurn(s));
      seen.push(combatantName(s.combatants.find((c) => c.id === s.turn)!));
    }
    expect(seen).toEqual(["Bo", "Goblin 1", "Goblin 2", "Goblin 3", "Ana"]);
    expect(s.round).toBe(2);
  });

  it("skips defeated combatants", () => {
    let s = ok(start(ready()));
    s = ok(setDefeated(s, idOf(s, "Bo"), true));
    s = ok(nextTurn(s));
    expect(combatantName(s.combatants.find((c) => c.id === s.turn)!)).toBe("Goblin 1");
  });

  it("refuses when everyone is defeated or the encounter isn't running", () => {
    expect(refused(nextTurn(ready()))).toMatch(/isn't running/);
    let s = ok(start(ready()));
    for (const c of s.combatants) s = ok(setDefeated(s, c.id, true));
    expect(refused(nextTurn(s))).toMatch(/defeated/);
  });

  it("rolls missing initiative when it starts, if there is a formula; asks for it by hand if not", () => {
    let s = fresh({ formula: "1d1+9" });
    s = ok(addCombatants(s, spec("A", "party")));
    s = ok(start(s));
    expect(s.combatants[0].initiative).toBe(10);
    let t = ok(addCombatants(fresh({ formula: "" }), spec("A", "party")));
    expect(refused(start(t))).toMatch(/initiative first/);
    t = ok(setInitiative(t, t.combatants[0].id, 3));
    expect(ok(start(t)).phase).toBe("running");
    expect(refused(start(fresh()))).toMatch(/at least one/);
  });

  it("removing the combatant whose turn it is passes the turn on", () => {
    let s = ok(start(ready()));
    s = ok(removeCombatant(s, idOf(s, "Ana")));
    expect(combatantName(s.combatants.find((c) => c.id === s.turn)!)).toBe("Bo");
    expect(names(s)).not.toContain("Ana");
  });

  it("removing the last one in the order wraps to a new round", () => {
    let s = ok(start(ready()));
    for (let i = 0; i < 4; i++) s = ok(nextTurn(s));
    expect(combatantName(s.combatants.find((c) => c.id === s.turn)!)).toBe("Goblin 3");
    s = ok(removeCombatant(s, idOf(s, "Goblin 3")));
    expect(s.round).toBe(2);
    expect(combatantName(s.combatants.find((c) => c.id === s.turn)!)).toBe("Ana");
  });
});

describe("group turns", () => {
  it("the first side goes, then the other, then a new round", () => {
    let s = ready("group");
    s = ok(setSideInitiative(s, "party", 5));
    s = ok(setSideInitiative(s, "foes", 12));
    s = ok(start(s));
    expect(s.side).toBe("foes");
    s = ok(nextTurn(s));
    expect(s.side).toBe("party");
    expect(s.round).toBe(1);
    s = ok(nextTurn(s));
    expect(s.side).toBe("foes");
    expect(s.round).toBe(2);
  });

  it("skips a side with nobody left standing", () => {
    let s = ok(start(ready("group")));
    expect(s.side).toBe("party");
    for (const c of s.combatants.filter((c) => c.side === "foes")) s = ok(setDefeated(s, c.id, true));
    s = ok(nextTurn(s));
    expect(s.side).toBe("party");
    expect(s.round).toBe(2);
  });

  it("starts on the party when it was never rolled and there is no formula", () => {
    expect(ok(start(ready("group"))).side).toBe("party");
  });
});

describe("popcorn turns", () => {
  it("whoever just went picks who is next, and a new round starts when everyone has gone", () => {
    let s = ok(start(ready("popcorn")));
    expect(s.turn).toBeNull();
    expect(refused(nextTurn(s))).toMatch(/Pick/);
    s = ok(pickTurn(s, idOf(s, "Bo")));
    expect(s.turn).toBe(idOf(s, "Bo"));
    s = ok(nextTurn(s, idOf(s, "Goblin 2")));
    expect(refused(nextTurn(s, idOf(s, "Bo")))).toMatch(/already gone/);
    for (const name of ["Ana", "Goblin 1", "Goblin 3"]) s = ok(nextTurn(s, idOf(s, name)));
    expect(s.round).toBe(1);
    // Everyone has now gone except the one acting; the next hand-over starts round 2.
    s = ok(nextTurn(s, idOf(s, "Bo")));
    expect(s.round).toBe(2);
    expect(s.turn).toBe(idOf(s, "Bo"));
    expect(s.acted).toEqual([]);
  });

  it("can't be picked outside a running popcorn encounter, or a defeated combatant", () => {
    expect(refused(pickTurn(ready(), "c1"))).toMatch(/popcorn/);
    let s = ok(start(ready("popcorn")));
    s = ok(setDefeated(s, idOf(s, "Bo"), true));
    expect(refused(pickTurn(s, idOf(s, "Bo")))).toMatch(/can't take a turn/);
  });
});

describe("health", () => {
  const withHealth = () => ok(addCombatants(fresh(), spec("Orc", "foes", { health: { current: 10, max: 15 } })));

  it("damage and healing stay between 0 and the maximum, and are logged", () => {
    let s = withHealth();
    const id = s.combatants[0].id;
    s = ok(adjustHealth(s, id, -4));
    expect(s.combatants[0].health).toEqual({ current: 6, max: 15 });
    expect(lastLog(s)).toBe("Orc takes 4 damage (6/15).");
    s = ok(adjustHealth(s, id, -50));
    expect(s.combatants[0].health?.current).toBe(0);
    s = ok(adjustHealth(s, id, 100));
    expect(s.combatants[0].health?.current).toBe(15);
    expect(lastLog(s)).toBe("Orc recovers 15 (15/15).");
  });

  it("needs a health bar and a number", () => {
    const s = ok(addCombatants(fresh(), spec("Ghost")));
    expect(refused(adjustHealth(s, s.combatants[0].id, -3))).toMatch(/no health/);
    const w = withHealth();
    expect(refused(adjustHealth(w, w.combatants[0].id, 0))).toMatch(/Type how much/);
    expect(refused(adjustHealth(w, w.combatants[0].id, Number.NaN))).toMatch(/Type how much/);
  });

  it("can be set outright, given a bar later, or removed", () => {
    let s = ok(addCombatants(fresh(), spec("Ghost")));
    const id = s.combatants[0].id;
    s = ok(setHealth(s, id, { current: 5, max: 5 }));
    expect(s.combatants[0].health).toEqual({ current: 5, max: 5 });
    s = ok(setHealth(s, id, null));
    expect(s.combatants[0].health).toBeNull();
  });
});

describe("statuses", () => {
  it("counts down each new round and removes the status when it ends", () => {
    let s = ok(start(ready()));
    const goblin = idOf(s, "Goblin 1");
    s = ok(addStatus(s, goblin, { name: "Poisoned", duration: 2 }));
    s = ok(addStatus(s, goblin, { name: "Prone" }));
    for (let i = 0; i < 5; i++) s = ok(nextTurn(s)); // into round 2
    expect(s.round).toBe(2);
    expect(s.combatants.find((c) => c.id === goblin)!.statuses.map((x) => [x.name, x.remaining])).toEqual([["Poisoned", 1], ["Prone", null]]);
    for (let i = 0; i < 5; i++) s = ok(nextTurn(s)); // into round 3
    expect(s.combatants.find((c) => c.id === goblin)!.statuses.map((x) => x.name)).toEqual(["Prone"]);
    expect(s.log.some((e) => /Poisoned ended on Goblin 1/.test(e.text))).toBe(true);
  });

  it("adding one it already has renews it instead of doubling it", () => {
    let s = ok(addCombatants(fresh(), spec("Orc")));
    const id = s.combatants[0].id;
    s = ok(addStatus(s, id, { name: "Poisoned", duration: 1 }));
    s = ok(addStatus(s, id, { name: "poisoned", duration: 5 }));
    expect(s.combatants[0].statuses).toHaveLength(1);
    expect(s.combatants[0].statuses[0].remaining).toBe(5);
  });

  it("can be removed, and refuses a status that isn't there or has no name", () => {
    let s = ok(addCombatants(fresh(), spec("Orc")));
    const id = s.combatants[0].id;
    s = ok(addStatus(s, id, { name: "Prone", notes: "On the ground", color: "#a5692c" }));
    const instance = s.combatants[0].statuses[0].id;
    expect(refused(addStatus(s, id, { name: " " }))).toMatch(/name/);
    s = ok(removeStatus(s, id, instance));
    expect(s.combatants[0].statuses).toEqual([]);
    expect(refused(removeStatus(s, id, instance))).toMatch(/isn't there/);
  });
});

describe("settings and edits", () => {
  it("changes initiative type only before the start", () => {
    let s = ok(setInitiativeType(fresh(), "group"));
    expect(s.initiativeType).toBe("group");
    s = ok(addCombatants(s, spec("A", "party")));
    s = ok(start(s));
    expect(refused(setInitiativeType(s, "popcorn"))).toMatch(/before/);
  });

  it("renames, moves sides, hides and notes", () => {
    let s = ok(addCombatants(fresh(), spec("Goblin"), 2));
    const id = idOf(s, "Goblin 2");
    s = ok(updateCombatant(s, id, { name: "Archer", side: "party", hidden: true, notes: "secret plan", bonus: 3 }));
    const c = s.combatants[1];
    expect([c.baseName, c.number, c.side, c.hidden, c.notes, c.bonus]).toEqual(["Archer", 2, "party", true, "secret plan", 3]);
    expect(refused(updateCombatant(s, id, { name: " " }))).toMatch(/name/);
    expect(refused(updateCombatant(s, "nope", {}))).toMatch(/isn't in/);
  });

  it("marks who has acted", () => {
    let s = ready();
    const id = s.combatants[0].id;
    s = ok(toggleActed(s, id));
    expect(s.acted).toEqual([id]);
    s = ok(toggleActed(s, id));
    expect(s.acted).toEqual([]);
  });

  it("sets how the players see foe health", () => {
    expect(ok(setFoeHealthDisplay(fresh(), "hidden")).foeHealth).toBe("hidden");
  });
});

describe("finishing", () => {
  it("ends, summarizes and can be resumed", () => {
    let s = ok(start(ready()));
    s = ok(setDefeated(s, idOf(s, "Goblin 1"), true));
    s = ok(finish(s));
    expect(s.phase).toBe("finished");
    expect(outcomeText(s)).toBe("Encounter: 1 round. Party standing: Ana, Bo. Foes standing: Goblin 2, Goblin 3. Foes defeated: Goblin 1.");
    expect(refused(nextTurn(s))).toMatch(/isn't running/);
    s = ok(resume(s));
    expect(s.phase).toBe("running");
    expect(refused(resume(s))).toMatch(/isn't over/);
  });
});

describe("undo", () => {
  it("takes back the last change, including its log lines", () => {
    let s = ok(addCombatants(fresh(), spec("Orc", "foes", { health: { current: 10, max: 10 } })));
    const logLength = s.log.length;
    s = ok(adjustHealth(s, s.combatants[0].id, -3));
    expect(s.log.length).toBe(logLength + 1);
    expect(canUndo(s)).toBe(true);
    s = ok(undo(s));
    expect(s.combatants[0].health?.current).toBe(10);
    expect(s.log.length).toBe(logLength);
  });

  it("goes back step by step to the beginning, then says there is nothing left", () => {
    let s = fresh();
    s = ok(addCombatants(s, spec("A")));
    s = ok(addCombatants(s, spec("B")));
    s = ok(undo(s));
    expect(names(s)).toEqual(["A"]);
    s = ok(undo(s));
    expect(names(s)).toEqual([]);
    expect(canUndo(s)).toBe(false);
    expect(refused(undo(s))).toMatch(/nothing to undo/);
  });

  it("undoing a turn restores the turn and the round", () => {
    let s = ok(start(ready()));
    const before = s.turn;
    s = ok(nextTurn(s));
    s = ok(undo(s));
    expect(s.turn).toBe(before);
    expect(s.round).toBe(1);
  });

  it("does not take back the dice: rolling again after an undo gives a new result", () => {
    let s = ok(addCombatants(fresh({ formula: "1d20" }), spec("A")));
    s = ok(rollInitiative(s));
    const first = s.combatants[0].initiative;
    const counter = s.counter;
    s = ok(undo(s));
    expect(s.combatants[0].initiative).toBeNull();
    expect(s.counter).toBe(counter);
    s = ok(rollInitiative(s));
    expect(s.counter).toBe(counter + 1);
    void first;
  });

  it("keeps only the newest 20 steps", () => {
    let s = fresh();
    for (let i = 0; i < 30; i++) s = ok(addCombatants(s, spec(`N${i}`)));
    expect(s.history.length).toBe(20);
    for (let i = 0; i < 20; i++) s = ok(undo(s));
    expect(s.combatants.length).toBe(10);
    expect(canUndo(s)).toBe(false);
  });
});

describe("storing and reading", () => {
  it("a state survives being written and read, and reading its own result changes nothing", () => {
    let s = ok(start(ready()));
    s = ok(addStatus(s, s.combatants[0].id, { name: "Poisoned", duration: 3, color: "#2f9e44" }));
    const read = normalizeEncounterState(JSON.parse(JSON.stringify(s)));
    if (!read.ok) throw new Error(read.error);
    expect(read.state).toEqual(s);
    const again = normalizeEncounterState(JSON.parse(JSON.stringify(read.state)));
    expect(again.ok && again.state).toEqual(read.state);
  });

  it("repairs a turn that points at nobody, drops broken combatants and refuses newer versions", () => {
    const s = ok(start(ready()));
    const broken = { ...JSON.parse(JSON.stringify(s)), turn: "ghost", combatants: [...s.combatants, { id: "", baseName: "x" }, 5, null] };
    const read = normalizeEncounterState(broken);
    if (!read.ok) throw new Error(read.error);
    expect(read.state.turn).toBeNull();
    expect(read.state.combatants).toHaveLength(5);
    expect(normalizeEncounterState({ version: 99 }).ok).toBe(false);
    for (const junk of [null, 4, "x", [], { combatants: 5 }, { log: [1, {}], history: [3] }]) expect(() => normalizeEncounterState(junk)).not.toThrow();
  });
});

describe("a random fight never breaks the rules", () => {
  it("whatever is done, the state stays readable and the turn points at somebody real", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const types = ["individual", "group", "popcorn"] as const;
      let s = newEncounterState(seed, { initiativeType: types[seed % 3], formula: seed % 5 === 0 ? "" : "1d20" });
      let r = seed * 2654435761;
      const next = (n: number) => {
        r = (Math.imul(r, 1103515245) + 12345) >>> 0;
        return r % n;
      };
      for (let step = 0; step < 60; step++) {
        const c = s.combatants;
        const pick = c.length > 0 ? c[next(c.length)] : null;
        const choice = next(12);
        let out: Outcome;
        if (choice === 0 || c.length === 0) out = addCombatants(s, spec(["Orc", "Elf", "Imp"][next(3)], next(2) ? "party" : "foes", { health: { current: 8, max: 8 }, bonus: next(4) }), 1 + next(2));
        else if (choice === 1 && pick) out = removeCombatant(s, pick.id);
        else if (choice === 2 && pick) out = adjustHealth(s, pick.id, next(9) - 4);
        else if (choice === 3 && pick) out = setDefeated(s, pick.id, next(2) === 0);
        else if (choice === 4 && pick) out = addStatus(s, pick.id, { name: ["Prone", "Dazed"][next(2)], duration: next(3) || null });
        else if (choice === 5) out = s.phase === "setup" ? start(s) : finish(s);
        else if (choice === 6) out = undo(s);
        else if (choice === 7) out = rollInitiative(s, { onlyMissing: true });
        else if (pick && s.initiativeType === "popcorn") out = nextTurn(s, pick.id);
        else out = nextTurn(s);
        if (out.ok) s = out.state;
        const read = normalizeEncounterState(JSON.parse(JSON.stringify(s)));
        expect(read.ok).toBe(true);
        if (read.ok) expect(read.state).toEqual(s);
        if (s.turn !== null) expect(s.combatants.some((x) => x.id === s.turn)).toBe(true);
        expect(new Set(s.combatants.map((x) => x.id)).size).toBe(s.combatants.length);
        const labels = s.combatants.map(combatantName);
        expect(new Set(labels).size).toBe(labels.length);
      }
    }
  });
});
