import { useState } from "react";
import { deleteItem } from "../../api/library";
import { createNamePreset, setNamePresetSetup, type PresetEntry } from "../../api/namePresets";
import { ConfirmButton } from "../../components/ConfirmButton";
import { parseSetup, serializeSetup, setupsEqual, type NameSetup } from "../../lib/tables/nameSetup";
import { bumpDataVersion } from "../../state/dataVersion";

/**
 * Saved name setups: choose one to load it, save the current setup under a name,
 * update the loaded preset with changes, or delete it. A loaded preset says when
 * the setup no longer matches it, so you can see what Update would overwrite.
 */
export function PresetBar({
  campaignId,
  setup,
  presets,
  loadedId,
  onLoad,
  onForget,
}: {
  campaignId: string;
  setup: NameSetup;
  presets: PresetEntry[];
  /** The preset the setup was loaded from or saved as, if any. */
  loadedId: string | null;
  /** A preset was chosen (or just saved): use its setup. */
  onLoad: (presetId: string, setup: NameSetup) => void;
  /** The loaded preset is gone: stop tracking it. */
  onForget: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loaded = presets.find((p) => p.itemId === loadedId) ?? null;
  const saved = loaded ? parseSetup(loaded.setupJson) : null;
  const changed = loaded !== null && (saved === null || !setupsEqual(setup, saved));

  async function run(action: () => Promise<void>) {
    setNote(null);
    try {
      await action();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  function choose(id: string) {
    setNote(null);
    if (id === "") {
      onForget();
      return;
    }
    const preset = presets.find((p) => p.itemId === id);
    const parsed = preset ? parseSetup(preset.setupJson) : null;
    if (!preset || !parsed) {
      setError(`“${preset?.name ?? "That preset"}” can't be read by this version of the app, so it was not loaded.`);
      return;
    }
    setError(null);
    onLoad(preset.itemId, parsed);
  }

  async function saveAs() {
    if (name.trim() === "") return;
    await run(async () => {
      const item = await createNamePreset(campaignId, name, null, serializeSetup(setup));
      setSaving(false);
      setName("");
      bumpDataVersion();
      onLoad(item.id, setup);
      setNote(`Saved as “${item.name}”.`);
    });
  }

  async function update() {
    if (!loaded) return;
    await run(async () => {
      await setNamePresetSetup(loaded.itemId, serializeSetup(setup));
      bumpDataVersion();
      setNote(`Updated “${loaded.name}”.`);
    });
  }

  async function remove() {
    if (!loaded) return;
    await run(async () => {
      await deleteItem(loaded.itemId);
      bumpDataVersion();
      onForget();
      setNote(`“${loaded.name}” is in the trash (restore it from the Library tab's trash).`);
    });
  }

  return (
    <div className="preset-bar">
      <div className="row wrap">
        <label>
          Preset{" "}
          <select value={loaded?.itemId ?? ""} onChange={(e) => choose(e.currentTarget.value)} aria-label="Saved name setup">
            <option value="">{presets.length === 0 ? "None saved yet" : "(none chosen)"}</option>
            {presets.map((p) => (
              <option key={p.itemId} value={p.itemId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {loaded && (
          <small className="meta" role="status">
            {saved === null ? "can't be read here" : changed ? "changed since saved" : "matches the saved preset"}
          </small>
        )}
      </div>
      <div className="row wrap">
        <button onClick={() => setSaving((v) => !v)} aria-expanded={saving}>
          Save as…
        </button>
        {loaded && (
          <>
            <button onClick={() => void update()} disabled={!changed}>
              Update “{loaded.name}”
            </button>
            <ConfirmButton label="Delete preset" confirmLabel="Tap again to delete" onConfirm={() => void remove()} />
          </>
        )}
      </div>
      {saving && (
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAs();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Name for this setup, like Elven name"
            aria-label="Name for the preset"
            autoFocus
          />
          <button type="submit" disabled={name.trim() === ""}>
            Save
          </button>
        </form>
      )}
      {note && <p className="meta" role="status">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
