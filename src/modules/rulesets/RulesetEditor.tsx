import { useEffect, useMemo, useRef, useState } from "react";
import { updateRuleset, readRuleset, type RulesetRecord } from "../../api/rulesets";
import { ConfirmButton } from "../../components/ConfirmButton";
import { createAutosaver, type SaveStatus } from "../../lib/autosave";
import { normalizeRuleset, problemsWith, type Ruleset } from "../../lib/rulesets/ruleset";
import { DiceSection } from "./DiceSection";
import { EncounterRulesSection } from "./EncounterRulesSection";
import { PropertiesSection } from "./PropertiesSection";
import { StatBlocksSection } from "./StatBlocksSection";
import { UseInProject } from "./UseInProject";
import { deleteRuleset } from "../../api/rulesets";

type Section = "properties" | "statblocks" | "dice" | "encounters";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "statblocks", label: "Stat blocks" },
  { id: "properties", label: "Properties" },
  { id: "dice", label: "Dice" },
  { id: "encounters", label: "Encounters" },
];

interface Draft {
  name: string;
  description: string;
  ruleset: Ruleset;
}

/**
 * Edits one ruleset. The whole ruleset is held here as a draft and saved by `createAutosaver` after
 * a pause (and when you leave), like the other editors. Changing a ruleset never changes a project
 * that already uses it: use "Update this project's copy" for that.
 */
export function RulesetEditor({ record, onBack, onDeleted }: { record: RulesetRecord; onBack: () => void; onDeleted: () => void }) {
  const initial = useMemo(() => readRuleset(record), [record]);
  const [draft, setDraft] = useState<Draft>({ name: record.name, description: record.description, ruleset: initial.ruleset });
  const draftRef = useRef(draft);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("statblocks");

  const saver = useMemo(
    () =>
      createAutosaver({
        save: async (text) => {
          const d = JSON.parse(text) as Draft;
          await updateRuleset(record.id, d.name, d.description, d.ruleset);
          setSaveError(null);
        },
        delayMs: 700,
        onStatus: (s, e) => {
          setStatus(s);
          if (s === "error") setSaveError(String(e));
        },
      }),
    [record.id],
  );
  const saverRef = useRef(saver);
  saverRef.current = saver;

  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && void saverRef.current.flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void saverRef.current.flush();
    };
  }, []);

  /**
   * Applies a change to the draft and schedules the save. The draft is allowed to be half-finished
   * (a status with no name yet, a stat block with a repeated name) so typing never fights the editor;
   * what is *saved* has been through the one reader, which leaves out anything unusable.
   * A blank name is held back from saving until it has text.
   */
  const edit = (change: (d: Draft) => Draft) => {
    const next = change(draftRef.current);
    draftRef.current = next;
    setDraft(next);
    if (next.name.trim() !== "") {
      const read = normalizeRuleset(next.ruleset);
      saverRef.current.change(JSON.stringify({ ...next, ruleset: read.ok ? read.ruleset : next.ruleset }));
    }
  };
  const editRuleset = (change: (r: Ruleset) => Ruleset) => edit((d) => ({ ...d, ruleset: change(d.ruleset) }));

  const read = useMemo(() => normalizeRuleset(draft.ruleset), [draft.ruleset]);
  const clean = read.ok ? read.ruleset : draft.ruleset;
  const problems = [...problemsWith(draft.name, clean), ...(read.ok ? read.warnings.map((w) => `When saved: ${w}`) : [])];

  return (
    <div className="ruleset-editor">
      <div className="row">
        <button onClick={() => void saverRef.current.flush().then(onBack)}>← All rulesets</button>
        <span className="meta">{status === "saved" ? "Saved." : status === "error" ? "Couldn't save yet; will try again." : "Saving..."}</span>
      </div>
      {saveError && <p className="error">{saveError}</p>}
      {initial.error && <p className="error">This ruleset's saved data can't be read ({initial.error}), so it is showing an empty one. Changing anything replaces it.</p>}
      {initial.warnings.length > 0 && <p className="meta">Some parts of this ruleset couldn't be used and were left out: {initial.warnings.join(" ")}</p>}

      <label>
        Name
        <input type="text" value={draft.name} maxLength={80} onChange={(e) => edit((d) => ({ ...d, name: e.currentTarget.value }))} />
      </label>
      <label>
        What it is for (optional)
        <input type="text" value={draft.description} onChange={(e) => edit((d) => ({ ...d, description: e.currentTarget.value }))} />
      </label>
      {problems.length > 0 && (
        <ul className="meta">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <UseInProject record={record} ruleset={clean} flush={() => saverRef.current.flush()} />

      <div className="row wrap" role="tablist" aria-label="Ruleset sections">
        {SECTIONS.map((s) => (
          <button key={s.id} role="tab" aria-selected={section === s.id} className={section === s.id ? "active" : undefined} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {section === "statblocks" && <StatBlocksSection ruleset={draft.ruleset} edit={editRuleset} goToProperties={() => setSection("properties")} />}
      {section === "properties" && <PropertiesSection ruleset={draft.ruleset} edit={editRuleset} />}
      {section === "dice" && <DiceSection ruleset={draft.ruleset} edit={editRuleset} />}
      {section === "encounters" && <EncounterRulesSection ruleset={draft.ruleset} edit={editRuleset} />}

      <hr />
      <ConfirmButton
        label="Delete this ruleset"
        onConfirm={async () => {
          await saverRef.current.flush();
          await deleteRuleset(record.id);
          onDeleted();
        }}
      />
      <p className="meta">Deleting a ruleset doesn't change projects that already use it; they keep their copy.</p>
    </div>
  );
}
