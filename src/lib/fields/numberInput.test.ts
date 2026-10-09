import { describe, expect, it } from "vitest";
import { newDefinition, type FieldDefinition } from "./definition";
import { parseNumberInput } from "./numberInput";

const number = (config: Partial<Extract<FieldDefinition, { kind: "number" }>["config"]> = {}) => {
  const base = newDefinition("number", "f", "STR") as Extract<FieldDefinition, { kind: "number" }>;
  return { ...base, config: { ...base.config, ...config } };
};

describe("parseNumberInput", () => {
  it("reads whole numbers, decimals and negatives", () => {
    expect(parseNumberInput(number(), "14")).toEqual({ ok: true, value: 14 });
    expect(parseNumberInput(number({ decimals: 2 }), "1.25")).toEqual({ ok: true, value: 1.25 });
    expect(parseNumberInput(number(), "-3")).toEqual({ ok: true, value: -3 });
    expect(parseNumberInput(number(), "+3")).toEqual({ ok: true, value: 3 });
    expect(parseNumberInput(number({ decimals: 2 }), ".5")).toEqual({ ok: true, value: 0.5 });
  });

  it("reads a single comma as a decimal point, and the typographic minus", () => {
    expect(parseNumberInput(number({ decimals: 1 }), "1,5")).toEqual({ ok: true, value: 1.5 });
    expect(parseNumberInput(number(), "−7")).toEqual({ ok: true, value: -7 });
  });

  it("ignores spaces around it", () => {
    expect(parseNumberInput(number(), "  42 ")).toEqual({ ok: true, value: 42 });
  });

  it("gives nothing for empty text", () => {
    expect(parseNumberInput(number(), "")).toEqual({ ok: true, value: null });
    expect(parseNumberInput(number(), "   ")).toEqual({ ok: true, value: null });
  });

  it("asks for a number when it is not one", () => {
    for (const text of ["abc", "1.2.3", "1,2,3", "12abc", "--1", "1e5", "."]) {
      expect(parseNumberInput(number(), text)).toEqual({ ok: false, error: "Type a number." });
    }
  });

  it("applies the field's rounding and limits", () => {
    expect(parseNumberInput(number(), "2.6")).toEqual({ ok: true, value: 3 });
    expect(parseNumberInput(number({ min: 1, max: 20 }), "0")).toEqual({ ok: false, error: "Must be at least 1." });
    expect(parseNumberInput(number({ min: 1, max: 20 }), "21")).toEqual({ ok: false, error: "Must be at most 20." });
  });
});
