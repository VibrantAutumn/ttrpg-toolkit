import { useState } from "react";
import { registry } from "../../registry";
import { addNode, canAdd, defaultRule, defaultTest, isSimple, moveNode, newGroup, removeNode, replaceNode, updateGroup, updateRule, type Path } from "../../lib/queries/build";
import { describeQuery } from "../../lib/queries/describe";
import {
  COMPARISONS,
  QUERY_LIMITS,
  RULE_KINDS,
  isGroup,
  isRuleComplete,
  testsForKind,
  type Comparison,
  type FieldCheck,
  type FieldTest,
  type Group,
  type Query,
  type Rule,
  type RuleKind,
  type SortKey,
} from "../../lib/queries/query";
import { ItemPick } from "./ItemPick";
import { pathLabel } from "../../lib/queries/catalog";
import type { QueryCatalog } from "./useQueryCatalog";

const RULE_LABELS: Record<RuleKind, string> = {
  itemType: "Kind of item",
  library: "Tool",
  folder: "Folder",
  tag: "Tag",
  name: "Name contains",
  text: "Mentions the text",
  field: "A property",
  linksTo: "Links to",
  linkedFrom: "Is linked from",
  changed: "Changed recently",
};

const CHECK_LABELS: Record<FieldCheck, string> = {
  contains: "contains",
  equals: "is exactly",
  number: "is",
  between: "is between",
  choice: "is one of",
  links: "links to",
  empty: "is empty",
};

const SORT_LABELS = { name: "Name", created: "When made", updated: "When changed", type: "Kind of item" } as const;

type Change = (next: Query) => void;

/**
 * Builds a query out of rules. The simple view is one list ("match all / any of these rules");
 * Advanced allows groups inside groups and sorting by several things.
 */
export function QueryBuilder({ projectId, query, catalog, onChange }: { projectId: string; query: Query; catalog: QueryCatalog; onChange: Change }) {
  const simple = isSimple(query);
  const [advancedOn, setAdvancedOn] = useState(!simple);
  const advanced = advancedOn || !simple;
  return (
    <div className="query-builder">
      <p className="query-summary">{describeQuery(query, catalog.names)}</p>
      <GroupView projectId={projectId} query={query} catalog={catalog} onChange={onChange} path={[]} group={query.where} advanced={advanced} />
      <SortEditor query={query} catalog={catalog} onChange={onChange} advanced={advanced} />
      <label className="row">
        <input type="checkbox" checked={advanced} disabled={!simple} onChange={(e) => setAdvancedOn(e.currentTarget.checked)} />
        <span>
          Advanced (groups inside groups, several sorts)
          {!simple && <small className="meta"> — this query uses them, so they stay on</small>}
        </span>
      </label>
    </div>
  );
}

function GroupView({
  projectId,
  query,
  catalog,
  onChange,
  path,
  group,
  advanced,
}: {
  projectId: string;
  query: Query;
  catalog: QueryCatalog;
  onChange: Change;
  path: Path;
  group: Group;
  advanced: boolean;
}) {
  const root = path.length === 0;
  const [kind, setKind] = useState<RuleKind>("tag");
  return (
    <div className={root ? "query-group root" : "query-group"}>
      <div className="row wrap">
        <span>{group.not ? "Leave out items that match" : "Find items that match"}</span>
        <select
          value={group.op}
          aria-label="All or any of the rules"
          onChange={(e) => onChange(updateGroup(query, path, { op: e.currentTarget.value === "any" ? "any" : "all" }))}
        >
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
        <span>of these rules</span>
        {advanced && (
          <label className="row">
            <input type="checkbox" checked={group.not} onChange={(e) => onChange(updateGroup(query, path, { not: e.currentTarget.checked }))} />
            <span>turn this group around</span>
          </label>
        )}
        {!root && (
          <button type="button" onClick={() => onChange(removeNode(query, path))}>
            Remove group
          </button>
        )}
      </div>

      {group.rules.length === 0 && <p className="empty">No rules yet{root ? ": this finds everything" : ""}.</p>}
      <ul className="query-rules">
        {group.rules.map((node, index) => {
          const childPath = [...path, index];
          return (
            <li key={index}>
              {isGroup(node) ? (
                <GroupView projectId={projectId} query={query} catalog={catalog} onChange={onChange} path={childPath} group={node} advanced={advanced} />
              ) : (
                <RuleView projectId={projectId} query={query} catalog={catalog} onChange={onChange} path={childPath} rule={node} />
              )}
              <div className="row query-rule-tools">
                <button type="button" disabled={index === 0} aria-label="Move up" onClick={() => onChange(moveNode(query, childPath, -1))}>
                  ↑
                </button>
                <button type="button" disabled={index === group.rules.length - 1} aria-label="Move down" onClick={() => onChange(moveNode(query, childPath, 1))}>
                  ↓
                </button>
                {!isGroup(node) && (
                  <button type="button" onClick={() => onChange(removeNode(query, childPath))}>
                    Remove rule
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="row wrap">
        <select value={kind} aria-label="What kind of rule to add" onChange={(e) => setKind(e.currentTarget.value as RuleKind)}>
          {RULE_KINDS.map((k) => (
            <option key={k} value={k}>
              {RULE_LABELS[k]}
            </option>
          ))}
        </select>
        <button type="button" disabled={!canAdd(query, path, defaultRule(kind))} onClick={() => onChange(addNode(query, path, defaultRule(kind)))}>
          Add rule
        </button>
        {advanced && (
          <button type="button" disabled={!canAdd(query, path, newGroup())} onClick={() => onChange(addNode(query, path, newGroup()))}>
            Add group
          </button>
        )}
      </div>
    </div>
  );
}

function RuleView({ projectId, query, catalog, onChange, path, rule }: { projectId: string; query: Query; catalog: QueryCatalog; onChange: Change; path: Path; rule: Rule }) {
  const set = (change: (r: Rule) => Rule) => onChange(updateRule(query, path, change));
  const complete = isRuleComplete(rule);
  return (
    <div className={complete ? "query-rule" : "query-rule incomplete"}>
      <div className="row wrap">
        <select value={rule.not ? "out" : "in"} aria-label="Include or leave out" onChange={(e) => set((r) => ({ ...r, not: e.currentTarget.value === "out" }) as Rule)}>
          <option value="in">Include if</option>
          <option value="out">Leave out if</option>
        </select>
        <select
          value={rule.kind}
          aria-label="Kind of rule"
          onChange={(e) => onChange(replaceNode(query, path, { ...defaultRule(e.currentTarget.value as RuleKind), not: rule.not }))}
        >
          {RULE_KINDS.map((k) => (
            <option key={k} value={k}>
              {RULE_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <RuleBody projectId={projectId} catalog={catalog} rule={rule} set={set} />
      {!complete && <p className="meta">Not finished: this rule is ignored until it is.</p>}
    </div>
  );
}

function toggled(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Chips({ options, chosen, onToggle }: { options: { id: string; label: string }[]; chosen: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o.id} type="button" className={chosen.includes(o.id) ? "chip on" : "chip"} aria-pressed={chosen.includes(o.id)} onClick={() => onToggle(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NumberBox({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      aria-label={label}
      onChange={(e) => {
        const n = e.currentTarget.valueAsNumber;
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

function RuleBody({ projectId, catalog, rule, set }: { projectId: string; catalog: QueryCatalog; rule: Rule; set: (change: (r: Rule) => Rule) => void }) {
  switch (rule.kind) {
    case "itemType": {
      const types = registry.getItemTypes().map((t) => ({ id: t.id, label: `${t.icon} ${t.label}` }));
      return <Chips options={types} chosen={rule.types} onToggle={(id) => set((r) => ({ ...r, types: toggled((r as typeof rule).types, id) }) as Rule)} />;
    }
    case "library": {
      const tools = registry.getTools().map((t) => ({ id: t.id, label: `${t.icon} ${t.label}` }));
      return <Chips options={tools} chosen={rule.libraries} onToggle={(id) => set((r) => ({ ...r, libraries: toggled((r as typeof rule).libraries, id) }) as Rule)} />;
    }
    case "folder":
      return (
        <div className="row wrap">
          <select value={rule.folderId} aria-label="Folder" onChange={(e) => set((r) => ({ ...r, folderId: e.currentTarget.value }) as Rule)}>
            <option value="">Choose a folder...</option>
            {catalog.folders.map((f) => (
              <option key={f.id} value={f.id}>
                {registry.getTool(f.library)?.label ?? f.library}: {pathLabel(catalog.folders, f.id)}
              </option>
            ))}
            {rule.folderId !== "" && !catalog.folders.some((f) => f.id === rule.folderId) && <option value={rule.folderId}>(missing folder)</option>}
          </select>
          <label className="row">
            <input type="checkbox" checked={rule.subfolders} onChange={(e) => set((r) => ({ ...r, subfolders: e.currentTarget.checked }) as Rule)} />
            <span>include the folders inside it</span>
          </label>
        </div>
      );
    case "tag":
      return (
        <div className="row wrap">
          <select value={rule.tagId} aria-label="Tag" onChange={(e) => set((r) => ({ ...r, tagId: e.currentTarget.value }) as Rule)}>
            <option value="">Choose a tag...</option>
            {catalog.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {pathLabel(catalog.tags, t.id)}
              </option>
            ))}
            {rule.tagId !== "" && !catalog.tags.some((t) => t.id === rule.tagId) && <option value={rule.tagId}>(missing tag)</option>}
          </select>
          <label className="row">
            <input type="checkbox" checked={rule.subtags} onChange={(e) => set((r) => ({ ...r, subtags: e.currentTarget.checked }) as Rule)} />
            <span>include its sub-tags</span>
          </label>
        </div>
      );
    case "name":
    case "text":
      return (
        <input
          value={rule.text}
          maxLength={QUERY_LIMITS.text}
          placeholder={rule.kind === "name" ? "Part of the name" : "A word or phrase (in the name, text or properties)"}
          aria-label="Text to look for"
          onChange={(e) => set((r) => ({ ...r, text: e.currentTarget.value }) as Rule)}
        />
      );
    case "linksTo":
    case "linkedFrom":
      return (
        <ItemPick
          projectId={projectId}
          itemId={rule.itemId}
          name={catalog.itemNames.get(rule.itemId)}
          onPick={(item) => set((r) => ({ ...r, itemId: item.id }) as Rule)}
        />
      );
    case "changed":
      return (
        <div className="row wrap">
          <span>in the last</span>
          <NumberBox value={rule.days} label="Number of days" onChange={(n) => set((r) => ({ ...r, days: Math.min(QUERY_LIMITS.days, Math.max(0, Math.round(n))) }) as Rule)} />
          <span>days</span>
        </div>
      );
    case "field":
      return <FieldRule projectId={projectId} catalog={catalog} rule={rule} set={set} />;
  }
}

function FieldRule({ projectId, catalog, rule, set }: { projectId: string; catalog: QueryCatalog; rule: Extract<Rule, { kind: "field" }>; set: (change: (r: Rule) => Rule) => void }) {
  const def = catalog.fields.find((d) => d.id === rule.fieldId);
  const checks = def ? testsForKind(def.kind) : [];
  const setTest = (test: FieldTest) => set((r) => ({ ...r, test }) as Rule);
  return (
    <div className="stack">
      <div className="row wrap">
        <select
          value={rule.fieldId}
          aria-label="Property"
          onChange={(e) => {
            const next = catalog.fields.find((d) => d.id === e.currentTarget.value);
            const first = next ? testsForKind(next.kind)[0] : "empty";
            set((r) => ({ ...r, fieldId: e.currentTarget.value, test: defaultTest(first) }) as Rule);
          }}
        >
          <option value="">Choose a property...</option>
          {catalog.fields.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          {rule.fieldId !== "" && !def && <option value={rule.fieldId}>(missing property)</option>}
        </select>
        {def && (
          <select value={rule.test.check} aria-label="Test" onChange={(e) => setTest(defaultTest(e.currentTarget.value as FieldCheck))}>
            {checks.map((c) => (
              <option key={c} value={c}>
                {CHECK_LABELS[c]}
              </option>
            ))}
            {!checks.includes(rule.test.check) && <option value={rule.test.check}>{CHECK_LABELS[rule.test.check]} (doesn't suit this property)</option>}
          </select>
        )}
      </div>
      {def && <TestEditor projectId={projectId} catalog={catalog} def={def} test={rule.test} onChange={setTest} />}
    </div>
  );
}

function TestEditor({ projectId, catalog, def, test, onChange }: { projectId: string; catalog: QueryCatalog; def: QueryCatalog["fields"][number]; test: FieldTest; onChange: (t: FieldTest) => void }) {
  switch (test.check) {
    case "contains":
    case "equals":
      return <input value={test.text} maxLength={QUERY_LIMITS.text} aria-label="Text" placeholder="Text" onChange={(e) => onChange({ ...test, text: e.currentTarget.value })} />;
    case "number":
      return (
        <div className="row wrap">
          <select value={test.cmp} aria-label="Comparison" onChange={(e) => onChange({ ...test, cmp: e.currentTarget.value as Comparison })}>
            {COMPARISONS.map((c) => (
              <option key={c} value={c}>
                {{ "=": "equal to", "<": "less than", "<=": "at most", ">": "more than", ">=": "at least" }[c]}
              </option>
            ))}
          </select>
          <NumberBox value={test.value} label="Value" onChange={(n) => onChange({ ...test, value: n })} />
          {def.kind === "bar" && <small className="meta">(the bar's current value)</small>}
        </div>
      );
    case "between":
      return (
        <div className="row wrap">
          <NumberBox value={test.min} label="Lowest value" onChange={(n) => onChange({ ...test, min: n })} />
          <span>and</span>
          <NumberBox value={test.max} label="Highest value" onChange={(n) => onChange({ ...test, max: n })} />
        </div>
      );
    case "choice": {
      const options = def.kind === "dropdown" ? def.config.options.map((o) => ({ id: o.id, label: o.label })) : [];
      return <Chips options={options} chosen={test.optionIds} onToggle={(id) => onChange({ ...test, optionIds: toggled(test.optionIds, id) })} />;
    }
    case "links":
      return <ItemPick projectId={projectId} itemId={test.itemId} name={catalog.itemNames.get(test.itemId)} onPick={(item) => onChange({ ...test, itemId: item.id })} />;
    case "empty":
      return null;
  }
}

function SortEditor({ query, catalog, onChange, advanced }: { query: Query; catalog: QueryCatalog; onChange: Change; advanced: boolean }) {
  const keys = advanced ? query.sort : query.sort.slice(0, 1);
  const setKeys = (sort: SortKey[]) => onChange({ ...query, sort });
  const valueOf = (k: SortKey) => (k.by === "field" ? `field:${k.fieldId}` : k.by);
  const change = (index: number, value: string, dir: "asc" | "desc") => {
    const key: SortKey = value.startsWith("field:") ? { by: "field", fieldId: value.slice(6), dir } : { by: value as keyof typeof SORT_LABELS, dir };
    setKeys(query.sort.map((k, i) => (i === index ? key : k)));
  };
  return (
    <div className="query-sort">
      {keys.map((k, index) => (
        <div key={index} className="row wrap">
          <span>{index === 0 ? "Sort by" : "then by"}</span>
          <select value={valueOf(k)} aria-label="Sort by" onChange={(e) => change(index, e.currentTarget.value, k.dir)}>
            {(Object.keys(SORT_LABELS) as (keyof typeof SORT_LABELS)[]).map((by) => (
              <option key={by} value={by}>
                {SORT_LABELS[by]}
              </option>
            ))}
            {catalog.fields.map((d) => (
              <option key={d.id} value={`field:${d.id}`}>
                Property: {d.name}
              </option>
            ))}
            {k.by === "field" && !catalog.fields.some((d) => d.id === k.fieldId) && <option value={valueOf(k)}>(missing property)</option>}
          </select>
          <select value={k.dir} aria-label="Direction" onChange={(e) => change(index, valueOf(k), e.currentTarget.value === "desc" ? "desc" : "asc")}>
            <option value="asc">A to Z / low to high / oldest first</option>
            <option value="desc">Z to A / high to low / newest first</option>
          </select>
          {advanced && query.sort.length > 1 && (
            <button type="button" onClick={() => setKeys(query.sort.filter((_, i) => i !== index))}>
              Remove
            </button>
          )}
        </div>
      ))}
      {advanced && query.sort.length < QUERY_LIMITS.sortKeys && (
        <button
          type="button"
          onClick={() => {
            const used = new Set(query.sort.map(valueOf));
            const next = (Object.keys(SORT_LABELS) as (keyof typeof SORT_LABELS)[]).find((by) => !used.has(by)) ?? "created";
            setKeys([...query.sort, { by: next, dir: "asc" }]);
          }}
        >
          Add another sort
        </button>
      )}
    </div>
  );
}
