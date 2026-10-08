import { useEffect, useState } from "react";
import { listNamePresets, type PresetEntry } from "../../api/namePresets";
import { loadLastSetup, parseSetup } from "../../lib/tables/nameSetup";
import { useCurrentCampaign } from "../../state/CurrentCampaign";
import { useDataVersion } from "../../state/dataVersion";
import { deviceStorage } from "../../state/deviceStorage";
import { generateNameFromSetup } from "../../state/nameActions";

/**
 * The quick tools panel's name generator: make a name from a saved setup, or from
 * whatever setup the Names tab was last left on. (Set the tables and rules up in
 * the Names tab.)
 */
export function QuickNameWidget() {
  const { campaign } = useCurrentCampaign();
  const dataVersion = useDataVersion();
  const campaignId = campaign?.id ?? null;
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setPresets([]);
      return;
    }
    let active = true;
    listNamePresets(campaignId)
      .then((list) => active && setPresets(list))
      .catch((e) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [campaignId, dataVersion]);

  if (!campaignId) return <p className="empty">Choose a campaign to generate names.</p>;

  async function generate() {
    if (!campaignId) return;
    const preset = presets.find((p) => p.itemId === chosen);
    const setup = preset ? parseSetup(preset.setupJson) : loadLastSetup(deviceStorage());
    if (!setup) {
      setError(`“${preset?.name}” can't be read by this version of the app.`);
      return;
    }
    const outcome = await generateNameFromSetup(campaignId, setup, preset?.name ?? null);
    setError(outcome.ok ? null : outcome.message);
  }

  return (
    <div>
      <div className="row wrap">
        <select value={chosen} onChange={(e) => setChosen(e.currentTarget.value)} aria-label="Name setup to use" className="grow">
          <option value="">Current setup from the Names tab</option>
          {presets.map((p) => (
            <option key={p.itemId} value={p.itemId}>
              {p.name}
            </option>
          ))}
        </select>
        <button onClick={() => void generate()}>Generate</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
