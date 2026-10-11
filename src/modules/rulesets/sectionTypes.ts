import type { Ruleset } from "../../lib/rulesets/ruleset";

/** What each section of the ruleset editor gets: the ruleset as drafted and a way to change it. */
export interface SectionProps {
  ruleset: Ruleset;
  edit: (change: (r: Ruleset) => Ruleset) => void;
}
