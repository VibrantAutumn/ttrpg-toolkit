import type { TableStarterDef } from "../../lib/tables/starterTables";

const plain = (...texts: string[]) => texts.map((text) => ({ text }));

/** Tavern names, from a table of whole-name patterns that use the adjectives and things tables. */
export const tavernNames: TableStarterDef = {
  id: "starter:tavern-names",
  name: "Tavern names",
  description: "Names like “The Rusty Flagon”, made from adjective and object tables, plus a table of name patterns.",
  tags: [],
  tables: [
    {
      key: "adjectives",
      name: "Tavern adjectives",
      entries: plain(
        "Rusty", "Gilded", "Laughing", "Drowsy", "Crooked", "Silver", "Wandering", "Merry",
        "Sleeping", "Thirsty", "Golden", "Lucky", "Smoky", "Mossy", "Humble", "Roaring",
        "Whispering", "Broken", "Crimson", "Salty", "Blind", "Dancing", "Iron", "Copper",
      ),
    },
    {
      key: "things",
      name: "Tavern things",
      entries: plain(
        "Flagon", "Goose", "Dwarf", "Anchor", "Lantern", "Barrel", "Stag", "Compass",
        "Cauldron", "Boar", "Kettle", "Raven", "Wheel", "Crown", "Fiddle", "Hammer",
        "Quill", "Mermaid", "Cart", "Oak", "Ferret", "Bell", "Pig", "Mule",
      ),
    },
    {
      key: "names",
      name: "Tavern names",
      notes: "Whole names built from the adjectives and things. Roll it for a ready-made name, or add patterns of your own.",
      entries: [
        { text: "The [Tavern adjectives] [Tavern things]", weight: 8 },
        { text: "The [Tavern things] and [Tavern things]", weight: 2 },
        { text: "The [Tavern things]'s Rest", weight: 2 },
        { text: "The [Tavern adjectives] [Tavern things] Inn", weight: 2 },
      ],
    },
  ],
};
