import { useState } from "react";
import { DefinitionEditor } from "../../components/fields/FieldDefinitionForm";
import { ConfirmButton } from "../../components/ConfirmButton";
import { KIND_LABELS, newDefinition, normalizeDefinition, validateDefinition, type FieldDefinition } from "../../lib/fields/definition";
import { removeField, uniqueKey, type RulesetField } from "../../lib/rulesets/ruleset";
import type { SectionProps } from "./sectionTypes";

const toDefinition = (f: RulesetField): FieldDefinition =>
  normalizeDefinition({ id: f.key, name: f.name, kind: f.kind, description: f.description, config: f.config }) ?? newDefinition("text", f.key, f.name);

/**
 * The properties a ruleset's stat blocks can use. The form is the same one pages use for their own
 * properties (`DefinitionEditor`), but nothing is saved to a project here: they are copied into a
 * project when the ruleset is used there.
 */
export function PropertiesSection({ ruleset, edit }: SectionProps) {
  const [editing, setEditing] = useState<{ key: string | null; draft: FieldDefinition } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  function save() {
    if (!editing) return;
    const found = validateDefinition(editing.draft);
    const clash = ruleset.fields.some((f) => f.key !== editing.key && f.name.trim().toLowerCase() === editing.draft.name.trim().toLowerCase());
    if (clash) found.push("Another property already has that name.");
    if (found.length > 0) return setProblems(found);
    const { draft } = editing;
    edit((r) => {
      if (editing.key !== null) {
        return { ...r, fields: r.fields.map((f) => (f.key === editing.key ? { ...f, name: draft.name.trim(), description: draft.description, config: { ...draft.config } } : f)) };
      }
      const key = uniqueKey(draft.name, r.fields.map((f) => f.key));
      return { ...r, fields: [...r.fields, { key, name: draft.name.trim(), kind: draft.kind, description: draft.description, config: { ...draft.config } }] };
    });
    setEditing(null);
    setProblems([]);
  }

  return (
    <div>
      <p className="meta">
        Properties are the numbers, bars and notes on a stat block (Strength, Hit points...). Make them here, then put them in stat blocks.
      </p>
      <ul className="list">
        {ruleset.fields.map((f) => (
          <li key={f.key} className="row wrap">
            <span className="name">
              <strong>{f.name}</strong> <span className="meta">{KIND_LABELS[f.kind]}</span>
              {f.description && <span className="meta"> · {f.description}</span>}
            </span>
            <button onClick={() => (setProblems([]), setEditing({ key: f.key, draft: toDefinition(f) }))}>Edit</button>
            <ConfirmButton label="Delete" onConfirm={() => edit((r) => removeField(r, f.key))} />
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="field-form">
          <h3>{editing.key === null ? "New property" : `Change “${ruleset.fields.find((f) => f.key === editing.key)?.name ?? ""}”`}</h3>
          <DefinitionEditor
            draft={editing.draft}
            setDraft={(change) => setEditing((e) => (e ? { ...e, draft: change(e.draft) } : e))}
            lockedKind={editing.key === null ? null : editing.draft.kind}
          />
          {problems.length > 0 && (
            <ul className="error" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="row">
            <button onClick={save}>{editing.key === null ? "Add property" : "Save changes"}</button>
            <button onClick={() => (setEditing(null), setProblems([]))}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => (setProblems([]), setEditing({ key: null, draft: newDefinition("number", "", "") }))}>+ New property</button>
      )}
    </div>
  );
}
