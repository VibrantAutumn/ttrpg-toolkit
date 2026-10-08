import type { StarterEntry, StarterPreset, TableStarterDef } from "../../lib/tables/starterTables";

/** Entries for one culture: each text gets that culture's tag. */
const culture = (tag: string, texts: string[]): StarterEntry[] => texts.map((text) => ({ text, tags: [tag] }));

const twoParts = (tag: string): StarterPreset["setup"] => ({
  mode: "two",
  sources: { first: "prefixes", last: "suffixes" },
  tags: [tag],
  tagMatch: "all",
  join1: "none",
  join2: "none",
  capitalisation: "firstLetter",
  mergeDoubles: true,
});

/**
 * Made-up name syllables for five cultures, in three tables. Every entry carries
 * its culture's tag, so a name setup that filters by that tag draws only that
 * culture's syllables (and with no filter the cultures mix).
 */
export const fantasyNames: TableStarterDef = {
  id: "starter:fantasy-names",
  name: "Fantasy names",
  description:
    "Name syllables for elves, dwarves, humans, orcs and halflings, each tagged with its culture, and a ready name setup for each.",
  tags: [
    { name: "Elf", color: "#2b8a3e" },
    { name: "Dwarf", color: "#c2255c" },
    { name: "Human", color: "#1971c2" },
    { name: "Orc", color: "#e8590c" },
    { name: "Halfling", color: "#9c36b5" },
  ],
  tables: [
    {
      key: "prefixes",
      name: "Name prefixes",
      notes:
        "The start of a name. Each entry is tagged with its culture (Elf, Dwarf, Human, Orc, Halfling), so a name setup can use just one culture. Add your own, and tag them.",
      entries: [
        ...culture("Elf", ["Ael", "Cal", "Fen", "Ilu", "Syl", "Tal"]),
        ...culture("Dwarf", ["Brak", "Dur", "Grim", "Kaz", "Mord", "Rok"]),
        ...culture("Human", ["Bran", "Cor", "Dal", "Edd", "Mar", "Wil"]),
        ...culture("Orc", ["Gor", "Krag", "Mog", "Ruk", "Zug", "Narg"]),
        ...culture("Halfling", ["Ambo", "Brim", "Cobb", "Dunn", "Pim", "Tuck"]),
      ],
    },
    {
      key: "middles",
      name: "Name middles",
      notes: "The middle of a longer name. Only the elves, dwarves and humans have some; orcs and halflings use two-part names.",
      entries: [
        ...culture("Elf", ["ar", "ith", "el", "an", "os", "ae"]),
        ...culture("Dwarf", ["gi", "ul", "dum"]),
        { text: "ra", tags: ["Dwarf", "Human"] }, // one syllable both cultures use
        ...culture("Human", ["li", "de", "ni"]),
      ],
    },
    {
      key: "suffixes",
      name: "Name suffixes",
      notes: "The end of a name, tagged by culture like the prefixes.",
      entries: [
        ...culture("Elf", ["wen", "dor", "iel", "orn", "ria", "thas"]),
        ...culture("Dwarf", ["din", "gar", "rek", "mund", "helm", "dak"]),
        ...culture("Human", ["ton", "ric", "wyn", "lan", "mer", "ford"]),
        ...culture("Orc", ["gash", "nak", "tuk", "rok", "mar", "dush"]),
        ...culture("Halfling", ["bottom", "wick", "foot", "brook", "dale", "ley"]),
      ],
    },
  ],
  presets: [
    {
      name: "Elven name",
      setup: { ...twoParts("Elf"), mode: "three", sources: { first: "prefixes", middle: "middles", last: "suffixes" } },
    },
    { name: "Dwarven name", setup: twoParts("Dwarf") },
    { name: "Human name", setup: twoParts("Human") },
    { name: "Orcish name", setup: twoParts("Orc") },
    { name: "Halfling name", setup: twoParts("Halfling") },
  ],
};
