import type { TableStarterDef } from "../../lib/tables/starterTables";

/**
 * Weather for a day in three climates. Each table is weighted to add up to 20,
 * so it reads like a printed d20 table (the ranges show beside each entry).
 */
export const weather: TableStarterDef = {
  id: "starter:weather",
  name: "Weather by climate",
  description: "A day's weather for temperate, desert and arctic lands, each weighted like a printed d20 table.",
  tags: [],
  tables: [
    {
      key: "temperate",
      name: "Temperate weather",
      notes: "Roll once a day. Entries are weighted to add up to 20.",
      dieSize: 20,
      entries: [
        { text: "Clear skies and mild", weight: 5 },
        { text: "Partly cloudy", weight: 4 },
        { text: "Overcast and grey", weight: 3 },
        { text: "Light rain for [1d6] hours", weight: 3 },
        { text: "Heavy rain", weight: 2 },
        { text: "Fog that burns off by midday", weight: 1 },
        { text: "Thunderstorm", weight: 1 },
        { text: "Strong, gusty wind", weight: 1 },
      ],
    },
    {
      key: "desert",
      name: "Desert weather",
      notes: "Roll once a day. Entries are weighted to add up to 20.",
      dieSize: 20,
      entries: [
        { text: "Searing heat under a cloudless sky", weight: 6 },
        { text: "Clear and hot", weight: 4 },
        { text: "Hot and hazy", weight: 4 },
        { text: "A dusty wind that stings the eyes", weight: 3 },
        { text: "A sandstorm lasting [1d4] hours", weight: 2 },
        { text: "A rare shower, gone in minutes", weight: 1 },
      ],
    },
    {
      key: "arctic",
      name: "Arctic weather",
      notes: "Roll once a day. Entries are weighted to add up to 20.",
      dieSize: 20,
      entries: [
        { text: "Bitter cold under a clear sky", weight: 5 },
        { text: "Light snow", weight: 5 },
        { text: "Heavy snow", weight: 3 },
        { text: "A blizzard lasting [1d6] hours", weight: 2 },
        { text: "Freezing fog", weight: 2 },
        { text: "Overcast and still", weight: 2 },
        { text: "A whiteout: nothing is visible past arm's reach", weight: 1 },
      ],
    },
  ],
};
