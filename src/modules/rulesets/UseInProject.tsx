import { useCallback, useEffect, useState } from "react";
import { applyRuleset, listProjectRulesets, removeProjectRuleset, type ProjectRulesetRecord, type RulesetRecord } from "../../api/rulesets";
import { ConfirmButton } from "../../components/ConfirmButton";
import { type Ruleset } from "../../lib/rulesets/ruleset";
import { useCurrentProject } from "../../state/CurrentProject";
import { bumpDataVersion } from "../../state/dataVersion";

/** Words for what applying made, e.g. "Added 5 properties, 2 stat blocks and 1 formula." */
function describeApplied(r: { fieldsMade: number; setsMade: number; formulasMade: number }): string {
  const parts = [
    r.fieldsMade > 0 ? `${r.fieldsMade} ${r.fieldsMade === 1 ? "property" : "properties"}` : null,
    r.setsMade > 0 ? `${r.setsMade} ${r.setsMade === 1 ? "stat block" : "stat blocks"}` : null,
    r.formulasMade > 0 ? `${r.formulasMade} ${r.formulasMade === 1 ? "formula" : "formulas"}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? "The project's copy is up to date." : `Added ${parts.join(", ")}.`;
}

/**
 * Connects the ruleset being edited to the open project. Using it **copies** the ruleset in
 * (properties, stat block sets, formulas, encounter rules); after that the project keeps working
 * on its own copy, and "Update this project's copy" brings in later changes.
 */
export function UseInProject({ record, ruleset, flush }: { record: RulesetRecord; ruleset: Ruleset; flush: () => Promise<void> }) {
  const { project } = useCurrentProject();
  const [copies, setCopies] = useState<ProjectRulesetRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!project) return setCopies([]);
    try {
      setCopies(await listProjectRulesets(project.id));
    } catch (e) {
      setError(String(e));
    }
  }, [project]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!project) return <p className="meta">Choose a project to use this ruleset in.</p>;
  const copy = copies.find((c) => c.rulesetId === record.id) ?? null;

  async function apply() {
    if (!project) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await flush(); // the project's copy is taken from what is saved
      const result = await applyRuleset(project.id, record.id, ruleset);
      setMessage(describeApplied(result));
      bumpDataVersion();
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="use-in-project">
      {copy ? (
        <p>
          <strong>Used in “{project.name}”.</strong>
        </p>
      ) : (
        <p className="meta">Not used in “{project.name}” yet.</p>
      )}
      <div className="row wrap">
        <button disabled={busy} onClick={apply}>
          {copy ? "Update this project's copy" : `Use in “${project.name}”`}
        </button>
        {copy && (
          <ConfirmButton
            label="Stop using it here"
            onConfirm={async () => {
              try {
                await removeProjectRuleset(copy.id);
                bumpDataVersion();
                setMessage(null);
                await reload();
              } catch (e) {
                setError(String(e));
              }
            }}
          />
        )}
      </div>
      <p className="meta">
        {copy
          ? "Pages and encounters in this project use the copy it has. Changes you make to this ruleset reach it when you update the copy."
          : "This copies the ruleset's stat blocks, dice and encounter rules into the project. Nothing is lost if you change or delete the ruleset later."}
      </p>
      {message && <p role="status">{message}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
