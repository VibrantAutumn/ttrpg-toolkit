import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "../dice/rng";
import { addOption, FIELD_KINDS, newDefinition, normalizeDefinition, validateDefinition, type FieldDefinition } from "./definition";
import { adjustBar, parseBarInput } from "./bar";
import { coerceValue, compareValues, emptyValue, formatValue, indexValue, isEmpty } from "./value";

/**
 * Whatever arrives as a value (typed by a person, read from the database, found in a content
 * pack), the field model must not throw, and what it accepts must be in its one proper form.
 */

const pick = <T>(rng: Rng, items: readonly T[]): T => items[rng.int(0, items.length - 1)];

/** Odd JSON: the right shapes, the wrong shapes, and edge values. */
function randomJson(rng: Rng, depth = 0): unknown {
  const roll = rng.int(1, depth >= 2 ? 8 : 12);
  switch (roll) {
    case 1:
      return null;
    case 2:
      return pick(rng, [0, 1, -1, 2.5, 14, 22, 30, 1e9, -1e9, Number.NaN, Infinity, 0.1 + 0.2]);
    case 3:
      return pick(rng, ["", " ", "text", "1d20+2", "2d", "o1", "o9", "a\nb", "x".repeat(600), "id-1", "id-2"]);
    case 4:
      return rng.int(1, 2) === 1;
    case 5:
      return undefined;
    case 6:
      return pick(rng, ["a", "b", "c"]);
    case 7:
      return { current: pick(rng, [0, 5, 22, -3, 40]), max: pick(rng, [0, 30, -1, 10]) };
    case 8:
      return { title: pick(rng, ["", "Bite", " Claw "]), text: pick(rng, ["", "x", " y "]) };
    case 9:
      return Array.from({ length: rng.int(0, 3) }, () => randomJson(rng, depth + 1));
    case 10:
      return { current: "1", max: 5 };
    case 11:
      return Array.from({ length: rng.int(0, 4) }, () => pick(rng, ["id-1", "id-2", "id-1", "", 3]));
    default:
      return { title: randomJson(rng, depth + 1), text: randomJson(rng, depth + 1) };
  }
}

function randomDefinition(rng: Rng, kind: (typeof FIELD_KINDS)[number]): FieldDefinition {
  let def = newDefinition(kind, "f", "Field");
  if (kind === "dropdown") for (const [i, label] of ["Alive", "Dead", "Missing"].entries()) def = addOption(def, label, `o${i + 1}`);
  if (kind === "text") def = { ...def, config: { multiline: rng.int(1, 2) === 1 } } as FieldDefinition;
  if (kind === "number") def = { ...def, config: { min: pick(rng, [null, 0, -5]), max: pick(rng, [null, 30, 100]), decimals: rng.int(0, 3), unit: pick(rng, ["", "ft"]) } } as FieldDefinition;
  if (kind === "bar") def = { ...def, config: { decimals: rng.int(0, 2) } } as FieldDefinition;
  if (kind === "link") def = { ...def, config: { many: rng.int(1, 2) === 1, library: null, itemTypes: [] } } as FieldDefinition;
  return def;
}

describe("values never break the field model", () => {
  it("coercion never throws, and an accepted value is accepted again unchanged", () => {
    const rng = createRng(2026);
    for (let n = 0; n < 20_000; n++) {
      const def = randomDefinition(rng, pick(rng, FIELD_KINDS));
      const raw = randomJson(rng);
      const first = coerceValue(def, raw);
      if (!first.ok) {
        expect(first.error.length).toBeGreaterThan(0);
        continue;
      }
      const second = coerceValue(def, first.value);
      if (!second.ok || JSON.stringify(second.value) !== JSON.stringify(first.value)) {
        throw new Error(`Not stable for ${def.kind}: ${JSON.stringify(raw)} -> ${JSON.stringify(first.value)} -> ${JSON.stringify(second)}`);
      }
    }
  });

  it("an accepted value can be shown, indexed and compared, and the empty value is always accepted", () => {
    const rng = createRng(7);
    for (let n = 0; n < 10_000; n++) {
      const def = randomDefinition(rng, pick(rng, FIELD_KINDS));
      const empty = emptyValue(def);
      expect(isEmpty(def, empty)).toBe(true);
      const r = coerceValue(def, empty);
      expect(r.ok).toBe(true);
      const made = coerceValue(def, randomJson(rng));
      if (!made.ok) continue;
      const value = made.value;
      expect(typeof formatValue(def, value)).toBe("string");
      const index = indexValue(def, value);
      expect(typeof index.searchText).toBe("string");
      expect(compareValues(def, value, value)).toBe(0);
      expect(Math.sign(compareValues(def, value, empty))).toBe(isEmpty(def, value) ? 0 : -1);
      expect(Math.sign(compareValues(def, empty, value))).toBe(isEmpty(def, value) ? 0 : 1);
    }
  });

  it("sorting is consistent: a before b exactly when b after a", () => {
    const rng = createRng(99);
    for (let n = 0; n < 5_000; n++) {
      const def = randomDefinition(rng, pick(rng, FIELD_KINDS));
      const a = coerceValue(def, randomJson(rng));
      const b = coerceValue(def, randomJson(rng));
      if (!a.ok || !b.ok) continue;
      for (const direction of ["asc", "desc"] as const) {
        // (adding 0 turns -0 into 0, which are the same order but not the same value to toBe)
        expect(Math.sign(compareValues(def, a.value, b.value, direction)) + 0).toBe(-Math.sign(compareValues(def, b.value, a.value, direction)) + 0);
      }
    }
  });
});

describe("definitions never break the field model", () => {
  it("reading any JSON as a definition never throws, is stable, and gives something that checks out or is clearly reported", () => {
    const rng = createRng(31);
    for (let n = 0; n < 10_000; n++) {
      const raw = {
        id: randomJson(rng),
        name: randomJson(rng),
        kind: pick(rng, [...FIELD_KINDS, "date", 3, null]),
        description: randomJson(rng),
        config: pick(rng, [randomJson(rng), { min: randomJson(rng), max: randomJson(rng), decimals: randomJson(rng), unit: randomJson(rng) }, { options: randomJson(rng) }, { many: randomJson(rng), library: randomJson(rng), itemTypes: randomJson(rng) }]),
      };
      const def = normalizeDefinition(raw);
      if (def === null) continue;
      expect(normalizeDefinition(def)).toEqual(def);
      expect(Array.isArray(validateDefinition(def))).toBe(true);
    }
  });
});

describe("bars never break", () => {
  it("typing anything into a bar never throws, and a result is a finite bar or nothing", () => {
    const rng = createRng(5);
    const pieces = ["1", "22", "30", "/", "+", "-", " ", ".", ",", "5", "x", "0", "99"];
    for (let n = 0; n < 10_000; n++) {
      let text = "";
      for (let k = rng.int(0, 6); k > 0; k--) text += pick(rng, pieces);
      const previous = pick(rng, [null, { current: 22, max: 30 }]);
      const result = parseBarInput(text, previous);
      if (result.ok && result.value) {
        expect(Number.isFinite(result.value.current)).toBe(true);
        expect(Number.isFinite(result.value.max)).toBe(true);
      }
    }
  });

  it("adjusting stays within the limits when asked to, from any starting point inside them", () => {
    const rng = createRng(8);
    for (let n = 0; n < 5_000; n++) {
      const max = rng.int(1, 50);
      const bar = { current: rng.int(0, max), max };
      const next = adjustBar(bar, rng.int(-60, 60));
      expect(next.current).toBeGreaterThanOrEqual(0);
      expect(next.current).toBeLessThanOrEqual(max);
    }
  });
});
