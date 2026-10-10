import type { StarterGeneratorDef } from "../../lib/generators/starterGenerators";

/**
 * The generators that come with the app. They roll the starter tables (Fantasy names, NPC quirks and
 * rumors), so add those first; an entity slot like `[entity:NPC]` picks one of your own documents tagged
 * NPC and falls back to a plain table when there are none. All the text is original to this app.
 * To add one: write a def here (the tests in `starterGenerators.test.ts` check it automatically).
 */
export const STARTER_GENERATORS: readonly StarterGeneratorDef[] = [
  {
    name: "Quick NPC",
    description: "A name, a quirk and a rumor, in a new NPC document (made from your NPC template if you have one).",
    templateName: "NPC",
    rows: [
      { label: "Name", target: { kind: "name" }, source: "[Name prefixes][Name suffixes]" },
      { label: "Quirk", target: { kind: "text" }, source: "[NPC quirks]" },
      { label: "Rumor", target: { kind: "text" }, source: "[Rumors]" },
    ],
  },
  {
    name: "Adventure hook",
    description: "A place, one of your NPCs and a rumor, as a plain document. Uses your documents tagged NPC when there are some.",
    rows: [
      { label: "Place", target: { kind: "name" }, source: "Trouble in [Places]" },
      { label: "Who is involved", target: { kind: "text" }, source: "[entity:NPC]", fallback: "Name prefixes" },
      { label: "What is going on", target: { kind: "text" }, source: "[Rumors]" },
    ],
  },
];
