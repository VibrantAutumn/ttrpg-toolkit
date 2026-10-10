import { describe, expect, it } from "vitest";
import { addOption, newDefinition, type FieldDefinition } from "./definition";
import { coerceValue, compareValues, emptyValue, formatValue, indexValue, isEmpty, type FieldValue } from "./value";

const def = <K extends FieldDefinition["kind"]>(kind: K, config?: Partial<Extract<FieldDefinition, { kind: K }>["config"]>) => {
  const base = newDefinition(kind, "f", "Field") as Extract<FieldDefinition, { kind: K }>;
  return { ...base, config: { ...base.config, ...config } } as Extract<FieldDefinition, { kind: K }>;
};
const status = () => {
  let d = newDefinition("dropdown", "s", "Status") as Extract<FieldDefinition, { kind: "dropdown" }>;
  for (const [i, label] of ["Alive", "Dead", "Missing"].entries()) d = addOption(d, label, `o${i + 1}`) as typeof d;
  return d;
};

const ok = (d: FieldDefinition, raw: unknown) => {
  const r = coerceValue(d, raw);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(raw)} to be accepted, got: ${r.error}`);
  return r.value;
};
const bad = (d: FieldDefinition, raw: unknown) => {
  const r = coerceValue(d, raw);
  if (r.ok) throw new Error(`expected ${JSON.stringify(raw)} to be refused`);
  return r.error;
};

describe("empty values", () => {
  it("each kind has one", () => {
    expect(emptyValue(def("text"))).toBe("");
    expect(emptyValue(def("number"))).toBeNull();
    expect(emptyValue(def("bar"))).toBeNull();
    expect(emptyValue(def("formula"))).toBe("");
    expect(emptyValue(status())).toBeNull();
    expect(emptyValue(def("list"))).toEqual([]);
    expect(emptyValue(def("link"))).toEqual([]);
  });

  it("is what isEmpty says is empty, and nothing else is", () => {
    for (const d of [def("text"), def("number"), def("bar"), def("formula"), status(), def("list"), def("link")]) {
      expect(isEmpty(d, emptyValue(d))).toBe(true);
    }
    expect(isEmpty(def("number"), 0)).toBe(false);
    expect(isEmpty(def("text"), " ")).toBe(false);
    expect(isEmpty(def("bar"), { current: 0, max: 0 })).toBe(false);
  });
});

describe("text", () => {
  it("accepts text and treats nothing as empty text", () => {
    expect(ok(def("text"), "Chaotic Good")).toBe("Chaotic Good");
    expect(ok(def("text"), null)).toBe("");
    expect(ok(def("text"), undefined)).toBe("");
  });

  it("keeps a single-line field on one line, and a multi-line one as written", () => {
    expect(ok(def("text"), "a\r\nb \n c")).toBe("a b c");
    expect(ok(def("text", { multiline: true }), "a\r\nb\n\nc")).toBe("a\nb\n\nc");
  });

  it("refuses other kinds of value and text that is too long", () => {
    expect(bad(def("text"), 5)).toMatch(/text/i);
    expect(bad(def("text"), "x".repeat(501))).toMatch(/500/);
    expect(ok(def("text", { multiline: true }), "x".repeat(501))).toHaveLength(501);
    expect(bad(def("text", { multiline: true }), "x".repeat(10001))).toMatch(/10,000/);
  });

  it("shows, orders and indexes by the text", () => {
    const d = def("text");
    expect(formatValue(d, "Hello")).toBe("Hello");
    expect(indexValue(d, "Hello")).toEqual({ sortNum: null, sortText: "hello", searchText: "Hello" });
    expect(indexValue(d, "")).toEqual({ sortNum: null, sortText: null, searchText: "" });
  });
});

describe("number", () => {
  it("accepts a number, or nothing", () => {
    expect(ok(def("number"), 14)).toBe(14);
    expect(ok(def("number"), -3)).toBe(-3);
    expect(ok(def("number"), null)).toBeNull();
  });

  it("refuses what is not a finite number", () => {
    expect(bad(def("number"), "14")).toMatch(/number/i);
    expect(bad(def("number"), Number.NaN)).toMatch(/number/i);
    expect(bad(def("number"), Infinity)).toMatch(/number/i);
  });

  it("rounds to the field's decimals", () => {
    expect(ok(def("number"), 2.6)).toBe(3);
    expect(ok(def("number", { decimals: 2 }), 1.23456)).toBe(1.23);
  });

  it("holds to its smallest and largest value", () => {
    const d = def("number", { min: 1, max: 20 });
    expect(ok(d, 1)).toBe(1);
    expect(ok(d, 20)).toBe(20);
    expect(bad(d, 0)).toBe("Must be at least 1.");
    expect(bad(d, 21)).toBe("Must be at most 20.");
  });

  it("shows the unit, only as many decimals as needed, and orders numerically", () => {
    expect(formatValue(def("number", { unit: "ft" }), 30)).toBe("30 ft");
    expect(formatValue(def("number", { decimals: 2 }), 1.5)).toBe("1.5");
    expect(formatValue(def("number"), null)).toBe("");
    expect(indexValue(def("number"), 7)).toEqual({ sortNum: 7, sortText: null, searchText: "7" });
    const d = def("number");
    expect(compareValues(d, 2, 10)).toBeLessThan(0);
  });
});

describe("bar", () => {
  it("accepts current and maximum", () => {
    expect(ok(def("bar"), { current: 22, max: 30 })).toEqual({ current: 22, max: 30 });
    expect(ok(def("bar"), null)).toBeNull();
  });

  it("refuses a missing, negative or non-number maximum", () => {
    expect(bad(def("bar"), { current: 1 })).toMatch(/bar/i);
    expect(bad(def("bar"), { current: 1, max: -5 })).toMatch(/maximum/i);
    expect(bad(def("bar"), { current: "1", max: 5 })).toMatch(/bar/i);
    expect(bad(def("bar"), 12)).toMatch(/bar/i);
  });

  it("lets the current value go past the maximum or below zero (temporary points, dying)", () => {
    expect(ok(def("bar"), { current: 35, max: 30 })).toEqual({ current: 35, max: 30 });
    expect(ok(def("bar"), { current: -4, max: 30 })).toEqual({ current: -4, max: 30 });
  });

  it("shows current over maximum", () => {
    expect(formatValue(def("bar"), { current: 22, max: 30 })).toBe("22/30");
    expect(formatValue(def("bar"), null)).toBe("");
    expect(indexValue(def("bar"), { current: 22, max: 30 })).toEqual({ sortNum: 22, sortText: null, searchText: "22/30" });
  });
});

describe("dice formula", () => {
  it("accepts a formula that parses, as typed with outer spaces removed", () => {
    expect(ok(def("formula"), " 1d20+2 ")).toBe("1d20+2");
    expect(ok(def("formula"), "")).toBe("");
    expect(ok(def("formula"), null)).toBe("");
  });

  it("refuses one that does not, and says where", () => {
    expect(bad(def("formula"), "2d")).toMatch(/character/);
    expect(bad(def("formula"), 7)).toMatch(/formula/i);
  });

  it("is shown and indexed as written", () => {
    expect(formatValue(def("formula"), "1d20+2")).toBe("1d20+2");
    expect(indexValue(def("formula"), "1d20+2").searchText).toBe("1d20+2");
  });
});

describe("dropdown", () => {
  it("holds the id of one of its choices, or nothing", () => {
    expect(ok(status(), "o2")).toBe("o2");
    expect(ok(status(), null)).toBeNull();
    expect(ok(status(), "")).toBeNull();
  });

  it("refuses a choice it does not have", () => {
    expect(bad(status(), "o9")).toBe("That choice is not in the list.");
    expect(bad(status(), 3)).toMatch(/choice/i);
  });

  it("shows the choice's name and orders by the order of the list", () => {
    const d = status();
    expect(formatValue(d, "o2")).toBe("Dead");
    expect(formatValue(d, null)).toBe("");
    expect(formatValue(d, "gone")).toBe("");
    expect(indexValue(d, "o3")).toEqual({ sortNum: 2, sortText: "missing", searchText: "Missing" });
    expect(compareValues(d, "o1", "o3")).toBeLessThan(0);
  });
});

describe("list", () => {
  it("holds entries with a title and a description", () => {
    expect(ok(def("list"), [{ title: "Bite", text: "Melee, +5" }, { title: "Claw", text: "" }])).toEqual([
      { title: "Bite", text: "Melee, +5" },
      { title: "Claw", text: "" },
    ]);
  });

  it("drops entries with neither, trims titles, and fills in a missing description", () => {
    expect(ok(def("list"), [{ title: " Bite ", text: "x" }, { title: "", text: " " }, { title: "Roar" }])).toEqual([
      { title: "Bite", text: "x" },
      { title: "Roar", text: "" },
    ]);
  });

  it("accepts nothing as an empty list, and refuses other shapes", () => {
    expect(ok(def("list"), null)).toEqual([]);
    expect(bad(def("list"), "Bite")).toMatch(/list/i);
    expect(bad(def("list"), [3])).toMatch(/list/i);
  });

  it("limits how many entries and how long they are", () => {
    expect(bad(def("list"), Array.from({ length: 201 }, (_, i) => ({ title: `T${i}`, text: "" })))).toMatch(/200/);
    expect(bad(def("list"), [{ title: "x".repeat(101), text: "" }])).toMatch(/100/);
    expect(bad(def("list"), [{ title: "x", text: "y".repeat(5001) }])).toMatch(/5,000/);
  });

  it("shows the titles, falling back to the start of the text", () => {
    expect(formatValue(def("list"), [{ title: "Bite", text: "a" }, { title: "Claw", text: "b" }])).toBe("Bite, Claw");
    expect(formatValue(def("list"), [{ title: "", text: "A long description that goes on and on and on" }])).toBe("A long description t…");
  });

  it("indexes the titles and text for search, and sorts by the first title", () => {
    const value = [{ title: "Bite", text: "Melee" }];
    expect(indexValue(def("list"), value)).toEqual({ sortNum: 1, sortText: "bite", searchText: "Bite\nMelee" });
  });
});

describe("link", () => {
  it("holds item ids, each once", () => {
    expect(ok(def("link", { many: true }), ["a", "b", "a"])).toEqual(["a", "b"]);
    expect(ok(def("link"), ["a"])).toEqual(["a"]);
    expect(ok(def("link"), "a")).toEqual(["a"]);
    expect(ok(def("link"), null)).toEqual([]);
  });

  it("holds only one when the field allows one", () => {
    expect(bad(def("link"), ["a", "b"])).toBe("This property links to one item only.");
  });

  it("refuses ids that are not text, and too many", () => {
    expect(bad(def("link", { many: true }), [1])).toMatch(/item/i);
    expect(bad(def("link", { many: true }), Array.from({ length: 201 }, (_, i) => `i${i}`))).toMatch(/200/);
  });

  it("shows the names of the items it can look up, and says how many otherwise", () => {
    const names = (id: string) => ({ a: "Zhentarim", b: "Harpers" })[id];
    expect(formatValue(def("link", { many: true }), ["a", "b"], { itemName: names })).toBe("Zhentarim, Harpers");
    expect(formatValue(def("link", { many: true }), ["a", "zzz"], { itemName: names })).toBe("Zhentarim, (missing)");
    expect(formatValue(def("link", { many: true }), ["a", "b"])).toBe("2 items");
    expect(formatValue(def("link"), ["a"])).toBe("1 item");
    expect(indexValue(def("link", { many: true }), ["a", "b"])).toEqual({ sortNum: 2, sortText: null, searchText: "" });
  });
});

describe("comparing values", () => {
  it("puts empty values last, ascending or descending", () => {
    const d = def("number");
    const values: (FieldValue)[] = [5, null, 1, 3];
    const asc = [...values].sort((a, b) => compareValues(d, a, b, "asc"));
    const desc = [...values].sort((a, b) => compareValues(d, a, b, "desc"));
    expect(asc).toEqual([1, 3, 5, null]);
    expect(desc).toEqual([5, 3, 1, null]);
  });

  it("orders text without caring about case, and numbers inside text naturally", () => {
    const d = def("text");
    const sorted = ["b", "A", "item 10", "item 2", ""].sort((a, b) => compareValues(d, a, b));
    expect(sorted).toEqual(["A", "b", "item 2", "item 10", ""]);
  });

  it("orders bars by their current value", () => {
    const d = def("bar");
    expect(compareValues(d, { current: 5, max: 10 }, { current: 9, max: 10 })).toBeLessThan(0);
    expect(compareValues(d, null, { current: 1, max: 1 })).toBeGreaterThan(0);
  });

  it("says equal values are equal", () => {
    expect(compareValues(def("number"), 3, 3)).toBe(0);
    expect(compareValues(def("number"), null, null)).toBe(0);
  });
});
