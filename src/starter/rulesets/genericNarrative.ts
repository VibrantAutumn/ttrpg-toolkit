import { bar, buildRuleset, list, num, status, text, type StarterRulesetDef } from "../../lib/rulesets/starterRulesets";

const rating = (key: string, name: string, description: string) => num(key, name, description, { min: 0, max: 5 });

/** A story-first system: a concept, three approaches, stress and fate points, aspects and stunts. */
export const genericNarrative: StarterRulesetDef = {
  id: "starter:generic-narrative",
  name: "Generic narrative",
  description: "Concept, approaches, stress and fate points; dice are a guide and the story decides.",
  ruleset: buildRuleset({
    fields: [
      text("concept", "Concept", "One line that says who this is."),
      text("trouble", "Trouble", "What keeps getting them into trouble."),
      list("aspects", "Aspects", "Short phrases that are true of them and can be called on."),
      rating("force", "Force", "Rating when acting with strength or speed."),
      rating("finesse", "Finesse", "Rating when acting with care or trickery."),
      rating("insight", "Insight", "Rating when acting with knowledge or sense."),
      bar("stress", "Stress", "How much they can take before they are taken out."),
      num("fate-points", "Fate points", "Spent to tip the story their way.", { min: 0, max: 20 }),
      list("stunts", "Stunts", "Special things they do better than most."),
      num("threat", "Threat", "How dangerous an opponent is, from 1 to 5.", { min: 1, max: 5 }),
      text("notes", "Notes", "Anything else worth keeping to hand.", true),
    ],
    statBlocks: [
      { key: "character", name: "Character", description: "A hero of the story.", fields: ["concept", "trouble", "aspects", "force", "finesse", "insight", "stress", "fate-points", "stunts", "notes"] },
      { key: "antagonist", name: "Antagonist", description: "An opponent or complication.", fields: ["concept", "aspects", "threat", "force", "finesse", "insight", "stress", "notes"] },
    ],
    formulas: [
      { name: "Fate roll", notation: "4dF" },
      { name: "Fate roll +1", notation: "4dF+1" },
      { name: "Fate roll +2", notation: "4dF+2" },
      { name: "Dice pool (5)", notation: "5d6>=5" },
    ],
    encounter: {
      initiative: { type: "popcorn", formula: "", bonusField: null, order: "high" },
      healthField: "stress",
      combatFields: ["threat"],
      statuses: [
        status("Hurt", "Carries an injury that makes things harder until it is treated.", null, "#c92a2a"),
        status("Shaken", "Rattled; it hesitates when it matters most.", 2, "#7048e8"),
        status("Exposed", "Out in the open; the next attack against it gets help.", 1, "#f08c00"),
        status("Boosted", "Has a fleeting advantage to spend.", 1, "#2f9e44"),
        status("Marked", "Singled out; others know where to find it.", null, "#1c7ed6"),
      ],
    },
  }),
};
