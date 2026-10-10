import { describe, expect, it } from "vitest";
import { addDie, DIE_BUTTONS, getModifier, setModifier } from "./builder";
import { parseDice } from "./parse";

describe("addDie", () => {
  it("starts a formula, then counts up the same die", () => {
    let f = "";
    f = addDie(f, 6);
    expect(f).toBe("d6");
    f = addDie(f, 6);
    expect(f).toBe("2d6");
    f = addDie(f, 6);
    expect(f).toBe("3d6");
  });

  it("adds a different die as its own term", () => {
    expect(addDie(addDie("", 6), 8)).toBe("d6+d8");
    expect(addDie("2d6+d8", 8)).toBe("2d6+2d8");
  });

  it("keeps a trailing modifier at the end", () => {
    expect(addDie("d6+3", 8)).toBe("d6+d8+3");
    expect(addDie("d6-2", 6)).toBe("2d6-2");
  });

  it("leaves terms it does not understand alone", () => {
    expect(addDie("4d6kh3", 6)).toBe("4d6kh3+d6");
    expect(addDie("d20 adv", 20)).toBe("d20 adv+d20");
    expect(addDie("6d10>=8", 4)).toBe("6d10>=8+d4");
  });

  it("does not add to a subtracted die", () => {
    expect(addDie("d20-d4", 4)).toBe("d20-d4+d4");
  });

  it("stops at 100 dice of one kind", () => {
    expect(addDie("100d6", 6)).toBe("100d6");
  });

  it("always gives a formula the parser accepts when it was given one", () => {
    for (const sides of DIE_BUTTONS) {
      let f = "";
      for (let i = 0; i < 5; i++) {
        f = addDie(f, sides);
        expect(parseDice(f).ok, f).toBe(true);
      }
      f = setModifier(addDie(f, 6), 4);
      expect(parseDice(f).ok, f).toBe(true);
    }
  });
});

describe("modifier", () => {
  it("reads the plain numbers of a formula", () => {
    expect(getModifier("d20")).toBe(0);
    expect(getModifier("d20+5")).toBe(5);
    expect(getModifier("d20-2")).toBe(-2);
    expect(getModifier("2d6+3+1")).toBe(4);
    expect(getModifier("4d6kh3")).toBe(0);
  });

  it("sets, changes and removes it", () => {
    expect(setModifier("2d6", 3)).toBe("2d6+3");
    expect(setModifier("2d6+3", -1)).toBe("2d6-1");
    expect(setModifier("2d6+3", 0)).toBe("2d6");
    expect(setModifier("d6+d8+2", 5)).toBe("d6+d8+5");
    expect(setModifier("2d6", 2.7)).toBe("2d6+2");
    expect(setModifier("2d6", Number.NaN)).toBe("2d6");
  });
});
