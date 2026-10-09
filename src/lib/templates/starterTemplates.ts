import { normalizeDefinition, type FieldKind } from "../fields/definition";

/**
 * Starter templates: ready-made templates (and the fields and field sets they use) that come
 * with the app. A starter is plain data (`TemplateStarterDef`) that the app turns into the bundle
 * the database installs in one all-or-nothing step. Pure data and logic.
 */

export interface StarterTag {
  name: string;
  color?: string | null;
}

export interface StarterField {
  /** Unique inside the starter; sets refer to fields by it. */
  key: string;
  name: string;
  kind: FieldKind;
  description?: string;
  /** The kind's settings (see `lib/fields/definition.ts`); anything left out takes its default. */
  config?: Record<string, unknown>;
}

export interface StarterFieldSet {
  name: string;
  description?: string;
  /** Keys of the starter's `fields`, in order. */
  fields: string[];
}

/** A tab of a starter template: a nested document with starter text, or an empty embed slot to fill in later. */
export type StarterTab = { kind: "document"; name: string; body: string } | { kind: "slot"; name: string };

export interface StarterTemplate {
  /** Unique inside the starter. */
  key: string;
  name: string;
  icon: string;
  /** The starter text, as Markdown (kept in the form the editor writes it; the tests check that). */
  body: string;
  /** Names of the starter's `sets`, in the order they are applied. */
  sets: string[];
  /** Names of the starter's `tags`. */
  tags: string[];
  /** The template's tabs, in order. */
  tabs?: StarterTab[];
}

export interface TemplateStarterDef {
  /** Starts with `starter:`; remembered on everything it makes. */
  id: string;
  /** Shown in the list, and the name of the folder the templates are put in. */
  name: string;
  description: string;
  tags: StarterTag[];
  fields: StarterField[];
  sets: StarterFieldSet[];
  templates: StarterTemplate[];
}

/** What the database reads (field names must match `TemplateBundle` in Rust). */
export interface TemplateBundleJson {
  id: string;
  name: string;
  tags: { name: string; color: string | null }[];
  fields: { key: string; name: string; kind: string; description: string; configJson: string }[];
  sets: { name: string; description: string; fieldKeys: string[] }[];
  templates: {
    key: string;
    name: string;
    icon: string | null;
    body: string;
    sets: string[];
    tags: string[];
    tabs: { kind: "document" | "slot"; title: string; body: string }[];
  }[];
}

/** A choice's id from its name: stable, so every starter that has "Alive" gives it the same id. */
export const choiceId = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The settings of a dropdown with these choices. */
export const choices = (...labels: string[]) => ({ options: labels.map((label) => ({ id: choiceId(label), label, color: null })) });

export function toTemplateBundle(def: TemplateStarterDef): TemplateBundleJson {
  return {
    id: def.id,
    name: def.name,
    tags: def.tags.map((t) => ({ name: t.name, color: t.color ?? null })),
    fields: def.fields.map((f) => {
      // The one reader of definitions turns the settings into their one proper form (and refuses a field that isn't one).
      const checked = normalizeDefinition({ id: f.key, name: f.name, kind: f.kind, description: f.description ?? "", config: f.config ?? {} });
      if (!checked) throw new Error(`The starter field “${f.name}” isn't a valid field.`);
      return { key: f.key, name: checked.name, kind: checked.kind, description: checked.description, configJson: JSON.stringify(checked.config) };
    }),
    sets: def.sets.map((s) => ({ name: s.name, description: s.description ?? "", fieldKeys: s.fields })),
    templates: def.templates.map((t) => ({
      key: t.key,
      name: t.name,
      icon: t.icon,
      body: t.body,
      sets: t.sets,
      tags: t.tags,
      tabs: (t.tabs ?? []).map((tab) => ({ kind: tab.kind, title: tab.name, body: tab.kind === "document" ? tab.body : "" })),
    })),
  };
}
