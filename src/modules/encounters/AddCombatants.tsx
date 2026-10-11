import { useEffect, useState } from "react";
import { getItemFields } from "../../api/fields";
import { searchItems, type Item } from "../../api/library";
import { addCombatants, type Outcome } from "../../lib/encounters/engine";
import { combatantFromValues } from "../../lib/encounters/fromItem";
import { SIDE_LABELS, SIDES, type EncounterState, type Side } from "../../lib/encounters/state";
import type { ProjectRules } from "../../lib/rulesets/projectRules";
import { itemIcon } from "../../components/item/itemDisplay";
import { useFieldCatalog } from "../../state/fieldCatalog";

/**
 * Two ways to add combatants: **quick add** (a name, how many, which side, optional health) and **from a page** (search
 * the project; the page's health, initiative bonus and combat properties are copied in from its stat block). Several at
 * once are numbered (Goblin 1, Goblin 2) and each has its own health and statuses.
 */
export function AddCombatants({
  projectId,
  rules,
  apply,
}: {
  projectId: string;
  rules: ProjectRules | null;
  apply: (change: (state: EncounterState) => Outcome) => boolean;
}) {
  const catalog = useFieldCatalog(projectId);
  const [side, setSide] = useState<Side>("foes");
  const [count, setCount] = useState(1);
  const [name, setName] = useState("");
  const [health, setHealth] = useState("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  const countNumber = Math.min(20, Math.max(1, Math.round(count) || 1));

  function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const max = Number(health.trim());
    const hasHealth = health.trim() !== "" && Number.isFinite(max) && max > 0;
    if (apply((s) => addCombatants(s, { name, side, health: hasHealth ? { current: max, max } : null }, countNumber))) {
      setName("");
      setHealth("");
      setCount(1);
    }
  }

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchItems(projectId, query, null, 8)
        .then((found) => !cancelled && setResults(found))
        .catch((e) => !cancelled && setError(String(e)));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, projectId]);

  async function addPage(item: Item) {
    setError(null);
    try {
      const data = await getItemFields(item.id);
      const spec = combatantFromValues({ name: item.name, itemId: item.id, side, rules, definitions: catalog.definitions, values: data.values });
      if (apply((s) => addCombatants(s, spec, countNumber))) {
        setSearch("");
        setResults([]);
        setCount(1);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <section className="add-combatants" aria-label="Add combatants">
      <h3>Add combatants</h3>
      <div className="row wrap">
        <label>
          Side
          <select value={side} onChange={(e) => setSide(e.currentTarget.value as Side)}>
            {SIDES.map((s) => (
              <option key={s} value={s}>
                {SIDE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          How many
          <input type="number" min={1} max={20} value={count} style={{ maxWidth: "5rem" }} onChange={(e) => setCount(Number(e.currentTarget.value))} />
        </label>
      </div>

      <form className="row wrap" onSubmit={quickAdd}>
        <input type="text" aria-label="Name" placeholder="Name (Goblin)" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <input type="text" inputMode="numeric" aria-label="Health" placeholder="Health (optional)" value={health} style={{ maxWidth: "10rem" }} onChange={(e) => setHealth(e.currentTarget.value)} />
        <button type="submit" disabled={name.trim() === ""}>
          Quick add
        </button>
      </form>

      <label>
        …or add a page that has a stat block
        <input type="search" placeholder="Search your pages" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
      </label>
      {!rules && <p className="meta">This project has no ruleset yet, so a page is added by its name only. Pick one in the Rulesets tool to copy health and stats in.</p>}
      {results.length > 0 && (
        <ul className="list">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => void addPage(r)}>
                {itemIcon(r)} {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
