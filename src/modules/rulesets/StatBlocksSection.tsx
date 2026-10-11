import { useState } from "react";
import { ConfirmButton } from "../../components/ConfirmButton";
import { KIND_LABELS } from "../../lib/fields/definition";
import { uniqueKey, type StatBlock } from "../../lib/rulesets/ruleset";
import type { SectionProps } from "./sectionTypes";

/**
 * Stat blocks: each is a named group of the ruleset's properties (Character, Monster, Vehicle...).
 * In a project each one becomes a property set a page can have.
 */
export function StatBlocksSection({ ruleset, edit, goToProperties }: SectionProps & { goToProperties: () => void }) {
  const [name, setName] = useState("");

  const change = (key: string, update: (b: StatBlock) => StatBlock) =>
    edit((r) => ({ ...r, statBlocks: r.statBlocks.map((b) => (b.key === key ? update(b) : b)) }));

  const swap = (key: string, i: number, j: number) =>
    change(key, (x) => {
      const list = [...x.fields];
      [list[i], list[j]] = [list[j], list[i]];
      return { ...x, fields: list };
    });

  const add = () => {
    const title = name.trim();
    if (title === "") return;
    edit((r) => ({ ...r, statBlocks: [...r.statBlocks, { key: uniqueKey(title, r.statBlocks.map((b) => b.key)), name: title, description: "", fields: [] }] }));
    setName("");
  };

  return (
    <div>
      <p className="meta">A stat block is the group of properties a character or monster page carries. Pages pick one when you add a stat block to them.</p>
      {ruleset.fields.length === 0 && (
        <p className="meta">
          This ruleset has no properties yet. <button onClick={goToProperties}>Make some first</button>
        </p>
      )}
      {ruleset.statBlocks.map((b) => {
        const unused = ruleset.fields.filter((f) => !b.fields.includes(f.key));
        return (
          <fieldset key={b.key} className="stat-block">
            <legend>{b.name || "Stat block"}</legend>
            <label>
              Name
              <input type="text" value={b.name} onChange={(e) => change(b.key, (x) => ({ ...x, name: e.currentTarget.value }))} />
            </label>
            <label>
              What it is for (optional)
              <input type="text" value={b.description} onChange={(e) => change(b.key, (x) => ({ ...x, description: e.currentTarget.value }))} />
            </label>
            <ul className="list">
              {b.fields.map((k, i) => {
                const f = ruleset.fields.find((x) => x.key === k);
                return (
                  <li key={k} className="row">
                    <span className="name">
                      {f?.name ?? k} <span className="meta">{f ? KIND_LABELS[f.kind] : ""}</span>
                    </span>
                    <button aria-label={`Move ${f?.name ?? k} up`} disabled={i === 0} onClick={() => swap(b.key, i, i - 1)}>
                      ↑
                    </button>
                    <button aria-label={`Move ${f?.name ?? k} down`} disabled={i === b.fields.length - 1} onClick={() => swap(b.key, i, i + 1)}>
                      ↓
                    </button>
                    <button aria-label={`Remove ${f?.name ?? k}`} onClick={() => change(b.key, (x) => ({ ...x, fields: x.fields.filter((y) => y !== k) }))}>
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
            {b.fields.length === 0 && <p className="meta">No properties in this stat block yet.</p>}
            {unused.length > 0 && (
              <select
                aria-label={`Add a property to ${b.name}`}
                value=""
                onChange={(e) => {
                  const k = e.currentTarget.value;
                  if (k) change(b.key, (x) => ({ ...x, fields: [...x.fields, k] }));
                }}
              >
                <option value="">Add a property…</option>
                {unused.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
            <ConfirmButton label="Delete stat block" onConfirm={() => edit((r) => ({ ...r, statBlocks: r.statBlocks.filter((x) => x.key !== b.key) }))} />
          </fieldset>
        );
      })}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input type="text" placeholder="New stat block (Character, Monster...)" aria-label="Name of a new stat block" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <button type="submit" disabled={name.trim() === ""}>
          Add stat block
        </button>
      </form>
    </div>
  );
}
