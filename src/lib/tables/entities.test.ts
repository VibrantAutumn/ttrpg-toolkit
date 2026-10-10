import { describe, expect, it } from "vitest";
import { createRng } from "../dice/rng";
import { buildEntityLookups, neededEntityNames, neededFieldNames, NO_VALUE } from "./entities";
import { rollTable } from "./roll";
import type { RollableTable } from "./roll";
import { buildWorld } from "./world";

const table = (name: string, ...texts: string[]) => ({ name, entries: texts.map((text) => ({ text })) });

describe("neededEntityNames", () => {
  it("lists explicit entity slots and table slots that name no table", () => {
    const tables = [
      table("Quests", "[Person] is missing [entity:Object as O] near [Town]"),
      table("Town", "Waterdeep"),
      table("Other", "[entity:person] again, and [2d4] and [draw 1 from Tarot] and [3 unique Villain]"),
    ];
    expect(neededEntityNames(tables)).toEqual(["Person", "Object", "Villain"]);
  });
  it("skips entries that don't parse, and names a table has", () => {
    expect(neededEntityNames([table("T", "oops [Person", "[T]")])).toEqual([]);
  });
});

describe("neededFieldNames", () => {
  it("lists each referenced field once", () => {
    const tables = [table("T", "[entity:Person as A] [A.Faction] [A.faction] [A.Home town]"), table("U", "[entity:X as B] [B.Mood]")];
    expect(neededFieldNames(tables)).toEqual(["Faction", "Home town", "Mood"]);
  });
});

describe("buildEntityLookups", () => {
  const people = { name: "Person", kind: "collection" as const, items: [{ id: "ann", name: "Ann" }] };
  const lookups = buildEntityLookups({ sources: [people], fields: [{ name: "Faction", text: new Map([["ann", "Red Hand"]]) }] });
  it("finds sources and fields ignoring case", () => {
    expect(lookups.findEntities("PERSON")).toBe(people);
    expect(lookups.findEntities("Nobody")).toBeNull();
    expect(lookups.entityField("ann", "faction")).toEqual({ ok: true, text: "Red Hand" });
  });
  it("shows (none) for an item without a value and explains an unknown field", () => {
    expect(lookups.entityField("bob", "Faction")).toEqual({ ok: true, text: NO_VALUE });
    const unknown = lookups.entityField("ann", "Rank");
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.message).toContain("Rank");
  });
});

describe("a whole roll through buildWorld", () => {
  it("picks an entity and reads its field", () => {
    const quests: RollableTable = { id: "q", name: "Quests", avoidRecent: 0, entries: [{ id: "e", text: "[Person as A] of [A.Faction]", weight: 1 }] };
    const data = {
      sources: [{ name: "Person", kind: "tag" as const, items: [{ id: "ann", name: "Ann" }, { id: "bob", name: "Bob" }] }],
      fields: [{ name: "Faction", text: new Map([["ann", "Red Hand"], ["bob", "Blue Cloak"]]) }],
    };
    const world = buildWorld([{ ...quests, recent: [] }], [], data);
    const result = rollTable(quests, world, createRng(3));
    if (!result.ok) throw new Error(result.message);
    expect(["Ann of Red Hand", "Bob of Blue Cloak"]).toContain(result.roll.text);
    expect(result.roll.warnings).toEqual([]);
  });
});
