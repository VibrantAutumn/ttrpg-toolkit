import { describe, expect, it } from "vitest";
import { STARTER_TEMPLATES } from "../../starter/templates";
import { normalizeDefinition, validateDefinition } from "../fields/definition";
import { docToMarkdown, markdownToDoc } from "../documents/markdown";
import { mentionIds } from "../documents/mentions";
import { choiceId, choices, toTemplateBundle, type TemplateStarterDef } from "./starterTemplates";

const lower = (s: string) => s.trim().toLowerCase();

describe("every starter set of templates", () => {
  it("has some", () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThan(0);
    const ids = STARTER_TEMPLATES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const starter of STARTER_TEMPLATES) {
    describe(starter.name, () => {
      it("has an id the installer accepts, and a name and description", () => {
        expect(starter.id.startsWith("starter:")).toBe(true);
        expect(starter.id.length).toBeLessThanOrEqual(64);
        expect(starter.name.trim()).not.toBe("");
        expect(starter.description.trim()).not.toBe("");
      });

      it("has fields that are valid, uniquely named and uniquely keyed", () => {
        const keys = starter.fields.map((f) => f.key);
        const names = starter.fields.map((f) => lower(f.name));
        expect(new Set(keys).size).toBe(keys.length);
        expect(new Set(names).size).toBe(names.length);
        for (const f of starter.fields) {
          const def = normalizeDefinition({ id: f.key, name: f.name, kind: f.kind, description: f.description ?? "", config: f.config ?? {} });
          expect(def, f.name).not.toBeNull();
          expect(validateDefinition(def!), f.name).toEqual([]);
          expect(f.name.trim().length, f.name).toBeLessThanOrEqual(60);
        }
      });

      it("gives every dropdown at least two choices with different ids", () => {
        for (const f of starter.fields.filter((f) => f.kind === "dropdown")) {
          const def = normalizeDefinition({ id: f.key, name: f.name, kind: f.kind, config: f.config });
          if (def?.kind !== "dropdown") throw new Error("not a dropdown");
          expect(def.config.options.length, f.name).toBeGreaterThanOrEqual(2);
          expect(new Set(def.config.options.map((o) => o.id)).size, f.name).toBe(def.config.options.length);
        }
      });

      it("has field sets that use only its fields, each field once, and every field is in a set", () => {
        const keys = new Set(starter.fields.map((f) => f.key));
        const used = new Set<string>();
        const setNames = starter.sets.map((s) => lower(s.name));
        expect(new Set(setNames).size).toBe(setNames.length);
        for (const set of starter.sets) {
          expect(new Set(set.fields).size, set.name).toBe(set.fields.length);
          for (const key of set.fields) {
            expect(keys.has(key), `${set.name} uses ${key}`).toBe(true);
            used.add(key);
          }
        }
        for (const key of keys) expect(used.has(key), `${key} is in no set`).toBe(true);
      });

      it("has templates that use only its sets and tags, with unique keys and names", () => {
        const setNames = new Set(starter.sets.map((s) => lower(s.name)));
        const tagNames = new Set(starter.tags.map((t) => lower(t.name)));
        const keys = starter.templates.map((t) => t.key);
        const names = starter.templates.map((t) => lower(t.name));
        expect(new Set(keys).size).toBe(keys.length);
        expect(new Set(names).size).toBe(names.length);
        for (const t of starter.templates) {
          expect(t.icon.trim(), t.name).not.toBe("");
          for (const s of t.sets) expect(setNames.has(lower(s)), `${t.name} uses set ${s}`).toBe(true);
          for (const tag of t.tags) expect(tagNames.has(lower(tag)), `${t.name} uses tag ${tag}`).toBe(true);
        }
      });

      it("has starter text the editor would write exactly as it is, with real headings", () => {
        for (const t of starter.templates) {
          expect(t.body.trim(), t.name).not.toBe("");
          expect(docToMarkdown(markdownToDoc(t.body)), t.name).toBe(t.body);
          expect(t.body, t.name).toMatch(/^## /m);
          expect(mentionIds(markdownToDoc(t.body)), t.name).toEqual([]); // starters never point at someone's items
        }
      });

      it("has tabs with names, no more than the page allows, and starter text the editor would write as it is", () => {
        for (const t of starter.templates) {
          const tabs = t.tabs ?? [];
          expect(tabs.length, t.name).toBeLessThanOrEqual(12);
          const names = tabs.map((tab) => lower(tab.name));
          expect(new Set(names).size, `${t.name}'s tabs`).toBe(names.length);
          for (const tab of tabs) {
            expect(tab.name.trim(), t.name).not.toBe("");
            expect(tab.name.length, tab.name).toBeLessThanOrEqual(60);
            if (tab.kind === "document") {
              expect(tab.body.trim(), `${t.name} / ${tab.name}`).not.toBe("");
              expect(docToMarkdown(markdownToDoc(tab.body)), `${t.name} / ${tab.name}`).toBe(tab.body);
            }
          }
        }
      });

      it("becomes a bundle the database accepts", () => {
        const bundle = toTemplateBundle(starter);
        expect(bundle.id).toBe(starter.id);
        expect(bundle.fields).toHaveLength(starter.fields.length);
        for (const f of bundle.fields) {
          const settings = JSON.parse(f.configJson);
          expect(typeof settings).toBe("object");
          // reading the stored settings again changes nothing
          const again = normalizeDefinition({ id: f.key, name: f.name, kind: f.kind, description: f.description, config: settings });
          expect(JSON.stringify(again?.config)).toBe(f.configJson);
        }
        expect(bundle.templates.map((t) => t.name)).toEqual(starter.templates.map((t) => t.name));
      });
    });
  }

  it("includes the six core templates, each with a field set and tag of its own name", () => {
    const core = STARTER_TEMPLATES.find((s) => s.id === "starter:templates")!;
    expect(core.templates.map((t) => t.name)).toEqual(["NPC", "Location", "Faction", "Item", "Quest", "Session"]);
    for (const t of core.templates) {
      expect(t.sets).toEqual([t.name]);
      expect(t.tags).toEqual([t.name]);
    }
  });

  it("gives NPC a Relationships tab and Location an empty Map slot", () => {
    const core = STARTER_TEMPLATES.find((s) => s.id === "starter:templates")!;
    expect(core.templates.find((t) => t.name === "NPC")?.tabs).toEqual([
      { kind: "document", name: "Relationships", body: "## Allies\n\n## Enemies\n\n## Family" },
    ]);
    expect(core.templates.find((t) => t.name === "Location")?.tabs).toEqual([{ kind: "slot", name: "Map" }]);
  });
});

describe("helpers", () => {
  it("makes choice ids from names, the same every time", () => {
    expect(choiceId("In progress")).toBe("in-progress");
    expect(choiceId("Wondrous item")).toBe("wondrous-item");
    expect(choiceId("  Very rare! ")).toBe("very-rare");
  });

  it("makes the settings of a dropdown", () => {
    expect(choices("A b", "C")).toEqual({
      options: [
        { id: "a-b", label: "A b", color: null },
        { id: "c", label: "C", color: null },
      ],
    });
  });

  it("refuses to bundle a field that isn't one", () => {
    const bad: TemplateStarterDef = {
      id: "starter:bad",
      name: "Bad",
      description: "x",
      tags: [],
      fields: [{ key: "k", name: "   ", kind: "text" }],
      sets: [],
      templates: [],
    };
    expect(() => toTemplateBundle(bad)).toThrow(/valid property/);
  });
});

describe("the bundle the database reads", () => {
  // The same file is installed by a Rust test (db/template_starters.rs), so the two sides can't
  // drift apart: change the starters or the bundle's shape and this fails until the file is
  // updated (run `npx vitest run -u src/lib/templates`), and the Rust test then checks the
  // database still accepts it.
  it("matches the golden file the Rust installer is tested with", async () => {
    const core = STARTER_TEMPLATES.find((s) => s.id === "starter:templates")!;
    const text = JSON.stringify(toTemplateBundle(core), null, 2) + "\n";
    await expect(text).toMatchFileSnapshot("../../../src-tauri/tests/fixtures/starter_templates_core.json");
  });
});
