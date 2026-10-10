import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listFieldDefinitions } from "../../api/fields";
import { getGenerator, setGeneratorDefinition } from "../../api/generators";
import { getItem, listItemsOfType, type Item } from "../../api/library";
import { listTables, type TableSummary } from "../../api/tables";
import { createAutosaver, type SaveStatus } from "../../lib/autosave";
import type { FieldDefinition } from "../../lib/fields/definition";
import type { GeneratedDocument } from "../../lib/generators/document";
import { GENERATOR_LIMITS, checkRow, emptyGenerator, newRow, parseGenerator, type GeneratorDef, type GeneratorRow, type RowTarget } from "../../lib/generators/generator";
import { rowValue, setOverride, type GeneratorRun } from "../../lib/generators/run";
import { bumpDataVersion, useDataVersion } from "../../state/dataVersion";
import { useNavigation } from "../../state/Navigation";
import { createFromRun, previewDocument, rerollGenerator, runGenerator } from "../../state/generatorActions";

/** The page of a generator: its rows, and a preview to try it, lock and reroll rows, and create the document. */
export function GeneratorView({ itemId }: { itemId: string }) {
  const dataVersion = useDataVersion();
  const [item, setItem] = useState<Item | null>(null);
  const [def, setDef] = useState<GeneratorDef | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Item[]>([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [tables, setTables] = useState<TableSummary[]>([]);

  const saver = useMemo(
    () =>
      createAutosaver({
        save: async (json) => {
          await setGeneratorDefinition(itemId, json);
          bumpDataVersion();
        },
        delayMs: 600,
        onStatus: setStatus,
      }),
    [itemId],
  );
  const saverRef = useRef(saver);
  saverRef.current = saver;

  useEffect(() => {
    let active = true;
    Promise.all([getItem(itemId), getGenerator(itemId)])
      .then(([it, saved]) => {
        if (!active) return;
        setItem(it);
        const read = parseGenerator(saved.definitionJson);
        setDef(read.ok ? read.def : emptyGenerator());
        setProblem(read.ok ? null : read.error);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
      void saverRef.current.flush();
    };
  }, [itemId]);

  const campaignId = item?.campaignId ?? null;
  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    Promise.all([listItemsOfType(campaignId, "worldbuilding", "template"), listFieldDefinitions(campaignId), listTables(campaignId)])
      .then(([t, f, tb]) => {
        if (!active) return;
        setTemplates(t);
        setFields(f);
        setTables(tb);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void saverRef.current.flush();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const change = useCallback(
    (next: GeneratorDef) => {
      setDef(next);
      setProblem(null);
      saver.change(JSON.stringify(next));
    },
    [saver],
  );

  if (error) return <p className="error">{error}</p>;
  if (!item || !def || !campaignId) return <p className="empty">Loading...</p>;

  const setRow = (index: number, patch: Partial<GeneratorRow>) => change({ ...def, rows: def.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= def.rows.length) return;
    const rows = def.rows.slice();
    [rows[index], rows[to]] = [rows[to], rows[index]];
    change({ ...def, rows });
  };
  const templateMissing = def.templateId !== null && !templates.some((t) => t.id === def.templateId);

  return (
    <div className="generator">
      <p className="meta">
        A generator rolls a set of rows and fills in a new document.{" "}
        {status === "saved" ? "Saved." : status === "error" ? "Couldn't save yet; will try again." : "Saving..."}
      </p>
      {problem && <p className="error">This generator's saved settings can't be read ({problem}), so it is showing an empty one. Changing anything replaces the old settings.</p>}

      <label className="field">
        <span>Make the document from this template</span>
        <select value={def.templateId ?? ""} onChange={(e) => change({ ...def, templateId: e.currentTarget.value || null })}>
          <option value="">No template (a plain document)</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          {templateMissing && <option value={def.templateId ?? ""}>(missing template)</option>}
        </select>
      </label>

      <h2>Rows</h2>
      <p className="meta">
        Each row rolls what you write, like a table entry: <code>[Fantasy first names] [Fantasy last names]</code>, <code>[entity:Faction]</code>, <code>[2d4] goblins</code>.
      </p>
      {def.rows.length === 0 && <p className="empty">No rows yet. Add the first one.</p>}
      <ul className="query-rules">
        {def.rows.map((row, index) => (
          <RowEditor
            key={row.id}
            row={row}
            index={index}
            last={index === def.rows.length - 1}
            fields={fields}
            tables={tables}
            onChange={(patch) => setRow(index, patch)}
            onMove={(delta) => move(index, delta)}
            onRemove={() => change({ ...def, rows: def.rows.filter((_, i) => i !== index) })}
          />
        ))}
      </ul>
      <button type="button" disabled={def.rows.length >= GENERATOR_LIMITS.rows} onClick={() => change({ ...def, rows: [...def.rows, newRow(def)] })}>
        Add a row
      </button>

      <Preview campaignId={campaignId} def={def} name={item.name} />
    </div>
  );
}

function targetValue(t: RowTarget): string {
  return t.kind === "field" ? `field:${t.fieldId}` : t.kind;
}

function RowEditor({
  row,
  index,
  last,
  fields,
  tables,
  onChange,
  onMove,
  onRemove,
}: {
  row: GeneratorRow;
  index: number;
  last: boolean;
  fields: FieldDefinition[];
  tables: TableSummary[];
  onChange: (patch: Partial<GeneratorRow>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const why = checkRow(row);
  const listId = `fallback-${row.id}`;
  const fieldGone = row.target.kind === "field" && !fields.some((f) => f.id === (row.target as { fieldId: string }).fieldId);
  return (
    <li className="query-rule">
      <div className="row wrap">
        <input
          value={row.label}
          maxLength={GENERATOR_LIMITS.label}
          placeholder="Label (Name, Race, Quirk...)"
          aria-label={`Label of row ${index + 1}`}
          onChange={(e) => onChange({ label: e.currentTarget.value })}
        />
        <select
          value={targetValue(row.target)}
          aria-label={`What row ${index + 1} fills`}
          onChange={(e) => {
            const v = e.currentTarget.value;
            onChange({ target: v === "name" ? { kind: "name" } : v === "text" ? { kind: "text" } : { kind: "field", fieldId: v.slice(6) } });
          }}
        >
          <option value="text">Fills: the text</option>
          <option value="name">Fills: the name</option>
          {fields.map((f) => (
            <option key={f.id} value={`field:${f.id}`}>
              Fills field: {f.name}
            </option>
          ))}
          {fieldGone && <option value={targetValue(row.target)}>Fills: (missing field)</option>}
        </select>
      </div>
      <input
        value={row.source}
        maxLength={GENERATOR_LIMITS.source}
        placeholder="What to roll, e.g. [Fantasy first names] [Fantasy last names]"
        aria-label={`What row ${index + 1} rolls`}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => onChange({ source: e.currentTarget.value })}
      />
      {why && <p className="error">{why}</p>}
      <div className="row wrap">
        <input
          value={row.fallback}
          list={listId}
          placeholder="If nothing is found, roll this table (optional)"
          aria-label={`Fallback table of row ${index + 1}`}
          onChange={(e) => onChange({ fallback: e.currentTarget.value })}
        />
        <datalist id={listId}>
          {tables.map((t) => (
            <option key={t.itemId} value={t.name} />
          ))}
        </datalist>
        <button type="button" disabled={index === 0} aria-label="Move up" onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" disabled={last} aria-label="Move down" onClick={() => onMove(1)}>
          ↓
        </button>
        <button type="button" onClick={onRemove}>
          Remove row
        </button>
      </div>
    </li>
  );
}

function Preview({ campaignId, def, name }: { campaignId: string; def: GeneratorDef; name: string }) {
  const { openItem } = useNavigation();
  const [run, setRun] = useState<GeneratorRun | null>(null);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<GeneratedDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const defKey = JSON.stringify(def);
  useEffect(() => {
    if (!run) {
      setPreview(null);
      return;
    }
    let active = true;
    previewDocument(campaignId, def, run, name)
      .then((p) => active && setPreview(p))
      .catch(() => active && setPreview(null));
    return () => {
      active = false;
    };
    // `defKey` stands for the generator's content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, defKey, run, name]);

  async function go(action: () => Promise<GeneratorRun>) {
    setBusy(true);
    try {
      setRun(await action());
      setMessage(null);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!run) return;
    setBusy(true);
    const result = await createFromRun(campaignId, def, run, name);
    setBusy(false);
    if (result.ok) {
      setMessage(null);
      openItem(result.item.id);
    } else {
      setMessage(result.message);
    }
  }

  const rollable = def.rows.some((r) => r.source.trim() !== "");
  const toggle = (id: string) =>
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="generator-preview">
      <h2>Try it</h2>
      <div className="row wrap">
        <button type="button" disabled={busy || !rollable} onClick={() => void go(() => runGenerator(campaignId, def))}>
          {run ? "Start over" : "Generate"}
        </button>
        {run && (
          <button type="button" disabled={busy} onClick={() => void go(() => rerollGenerator(campaignId, def, run, kept))}>
            Reroll the rows that aren't kept
          </button>
        )}
      </div>
      {!rollable && <p className="empty">Write something to roll in at least one row first.</p>}
      {message && <p className="error">{message}</p>}
      {run && (
        <>
          <ul className="query-rules">
            {def.rows.map((row) => {
              const generated = run.rows.find((r) => r.rowId === row.id);
              if (!generated) return null;
              const isKept = kept.has(row.id) || generated.override !== undefined;
              return (
                <li key={row.id} className="query-rule">
                  <div className="row wrap">
                    <strong>{row.label || "Row"}</strong>
                    <label className="row">
                      <input type="checkbox" checked={isKept} disabled={generated.override !== undefined} onChange={() => toggle(row.id)} />
                      <span>keep</span>
                    </label>
                    <button type="button" disabled={busy} onClick={() => void go(() => rerollGenerator(campaignId, def, run, new Set(def.rows.map((r) => r.id).filter((id) => id !== row.id))))}>
                      Reroll this
                    </button>
                  </div>
                  <input
                    value={rowValue(generated)}
                    aria-label={`${row.label || "Row"} value`}
                    onChange={(e) => setRun(setOverride(run, row.id, e.currentTarget.value))}
                  />
                  {generated.override !== undefined && (
                    <button type="button" onClick={() => setRun(setOverride(run, row.id, null))}>
                      Use the rolled value again
                    </button>
                  )}
                  {generated.usedFallback && <p className="meta">Nothing matched, so the fallback table “{row.fallback}” was rolled.</p>}
                  {generated.message && <p className="meta">{generated.message}</p>}
                  {generated.roll && generated.roll.warnings.length > 0 && (
                    <ul className="meta">
                      {generated.roll.warnings.map((w) => (
                        <li key={w}>⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {preview && (
            <div>
              <p>
                Will make <strong>{preview.name}</strong>
                {def.templateId ? " from the template" : " as a plain document"}.
              </p>
              {preview.warnings.length > 0 && (
                <ul className="meta">
                  {preview.warnings.map((w) => (
                    <li key={w}>⚠ {w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button type="button" disabled={busy} onClick={() => void create()}>
            Create the document
          </button>
        </>
      )}
    </div>
  );
}
