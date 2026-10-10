import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyFieldSet,
  clearFieldValue,
  deleteFieldDefinition,
  deleteFieldSet,
  getItemFields,
  listDeletedFieldDefinitions,
  listDeletedFieldSets,
  restoreFieldDefinition,
  restoreFieldSet,
  saveFieldValue,
  setFieldSecret,
  unapplyFieldSet,
  type ItemFieldData,
} from "../../api/fields";
import type { Item } from "../../api/library";
import type { FieldDefinition } from "../../lib/fields/definition";
import { fieldsToShow, type FieldSet, type ShownField } from "../../lib/fields/fieldSets";
import { coerceValue, emptyValue, formatValue, isEmpty, type FieldValue } from "../../lib/fields/value";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useFieldCatalog } from "../../state/fieldCatalog";
import { ConfirmButton } from "../ConfirmButton";
import { FieldDefinitionForm } from "./FieldDefinitionForm";
import { FieldSetForm } from "./FieldSetForm";
import { FieldValueEditor } from "./FieldValueEditor";

/**
 * The Properties section of an item's page (any item can have properties; "field" in the code):
 * the property sets applied to it, each property's value, and everything needed to manage them
 * right here: add an existing property or set, make a new property, change or delete one (for the
 * whole project), and restore deleted ones. On a template page, property sets can also be made,
 * changed and deleted, because the template decides which sets new documents get. A value can be
 * marked GM-only (kept as a mark now; sharing in Phase 9 is what keeps it off players' devices).
 */
export function ItemFieldsPanel({ item }: { item: Item }) {
  const catalog = useFieldCatalog(item.projectId);
  const dataVersion = useDataVersion();
  const [data, setData] = useState<ItemFieldData | null>(null);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editingField, setEditingField] = useState<string | "new" | null>(null);
  const [editingSet, setEditingSet] = useState<string | "new" | null>(null);
  const isTemplate = item.itemType === "template";

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

  // Properties picked with "Add a property" stay on the page until they have a value (and after).
  useEffect(() => {
    setExtraIds([]);
    setEditingField(null);
    setEditingSet(null);
  }, [item.id]);

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

  // Group the properties as they were gathered: a set's properties together, then the others.
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

  const removeEverywhere = (action: () => Promise<unknown>) =>
    run(async () => {
      await action();
      bumpDataVersion(); // other pages, tables and filter sets that used it change too
    });

  return (
    <section className="item-fields" aria-label="Properties">
      <h2>Properties</h2>
      {(error || catalog.error) && <p className="error">{error ?? catalog.error}</p>}
      {!data && !error && <p className="empty">Loading...</p>}

      {data && groups.length === 0 && (
        <p className="empty">
          {catalog.definitions.length === 0
            ? "No properties yet. Use “New property” below to make one."
            : "No properties on this page yet. Add a property set or a single property."}
        </p>
      )}

      {data &&
        groups.map((group) => {
          const set = group.setId ? catalog.sets.find((s) => s.id === group.setId) : undefined;
          return (
            <div key={group.setId ?? "other"} className="field-group">
              {group.setId ? (
                editingSet === group.setId && set ? (
                  <FieldSetForm
                    projectId={item.projectId}
                    initial={set}
                    definitions={catalog.definitions}
                    onDone={() => setEditingSet(null)}
                    onCancel={() => setEditingSet(null)}
                  />
                ) : (
                  <h3 className="row wrap">
                    <span className="grow">{set?.name}</span>
                    {isTemplate && set && (
                      <>
                        <button type="button" onClick={() => setEditingSet(set.id)}>
                          Edit set
                        </button>
                        <ConfirmButton
                          label="Delete set"
                          confirmLabel="Tap again to delete"
                          onConfirm={() => removeEverywhere(() => deleteFieldSet(set.id))}
                        />
                      </>
                    )}
                    <button type="button" onClick={() => run(() => unapplyFieldSet(item.id, group.setId as string))}>
                      Remove set
                    </button>
                  </h3>
                )
              ) : (
                groups.length > 1 && <h3>Other properties</h3>
              )}
              {group.fields.map(({ definition }) =>
                editingField === definition.id ? (
                  <FieldDefinitionForm
                    key={definition.id}
                    projectId={item.projectId}
                    initial={definition}
                    onDone={() => setEditingField(null)}
                    onCancel={() => setEditingField(null)}
                  />
                ) : (
                  <FieldRow
                    key={definition.id}
                    def={definition}
                    stored={data.values.get(definition.id)}
                    item={item}
                    onSave={save}
                    onClear={clear}
                    onSecret={(secret) => run(() => setFieldSecret(item.id, definition.id, secret))}
                    onEdit={() => setEditingField(definition.id)}
                    onDelete={() => removeEverywhere(() => deleteFieldDefinition(definition.id))}
                  />
                ),
              )}
            </div>
          );
        })}

      {data && editingField === "new" && (
        <FieldDefinitionForm
          projectId={item.projectId}
          initial={null}
          onDone={(id) => {
            if (id) setExtraIds((ids) => [...ids, id]);
            setEditingField(null);
          }}
          onCancel={() => setEditingField(null)}
        />
      )}
      {data && isTemplate && editingSet === "new" && (
        <FieldSetForm
          projectId={item.projectId}
          initial={null}
          definitions={catalog.definitions}
          onDone={(id) => {
            setEditingSet(null);
            if (id) void run(() => applyFieldSet(item.id, id)); // a set made here is used here
          }}
          onCancel={() => setEditingSet(null)}
        />
      )}

      {data && (
        <div className="row wrap">
          {setsToAdd.length > 0 && (
            <select
              aria-label="Add a property set"
              value=""
              onChange={(e) => e.currentTarget.value && run(() => applyFieldSet(item.id, e.currentTarget.value))}
            >
              <option value="">Add a property set…</option>
              {setsToAdd.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {fieldsToAdd.length > 0 && (
            <select
              aria-label="Add a property"
              value=""
              onChange={(e) => {
                const id = e.currentTarget.value;
                if (id) setExtraIds((ids) => [...ids, id]);
              }}
            >
              <option value="">Add a property…</option>
              {fieldsToAdd.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={() => setEditingField("new")} disabled={editingField === "new"}>
            New property
          </button>
          {isTemplate && (
            <button type="button" onClick={() => setEditingSet("new")} disabled={editingSet === "new"}>
              New property set
            </button>
          )}
        </div>
      )}

      <DeletedProperties projectId={item.projectId} showSets={isTemplate} onError={setError} />
    </section>
  );
}

/** Properties (and, on templates, property sets) that were deleted, with a way to bring them back. */
function DeletedProperties({ projectId, showSets, onError }: { projectId: string; showSets: boolean; onError: (message: string) => void }) {
  const dataVersion = useDataVersion();
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [sets, setSets] = useState<FieldSet[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([listDeletedFieldDefinitions(projectId), showSets ? listDeletedFieldSets(projectId) : Promise.resolve([] as FieldSet[])])
      .then(([f, s]) => {
        if (!active) return;
        setFields(f);
        setSets(s);
      })
      .catch((e) => active && onError(String(e)));
    return () => {
      active = false;
    };
  }, [projectId, showSets, dataVersion, onError]);

  async function restore(action: () => Promise<unknown>) {
    try {
      await action();
      bumpDataVersion();
    } catch (e) {
      onError(String(e));
    }
  }

  if (fields.length === 0 && sets.length === 0) return null;
  return (
    <details className="trash">
      <summary>
        Deleted properties{showSets ? " and sets" : ""} ({fields.length + sets.length})
      </summary>
      <ul className="list">
        {fields.map((d) => (
          <li key={d.id} className="row wrap">
            <span className="grow">
              {d.name} <span className="meta">property</span>
            </span>
            <button type="button" onClick={() => restore(() => restoreFieldDefinition(d.id))}>
              Restore
            </button>
          </li>
        ))}
        {sets.map((s) => (
          <li key={s.id} className="row wrap">
            <span className="grow">
              {s.name} <span className="meta">property set</span>
            </span>
            <button type="button" onClick={() => restore(() => restoreFieldSet(s.id))}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FieldRow({
  def,
  stored,
  item,
  onSave,
  onClear,
  onSecret,
  onEdit,
  onDelete,
}: {
  def: FieldDefinition;
  stored: { raw: unknown; secret: boolean } | undefined;
  item: Item;
  onSave: (def: FieldDefinition, value: FieldValue, secret: boolean) => Promise<string | null>;
  onClear: (def: FieldDefinition) => Promise<string | null>;
  onSecret: (secret: boolean) => Promise<string | null>;
  onEdit: () => void;
  onDelete: () => void;
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
            The saved value doesn't fit this property any more ({checked.error}). It shows as “{formatValue(def, emptyValue(def))}” until you clear it.
          </p>
        )}
      </div>
      <div className="field-actions row">
        {hasValue && (
          <>
            <button type="button" aria-pressed={secret} title="Mark this value as GM-only" onClick={() => onSecret(!secret)}>
              {secret ? "🔒 GM only" : "🔓 Visible"}
            </button>
            <button type="button" onClick={() => onClear(def)}>
              Clear
            </button>
          </>
        )}
        <details className="prop-menu">
          <summary aria-label={`More for ${def.name}`}>⋯</summary>
          <div className="row wrap">
            <button type="button" onClick={onEdit}>
              Edit property
            </button>
            <ConfirmButton label="Delete property" confirmLabel="Tap again: every page loses it" onConfirm={onDelete} />
          </div>
        </details>
      </div>
    </div>
  );
}
