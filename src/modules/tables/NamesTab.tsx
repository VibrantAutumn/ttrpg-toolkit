import { useEffect, useMemo, useState } from "react";
import { listTags, type Tag } from "../../api/library";
import { listTables, type TableSummary } from "../../api/tables";
import { LogEntryView } from "../../components/results/LogEntryView";
import { RollLogList } from "../../components/results/RollLogList";
import { partsOf } from "../../lib/tables/nameGen";
import type { Capitalisation, NameMode, PartKey, Separator } from "../../lib/tables/nameGen";
import { loadLastSetup, saveLastSetup, SOURCE_LABELS, type NameSetup, type TagMatch } from "../../lib/tables/nameSetup";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { useDataVersion } from "../../state/dataVersion";
import { generateNameFromSetup } from "../../state/nameActions";
import { useRollLog } from "../../state/rollLog";

const MODE_LABELS: Record<NameMode, string> = {
  full: "One part (a whole name)",
  two: "Two parts",
  three: "Three parts",
};

const SEPARATOR_LABELS: Record<Separator, string> = {
  none: "Nothing (Aelwen)",
  space: "A space (Anna Marie)",
  hyphen: "A hyphen (Anna-Marie)",
  apostrophe: "An apostrophe (Kel'drin)",
};

const CAPITALISATION_LABELS: Record<Capitalisation, string> = {
  asTyped: "As typed in the tables",
  firstLetter: "First letter of the name",
  everyPart: "First letter of every part",
};

/** Works whether or not the browser lets us use its storage (a private window may not). */
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The name generator: choose how many parts a name has, the table each part comes
 * from, which tags entries must carry, and how the parts are joined, then
 * Generate. Everything can be changed between names, and the last setup is
 * remembered on this device.
 */
export function NamesTab() {
  const { campaign } = useCurrentCampaign();
  const dataVersion = useDataVersion();
  const log = useRollLog();
  const campaignId = campaign?.id ?? null;

  const [setup, setSetup] = useState<NameSetup>(() => loadLastSetup(storage()));
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setTables([]);
      setTags([]);
      return;
    }
    let active = true;
    Promise.all([listTables(campaignId), listTags(campaignId)])
      .then(([t, g]) => {
        if (!active) return;
        setTables(t);
        setTags(g);
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  const latest = useMemo(() => log.find((e) => e.kind === "name"), [log]);

  function change(patch: Partial<NameSetup>) {
    const next = { ...setup, ...patch };
    setSetup(next);
    saveLastSetup(storage(), next);
  }

  async function generate() {
    if (!campaignId) return;
    const outcome = await generateNameFromSetup(campaignId, setup);
    setError(outcome.ok ? null : outcome.message);
  }

  if (!campaignId) return <p className="empty">Choose a campaign to generate names.</p>;

  const keys = partsOf(setup.mode);
  const joins: [string, "join1" | "join2"][] =
    setup.mode === "two"
      ? [["Between the two parts", "join1"]]
      : setup.mode === "three"
        ? [
            ["Between the first and middle parts", "join1"],
            ["Between the middle and last parts", "join2"],
          ]
        : [];
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name;
  const toggleTag = (id: string) =>
    change({ tagIds: setup.tagIds.includes(id) ? setup.tagIds.filter((t) => t !== id) : [...setup.tagIds, id] });

  return (
    <div className="names-tab">
      <h2>Make a name</h2>
      <p className="meta">
        Each part of a name comes from a table you choose. Pick the tables, say how to join them, and generate.
      </p>

      <label className="field">
        <span>A name has</span>
        <select value={setup.mode} onChange={(e) => change({ mode: e.currentTarget.value as NameMode })}>
          {(Object.keys(MODE_LABELS) as NameMode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      {keys.map((key: PartKey) => {
        const chosen = setup.sources[key] ?? "";
        const exists = tables.some((t) => t.itemId === chosen);
        return (
          <label className="field" key={key}>
            <span>{capitalise(SOURCE_LABELS[key])} comes from</span>
            <select
              value={exists ? chosen : ""}
              onChange={(e) => change({ sources: { ...setup.sources, [key]: e.currentTarget.value } })}
            >
              <option value="">{chosen && !exists ? "That table is gone: choose another..." : "Choose a table..."}</option>
              {tables.map((t) => (
                <option key={t.itemId} value={t.itemId}>
                  {t.name} ({t.entries})
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {tables.length === 0 && <p className="empty">No tables yet. Make some in the Library tab, with entries to draw from.</p>}

      <details open={setup.tagIds.length > 0}>
        <summary>Only use entries tagged… {setup.tagIds.length > 0 && `(${setup.tagIds.length})`}</summary>
        <p className="meta">
          Tags are put on entries in a table's page (under each entry, “Tags”). Leave all off to use every entry.
        </p>
        {tags.length === 0 && setup.tagIds.length === 0 && <p className="empty">No tags yet.</p>}
        <div className="chips">
          {tags.map((t) => {
            const on = setup.tagIds.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={on ? "chip on" : "chip"}
                aria-pressed={on}
                style={t.color ? { borderColor: t.color } : undefined}
                onClick={() => toggleTag(t.id)}
              >
                {t.name}
              </button>
            );
          })}
          {setup.tagIds
            .filter((id) => tagName(id) === undefined)
            .map((id) => (
              <button key={id} type="button" className="chip on" aria-pressed onClick={() => toggleTag(id)}>
                (deleted tag) ×
              </button>
            ))}
        </div>
        {setup.tagIds.length > 1 && (
          <label className="field">
            <span>An entry needs</span>
            <select value={setup.tagMatch} onChange={(e) => change({ tagMatch: e.currentTarget.value as TagMatch })}>
              <option value="all">All of these tags</option>
              <option value="any">Any one of these tags</option>
            </select>
          </label>
        )}
      </details>

      <details>
        <summary>How the parts are joined</summary>
        {joins.map(([label, key]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <select value={setup[key]} onChange={(e) => change({ [key]: e.currentTarget.value as Separator })}>
              {(Object.keys(SEPARATOR_LABELS) as Separator[]).map((s) => (
                <option key={s} value={s}>
                  {SEPARATOR_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="field">
          <span>Capital letters</span>
          <select
            value={setup.capitalisation}
            onChange={(e) => change({ capitalisation: e.currentTarget.value as Capitalisation })}
          >
            {(Object.keys(CAPITALISATION_LABELS) as Capitalisation[]).map((c) => (
              <option key={c} value={c}>
                {CAPITALISATION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        {setup.mode !== "full" && (
          <label>
            <input
              type="checkbox"
              checked={setup.mergeDoubles}
              onChange={(e) => change({ mergeDoubles: e.currentTarget.checked })}
            />{" "}
            Merge a letter doubled where two parts meet (Dar + rin = Darin)
          </label>
        )}
      </details>

      <div className="row wrap">
        <button onClick={() => void generate()}>Generate a name</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {latest && (
        <ul className="list">
          <LogEntryView key={latest.id} entry={latest} />
        </ul>
      )}

      <h2>Names made</h2>
      <RollLogList kind="name" showClear emptyText="No names yet. The log is cleared when the app restarts." />
    </div>
  );
}
