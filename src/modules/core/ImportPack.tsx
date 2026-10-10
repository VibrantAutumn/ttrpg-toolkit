import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { importPack, previewPack, type ImportResult, type PackPreview } from "../../api/packs";
import { describeCounts } from "../../lib/packs";

type Stage =
  | { step: "idle" }
  | { step: "busy" }
  | { step: "preview"; bytes: Uint8Array; preview: PackPreview };

/**
 * Import a content pack file as a new project: choose a file, see what's in it,
 * then confirm. Nothing existing is ever changed or overwritten.
 */
export function ImportPack({ onImported }: { onImported: (result: ImportResult) => Promise<void> }) {
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function choose() {
    setError(null);
    setMessage(null);
    try {
      // No file-type filter: Android pickers can hide files with unknown extensions,
      // and the importer gives a clear error for anything that isn't a pack.
      const path = await open({ multiple: false });
      if (!path) return;
      setStage({ step: "busy" });
      const bytes = await readFile(path);
      setStage({ step: "preview", bytes, preview: await previewPack(bytes) });
    } catch (e) {
      setStage({ step: "idle" });
      setError(String(e));
    }
  }

  async function confirm(bytes: Uint8Array) {
    setStage({ step: "busy" });
    try {
      const result = await importPack(bytes);
      await onImported(result);
      const fixes = result.warnings.length;
      setMessage(
        `Imported as “${result.project.name}”.` +
          (fixes > 0 ? ` ${fixes} problem${fixes === 1 ? " was" : "s were"} fixed along the way.` : ""),
      );
    } catch (e) {
      setError(String(e));
    }
    setStage({ step: "idle" });
  }

  return (
    <div className="import-pack">
      <button onClick={choose} disabled={stage.step !== "idle"}>
        {stage.step === "busy" ? "Working..." : "Import pack..."}
      </button>

      {error && <p className="error">{error}</p>}
      {message && <p className="notice">{message}</p>}

      {stage.step === "preview" && (
        <section className="pack-preview" aria-label="Import preview">
          <h2>Import “{stage.preview.projectName}”?</h2>
          <p>
            {describeCounts(stage.preview.counts)}
            {stage.preview.trashed > 0 && ` (${stage.preview.trashed} of them in the trash)`}.
          </p>
          <p className="meta">
            Made {new Date(stage.preview.createdAt).toLocaleDateString()} by app version{" "}
            {stage.preview.appVersion}. It will be added as a new project called “
            {stage.preview.projectName} (imported)”. Nothing you already have is changed.
          </p>
          {stage.preview.warnings.length > 0 && (
            <>
              <p>Some things in this pack needed fixing:</p>
              <ul>
                {stage.preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          )}
          <div className="row">
            <button onClick={() => confirm(stage.bytes)}>Import as new project</button>
            <button onClick={() => setStage({ step: "idle" })}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}
