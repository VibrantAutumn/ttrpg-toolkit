import { describe, expect, it } from "vitest";
import { createRng } from "../dice/rng";
import { scripted } from "../dice/testing";
import { generateName, joinName, partsOf } from "./nameGen";
import type { NameGenerator, NameGenSettings, NamePick, PartKey } from "./nameGen";

const entries = (...texts: string[]) => texts.map((text, i) => ({ id: `${text}-${i}`, text, weight: 1 }));

function settings(patch: Partial<NameGenSettings> = {}): NameGenSettings {
  return { mode: "two", join1: "none", join2: "none", capitalisation: "asTyped", mergeDoubles: false, ...patch };
}

function generator(patch: Partial<NameGenSettings>, parts: Partial<Record<PartKey, ReturnType<typeof entries>>>): NameGenerator {
  return { id: "g", name: "Elf names", settings: settings(patch), parts: { full: [], first: [], middle: [], last: [], ...parts } };
}

function make(gen: NameGenerator, rng: Parameters<typeof generateName>[1], keep?: Parameters<typeof generateName>[2]) {
  const r = generateName(gen, rng, keep);
  if (!r.ok) throw new Error(`should generate: ${r.message}`);
  return r.result;
}

describe("partsOf", () => {
  it("lists the lists each mode uses, in the order they are drawn", () => {
    expect(partsOf("full")).toEqual(["full"]);
    expect(partsOf("two")).toEqual(["first", "last"]);
    expect(partsOf("three")).toEqual(["first", "middle", "last"]);
  });
});

describe("generateName: picking", () => {
  const two = generator({}, { first: entries("Ael", "Cal"), last: entries("wen", "dor") });

  it("draws the first part, then the last, each by weight", () => {
    expect(make(two, scripted(2, 1)).name).toBe("Calwen");
    expect(make(two, scripted(1, 2)).name).toBe("Aeldor");
  });

  it("uses entry weights, and never picks a weight of 0", () => {
    const weighted = generator(
      {},
      {
        first: [
          { id: "a", text: "A", weight: 1 },
          { id: "z", text: "Z", weight: 0 },
          { id: "b", text: "B", weight: 3 },
        ],
        last: entries("x"),
      },
    );
    // Total weight 4: roll 4 lands on B; the zero-weight entry takes no part of the range.
    expect(make(weighted, scripted(4, 1)).name).toBe("Bx");
    expect(make(weighted, scripted(2, 1)).name).toBe("Bx");
    expect(make(weighted, scripted(1, 1)).name).toBe("Ax");
  });

  it("draws three parts in order", () => {
    const three = generator({ mode: "three" }, { first: entries("Ael", "Cal"), middle: entries("ar", "ith"), last: entries("wen", "dor") });
    expect(make(three, scripted(1, 2, 2)).name).toBe("Aelithdor");
  });

  it("draws one whole name in full mode, and ignores lists the mode doesn't use", () => {
    const full = generator({ mode: "full" }, { full: entries("Aelwen Silverleaf", "Calith Dawnsong"), first: entries("ignored") });
    expect(make(full, scripted(2)).name).toBe("Calith Dawnsong");
  });

  it("records every pick for the log, with the entry it came from", () => {
    const r = make(two, scripted(2, 1));
    expect(r.picks).toEqual([
      { part: "first", entryId: "Cal-1", text: "Cal" },
      { part: "last", entryId: "wen-0", text: "wen" },
    ]);
  });

  it("is reproducible from a seed", () => {
    const big = generator({}, { first: entries("a", "b", "c", "d", "e"), last: entries("v", "w", "x", "y", "z") });
    expect(make(big, createRng(7)).name).toBe(make(big, createRng(7)).name);
  });

  it("says which list is empty when a part has nothing to pick", () => {
    const noLast = generator({}, { first: entries("Ael") });
    const r = generateName(noLast, scripted(1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/suffix/i);

    const noFirst = generator({}, { last: entries("wen") });
    const r2 = generateName(noFirst, scripted(1));
    expect(!r2.ok && r2.message).toMatch(/prefix/i);

    const onlyZero = generator({ mode: "full" }, { full: [{ id: "a", text: "A", weight: 0 }] });
    const r3 = generateName(onlyZero, scripted(1));
    expect(!r3.ok && r3.message).toMatch(/names/i);
  });

  it("trims entries and turns line breaks inside one into spaces", () => {
    const messy = generator({ mode: "full" }, { full: [{ id: "a", text: "  Aelwen\n  Silverleaf \n", weight: 1 }] });
    expect(make(messy, scripted(1)).name).toBe("Aelwen Silverleaf");
  });
});

describe("generateName: locking parts", () => {
  const two = generator({}, { first: entries("Ael", "Cal"), last: entries("wen", "dor") });

  it("keeps locked parts exactly and draws only the others", () => {
    const first = make(two, scripted(1, 1));
    expect(first.name).toBe("Aelwen");
    const rng = scripted(2); // only the last part is drawn
    const again = make(two, rng, { picks: first.picks, locked: new Set<PartKey>(["first"]) });
    expect(again.name).toBe("Aeldor");
    expect(rng.remaining()).toBe(0);
    expect(again.picks[0]).toEqual(first.picks[0]);
  });

  it("keeps a locked part even if its entry has since been removed from the list", () => {
    const first = make(two, scripted(2, 1));
    const edited = generator({}, { first: entries("Zed"), last: entries("wen", "dor") });
    const again = make(edited, scripted(1), { picks: first.picks, locked: new Set<PartKey>(["first"]) });
    expect(again.name).toBe("Calwen");
  });

  it("draws a locked part afresh if there was no earlier pick for it, or the mode no longer uses it", () => {
    const stale: NamePick[] = [{ part: "middle", entryId: "m", text: "zz" }];
    const r = make(two, scripted(1, 1), { picks: stale, locked: new Set<PartKey>(["middle", "first"]) });
    expect(r.name).toBe("Aelwen");
  });

  it("draws everything again when nothing is locked", () => {
    const first = make(two, scripted(1, 1));
    expect(make(two, scripted(2, 2), { picks: first.picks, locked: new Set() }).name).toBe("Caldor");
  });
});

describe("joinName: separators", () => {
  const join = (texts: string[], patch: Partial<NameGenSettings>) => joinName(texts, settings({ mode: texts.length === 3 ? "three" : "two", ...patch }));

  it("joins with nothing, a space, a hyphen or an apostrophe", () => {
    expect(join(["Ael", "wen"], { join1: "none" })).toBe("Aelwen");
    expect(join(["Anna", "Marie"], { join1: "space" })).toBe("Anna Marie");
    expect(join(["Anna", "Marie"], { join1: "hyphen" })).toBe("Anna-Marie");
    expect(join(["Kel", "drin"], { join1: "apostrophe" })).toBe("Kel'drin");
  });

  it("has a separate setting for each join in a three-part name", () => {
    expect(join(["Ael", "ar", "wen"], { join1: "hyphen", join2: "apostrophe" })).toBe("Ael-ar'wen");
    expect(join(["Ael", "ar", "wen"], { join1: "none", join2: "space" })).toBe("Aelar wen");
  });

  it("does not join a whole name in full mode", () => {
    expect(joinName(["Aelwen Silverleaf"], settings({ mode: "full", join1: "hyphen" }))).toBe("Aelwen Silverleaf");
  });
});

describe("joinName: capitalisation", () => {
  const join = (texts: string[], patch: Partial<NameGenSettings>) => joinName(texts, settings(patch.mode ? patch : { mode: "two", ...patch }));

  it("leaves the text as typed", () => {
    expect(join(["ael", "Wen"], { capitalisation: "asTyped" })).toBe("aelWen");
  });

  it("capitalises only the first letter of the whole name", () => {
    expect(join(["ael", "wen"], { capitalisation: "firstLetter" })).toBe("Aelwen");
    expect(join(["kel", "drin"], { capitalisation: "firstLetter", join1: "apostrophe" })).toBe("Kel'drin");
    expect(join(["mcdonald", "x"], { capitalisation: "firstLetter" })).toBe("Mcdonaldx");
    expect(join(["mcDonald", "x"], { capitalisation: "firstLetter" })).toBe("McDonaldx");
  });

  it("capitalises the first letter of every part", () => {
    expect(join(["ael", "wen"], { capitalisation: "everyPart" })).toBe("AelWen");
    expect(join(["ael", "wen"], { capitalisation: "everyPart", join1: "hyphen" })).toBe("Ael-Wen");
    expect(join(["kel", "drin"], { capitalisation: "everyPart", join1: "apostrophe" })).toBe("Kel'Drin");
    expect(join(["mary", "ann"], { capitalisation: "everyPart", join1: "space" })).toBe("Mary Ann");
  });

  it("copes with parts that don't start with a letter", () => {
    expect(join(["'ael", "wen"], { capitalisation: "firstLetter" })).toBe("'ael" + "wen");
    expect(join(["1st", "x"], { capitalisation: "everyPart" })).toBe("1stX");
  });

  it("capitalises accented letters", () => {
    expect(join(["éowyn", "x"], { capitalisation: "firstLetter" })).toBe("Éowynx");
  });
});

describe("joinName: doubled letters", () => {
  const join = (texts: string[], patch: Partial<NameGenSettings>) => joinName(texts, settings({ mode: texts.length === 3 ? "three" : "two", mergeDoubles: true, ...patch }));

  it("merges a letter repeated where two parts meet", () => {
    expect(join(["Dar", "rin"], {})).toBe("Darin");
    expect(join(["Mol", "lin"], {})).toBe("Molin");
  });

  it("ignores case when comparing", () => {
    expect(join(["DAR", "rin"], {})).toBe("DARin");
    expect(join(["dar", "Rin"], {})).toBe("darin");
  });

  it("leaves a join alone when the letters differ", () => {
    expect(join(["Ael", "wen"], {})).toBe("Aelwen");
  });

  it("only merges when the parts are joined directly", () => {
    expect(join(["Dar", "rin"], { join1: "hyphen" })).toBe("Dar-rin");
    expect(join(["Dar", "rin"], { join1: "apostrophe" })).toBe("Dar'rin");
    expect(join(["Dar", "rin"], { join1: "space" })).toBe("Dar rin");
  });

  it("works through capitalisation, dropping the capital of the second part", () => {
    expect(join(["dar", "rin"], { capitalisation: "everyPart" })).toBe("Darin");
    expect(join(["dar", "rin"], { capitalisation: "firstLetter" })).toBe("Darin");
  });

  it("merges across several joins, one at a time", () => {
    expect(join(["Mol", "lin", "nor"], {})).toBe("Molinor");
  });

  it("only merges letters, not digits or symbols", () => {
    expect(join(["A1", "1b"], {})).toBe("A11b");
  });

  it("does nothing when switched off", () => {
    expect(joinName(["Dar", "rin"], settings({ mergeDoubles: false }))).toBe("Darrin");
  });

  it("applies in a generated name too", () => {
    const g = generator({ mergeDoubles: true }, { first: entries("Dar"), last: entries("rin") });
    expect(make(g, scripted(1, 1)).name).toBe("Darin");
  });
});
