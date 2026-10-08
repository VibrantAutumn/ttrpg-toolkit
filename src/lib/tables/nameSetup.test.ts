import { describe, expect, it } from "vitest";
import { scripted } from "../dice/testing";
import { generateName } from "./nameGen";
import {
  DEFAULT_SETUP,
  LAST_SETUP_KEY,
  buildGenerator,
  entryMatchesTags,
  filterByTags,
  loadLastSetup,
  parseSetup,
  saveLastSetup,
  serializeSetup,
} from "./nameSetup";
import type { NameSetup, SourceTable, TagInfo } from "./nameSetup";

// Region > Forest > Deep forest, and separate Elf and Noble tags.
const tags: TagInfo[] = [
  { id: "elf", name: "Elf", parentId: null },
  { id: "noble", name: "Noble", parentId: null },
  { id: "region", name: "Region", parentId: null },
  { id: "forest", name: "Forest", parentId: "region" },
  { id: "deep", name: "Deep forest", parentId: "forest" },
];

describe("entryMatchesTags", () => {
  it("lets every entry through when no tags are wanted", () => {
    expect(entryMatchesTags([], [], "all", tags)).toBe(true);
    expect(entryMatchesTags(["elf"], [], "any", tags)).toBe(true);
  });

  it("needs every wanted tag by default", () => {
    expect(entryMatchesTags(["elf", "noble"], ["elf", "noble"], "all", tags)).toBe(true);
    expect(entryMatchesTags(["elf"], ["elf", "noble"], "all", tags)).toBe(false);
    expect(entryMatchesTags([], ["elf"], "all", tags)).toBe(false);
  });

  it("needs only one of the wanted tags when matching any", () => {
    expect(entryMatchesTags(["elf"], ["elf", "noble"], "any", tags)).toBe(true);
    expect(entryMatchesTags(["noble"], ["elf", "noble"], "any", tags)).toBe(true);
    expect(entryMatchesTags(["region"], ["elf", "noble"], "any", tags)).toBe(false);
    expect(entryMatchesTags([], ["elf", "noble"], "any", tags)).toBe(false);
  });

  it("counts a tag nested under a wanted tag as that tag", () => {
    expect(entryMatchesTags(["deep"], ["region"], "all", tags)).toBe(true);
    expect(entryMatchesTags(["forest"], ["region"], "all", tags)).toBe(true);
    expect(entryMatchesTags(["region"], ["forest"], "all", tags)).toBe(false); // a parent is not its child
    expect(entryMatchesTags(["deep"], ["forest", "elf"], "any", tags)).toBe(true);
  });

  it("never matches a wanted tag that no longer exists", () => {
    expect(entryMatchesTags(["elf"], ["elf", "ghost"], "all", tags)).toBe(false);
    expect(entryMatchesTags(["elf"], ["ghost"], "any", tags)).toBe(false);
    expect(entryMatchesTags(["elf"], ["ghost", "elf"], "any", tags)).toBe(true);
  });

  it("survives a loop in the tag tree", () => {
    const loop: TagInfo[] = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    expect(entryMatchesTags(["a"], ["b"], "all", loop)).toBe(true);
    expect(entryMatchesTags(["c"], ["b"], "all", loop)).toBe(false);
  });
});

describe("filterByTags", () => {
  const entries = [
    { id: "1", tagIds: ["elf"] },
    { id: "2", tagIds: ["elf", "noble"] },
    { id: "3", tagIds: [] },
  ];

  it("keeps the entries that match, in order", () => {
    expect(filterByTags(entries, ["elf"], "all", tags).map((e) => e.id)).toEqual(["1", "2"]);
    expect(filterByTags(entries, ["elf", "noble"], "all", tags).map((e) => e.id)).toEqual(["2"]);
    expect(filterByTags(entries, ["noble"], "any", tags).map((e) => e.id)).toEqual(["2"]);
  });

  it("keeps everything when nothing is wanted", () => {
    expect(filterByTags(entries, [], "all", tags)).toHaveLength(3);
  });
});

describe("parseSetup / serializeSetup", () => {
  const setup: NameSetup = {
    mode: "three",
    sources: { first: "t1", middle: "t2", last: "t3" },
    tagIds: ["elf"],
    tagMatch: "any",
    join1: "apostrophe",
    join2: "hyphen",
    capitalisation: "everyPart",
    mergeDoubles: true,
  };

  it("round-trips a setup", () => {
    expect(parseSetup(serializeSetup(setup))).toEqual(setup);
    expect(parseSetup(serializeSetup(DEFAULT_SETUP))).toEqual(DEFAULT_SETUP);
  });

  it("has sensible defaults", () => {
    expect(DEFAULT_SETUP).toMatchObject({
      mode: "two",
      sources: {},
      tagIds: [],
      tagMatch: "all",
      join1: "none",
      capitalisation: "firstLetter",
      mergeDoubles: false,
    });
  });

  it("fills in whatever is missing with the defaults, and ignores what it doesn't know", () => {
    expect(parseSetup('{"version":1,"mode":"full","somethingNew":42}')).toEqual({ ...DEFAULT_SETUP, mode: "full" });
    expect(parseSetup("{}")).toEqual(DEFAULT_SETUP);
  });

  it("gives nothing for text it can't trust, never a guess", () => {
    for (const bad of [
      "",
      "not json",
      "[]",
      "null",
      '"text"',
      '{"mode":"four"}',
      '{"join1":"comma"}',
      '{"join2":3}',
      '{"capitalisation":"SHOUT"}',
      '{"tagMatch":"most"}',
      '{"mergeDoubles":"yes"}',
      '{"tagIds":"elf"}',
      '{"tagIds":[1,2]}',
      '{"sources":"t1"}',
      '{"sources":{"first":5}}',
      '{"version":99}',
    ]) {
      expect(parseSetup(bad), bad).toBeNull();
    }
  });

  it("drops sources for parts that don't exist", () => {
    expect(parseSetup('{"sources":{"first":"t1","bogus":"t2"}}')?.sources).toEqual({ first: "t1" });
  });
});

describe("buildGenerator", () => {
  const entry = (id: string, text: string, tagIds: string[] = [], weight = 1) => ({ id, text, weight, tagIds });
  const prefixes: SourceTable = {
    id: "pre",
    name: "Elf prefixes",
    entries: [entry("p1", "Ael", ["elf"]), entry("p2", "Gor", ["orc"]), entry("p3", "Cal", ["elf", "noble"])],
  };
  const suffixes: SourceTable = {
    id: "suf",
    name: "Suffixes",
    entries: [entry("s1", "wen", ["elf"]), entry("s2", "dor", ["elf"]), entry("s3", "gash", ["orc"])],
  };
  const middles: SourceTable = { id: "mid", name: "Middles", entries: [entry("m1", "ar", ["elf"])] };
  const base: NameSetup = { ...DEFAULT_SETUP, sources: { first: "pre", last: "suf" } };

  function build(setup: NameSetup, source: SourceTable[] = [prefixes, suffixes, middles]) {
    const r = buildGenerator(setup, source, tags);
    if (!r.ok) throw new Error(`should build: ${r.message}`);
    return r.generator;
  }

  it("takes each part's entries from its table, with the setup's rules", () => {
    const g = build({ ...base, join1: "apostrophe", capitalisation: "everyPart", mergeDoubles: true });
    expect(g.parts.first.map((e) => e.text)).toEqual(["Ael", "Gor", "Cal"]);
    expect(g.parts.last.map((e) => e.text)).toEqual(["wen", "dor", "gash"]);
    expect(g.settings).toEqual({
      mode: "two",
      join1: "apostrophe",
      join2: "none",
      capitalisation: "everyPart",
      mergeDoubles: true,
    });
  });

  it("only keeps entries with the wanted tags", () => {
    const g = build({ ...base, tagIds: ["elf"] });
    expect(g.parts.first.map((e) => e.text)).toEqual(["Ael", "Cal"]);
    expect(g.parts.last.map((e) => e.text)).toEqual(["wen", "dor"]);
    const both = build({ ...base, tagIds: ["elf", "noble"] }, [prefixes, { ...suffixes, entries: [entry("s9", "wen", ["elf", "noble"])] }]);
    expect(both.parts.first.map((e) => e.text)).toEqual(["Cal"]);
  });

  it("makes names that can be generated and reproduced", () => {
    const g = build({ ...base, tagIds: ["elf"] });
    const r = generateName(g, scripted(2, 1));
    expect(r.ok && r.result.name).toBe("Calwen");
  });

  it("uses the lists the mode needs and leaves the others empty", () => {
    const three = build({ ...base, mode: "three", sources: { first: "pre", middle: "mid", last: "suf" }, tagIds: ["elf"] });
    expect(three.parts.middle.map((e) => e.text)).toEqual(["ar"]);
    expect(three.parts.full).toEqual([]);
    const full = build({ ...base, mode: "full", sources: { full: "suf" } });
    expect(full.parts.full).toHaveLength(3);
    expect(full.parts.first).toEqual([]);
  });

  it("ignores a table chosen for a part the mode doesn't use", () => {
    const g = build({ ...base, sources: { first: "pre", middle: "ghost", last: "suf" } });
    expect(g.parts.middle).toEqual([]);
  });

  it("asks for a table for a part that has none", () => {
    const r = buildGenerator({ ...base, sources: { first: "pre" } }, [prefixes], tags);
    expect(!r.ok && r.message).toMatch(/last part/i);
    const r2 = buildGenerator({ ...base, mode: "three", sources: { first: "pre", last: "suf" } }, [prefixes, suffixes], tags);
    expect(!r2.ok && r2.message).toMatch(/middle part/i);
    const r3 = buildGenerator({ ...base, mode: "full", sources: {} }, [], tags);
    expect(!r3.ok && r3.message).toMatch(/table/i);
  });

  it("says when a chosen table has gone", () => {
    const r = buildGenerator(base, [prefixes], tags); // the suffix table is no longer there
    expect(!r.ok && r.message).toMatch(/last part/i);
    expect(!r.ok && r.message).toMatch(/choose another/i);
  });

  it("says which table has nothing to pick, and why", () => {
    const noElves: SourceTable = { id: "suf", name: "Orc suffixes", entries: [entry("s3", "gash", ["orc"])] };
    const r = buildGenerator({ ...base, tagIds: ["elf"] }, [prefixes, noElves], tags);
    expect(!r.ok && r.message).toMatch(/Orc suffixes/);
    expect(!r.ok && r.message).toMatch(/Elf/);

    const empty: SourceTable = { id: "suf", name: "Empty", entries: [] };
    const r2 = buildGenerator(base, [prefixes, empty], tags);
    expect(!r2.ok && r2.message).toMatch(/Empty/);

    const never: SourceTable = { id: "suf", name: "Zeroes", entries: [entry("z", "x", [], 0)] };
    const r3 = buildGenerator(base, [prefixes, never], tags);
    expect(!r3.ok && r3.message).toMatch(/weight/i);
  });

  it("names a wanted tag that was deleted", () => {
    const r = buildGenerator({ ...base, tagIds: ["ghost"] }, [prefixes, suffixes], tags);
    expect(!r.ok && r.message).toMatch(/no longer exists/i);
  });

  it("can use the same table for two parts", () => {
    const g = build({ ...base, sources: { first: "pre", last: "pre" } }, [prefixes]);
    expect(g.parts.first).toEqual(g.parts.last);
  });
});

describe("remembering the last setup on this device", () => {
  const setup: NameSetup = { ...DEFAULT_SETUP, mode: "three", sources: { first: "a", middle: "b", last: "c" }, tagIds: ["elf"] };

  /** A stand-in for localStorage. */
  function fakeStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      data,
      getItem: (key: string) => (key in data ? data[key] : null),
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
  }
  const broken = {
    getItem: () => {
      throw new Error("storage is blocked");
    },
    setItem: () => {
      throw new Error("storage is blocked");
    },
  };

  it("reads back what was saved", () => {
    const storage = fakeStorage();
    expect(saveLastSetup(storage, setup)).toBe(true);
    expect(loadLastSetup(storage)).toEqual(setup);
  });

  it("starts from the defaults when nothing usable is there", () => {
    expect(loadLastSetup(fakeStorage())).toEqual(DEFAULT_SETUP);
    expect(loadLastSetup(undefined)).toEqual(DEFAULT_SETUP);
    expect(loadLastSetup(fakeStorage({ [LAST_SETUP_KEY]: "not json" }))).toEqual(DEFAULT_SETUP);
    expect(loadLastSetup(fakeStorage({ [LAST_SETUP_KEY]: '{"mode":"seven"}' }))).toEqual(DEFAULT_SETUP);
  });

  it("never throws when the storage is blocked", () => {
    expect(loadLastSetup(broken)).toEqual(DEFAULT_SETUP);
    expect(saveLastSetup(broken, setup)).toBe(false);
    expect(saveLastSetup(undefined, setup)).toBe(false);
  });
});
