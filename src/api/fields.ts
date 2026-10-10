import { invoke } from "@tauri-apps/api/core";
import { normalizeDefinition, type FieldDefinition } from "../lib/fields/definition";
import type { FieldSet } from "../lib/fields/fieldSets";
import { coerceValue, indexValue, isEmpty, type FieldValue } from "../lib/fields/value";

/**
 * Fields: definitions, sets, and the values items hold. The database stores settings and values
 * as JSON text and only checks sizes and ownership; this layer turns them into the types in
 * `lib/fields/` and makes every value pass `coerceValue` on the way in.
 */

interface DefinitionRecord {
  id: string;
  name: string;
  kind: string;
  description: string;
  configJson: string;
}

interface SetRecord {
  id: string;
  name: string;
  description: string;
  fieldIds: string[];
}

function toDefinition(record: DefinitionRecord): FieldDefinition | null {
  let config: unknown = {};
  try {
    config = JSON.parse(record.configJson);
  } catch {
    // Unreadable settings fall back to the kind's defaults.
  }
  return normalizeDefinition({ id: record.id, name: record.name, kind: record.kind, description: record.description, config });
}

const toDefinitions = (records: DefinitionRecord[]): FieldDefinition[] =>
  records.flatMap((r) => {
    const def = toDefinition(r);
    return def ? [def] : [];
  });

const toSet = (r: SetRecord): FieldSet => ({ id: r.id, name: r.name, description: r.description, fieldIds: r.fieldIds });

// ---- definitions

export const listFieldDefinitions = async (projectId: string) =>
  toDefinitions(await invoke<DefinitionRecord[]>("list_field_definitions", { projectId }));

export const listDeletedFieldDefinitions = async (projectId: string) =>
  toDefinitions(await invoke<DefinitionRecord[]>("list_deleted_field_definitions", { projectId }));

export async function createFieldDefinition(projectId: string, def: FieldDefinition): Promise<FieldDefinition> {
  const record = await invoke<DefinitionRecord>("create_field_definition", {
    projectId,
    name: def.name.trim(),
    kind: def.kind,
    description: def.description,
    configJson: JSON.stringify(def.config),
  });
  return toDefinition(record) ?? def;
}

export async function updateFieldDefinition(def: FieldDefinition): Promise<FieldDefinition> {
  const record = await invoke<DefinitionRecord>("update_field_definition", {
    id: def.id,
    name: def.name.trim(),
    description: def.description,
    configJson: JSON.stringify(def.config),
  });
  return toDefinition(record) ?? def;
}

export const deleteFieldDefinition = (id: string) => invoke<void>("delete_field_definition", { id });
export const restoreFieldDefinition = (id: string) => invoke<DefinitionRecord>("restore_field_definition", { id });

// ---- sets

export const listFieldSets = async (projectId: string) =>
  (await invoke<SetRecord[]>("list_field_sets", { projectId })).map(toSet);
export const listDeletedFieldSets = async (projectId: string) =>
  (await invoke<SetRecord[]>("list_deleted_field_sets", { projectId })).map(toSet);
export const createFieldSet = async (projectId: string, name: string, description: string) =>
  toSet(await invoke<SetRecord>("create_field_set", { projectId, name, description }));
export const updateFieldSet = async (id: string, name: string, description: string) =>
  toSet(await invoke<SetRecord>("update_field_set", { id, name, description }));
export const setFieldSetFields = async (setId: string, fieldIds: string[]) =>
  toSet(await invoke<SetRecord>("set_field_set_fields", { setId, fieldIds }));
export const deleteFieldSet = (id: string) => invoke<void>("delete_field_set", { id });
export const restoreFieldSet = (id: string) => invoke<SetRecord>("restore_field_set", { id });
export const applyFieldSet = (itemId: string, setId: string) => invoke<void>("apply_field_set", { itemId, setId });
export const unapplyFieldSet = (itemId: string, setId: string) => invoke<void>("unapply_field_set", { itemId, setId });

// ---- values

interface ValueRecord {
  itemId: string;
  fieldId: string;
  valueJson: string;
  secret: boolean;
}

/** What an item holds: the sets applied to it and each stored value (still unchecked JSON). */
export interface ItemFieldData {
  setIds: string[];
  values: Map<string, { raw: unknown; secret: boolean }>;
}

export async function getItemFields(itemId: string): Promise<ItemFieldData> {
  const data = await invoke<{ setIds: string[]; values: ValueRecord[] }>("get_item_fields", { itemId });
  const values = new Map<string, { raw: unknown; secret: boolean }>();
  for (const v of data.values) {
    try {
      values.set(v.fieldId, { raw: JSON.parse(v.valueJson), secret: v.secret });
    } catch {
      // A value that can't be read is treated as not there.
    }
  }
  return { setIds: data.setIds, values };
}

/**
 * Saves an item's value for a field. The value must fit the field (it is checked again here); an
 * empty value clears it. Throws the reason as text if it can't be saved.
 */
export async function saveFieldValue(def: FieldDefinition, itemId: string, value: FieldValue, secret: boolean): Promise<void> {
  const checked = coerceValue(def, value);
  if (!checked.ok) throw checked.error;
  if (isEmpty(def, checked.value)) {
    await invoke<void>("clear_field_value", { itemId, fieldId: def.id });
    return;
  }
  await invoke<void>("set_field_value", {
    itemId,
    fieldId: def.id,
    valueJson: JSON.stringify(checked.value),
    index: indexValue(def, checked.value),
    secret,
  });
}

export const clearFieldValue = (itemId: string, fieldId: string) => invoke<void>("clear_field_value", { itemId, fieldId });
export const setFieldSecret = (itemId: string, fieldId: string, secret: boolean) =>
  invoke<void>("set_field_secret", { itemId, fieldId, secret });

/**
 * After a field's settings change: refreshes what its stored values sort and search as (renaming
 * or reordering a dropdown's choices changes that), and clears values that no longer fit (a
 * dropdown choice that was removed).
 */
export async function refreshFieldValues(def: FieldDefinition): Promise<void> {
  const stored = await invoke<ValueRecord[]>("list_field_values", { fieldId: def.id });
  const updates: { itemId: string; sortNum: number | null; sortText: string | null; searchText: string }[] = [];
  for (const v of stored) {
    let raw: unknown;
    try {
      raw = JSON.parse(v.valueJson);
    } catch {
      continue;
    }
    const checked = coerceValue(def, raw);
    if (checked.ok) {
      const index = indexValue(def, checked.value);
      updates.push({ itemId: v.itemId, ...index });
    } else if (def.kind === "dropdown") {
      await invoke<void>("clear_field_value", { itemId: v.itemId, fieldId: def.id });
    }
  }
  if (updates.length > 0) await invoke<void>("update_field_indexes", { fieldId: def.id, updates });
}

/** Every item's value for one field, each checked against the field (a value that doesn't fit is left out). */
export async function listFieldValues(def: FieldDefinition): Promise<Map<string, FieldValue>> {
  const stored = await invoke<ValueRecord[]>("list_field_values", { fieldId: def.id });
  const out = new Map<string, FieldValue>();
  for (const v of stored) {
    try {
      const checked = coerceValue(def, JSON.parse(v.valueJson));
      if (checked.ok) out.set(v.itemId, checked.value);
    } catch {
      // unreadable: treated as not there
    }
  }
  return out;
}
