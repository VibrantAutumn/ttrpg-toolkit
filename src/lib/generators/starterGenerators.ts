import { GENERATOR_VERSION, newRowId, type GeneratorDef, type GeneratorRow } from "./generator";

/**
 * Starter generators: ready-made generators that come with the app. A starter is plain data that names
 * its template and fields by name; `toDefinition` turns it into a real generator once the campaign's own
 * template and field ids are known (a template or field the campaign doesn't have is simply left out, so
 * the generator still works). Pure logic.
 */

export type StarterTarget = { kind: "name" } | { kind: "text" } | { kind: "field"; fieldName: string };

export interface StarterRow {
  label: string;
  target: StarterTarget;
  source: string;
  fallback?: string;
}

export interface StarterGeneratorDef {
  /** Unique; also the name of the generator item made. */
  name: string;
  description: string;
  /** The template (by name) new documents are made from, if the campaign has one by that name. */
  templateName?: string;
  rows: StarterRow[];
}

export interface Lookup {
  templateIdByName(name: string): string | null;
  fieldIdByName(name: string): string | null;
}

export function toDefinition(def: StarterGeneratorDef, lookup: Lookup): GeneratorDef {
  const used = new Set<string>();
  const rows: GeneratorRow[] = def.rows.map((r) => {
    const id = newRowId(used);
    used.add(id);
    let target: GeneratorRow["target"] = { kind: "text" };
    if (r.target.kind === "name") target = { kind: "name" };
    else if (r.target.kind === "field") {
      const fieldId = lookup.fieldIdByName(r.target.fieldName);
      if (fieldId) target = { kind: "field", fieldId };
    }
    return { id, label: r.label, target, source: r.source, fallback: r.fallback ?? "" };
  });
  return { version: GENERATOR_VERSION, templateId: def.templateName ? lookup.templateIdByName(def.templateName) : null, rows };
}
