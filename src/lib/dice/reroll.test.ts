import { describe, expect, it } from "vitest";
import { parseDice } from "./parse";
import { createRng } from "./rng";
import { rollDice, rerollDice } from "./roll";
import { scripted } from "./testing";

function expr(notation: string) {
  const parsed = parseDice(notation);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.expression;
}

describe("rerollDice (lock parts of a result, reroll the rest)", () => {
  const expression = expr("1d20+1d6+2");
  const first = rollDice(expression, scripted(15, 3));

  it("keeps locked terms exactly and rolls the others", () => {
    const rng = scripted(6); // only the unlocked d6 needs a value
    const again = rerollDice(expression, first, new Set([0]), rng);
    expect(again.terms[0]).toEqual(first.terms[0]);
    expect(again.terms[1].subtotal).toBe(6);
    expect(again.total).toBe(15 + 6 + 2);
    expect(rng.remaining()).toBe(0);
  });

  it("with nothing locked, rolls every dice term again", () => {
    const again = rerollDice(expression, first, new Set(), scripted(1, 2));
    expect(again.total).toBe(1 + 2 + 2);
  });

  it("with everything locked, changes nothing and uses no randomness", () => {
    const rng = scripted();
    const again = rerollDice(expression, first, new Set([0, 1, 2]), rng);
    expect(again).toEqual(first);
  });

  it("is reproducible from a seed", () => {
    const a = rerollDice(expression, first, new Set([1]), createRng(7));
    const b = rerollDice(expression, first, new Set([1]), createRng(7));
    expect(a).toEqual(b);
  });

  it("recomputes capped from the terms it ends up with", () => {
    const exploding = expr("1d1!+1d6");
    const capped = rollDice(exploding, scripted(...Array(101).fill(1), 4));
    expect(capped.capped).toBe(true);
    // Lock only the d6 and reroll the exploding term: it hits the cap again.
    const again = rerollDice(exploding, capped, new Set([1]), scripted(...Array(101).fill(1)));
    expect(again.capped).toBe(true);
    // Lock the capped term and it stays capped; reroll just the d6.
    const keepCapped = rerollDice(exploding, capped, new Set([0]), scripted(2));
    expect(keepCapped.capped).toBe(true);
  });

  it("refuses a previous result that came from a different formula", () => {
    const other = rollDice(expr("2d6"), scripted(1, 2));
    expect(() => rerollDice(expression, other, new Set(), scripted(1, 1))).toThrow();
  });
});
