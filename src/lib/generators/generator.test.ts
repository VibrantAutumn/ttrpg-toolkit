import { describe, expect, it } from "vitest";
import { checkGenerator, emptyGenerator, GENERATOR_LIMITS, GENERATOR_VERSION, isComplete, normalizeGenerator, parseGenerator } from "./generator";

describe("normalizeGenerator", () => {
  it("reads the current shape and trims the text", () => {
    const read = normalizeGenerator({ version: GENERATOR_VERSION, text: "  [Faction] sends [2d4] agents.  " });
    expect(read).toEqual({ ok: true, def: { version: GENERATOR_VERSION, text: "[Faction] sends [2d4] agents." } });
  });

  it("reads a missing text as empty", () => {
    expect(normalizeGenerator({ version: GENERATOR_VERSION })).toEqual({ ok: true, def: emptyGenerator() });
  });

  it("turns a version 1 generator's rows into lines of text, dropping everything else", () => {
    const read = normalizeGenerator({
      version: 1,
      templateId: "t",
      rows: [
        { id: "r1", label: "Name", target: { kind: "name" }, source: "[Names]", fallback: "Plain" },
        { id: "r2", label: "", target: { kind: "text" }, source: "[Rumors]", fallback: "" },
        { id: "r3", label: "Empty", target: { kind: "text" }, source: "  ", fallback: "" },
      ],
    });
    expect(read).toEqual({ ok: true, def: { version: GENERATOR_VERSION, text: "Name: [Names]\n[Rumors]" } });
  });

  it("refuses what it can't read, in a sentence, without throwing", () => {
    for (const raw of [null, 5, "x", [], {}, { version: 0 }, { version: GENERATOR_VERSION, text: 4 }]) {
      const read = normalizeGenerator(raw);
      expect(read.ok).toBe(false);
    }
    expect(normalizeGenerator({ version: 99 })).toEqual({ ok: false, error: "This generator was made by a newer version of the app." });
    expect(normalizeGenerator({ version: GENERATOR_VERSION, text: "x".repeat(GENERATOR_LIMITS.text + 1) }).ok).toBe(false);
  });

  it("reads stored text, and says so when it isn't a generator", () => {
    expect(parseGenerator(JSON.stringify({ version: GENERATOR_VERSION, text: "hi" })).ok).toBe(true);
    expect(parseGenerator("not json")).toEqual({ ok: false, error: "This isn't a generator." });
  });
});

describe("checking the text", () => {
  it("is complete only when there is something to roll", () => {
    expect(isComplete({ version: GENERATOR_VERSION, text: "  " })).toBe(false);
    expect(isComplete({ version: GENERATOR_VERSION, text: "a" })).toBe(true);
  });
  it("accepts good slots and names the problem with bad ones", () => {
    expect(checkGenerator({ version: GENERATOR_VERSION, text: "[Faction] sends [2d4] agents." })).toBeNull();
    expect(checkGenerator({ version: GENERATOR_VERSION, text: "" })).toBeNull();
    expect(checkGenerator({ version: GENERATOR_VERSION, text: "oops [Faction" })).toEqual(expect.any(String));
  });
});
