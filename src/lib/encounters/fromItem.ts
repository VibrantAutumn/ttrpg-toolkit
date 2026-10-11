import type { FieldDefinition } from "../fields/definition";
import { coerceValue, formatValue, type BarValue, type FieldValue } from "../fields/value";
import type { ProjectRules } from "../rulesets/projectRules";
import type { CombatantSpec } from "./engine";
import type { Side } from "./state";

/**
 * Makes the combatant for a page that has a stat block: its health bar, its initiative bonus and the properties the
 * ruleset shows in combat, read from the page's property values *as they are right now*. They are copied: the
 * combatant keeps its own health and numbers for the fight, and the page is not changed by it.
 */
export function combatantFromValues(input: {
  name: string;
  itemId: string;
  side: Side;
  rules: ProjectRules | null;
  definitions: readonly FieldDefinition[];
  /** The page's stored values by property id (unchecked JSON, as `getItemFields` gives them). */
  values: ReadonlyMap<string, { raw: unknown }>;
  /** Names for link values (a property that links to other pages). */
  itemName?: (id: string) => string | undefined;
}): CombatantSpec {
  const { rules, definitions, values } = input;
  const def = (key: string | null): FieldDefinition | null => {
    if (!rules || key === null) return null;
    const id = rules.fieldIds[key];
    return definitions.find((d) => d.id === id) ?? null;
  };
  const valueOf = (d: FieldDefinition | null): FieldValue | null => {
    if (!d) return null;
    const stored = values.get(d.id);
    if (!stored) return null;
    const checked = coerceValue(d, stored.raw);
    return checked.ok ? checked.value : null;
  };

  const spec: CombatantSpec = { name: input.name, itemId: input.itemId, side: input.side, health: null, bonus: 0, stats: [] };
  if (!rules) return spec;
  const { encounter } = rules.ruleset;

  const healthDef = def(encounter.healthField);
  const health = healthDef?.kind === "bar" ? (valueOf(healthDef) as BarValue | null) : null;
  if (health) spec.health = { current: health.current, max: health.max };

  const bonusDef = def(encounter.initiative.bonusField);
  const bonus = bonusDef?.kind === "number" ? valueOf(bonusDef) : null;
  if (typeof bonus === "number") spec.bonus = bonus;

  for (const key of encounter.combatFields) {
    const d = def(key);
    const value = valueOf(d);
    if (!d || value === null) continue;
    const text = formatValue(d, value, { itemName: input.itemName }).trim();
    if (text !== "") spec.stats!.push({ label: d.name, value: text });
  }
  return spec;
}
