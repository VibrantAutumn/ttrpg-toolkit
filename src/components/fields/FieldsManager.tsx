import { useEffect, useState } from "react";
import {
  deleteFieldDefinition,
  deleteFieldSet,
  listDeletedFieldDefinitions,
  listDeletedFieldSets,
  restoreFieldDefinition,
  restoreFieldSet,
} from "../../api/fields";
import { KIND_LABELS, type FieldDefinition } from "../../lib/fields/definition";
import type { FieldSet } from "../../lib/fields/fieldSets";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useFieldCatalog } from "../../state/fieldCatalog";
import { ConfirmButton } from "../ConfirmButton";
import { FieldDefinitionForm } from "./FieldDefinitionForm";
import { FieldSetForm } from "./FieldSetForm";

/** Where fields and field sets are made and changed (Worldbuilding's Fields tab). */
export function FieldsManager() {
  const { campaign } = useCurrentCampaign();
  const campaignId = campaign?.id ?? null;
  const catalog = useFieldCatalog(campaignId);
  const dataVersion = useDataVersion();
  const [editingField, setEditingField] = useState<FieldDefinition | "new" | null>(null);
  const [editingSet, setEditingSet] = useState<FieldSet | "new" | null>(null);
  const [deletedFields, setDeletedFields] = useState<FieldDefinition[]>([]);
  const [deletedSets, setDeletedSets] = useState<FieldSet[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    Promise.all([listDeletedFieldDefinitions(campaignId), listDeletedFieldSets(campaignId)])
      .then(([f, s]) => {
        if (!active) return;
        setDeletedFields(f);
        setDeletedSets(s);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setError(null);
      bumpDataVersion();
    } catch (e) {
      setError(String(e));
    }
  }

  if (!campaignId) return <p className="empty">Choose a campaign to make fields.</p>;

  const fieldName = (id: string) => catalog.definitions.find((d) => d.id === id)?.name;

  return (
    <div className="fields-manager">
      <p className="meta">
        Fields are properties you can fill in on any item. Group them into field sets (an “NPC” set, say) so one tap adds them all.
      </p>
      {(error || catalog.error) && <p className="error">{error ?? catalog.error}</p>}

      <h2>Fields</h2>
      {catalog.definitions.length === 0 && editingField !== "new" && <p className="empty">No fields yet.</p>}
      <ul className="list">
        {catalog.definitions.map((d) => (
          <li key={d.id}>
            {editingField && editingField !== "new" && editingField.id === d.id ? (
              <FieldDefinitionForm campaignId={campaignId} initial={d} onDone={() => setEditingField(null)} onCancel={() => setEditingField(null)} />
            ) : (
              <div className="row wrap">
                <span className="grow">
                  <strong>{d.name}</strong> <span className="meta">{KIND_LABELS[d.kind]}</span>
                  {d.description && <span className="meta"> · {d.description}</span>}
                </span>
                <button type="button" onClick={() => setEditingField(d)}>
                  Change
                </button>
                <ConfirmButton label="Delete" confirmLabel="Tap again to delete" onConfirm={() => run(() => deleteFieldDefinition(d.id))} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {editingField === "new" ? (
        <FieldDefinitionForm campaignId={campaignId} initial={null} onDone={() => setEditingField(null)} onCancel={() => setEditingField(null)} />
      ) : (
        <button type="button" onClick={() => setEditingField("new")}>
          New field
        </button>
      )}

      <h2>Field sets</h2>
      {catalog.sets.length === 0 && editingSet !== "new" && <p className="empty">No field sets yet.</p>}
      <ul className="list">
        {catalog.sets.map((s) => (
          <li key={s.id}>
            {editingSet && editingSet !== "new" && editingSet.id === s.id ? (
              <FieldSetForm campaignId={campaignId} initial={s} definitions={catalog.definitions} onDone={() => setEditingSet(null)} onCancel={() => setEditingSet(null)} />
            ) : (
              <div className="row wrap">
                <span className="grow">
                  <strong>{s.name}</strong>{" "}
                  <span className="meta">{s.fieldIds.length === 0 ? "no fields" : s.fieldIds.map((id) => fieldName(id) ?? "?").join(", ")}</span>
                </span>
                <button type="button" onClick={() => setEditingSet(s)}>
                  Change
                </button>
                <ConfirmButton label="Delete" confirmLabel="Tap again to delete" onConfirm={() => run(() => deleteFieldSet(s.id))} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {editingSet === "new" ? (
        <FieldSetForm campaignId={campaignId} initial={null} definitions={catalog.definitions} onDone={() => setEditingSet(null)} onCancel={() => setEditingSet(null)} />
      ) : (
        <button type="button" onClick={() => setEditingSet("new")}>
          New field set
        </button>
      )}

      {(deletedFields.length > 0 || deletedSets.length > 0) && (
        <details className="trash">
          <summary>Deleted fields and sets ({deletedFields.length + deletedSets.length})</summary>
          <ul className="list">
            {deletedFields.map((d) => (
              <li key={d.id} className="row wrap">
                <span className="grow">
                  {d.name} <span className="meta">field</span>
                </span>
                <button type="button" onClick={() => run(() => restoreFieldDefinition(d.id))}>
                  Restore
                </button>
              </li>
            ))}
            {deletedSets.map((s) => (
              <li key={s.id} className="row wrap">
                <span className="grow">
                  {s.name} <span className="meta">field set</span>
                </span>
                <button type="button" onClick={() => run(() => restoreFieldSet(s.id))}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
