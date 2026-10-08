import { useEffect, useState } from "react";
import { getItem, listTags, type Tag } from "../../api/library";
import { getNamePreset } from "../../api/namePresets";
import { listTables, type TableSummary } from "../../api/tables";
import { partsOf } from "../../lib/tables/nameGen";
import { parseSetup, SOURCE_LABELS, type NameSetup } from "../../lib/tables/nameSetup";
import { CAPITALISATION_LABELS, MODE_LABELS, SEPARATOR_LABELS } from "./nameLabels";

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A saved name setup's page: what it does, in words. It is chosen and changed in the Names tab. */
export function NamePresetView({ itemId }: { itemId: string }) {
  const [state, setState] = useState<{ setup: NameSetup | null; tables: TableSummary[]; tags: Tag[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getNamePreset(itemId), getItem(itemId)])
      .then(async ([preset, item]) => {
        const [tables, tags] = await Promise.all([listTables(item.campaignId), listTags(item.campaignId)]);
        if (active) setState({ setup: parseSetup(preset.setupJson), tables, tags });
      })
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [itemId]);

  if (!state) return error ? <p className="error">{error}</p> : <p className="empty">Loading...</p>;
  const { setup, tables, tags } = state;
  if (!setup) {
    return <p className="error">This setup can't be read by this version of the app (it may come from a newer one).</p>;
  }

  const joiner = setup.tagMatch === "all" ? " and " : " or ";
  const tagNames = setup.tagIds.map((id) => tags.find((t) => t.id === id)?.name ?? "(deleted tag)");
  return (
    <div className="name-preset-view">
      <p>
        A saved setup for the name generator: {MODE_LABELS[setup.mode].toLowerCase()}. Choose it in the Tables tool's
        Names tab.
      </p>
      <ul>
        {partsOf(setup.mode).map((key) => {
          const id = setup.sources[key];
          const table = tables.find((t) => t.itemId === id);
          return (
            <li key={key}>
              {capitalise(SOURCE_LABELS[key])}: {table ? table.name : id ? "a table that is gone" : "no table chosen"}
            </li>
          );
        })}
        <li>{tagNames.length > 0 ? `Only entries tagged ${tagNames.join(joiner)}` : "Every entry (no tag filter)"}</li>
        {setup.mode !== "full" && <li>Joined with: {SEPARATOR_LABELS[setup.join1].toLowerCase()}</li>}
        {setup.mode === "three" && <li>Then: {SEPARATOR_LABELS[setup.join2].toLowerCase()}</li>}
        <li>Capital letters: {CAPITALISATION_LABELS[setup.capitalisation].toLowerCase()}</li>
        {setup.mode !== "full" && setup.mergeDoubles && <li>Merges a letter doubled where parts meet</li>}
      </ul>
    </div>
  );
}
