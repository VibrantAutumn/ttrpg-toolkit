import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyFieldSet,
  clearFieldValue,
  getItemFields,
  saveFieldValue,
  setFieldSecret,
  unapplyFieldSet,
  type ItemFieldData,
} from "../../api/fields";
import type { Item } from "../../api/library";
import type { FieldDefinition } from "../../lib/fields/definition";
import { fieldsToShow, type ShownField } from "../../lib/fields/fieldSets";
import { coerceValue, emptyValue, formatValue, isEmpty, type FieldValue } from "../../lib/fields/value";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useFieldCatalog } from "../../state/fieldCatalog";
import { FieldValueEditor } from "./FieldValueEditor";

/**
 * The Fields section of an item's page (any item can have fields): the field sets applied to it,
 * each field's value, and a way to add a set or a single field. A value can be marked GM-only
 * (kept as a mark now; sharing in Phase 9 is what keeps it off players' devices).
 */
export function ItemFieldsPanel({ item }: { item: Item }) {
  const catalog = useFieldCatalog(item.projectId);
  const dataVersion = useDataVersion();
  const [data, setData] = useState<ItemFieldData | null>(null);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    getItemFields(item.id)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [item.id, dataVersion, refresh]);

  // Fields picked with "Add a field" stay on the page until they have a value (and after).
  useEffect(() => setExtraIds([]), [item.id]);

  const shown = useMemo<ShownField[]>(() => {
    if (!data) return [];
    return fieldsToShow({
      appliedSetIds: data.setIds,
      sets: catalog.sets,
      definitions: catalog.definitions,
      fieldIdsWithValues: new Set([...data.values.keys(), ...extraIds]),
    });
  }, [data, catalog.sets, catalog.definitions, extraIds]);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  async function run(action: () => Promise<unknown>): Promise<string | null> {
    try {
      await action();
      reload();
      return null;
    } catch (e) {
      const message = String(e);
      setError(message);
      return message;
    }
  }

  const save = (def: FieldDefinition, value: FieldValue, secret: boolean) =>
    run(async () => {
      await saveFieldValue(def, item.id, value, secret);
      if (def.kind === "link") bumpDataVersion(); // the item page's Links lists change
    });

  const clear = (def: FieldDefinition) =>
    run(async () => {
      await clearFieldValue(item.id, def.id);
      if (def.kind === "link") bumpDataVersion();
    });

  // Group the fields as they were gathered: a set's fields together, then the others.
  const groups: { setId: string | null; fields: ShownField[] }[] = [];
  for (const field of shown) {
    const last = groups[groups.length - 1];
    if (last && last.setId === field.setId) last.fields.push(field);
    else groups.push({ setId: field.setId, fields: [field] });
  }

  const appliedSets = new Set(data?.setIds ?? []);
  const shownIds = new Set(shown.map((s) => s.definition.id));
  const setsToAdd = catalog.sets.filter((s) => !appliedSets.has(s.id));
  const fieldsToAdd = catalog.definitions.filter((d) => !shownIds.has(d.id));

  return (
    <section className="item-fields" aria-label="Fields">
      <h2>Fields</h2>
      {(error || catalog.error) && <p className="error">{error ?? catalog.error}</p>}
      {!data && !error && <p className="empty">Loading...</p>}

      {data && groups.length === 0 && (
        <p className="empty">
          {catalog.definitions.length === 0
            ? "No fields yet. Make some in Worldbuilding, under Fields, then add them here."
            : "No fields on this item yet. Add a field set or a single field."}
        </p>
      )}

      {data &&
        groups.map((group) => {
          const set = group.setId ? catalog.sets.find((s) => s.id === group.setId) : undefined;
          return (
            <div key={group.setId ?? "other"} className="field-group">
              {group.setId ? (
                <h3 className="row wrap">
                  <span className="grow">{set?.name}</span>
                  <button type="button" onClick={() => run(() => unapplyFieldSet(item.id, group.setId as string))}>
                    Remove set
                  </button>
                </h3>
              ) : (
                groups.length > 1 && <h3>Other fields</h3>
              )}
              {group.fields.map(({ definition }) => (
                <FieldRow
                  key={definition.id}
                  def={definition}
                  stored={data.values.get(definition.id)}
                  item={item}
                  onSave={save}
                  onClear={clear}
                  onSecret={(secret) => run(() => setFieldSecret(item.id, definition.id, secret))}
                />
              ))}
            </div>
          );
        })}

      {data && (setsToAdd.length > 0 || fieldsToAdd.length > 0) && (
        <div className="row wrap">
          {setsToAdd.length > 0 && (
            <select
              aria-label="Add a field set"
              value=""
              onChange={(e) => e.currentTarget.value && run(() => applyFieldSet(item.id, e.currentTarget.value))}
            >
              <option value="">Add a field set…</option>
              {setsToAdd.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {fieldsToAdd.length > 0 && (
            <select
              aria-label="Add a single field"
              value=""
              onChange={(e) => {
                const id = e.currentTarget.value;
                if (id) setExtraIds((ids) => [...ids, id]);
              }}
            >
              <option value="">Add a single field…</option>
              {fieldsToAdd.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </section>
  );
}

function FieldRow({
  def,
  stored,
  item,
  onSave,
  onClear,
  onSecret,
}: {
  def: FieldDefinition;
  stored: { raw: unknown; secret: boolean } | undefined;
  item: Item;
  onSave: (def: FieldDefinition, value: FieldValue, secret: boolean) => Promise<string | null>;
  onClear: (def: FieldDefinition) => Promise<string | null>;
  onSecret: (secret: boolean) => Promise<string | null>;
}) {
  // The saved value, checked against the field; one that no longer fits is shown as such.
  const checked = useMemo(() => (stored === undefined ? { ok: true as const, value: emptyValue(def) } : coerceValue(def, stored.raw)), [def, stored]);
  const secret = stored?.secret ?? false;
  const hasValue = stored !== undefined && (!checked.ok || !isEmpty(def, checked.value));

  return (
    <div className={secret ? "field-row field-secret" : "field-row"}>
      <label className="field-name" title={def.description || undefined}>
        {def.name}
        {secret && <span className="meta"> 🔒 GM only</span>}
      </label>
      <div className="field-editor">
        {checked.ok ? (
          <FieldValueEditor
            def={def}
            value={checked.value}
            projectId={item.projectId}
            itemId={item.id}
            onChange={(value) => onSave(def, value, secret)}
          />
        ) : (
          <p className="error">
            The saved value doesn't fit this field any more ({checked.error}). It shows as “{formatValue(def, emptyValue(def))}” until you clear it.
          </p>
        )}
      </div>
      {hasValue && (
        <div className="field-actions row">
          <button type="button" aria-pressed={secret} title="Mark this value as GM-only" onClick={() => onSecret(!secret)}>
            {secret ? "🔒 GM only" : "🔓 Visible"}
          </button>
          <button type="button" onClick={() => onClear(def)}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
