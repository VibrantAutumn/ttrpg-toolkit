import { useState } from "react";
import { createFieldDefinition, refreshFieldValues, updateFieldDefinition } from "../../api/fields";
import {
  addOption,
  defaultConfig,
  FIELD_KINDS,
  KIND_LABELS,
  LIMITS,
  moveOption,
  newDefinition,
  removeOption,
  renameOption,
  setOptionColor,
  validateDefinition,
  type ConfigOf,
  type FieldDefinition,
  type FieldKind,
} from "../../lib/fields/definition";
import { registry } from "../../registry";
import { bumpDataVersion } from "../../state/dataVersion";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Reads a box of text as a number, or null when it is empty or not a number. */
const numberOrNull = (text: string): number | null => {
  const n = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(n) ? null : n;
};

type Of<K extends FieldKind> = Extract<FieldDefinition, { kind: K }>;

/**
 * Makes a field or changes one. The kind can only be chosen when making it (changing it later
 * could leave saved values that don't fit). Problems are listed in plain words before anything
 * is saved.
 */
export function FieldDefinitionForm({
  projectId,
  initial,
  onDone,
  onCancel,
}: {
  projectId: string;
  initial: FieldDefinition | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<FieldDefinition>(initial ?? newDefinition("text", "", ""));
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  /** Changes some of the kind's settings. */
  function configure<K extends FieldKind>(change: Partial<ConfigOf<K>>) {
    setDraft((d) => ({ ...d, config: { ...d.config, ...change } }) as FieldDefinition);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateDefinition(draft);
    if (found.length > 0) return setProblems(found);
    setSaving(true);
    try {
      const saved = initial ? await updateFieldDefinition(draft) : await createFieldDefinition(projectId, draft);
      // A dropdown's values sort and search by its choices, and a removed choice clears them.
      if (initial && saved.kind === "dropdown") await refreshFieldValues(saved);
      bumpDataVersion();
      onDone();
    } catch (err) {
      setProblems([String(err)]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="field-form" onSubmit={submit}>
      <h3>{initial ? `Change “${initial.name}”` : "New field"}</h3>
      <label>
        Name
        <input
          type="text"
          value={draft.name}
          maxLength={LIMITS.name + 20}
          autoFocus
          onChange={(e) => {
            const name = e.currentTarget.value;
            setDraft((d) => ({ ...d, name }) as FieldDefinition);
          }}
        />
      </label>
      <label>
        What it is for (optional)
        <input
          type="text"
          value={draft.description}
          onChange={(e) => {
            const description = e.currentTarget.value;
            setDraft((d) => ({ ...d, description }) as FieldDefinition);
          }}
        />
      </label>
      <label>
        Kind
        {initial ? (
          <span> {KIND_LABELS[initial.kind]} (can't be changed)</span>
        ) : (
          <select
            value={draft.kind}
            onChange={(e) => {
              const kind = e.currentTarget.value as FieldKind;
              setDraft((d) => ({ ...d, kind, config: defaultConfig(kind) }) as FieldDefinition);
            }}
          >
            {FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        )}
      </label>

      {draft.kind === "text" && (
        <label className="check">
          <input type="checkbox" checked={draft.config.multiline} onChange={(e) => configure<"text">({ multiline: e.currentTarget.checked })} />
          Allow several lines
        </label>
      )}

      {draft.kind === "number" && <NumberSettings def={draft} configure={(c) => configure<"number">(c)} />}

      {draft.kind === "bar" && (
        <label>
          Decimal places
          <input type="number" min={0} max={LIMITS.decimals} value={draft.config.decimals} onChange={(e) => configure<"bar">({ decimals: Number(e.currentTarget.value) })} />
        </label>
      )}

      {draft.kind === "dropdown" && <ChoicesEditor def={draft} onChange={setDraft} />}

      {draft.kind === "link" && (
        <>
          <label className="check">
            <input type="checkbox" checked={draft.config.many} onChange={(e) => configure<"link">({ many: e.currentTarget.checked })} />
            Allow several items
          </label>
          <label>
            Only link to items in
            <select value={draft.config.library ?? ""} onChange={(e) => configure<"link">({ library: e.currentTarget.value || null })}>
              <option value="">Any tool</option>
              {registry.getTools().map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {(draft.kind === "formula" || draft.kind === "list") && (
        <p className="meta">
          {draft.kind === "formula"
            ? "Holds a dice formula such as 1d20+2, and has a button to roll it."
            : "Holds entries, each with a title and a description (actions, abilities...)."}
        </p>
      )}

      {problems.length > 0 && (
        <ul className="error" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="row">
        <button type="submit" disabled={saving}>
          {initial ? "Save changes" : "Make field"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function NumberSettings({ def, configure }: { def: Of<"number">; configure: (change: Partial<Of<"number">["config"]>) => void }) {
  return (
    <div className="row wrap">
      <label>
        Smallest
        <input type="text" inputMode="decimal" defaultValue={def.config.min ?? ""} onChange={(e) => configure({ min: numberOrNull(e.currentTarget.value) })} />
      </label>
      <label>
        Largest
        <input type="text" inputMode="decimal" defaultValue={def.config.max ?? ""} onChange={(e) => configure({ max: numberOrNull(e.currentTarget.value) })} />
      </label>
      <label>
        Decimal places
        <input type="number" min={0} max={LIMITS.decimals} value={def.config.decimals} onChange={(e) => configure({ decimals: Number(e.currentTarget.value) })} />
      </label>
      <label>
        Unit
        <input type="text" value={def.config.unit} maxLength={LIMITS.unit} placeholder="ft, gp..." onChange={(e) => configure({ unit: e.currentTarget.value })} />
      </label>
    </div>
  );
}

/** The choices of a dropdown: rename, colour, reorder, remove, add. */
function ChoicesEditor({ def, onChange }: { def: Of<"dropdown">; onChange: (def: FieldDefinition) => void }) {
  const [adding, setAdding] = useState("");
  const add = () => {
    onChange(addOption(def, adding, newId()));
    setAdding("");
  };
  return (
    <fieldset className="choices">
      <legend>Choices</legend>
      <ul className="list">
        {def.config.options.map((o, i) => (
          <li key={o.id} className="row wrap">
            <input
              type="text"
              aria-label={`Choice ${i + 1}`}
              className="grow"
              value={o.label}
              maxLength={LIMITS.optionLabel}
              onChange={(e) => onChange({ ...renameOption(def, o.id, e.currentTarget.value), } as FieldDefinition)}
            />
            <input
              type="color"
              aria-label={`Colour of ${o.label || "choice"}`}
              value={o.color ?? "#808080"}
              onChange={(e) => onChange(setOptionColor(def, o.id, e.currentTarget.value))}
            />
            {o.color && (
              <button type="button" onClick={() => onChange(setOptionColor(def, o.id, null))}>
                No colour
              </button>
            )}
            <button type="button" disabled={i === 0} aria-label="Move up" onClick={() => onChange(moveOption(def, o.id, -1))}>
              ↑
            </button>
            <button type="button" disabled={i === def.config.options.length - 1} aria-label="Move down" onClick={() => onChange(moveOption(def, o.id, 1))}>
              ↓
            </button>
            <button type="button" aria-label={`Remove ${o.label || "choice"}`} onClick={() => onChange(removeOption(def, o.id))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input
          type="text"
          className="grow"
          aria-label="New choice"
          placeholder="Add a choice"
          value={adding}
          onChange={(e) => setAdding(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" disabled={adding.trim() === ""} onClick={add}>
          Add
        </button>
      </div>
      <p className="meta">Items that use a choice you remove lose that value when you save.</p>
    </fieldset>
  );
}
