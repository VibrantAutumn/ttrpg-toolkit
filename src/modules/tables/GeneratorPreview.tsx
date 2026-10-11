import { useState } from "react";
import { copyText } from "../../lib/copyText";
import type { GeneratorDef } from "../../lib/generators/generator";
import { isComplete } from "../../lib/generators/generator";
import { lockableSlots, pickedDocuments, type GeneratorRun } from "../../lib/generators/run";
import { rerollGenerator, runGenerator, saveOutput } from "../../state/generatorActions";
import { useNavigation } from "../../state/Navigation";

/**
 * Rolls a generator and shows its output: roll again, keep some slots while rerolling the rest, copy
 * it, or save it as a page (linked to any documents it picked). Nothing is saved unless asked.
 */
export function GeneratorPreview({
  projectId,
  def,
  name,
  heading = "Try it",
}: {
  projectId: string;
  def: GeneratorDef;
  name: string;
  /** The title above the output; null leaves it out. */
  heading?: string | null;
}) {
  const { openItem } = useNavigation();
  const [run, setRun] = useState<GeneratorRun | null>(null);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(again: boolean) {
    setBusy(true);
    setNote(null);
    const result = again && run ? await rerollGenerator(projectId, def, name, run, locked) : await runGenerator(projectId, def, name);
    setBusy(false);
    if (result.ok) {
      setRun(result.run);
      setError(null);
      if (!again || !run) setLocked(new Set());
    } else {
      setError(result.message);
    }
  }

  async function save() {
    if (!run) return;
    setBusy(true);
    const result = await saveOutput(projectId, run, name);
    setBusy(false);
    if (result.ok) {
      setError(null);
      openItem(result.item.id);
    } else {
      setError(result.message);
    }
  }

  async function copy() {
    if (run) setNote((await copyText(run.roll.text)) ? "Copied." : "Couldn't copy; select the text instead.");
  }

  const toggle = (index: number) =>
    setLocked((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const documents = run ? pickedDocuments(run) : [];
  const slots = run ? lockableSlots(run) : [];

  return (
    <div className="generator-preview">
      {heading && <h2>{heading}</h2>}
      <div className="row wrap">
        <button type="button" disabled={busy || !isComplete(def)} onClick={() => void go(false)}>
          {run ? "Roll again" : "Generate"}
        </button>
        {run && slots.length > 0 && locked.size < slots.length && (
          <button type="button" disabled={busy} onClick={() => void go(true)}>
            Reroll the parts that aren't kept
          </button>
        )}
      </div>
      {!isComplete(def) && <p className="empty">Write something to roll first.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {run && (
        <>
          <p className="roll-text" aria-live="polite">{run.roll.text}</p>
          {slots.length > 1 && (
            <div className="row wrap">
              <small className="meta">Keep when rerolling:</small>
              {slots.map((s) => (
                <button key={s.index} type="button" aria-pressed={locked.has(s.index)} className={locked.has(s.index) ? "active" : undefined} onClick={() => toggle(s.index)}>
                  {locked.has(s.index) ? "🔒" : "🔓"} {s.text}
                </button>
              ))}
            </div>
          )}
          {documents.length > 0 && (
            <div className="row wrap">
              <small className="meta">Open:</small>
              {documents.map((d, i) => (
                <button key={`${d.id}-${i}`} type="button" className="link" onClick={() => openItem(d.id)}>
                  {d.name}
                </button>
              ))}
            </div>
          )}
          {run.roll.warnings.length > 0 && (
            <ul className="meta">
              {run.roll.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
          <div className="row wrap">
            <button type="button" onClick={() => void copy()}>Copy</button>
            <button type="button" disabled={busy} onClick={() => void save()}>Save as a page</button>
          </div>
          {note && <p className="meta" role="status">{note}</p>}
        </>
      )}
    </div>
  );
}
