import { describe, expect, it } from "vitest";
import { QUICK_PANEL_KEY, loadCollapsed, saveCollapsed, toggleCollapsed } from "./quickPanel";

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

describe("loadCollapsed", () => {
  it("starts with nothing collapsed", () => {
    expect(loadCollapsed(fakeStorage())).toEqual(new Set());
    expect(loadCollapsed(undefined)).toEqual(new Set());
  });

  it("reads back what was saved", () => {
    const storage = fakeStorage({ [QUICK_PANEL_KEY]: JSON.stringify(["roller", "draw"]) });
    expect(loadCollapsed(storage)).toEqual(new Set(["roller", "draw"]));
  });

  it("ignores anything that isn't a list of ids instead of failing", () => {
    for (const bad of ["not json", "{}", "42", "null", '"text"']) {
      expect(loadCollapsed(fakeStorage({ [QUICK_PANEL_KEY]: bad })), bad).toEqual(new Set());
    }
    const mixed = fakeStorage({ [QUICK_PANEL_KEY]: JSON.stringify(["ok", 5, null, "also-ok", {}]) });
    expect(loadCollapsed(mixed)).toEqual(new Set(["ok", "also-ok"]));
  });

  it("copes with storage that is blocked (a private window, cleared site data)", () => {
    expect(loadCollapsed(broken)).toEqual(new Set());
  });
});

describe("saveCollapsed", () => {
  it("stores the ids as a sorted list", () => {
    const storage = fakeStorage();
    expect(saveCollapsed(storage, new Set(["b", "a"]))).toBe(true);
    expect(JSON.parse(storage.data[QUICK_PANEL_KEY])).toEqual(["a", "b"]);
  });

  it("says so, without throwing, when it can't save", () => {
    expect(saveCollapsed(broken, new Set(["a"]))).toBe(false);
    expect(saveCollapsed(undefined, new Set(["a"]))).toBe(false);
  });
});

describe("toggleCollapsed", () => {
  it("collapses an open widget and opens a collapsed one, without changing the original", () => {
    const start = new Set(["a"]);
    const collapsed = toggleCollapsed(start, "b");
    expect(collapsed).toEqual(new Set(["a", "b"]));
    expect(toggleCollapsed(collapsed, "a")).toEqual(new Set(["b"]));
    expect(start).toEqual(new Set(["a"]));
  });
});
