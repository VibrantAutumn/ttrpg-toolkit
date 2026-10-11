import { bar, buildRuleset, list, num, status, text, type StarterRulesetDef } from "../../lib/rulesets/starterRulesets";

const score = (key: string, name: string, description: string) => num(key, name, description, { min: 1, max: 30 });

/** A plain d20 system: six ability scores, armor class, hit points, attacks and the usual conditions. */
export const genericD20: StarterRulesetDef = {
  id: "starter:generic-d20",
  name: "Generic d20",
  description: "Six ability scores, armor class and hit points; roll a d20 and beat a number.",
  ruleset: buildRuleset({
    fields: [
      score("strength", "Strength", "Raw power."),
      score("dexterity", "Dexterity", "Speed and balance."),
      score("constitution", "Constitution", "Toughness."),
      score("intelligence", "Intelligence", "Reasoning and memory."),
      score("wisdom", "Wisdom", "Awareness and judgement."),
      score("charisma", "Charisma", "Force of personality."),
      num("armor-class", "Armor class", "The number an attack has to meet or beat.", { min: 0, max: 40 }),
      bar("hit-points", "Hit points", "Health: current and maximum."),
      num("speed", "Speed", "How far it moves in a turn.", { min: 0, unit: "ft" }),
      num("initiative-bonus", "Initiative bonus", "Added to the initiative roll."),
      num("level", "Level", "Overall power for characters.", { min: 1, max: 30 }),
      num("challenge", "Challenge", "Overall power for monsters.", { min: 0, max: 30, decimals: 1 }),
      text("class", "Class", "What the character does best."),
      list("attacks", "Attacks", "Each attack with its bonus and damage."),
      list("traits", "Traits", "Special abilities and features."),
      text("notes", "Notes", "Anything else worth keeping to hand.", true),
    ],
    statBlocks: [
      {
        key: "character",
        name: "Character",
        description: "A player character or a named ally.",
        fields: ["class", "level", "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma", "armor-class", "hit-points", "speed", "initiative-bonus", "attacks", "traits", "notes"],
      },
      {
        key: "monster",
        name: "Monster",
        description: "A creature or foe.",
        fields: ["challenge", "armor-class", "hit-points", "speed", "initiative-bonus", "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma", "attacks", "traits", "notes"],
      },
    ],
    formulas: [
      { name: "d20 check", notation: "1d20" },
      { name: "Advantage", notation: "d20 adv" },
      { name: "Disadvantage", notation: "d20 dis" },
      { name: "Ability scores", notation: "4d6kh3" },
      { name: "Damage (small)", notation: "1d6" },
      { name: "Damage (medium)", notation: "1d8+2" },
    ],
    encounter: {
      initiative: { type: "individual", formula: "1d20", bonusField: "initiative-bonus", order: "high" },
      healthField: "hit-points",
      combatFields: ["armor-class", "speed"],
      statuses: [
        status("Blinded", "Can't see. Attacks against it are easier; its own attacks are harder.", null, "#495057"),
        status("Charmed", "Won't attack whoever charmed it and treats them as a friend.", null, "#e64980"),
        status("Deafened", "Can't hear.", null, "#868e96"),
        status("Frightened", "Has a harder time while it can see the source of its fear and can't move closer to it.", null, "#7048e8"),
        status("Grappled", "Held in place; its speed is zero.", null, "#e8590c"),
        status("Incapacitated", "Can't take actions or reactions.", null, "#c92a2a"),
        status("Invisible", "Can't be seen without help. Attacks against it are harder; its own are easier.", null, "#1c7ed6"),
        status("Paralyzed", "Can't move or act. Attacks against it are easier.", null, "#d9480f"),
        status("Poisoned", "Its attacks and checks are harder.", null, "#2f9e44"),
        status("Prone", "On the ground. Melee attacks against it are easier; ranged ones are harder.", null, "#a5692c"),
        status("Restrained", "Speed is zero; attacks against it are easier, its own are harder.", null, "#f08c00"),
        status("Stunned", "Can't act and can barely react.", 1, "#fab005"),
        status("Unconscious", "Out cold and unaware. Drops what it holds and falls prone.", null, "#212529"),
        status("Concentrating", "Keeping an effect going; taking damage can break it.", 10, "#0c8599"),
      ],
    },
  }),
};
