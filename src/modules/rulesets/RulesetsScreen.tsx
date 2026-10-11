import { useCallback, useEffect, useState } from "react";
import { createRuleset, deleteRuleset, listDeletedRulesets, listRulesets, purgeRuleset, restoreRuleset, type RulesetRecord } from "../../api/rulesets";
import { ConfirmButton } from "../../components/ConfirmButton";
import { emptyRuleset } from "../../lib/rulesets/ruleset";
import { RulesetEditor } from "./RulesetEditor";
import { StarterRulesets } from "./StarterRulesets";

/**
 * The Rulesets tool. Rulesets are global (they belong to no project), so this screen works the
 * same whichever project is open; the "Use in this project" panel inside a ruleset is what
 * connects it to the open project.
 */
export function RulesetsScreen() {
  const [rulesets, setRulesets] = useState<RulesetRecord[]>([]);
  const [deleted, setDeleted] = useState<RulesetRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [live, gone] = await Promise.all([listRulesets(), listDeletedRulesets()]);
      setRulesets(live);
      setDeleted(gone);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function make(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const made = await createRuleset(name.trim() === "" ? "New ruleset" : name, "", emptyRuleset());
      setName("");
      await reload();
      setSelected(made.id);
    } catch (err) {
      setError(String(err));
    }
  }

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(String(err));
    }
    await reload();
  };

  const current = rulesets.find((r) => r.id === selected) ?? null;
  if (current) {
    return (
      <section>
        <RulesetEditor
          key={current.id}
          record={current}
          onBack={() => {
            setSelected(null);
            void reload();
          }}
          onDeleted={() => {
            setSelected(null);
            void reload();
          }}
        />
      </section>
    );
  }

  return (
    <section>
      <h1>Rulesets</h1>
      <p className="meta">
        A ruleset describes a game system: its stat blocks, dice and the rules encounters follow. Rulesets belong to you, not to a project; pick one in a project to
        copy its stat blocks and dice in.
      </p>
      {error && <p className="error">{error}</p>}
      <form className="row" onSubmit={make}>
        <input type="text" placeholder="Name of a new ruleset" aria-label="Name of a new ruleset" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <button type="submit">New ruleset</button>
      </form>
      <StarterRulesets installedIds={rulesets.map((r) => r.originId)} onAdded={reload} />
      {rulesets.length === 0 ? (
        <p className="empty">No rulesets yet. Add a starter above or make your own.</p>
      ) : (
        <ul className="list">
          {rulesets.map((r) => (
            <li key={r.id} className="row">
              <button className="name" onClick={() => setSelected(r.id)}>
                <strong>{r.name}</strong>
                {r.description && <span className="meta"> {r.description}</span>}
              </button>
              <ConfirmButton label="Delete" onConfirm={() => run(() => deleteRuleset(r.id))} />
            </li>
          ))}
        </ul>
      )}
      {deleted.length > 0 && (
        <>
          <button onClick={() => setShowTrash((v) => !v)}>{showTrash ? "Hide" : "Show"} deleted rulesets ({deleted.length})</button>
          {showTrash && (
            <ul className="list">
              {deleted.map((r) => (
                <li key={r.id} className="row">
                  <span className="name">{r.name}</span>
                  <button onClick={() => run(() => restoreRuleset(r.id))}>Restore</button>
                  <ConfirmButton label="Delete forever" onConfirm={() => run(() => purgeRuleset(r.id))} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
