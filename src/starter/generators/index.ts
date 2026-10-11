import type { StarterGeneratorDef } from "../../lib/generators/starterGenerators";

/**
 * The generators that come with the app. They roll the starter tables (Fantasy names, NPC quirks and
 * rumors), so add those first; an entity slot like `[entity:NPC]` picks one of your own documents tagged
 * NPC. All the text is original to this app.
 * To add one: write a def here (the tests in `starterGenerators.test.ts` check it automatically).
 */
export const STARTER_GENERATORS: readonly StarterGeneratorDef[] = [
  {
    name: "Quick NPC",
    description: "A name, a quirk and a rumor about someone new.",
    text: "[Name prefixes][Name suffixes]\nQuirk: [NPC quirks]\nRumor: [Rumors]",
  },
  {
    name: "Adventure hook",
    description: "Trouble in a place, someone involved and a rumor. Swap the name for [entity:NPC] to pick one of your documents tagged NPC.",
    text: "Trouble in [Places]: [Name prefixes][Name suffixes] is involved. They say: [Rumors]",
  },
];
