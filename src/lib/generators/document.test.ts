import { describe, expect, it } from "vitest";
import { markdownToDoc } from "../documents/markdown";
import { mentionIds } from "../documents/mentions";
import { newDefinition, type FieldDefinition } from "../fields/definition";
import { scripted } from "../dice/testing";
import type { EntitySource, RollableTable, TableWorld } from "../tables/roll";
import { appendSection, buildDocument, pickedItems } from "./document";
import { emptyGenerator, newRow, type GeneratorDef, type RowTarget } from "./generator";
import { generate, setOverride } from "./run";

const ANN = "0190f3a2-0000-7000-8000-000000000001";
const BOB = "0190f3a2-0000-7000-8000-000000000002";
const people: EntitySource = { name: "Person", kind: "collection", items: [{ id: ANN, name: "Ann" }, { id: BOB, name: "Bob" }] };

const table = (name: string, ...texts: string[]): RollableTable => ({
  id: name.toLowerCase(),
  name,
  avoidRecent: 0,
  entries: texts.map((text, i) => ({ id: `${name}${i}`, text, weight: 1 })),
});
const world = (tables: RollableTable[]): TableWorld => ({
  findTable: (n) => tables.find((t) => t.name.toLowerCase() === n.toLowerCase()) ?? null,
  findDeck: () => null,
  recent: () => [],
  findEntities: (n) => (n.toLowerCase() === "person" ? people : null),
});

const level = newDefinition("number", "f-level", "Level");
const role = newDefinition("text", "f-role", "Role");
const mood: FieldDefinition = { ...newDefinition("dropdown", "f-mood", "Mood"), config: { options: [{ id: "calm", label: "Calm", color: null }, { id: "angry", label: "Angry", color: null }] } } as FieldDefinition;
const friends: FieldDefinition = { ...newDefinition("link", "f-friends", "Friends"), config: { many: false, library: null, itemTypes: [] } } as FieldDefinition;
const hp = newDefinition("bar", "f-hp", "HP");
const defs = [level, role, mood, friends, hp];

function gen(...rows: { label: string; source: string; target: RowTarget }[]): GeneratorDef {
  const g = emptyGenerator();
  for (const r of rows) g.rows.push({ ...newRow(g), ...r });
  return g;
}

describe("buildDocument", () => {
  const g = gen(
    { label: "Name", source: "Ash", target: { kind: "name" } },
    { label: "Role", source: "Guard", target: { kind: "field", fieldId: "f-role" } },
    { label: "Level", source: "level 7 or so", target: { kind: "field", fieldId: "f-level" } },
    { label: "Mood", source: "calm", target: { kind: "field", fieldId: "f-mood" } },
    { label: "Quirk", source: "Hums while *working*", target: { kind: "text" } },
  );
  const run = generate(g, world([]), 1);

  it("fills the name, fields of several kinds, and a text section", () => {
    const doc = buildDocument(g, run, defs, "New NPC");
    expect(doc.name).toBe("Ash");
    expect(doc.fields).toEqual([
      { fieldId: "f-role", value: "Guard" },
      { fieldId: "f-level", value: 7 },
      { fieldId: "f-mood", value: "calm" },
    ]);
    expect(doc.warnings).toEqual([]);
    expect(doc.section.startsWith("## Generated\n\n**Quirk:** ")).toBe(true);
    expect(doc.section).toContain("Hums while");
  });
  it("uses the fallback name when no row names the document", () => {
    const only = gen({ label: "Quirk", source: "x", target: { kind: "text" } });
    expect(buildDocument(only, generate(only, world([]), 1), defs, "New NPC").name).toBe("New NPC");
  });
  it("explains what couldn't be used instead of guessing", () => {
    const bad = gen(
      { label: "Level", source: "none", target: { kind: "field", fieldId: "f-level" } },
      { label: "Mood", source: "furious", target: { kind: "field", fieldId: "f-mood" } },
      { label: "Gone", source: "x", target: { kind: "field", fieldId: "f-gone" } },
      { label: "HP", source: "10", target: { kind: "field", fieldId: "f-hp" } },
      { label: "Second name", source: "Y", target: { kind: "name" } },
      { label: "First name", source: "X", target: { kind: "name" } },
      { label: "Again", source: "Z", target: { kind: "field", fieldId: "f-role" } },
      { label: "Again 2", source: "W", target: { kind: "field", fieldId: "f-role" } },
    );
    const doc = buildDocument(bad, generate(bad, world([]), 1), defs, "New");
    expect(doc.fields).toEqual([{ fieldId: "f-role", value: "Z" }]);
    expect(doc.name).toBe("Y");
    expect(doc.warnings).toHaveLength(6);
    expect(doc.warnings.join("\n")).toMatch(/Level/);
    expect(doc.warnings.join("\n")).toMatch(/no longer exists/);
    expect(doc.warnings.join("\n")).toMatch(/bar/);
  });
  it("skips rows with no value", () => {
    const blank = gen({ label: "Empty", source: "", target: { kind: "text" } });
    const doc = buildDocument(blank, generate(blank, world([]), 1), defs, "N");
    expect(doc.section).toBe("");
    expect(doc.fields).toEqual([]);
  });
  it("uses what was typed over a rolled value", () => {
    const typed = setOverride(run, g.rows[0].id, "Typed Name");
    expect(buildDocument(g, typed, defs, "N").name).toBe("Typed Name");
  });
});

describe("rows that pick documents", () => {
  const g = gen(
    { label: "Friend", source: "[entity:Person]", target: { kind: "field", fieldId: "f-friends" } },
    { label: "Ally", source: "[entity:Person]", target: { kind: "text" } },
  );
  const run = generate(g, world([]), 3);

  it("links a link field to the picked document and mentions it in the text", () => {
    const doc = buildDocument(g, run, defs, "N");
    const picked = pickedItems(run.rows[0]);
    expect(picked).toHaveLength(1);
    expect(doc.fields).toEqual([{ fieldId: "f-friends", value: [picked[0].id] }]);
    const ally = pickedItems(run.rows[1])[0];
    expect(doc.mentions).toEqual([ally.id]);
    expect(mentionIds(markdownToDoc(doc.section))).toEqual([ally.id]);
    expect(doc.section).toContain(`(item:${ally.id})`);
  });
  it("does not link a picked document once the value was typed over", () => {
    const typed = setOverride(run, g.rows[0].id, "Somebody");
    const doc = buildDocument(g, typed, defs, "N");
    expect(doc.fields).toEqual([]);
    expect(doc.warnings.join(" ")).toMatch(/Friends/);
  });
  it("mentions several picks with commas", () => {
    const many = gen({ label: "Crew", source: "[entity:2 unique Person]", target: { kind: "text" } });
    const doc = buildDocument(many, generate(many, world([]), 1), defs, "N");
    expect(doc.mentions.sort()).toEqual([ANN, BOB]);
  });
});

describe("appendSection", () => {
  it("adds the section after the template's text", () => {
    expect(appendSection("## Looks\n\n", "## Generated\n\nx")).toBe("## Looks\n\n## Generated\n\nx");
    expect(appendSection("", "## Generated")).toBe("## Generated");
    expect(appendSection("text", "")).toBe("text");
  });
});

describe("a seeded run is reproducible all the way to the document", () => {
  it("gives the same document for the same seed", () => {
    const g = gen({ label: "Role", source: "[Roles]", target: { kind: "field", fieldId: "f-role" } });
    const w = world([table("Roles", "Guard", "Cook", "Spy")]);
    expect(buildDocument(g, generate(g, w, 9), defs, "N")).toEqual(buildDocument(g, generate(g, w, 9), defs, "N"));
    void scripted;
  });
});
