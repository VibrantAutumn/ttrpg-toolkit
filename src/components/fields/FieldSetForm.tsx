import { useState } from "react";
import { createFieldSet, setFieldSetFields, updateFieldSet } from "../../api/fields";
import type { FieldDefinition } from "../../lib/fields/definition";
import { LIMITS } from "../../lib/fields/definition";
import type { FieldSet } from "../../lib/fields/fieldSets";
import { bumpDataVersion } from "../../state/dataVersion";

/** Makes or changes a field set: its name and which fields it holds, in order. */
export function FieldSetForm({
  projectId,
  initial,
  definitions,
  onDone,
  onCancel,
}: {
  projectId: string;
  initial: FieldSet | null;
  definitions: FieldDefinition[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [members, setMembers] = useState<string[]>(initial?.fieldIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const byId = new Map(definitions.map((d) => [d.id, d]));
  const available = definitions.filter((d) => !members.includes(d.id));

  function move(i: number, delta: number) {
    const next = [...members];
    const [id] = next.splice(i, 1);
    next.splice(i + delta, 0, id);
    setMembers(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return setError("Give the set a name.");
    setSaving(true);
    try {
      const set = initial ? await updateFieldSet(initial.id, name, description) : await createFieldSet(projectId, name, description);
      await setFieldSetFields(set.id, members);
      bumpDataVersion();
      onDone();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="field-form" onSubmit={submit}>
      <h3>{initial ? `Change “${initial.name}”` : "New field set"}</h3>
      <label>
        Name
        <input type="text" value={name} maxLength={LIMITS.name + 20} autoFocus onChange={(e) => setName(e.currentTarget.value)} />
      </label>
      <label>
        What it is for (optional)
        <input type="text" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
      </label>

      <fieldset className="choices">
        <legend>Fields in this set</legend>
        {members.length === 0 && <p className="empty">No fields yet.</p>}
        <ul className="list">
          {members.map((id, i) => (
            <li key={id} className="row wrap">
              <span className="grow">{byId.get(id)?.name ?? "(missing)"}</span>
              <button type="button" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" disabled={i === members.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" aria-label={`Take ${byId.get(id)?.name ?? "field"} out`} onClick={() => setMembers(members.filter((m) => m !== id))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {available.length > 0 ? (
          <select
            aria-label="Add a field to the set"
            value=""
            onChange={(e) => e.currentTarget.value && setMembers([...members, e.currentTarget.value])}
          >
            <option value="">Add a field…</option>
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : (
          definitions.length === 0 && <p className="meta">Make some fields first, then group them here.</p>
        )}
      </fieldset>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={saving}>
          {initial ? "Save changes" : "Make set"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
