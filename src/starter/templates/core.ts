import { choices, type TemplateStarterDef } from "../../lib/templates/starterTemplates";

const one = { many: false, library: null, itemTypes: [] };
const several = { many: true, library: null, itemTypes: [] };

/**
 * The six core templates: NPC, Location, Faction, Item, Quest and Session. Each comes with a
 * field set of the same name and starter text with section headings. All the text is original
 * to this app.
 */
export const coreTemplates: TemplateStarterDef = {
  id: "starter:templates",
  name: "Templates",
  description: "NPC, Location, Faction, Item, Quest and Session, each with a field set and starter headings. NPC comes with a Relationships tab, Location with an empty Map slot.",
  tags: [{ name: "NPC" }, { name: "Location" }, { name: "Faction" }, { name: "Item" }, { name: "Quest" }, { name: "Session" }],

  fields: [
    // NPC
    { key: "role", name: "Role", kind: "text", description: "What they do: innkeeper, guard captain, hedge witch..." },
    { key: "species", name: "Species", kind: "text" },
    { key: "npc-status", name: "Status", kind: "dropdown", config: choices("Alive", "Dead", "Missing", "Unknown") },
    { key: "faction", name: "Faction", kind: "link", description: "The group they belong to", config: one },
    { key: "home", name: "Home", kind: "link", description: "Where they live", config: one },
    { key: "motivation", name: "Motivation", kind: "text", description: "What they want", config: { multiline: true } },
    { key: "secret", name: "Secret", kind: "text", description: "Something only the GM knows", config: { multiline: true } },
    // Location
    { key: "location-kind", name: "Location kind", kind: "dropdown", config: choices("Settlement", "Building", "Dungeon", "Wilderness", "Landmark", "Other") },
    { key: "region", name: "Region", kind: "text" },
    { key: "population", name: "Population", kind: "number", config: { min: 0 } },
    { key: "ruler", name: "Ruler", kind: "link", config: one },
    { key: "points-of-interest", name: "Points of interest", kind: "list", description: "Notable places and features here" },
    // Faction
    { key: "goal", name: "Goal", kind: "text", description: "What the group is trying to achieve", config: { multiline: true } },
    { key: "leader", name: "Leader", kind: "link", config: one },
    { key: "headquarters", name: "Headquarters", kind: "link", config: one },
    { key: "allies", name: "Allies", kind: "link", config: several },
    { key: "rivals", name: "Rivals", kind: "link", config: several },
    // Item
    { key: "item-kind", name: "Item kind", kind: "dropdown", config: choices("Weapon", "Armour", "Wondrous item", "Consumable", "Tool", "Treasure") },
    { key: "rarity", name: "Rarity", kind: "dropdown", config: choices("Common", "Uncommon", "Rare", "Legendary", "Unique") },
    { key: "value", name: "Value", kind: "number", config: { min: 0 } },
    { key: "held-by", name: "Held by", kind: "link", config: one },
    { key: "properties", name: "Properties", kind: "list", description: "What it does, each with its rules" },
    // Quest
    { key: "progress", name: "Progress", kind: "dropdown", config: choices("Rumour", "Open", "In progress", "Completed", "Failed") },
    { key: "quest-giver", name: "Quest giver", kind: "link", config: one },
    { key: "where", name: "Where", kind: "link", description: "Where it takes place", config: one },
    { key: "reward", name: "Reward", kind: "text", config: { multiline: true } },
    { key: "objectives", name: "Objectives", kind: "list", description: "What needs doing" },
    // Session
    { key: "session-number", name: "Session number", kind: "number", config: { min: 1 } },
    { key: "played-on", name: "Played on", kind: "text" },
    { key: "players", name: "Players", kind: "text" },
    { key: "next-time", name: "Next time", kind: "text", description: "Where to pick up", config: { multiline: true } },
  ],

  sets: [
    { name: "NPC", description: "A person in the world", fields: ["role", "species", "npc-status", "faction", "home", "motivation", "secret"] },
    { name: "Location", description: "A place", fields: ["location-kind", "region", "population", "ruler", "points-of-interest"] },
    { name: "Faction", description: "A group", fields: ["goal", "leader", "headquarters", "allies", "rivals"] },
    { name: "Item", description: "A thing worth noting", fields: ["item-kind", "rarity", "value", "held-by", "properties"] },
    { name: "Quest", description: "Something the party can do", fields: ["progress", "quest-giver", "where", "reward", "objectives"] },
    { name: "Session", description: "One session at the table", fields: ["session-number", "played-on", "players", "next-time"] },
  ],

  templates: [
    {
      key: "npc",
      name: "NPC",
      icon: "🧙",
      body: "## Appearance\n\n## Personality\n\n## Background\n\n:::secret\n## Secrets\n:::",
      sets: ["NPC"],
      tags: ["NPC"],
      tabs: [{ kind: "document", name: "Relationships", body: "## Allies\n\n## Enemies\n\n## Family" }],
    },
    {
      key: "location",
      name: "Location",
      icon: "🏰",
      body: "## Description\n\n## Who lives here\n\n## Adventure hooks",
      sets: ["Location"],
      tags: ["Location"],
      tabs: [{ kind: "slot", name: "Map" }],
    },
    {
      key: "faction",
      name: "Faction",
      icon: "🏴",
      body: "## Overview\n\n## Structure\n\n## Methods\n\n## Relationships",
      sets: ["Faction"],
      tags: ["Faction"],
    },
    {
      key: "item",
      name: "Item",
      icon: "🎒",
      body: "## Description\n\n## Properties and rules\n\n## History",
      sets: ["Item"],
      tags: ["Item"],
    },
    {
      key: "quest",
      name: "Quest",
      icon: "📜",
      body: "## Summary\n\n## How it begins\n\n## Complications\n\n## Outcomes",
      sets: ["Quest"],
      tags: ["Quest"],
    },
    {
      key: "session",
      name: "Session",
      icon: "🎲",
      body: "## Recap\n\n## Scenes\n\n## Loose ends\n\n:::secret\n## GM notes\n:::",
      sets: ["Session"],
      tags: ["Session"],
    },
  ],
};
