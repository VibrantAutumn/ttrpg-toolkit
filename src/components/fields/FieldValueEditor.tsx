import { useEffect, useRef, useState } from "react";
import { getItems, type Item } from "../../api/library";
import { describeParseError } from "../../lib/dice/formula";
import { adjustBar, barFraction, parseBarInput } from "../../lib/fields/bar";
import type { FieldDefinition } from "../../lib/fields/definition";
import { parseNumberInput } from "../../lib/fields/numberInput";
import { coerceValue, type BarValue, type FieldValue, type ListEntry } from "../../lib/fields/value";
import { rollLog } from "../../state/rollLog";
import { itemIcon } from "../item/itemDisplay";
import { LinkPicker } from "../item/LinkPicker";

/**
 * The editor for one field's value, whatever its kind. Edits are checked as they are committed
 * (when you leave the box, or press a button), never while typing, so half-typed text is never
 * refused; a value that doesn't fit shows why and is not saved.
 */
export interface FieldValueEditorProps {
  def: FieldDefinition;
  /** The saved value (already checked against the field). */
  value: FieldValue;
  campaignId: string;
  /** The item the value belongs to (it is left out of the items a link field offers). */
  itemId: string;
  disabled?: boolean;
  /** Saves a new value. Returns why it couldn't be saved, or null if it was. */
  onChange: (value: FieldValue) => Promise<string | null>;
}

export function FieldValueEditor(props: FieldValueEditorProps) {
  const { def } = props;
  switch (def.kind) {
    case "text":
      return <TextEditor {...props} def={def} />;
    case "number":
      return <NumberEditor {...props} def={def} />;
    case "bar":
      return <BarEditor {...props} def={def} />;
    case "formula":
      return <FormulaEditor {...props} def={def} />;
    case "dropdown":
      return <DropdownEditor {...props} def={def} />;
    case "list":
      return <ListEditor {...props} def={def} />;
    case "link":
      return <LinkEditor {...props} def={def} />;
  }
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p className="error field-error" role="alert">
      {message}
    </p>
  ) : null;
}

/** A text draft that follows the saved value, and is committed on blur or Enter. */
function useTextDraft(saved: string) {
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(saved);
    setError(null);
  }, [saved]);
  return { draft, setDraft, error, setError };
}

type Kind<K extends FieldDefinition["kind"]> = FieldValueEditorProps & { def: Extract<FieldDefinition, { kind: K }> };

function TextEditor({ def, value, disabled, onChange }: Kind<"text">) {
  const { draft, setDraft, error, setError } = useTextDraft(value as string);
  async function commit() {
    if (draft === value) return setError(null);
    const checked = coerceValue(def, draft);
    if (!checked.ok) return setError(checked.error);
    setError(await onChange(checked.value));
  }
  return (
    <>
      {def.config.multiline ? (
        <textarea rows={3} value={draft} disabled={disabled} aria-label={def.name} onChange={(e) => setDraft(e.currentTarget.value)} onBlur={commit} />
      ) : (
        <input
          type="text"
          value={draft}
          disabled={disabled}
          aria-label={def.name}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      )}
      <ErrorLine message={error} />
    </>
  );
}

function NumberEditor({ def, value, disabled, onChange }: Kind<"number">) {
  const saved = value === null ? "" : String(value);
  const { draft, setDraft, error, setError } = useTextDraft(saved);
  async function commit() {
    if (draft.trim() === saved) return setError(null);
    const checked = parseNumberInput(def, draft);
    if (!checked.ok) return setError(checked.error);
    setError(await onChange(checked.value));
  }
  return (
    <>
      <span className="field-number">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          aria-label={def.name}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        {def.config.unit && <span className="meta">{def.config.unit}</span>}
      </span>
      <ErrorLine message={error} />
    </>
  );
}

function BarEditor({ def, value, disabled, onChange }: Kind<"bar">) {
  const bar = value as BarValue | null;
  const saved = bar ? `${bar.current}/${bar.max}` : "";
  const { draft, setDraft, error, setError } = useTextDraft(saved);
  async function commit() {
    if (draft.trim() === saved) return setError(null);
    const parsed = parseBarInput(draft, bar);
    if (!parsed.ok) return setError(parsed.error);
    const checked = coerceValue(def, parsed.value);
    if (!checked.ok) return setError(checked.error);
    setError(await onChange(checked.value));
  }
  async function nudge(delta: number) {
    setError(await onChange(adjustBar(bar, delta)));
  }
  return (
    <>
      <span className="field-bar-row">
        <button type="button" disabled={disabled || !bar} aria-label={`Lower ${def.name} by 1`} onClick={() => nudge(-1)}>
          −
        </button>
        <input
          type="text"
          inputMode="text"
          value={draft}
          disabled={disabled}
          aria-label={def.name}
          placeholder="22/30"
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <button type="button" disabled={disabled || !bar} aria-label={`Raise ${def.name} by 1`} onClick={() => nudge(1)}>
          +
        </button>
      </span>
      {bar && (
        <div className="field-bar" role="img" aria-label={`${bar.current} of ${bar.max}`}>
          <div className="field-bar-fill" style={{ width: `${Math.round(barFraction(bar) * 100)}%` }} />
        </div>
      )}
      <ErrorLine message={error} />
    </>
  );
}

function FormulaEditor({ def, value, disabled, onChange }: Kind<"formula">) {
  const text = value as string;
  const { draft, setDraft, error, setError } = useTextDraft(text);
  async function commit() {
    if (draft.trim() === text) return setError(null);
    const checked = coerceValue(def, draft);
    if (!checked.ok) return setError(checked.error);
    setError(await onChange(checked.value));
  }
  function roll() {
    const outcome = rollLog.roll(text, undefined, def.name);
    setError(outcome.ok ? null : describeParseError(outcome.error));
  }
  return (
    <>
      <span className="field-bar-row">
        <input
          type="text"
          value={draft}
          disabled={disabled}
          aria-label={def.name}
          placeholder="1d20+2"
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <button type="button" disabled={text === "" || draft.trim() !== text} onClick={roll}>
          Roll
        </button>
      </span>
      <ErrorLine message={error} />
    </>
  );
}

function DropdownEditor({ def, value, disabled, onChange }: Kind<"dropdown">) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <select
        value={(value as string | null) ?? ""}
        disabled={disabled}
        aria-label={def.name}
        onChange={async (e) => setError(await onChange(e.currentTarget.value === "" ? null : e.currentTarget.value))}
      >
        <option value="">—</option>
        {def.config.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ErrorLine message={error} />
    </>
  );
}

function ListEditor({ def, value, disabled, onChange }: Kind<"list">) {
  const saved = value as ListEntry[];
  const [draft, setDraft] = useState<ListEntry[]>(saved);
  const [error, setError] = useState<string | null>(null);
  // Follow the saved list when it really changes (not just because the parent drew again).
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setDraft(JSON.parse(savedKey) as ListEntry[]);
    setError(null);
  }, [savedKey]);

  async function commit(next: ListEntry[]) {
    const checked = coerceValue(def, next);
    if (!checked.ok) return setError(checked.error);
    if (JSON.stringify(checked.value) === JSON.stringify(saved)) return setError(null);
    setError(await onChange(checked.value));
  }
  const edit = (i: number, change: Partial<ListEntry>) => setDraft(draft.map((e, k) => (k === i ? { ...e, ...change } : e)));
  function move(i: number, delta: number) {
    const next = [...draft];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item);
    setDraft(next);
    void commit(next);
  }

  return (
    <>
      <ul className="field-list">
        {draft.map((entry, i) => (
          <li key={i} className="field-list-entry">
            <input
              type="text"
              value={entry.title}
              disabled={disabled}
              placeholder="Title"
              aria-label={`${def.name} entry ${i + 1} title`}
              onChange={(e) => edit(i, { title: e.currentTarget.value })}
              onBlur={() => commit(draft)}
            />
            <textarea
              rows={2}
              value={entry.text}
              disabled={disabled}
              placeholder="Description"
              aria-label={`${def.name} entry ${i + 1} description`}
              onChange={(e) => edit(i, { text: e.currentTarget.value })}
              onBlur={() => commit(draft)}
            />
            <span className="row">
              <button type="button" disabled={disabled || i === 0} aria-label="Move up" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" disabled={disabled || i === draft.length - 1} aria-label="Move down" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-label="Remove entry"
                onClick={() => {
                  const next = draft.filter((_, k) => k !== i);
                  setDraft(next);
                  void commit(next);
                }}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" disabled={disabled} onClick={() => setDraft([...draft, { title: "", text: "" }])}>
        Add entry
      </button>
      <ErrorLine message={error} />
    </>
  );
}

function LinkEditor({ def, value, campaignId, itemId, disabled, onChange }: Kind<"link">) {
  const ids = value as string[];
  const [items, setItems] = useState<Map<string, Item>>(new Map());
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef("");

  useEffect(() => {
    const key = ids.join(",");
    if (key === asked.current || ids.length === 0) return;
    asked.current = key;
    let active = true;
    getItems(ids)
      .then((found) => active && setItems(new Map(found.map((i) => [i.id, i]))))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ids]);

  async function save(next: string[]) {
    setError(await onChange(next));
  }

  const matches = (item: Item) =>
    (def.config.library === null || item.library === def.config.library) &&
    (def.config.itemTypes.length === 0 || def.config.itemTypes.includes(item.itemType));

  return (
    <>
      {ids.length > 0 && (
        <ul className="chips field-links">
          {ids.map((id) => {
            const item = items.get(id);
            return (
              <li key={id} className="chip static">
                {item ? `${itemIcon(item)} ${item.name}${item.deletedAt !== null ? " (in the trash)" : ""}` : "(missing)"}
                <button type="button" disabled={disabled} aria-label={`Remove ${item?.name ?? "link"}`} onClick={() => save(ids.filter((x) => x !== id))}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {picking ? (
        <LinkPicker
          campaignId={campaignId}
          excludeIds={new Set([itemId, ...ids])}
          onPick={(item) => {
            setPicking(false);
            if (!matches(item)) return setError("This field only links to a different kind of item.");
            void save(def.config.many ? [...ids, item.id] : [item.id]);
          }}
          onClose={() => setPicking(false)}
        />
      ) : (
        <button type="button" disabled={disabled || (!def.config.many && ids.length > 0)} onClick={() => setPicking(true)}>
          {def.config.many ? "Add link" : ids.length > 0 ? "Remove it to choose another" : "Choose item"}
        </button>
      )}
      <ErrorLine message={error} />
    </>
  );
}
