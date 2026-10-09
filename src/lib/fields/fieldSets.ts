import type { FieldDefinition } from "./definition";

/** A reusable group of fields ("NPC", a ruleset's stat block). Templates and rulesets use them. */
export interface FieldSet {
  id: string;
  name: string;
  description: string;
  /** In the order they are shown. */
  fieldIds: string[];
}

export interface ShownField {
  definition: FieldDefinition;
  /** The applied set it came from, or null for a field shown only because the item has a value for it. */
  setId: string | null;
}

/**
 * The fields an item's page shows: first those of the field sets applied to it, set by set in
 * the order they were applied (a field in several sets appears once, under the first); then any
 * other field the item holds a value for, alphabetically. Fields and sets that no longer exist
 * are skipped.
 */
export function fieldsToShow(input: {
  appliedSetIds: string[];
  sets: FieldSet[];
  definitions: FieldDefinition[];
  fieldIdsWithValues: ReadonlySet<string>;
}): ShownField[] {
  const byId = new Map(input.definitions.map((d) => [d.id, d]));
  const setById = new Map(input.sets.map((s) => [s.id, s]));
  const shown: ShownField[] = [];
  const seen = new Set<string>();

  for (const setId of input.appliedSetIds) {
    const set = setById.get(setId);
    if (!set) continue;
    for (const fieldId of set.fieldIds) {
      const definition = byId.get(fieldId);
      if (!definition || seen.has(fieldId)) continue;
      seen.add(fieldId);
      shown.push({ definition, setId });
    }
  }

  const extra = [...input.fieldIdsWithValues]
    .filter((id) => !seen.has(id) && byId.has(id))
    .map((id) => byId.get(id) as FieldDefinition)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  for (const definition of extra) shown.push({ definition, setId: null });
  return shown;
}
