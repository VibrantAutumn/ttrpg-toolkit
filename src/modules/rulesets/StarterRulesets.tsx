import { useState } from "react";
import { createRuleset } from "../../api/rulesets";
import type { StarterRulesetDef } from "../../lib/rulesets/starterRulesets";
import { STARTER_RULESETS } from "../../starter/rulesets";

/**
 * "Add starter rulesets": a generic d20 system, a generic narrative one and a blank one. Rulesets are
 * global, so these are added once for the whole app (not per project) and then are ordinary rulesets.
 */
export function StarterRulesets({ installedIds, onAdded }: { installedIds: (string | null)[]; onAdded: () => void | Promise<void> }) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(starter: StarterRulesetDef) {
    setWorking(starter.id);
    setError(null);
    try {
      await createRuleset(starter.name, starter.description, starter.ruleset, starter.id);
      await onAdded();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(null);
    }
  }

  const missing = STARTER_RULESETS.filter((s) => !installedIds.includes(s.id));
  if (missing.length === 0) return null;
  return (
    <details className="starter-rulesets" open={installedIds.every((id) => id === null || !id.startsWith("starter:"))}>
      <summary>Add starter rulesets</summary>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {missing.map((s) => (
          <li key={s.id} className="row wrap">
            <span className="name">
              <strong>{s.name}</strong> <small className="meta">{s.description}</small>
            </span>
            <button type="button" disabled={working !== null} onClick={() => void add(s)}>
              {working === s.id ? "Adding..." : "Add"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
