# TTRPG Toolkit: Project Spec

Oct 7, 2026 · @Katie or DJ

## What changed in this redesign

The features are the same; the structure underneath is new. Each tool keeps its own home, and a small set of shared engines lets them work together.

- **Separate tools, each with its own library:** Worldbuilding, Cards, Tables and generators, Maps, Calendar and timeline, Encounters, plus Dice and the GM screen. Every library has folders, tags and search.
- **Documents have tabs** that are either nested documents or live embeds from other tools (a character's hometown map).
- **One field system** powers document properties, stat blocks and calendar dates.
- **One query system** (tags, fields, folders, item type) powers search, table slots, card pools, timeline lanes and widgets.
- **One results engine** for dice, tables, card draws and generators, with a shared roll log, lock-and-reroll and "save to session".
- **Campaign state** (current date, session, party location, weather) is shared by the calendar, maps, GM screen and sessions.
- **Quick tools:** dice, card draws and tables can be pulled up anywhere, by the GM and by players.
- **Sharing by campaign,** with player spaces, per-player reveals and per-tool visibility defaults.
- **Content packs** are one export format for backups, copying between campaigns and sharing.
- **New:** starter content and a new-campaign wizard, a command palette, trash and restore, a player display, and a module registry for future features.

## Overview

A personal, local-first, system-agnostic TTRPG toolkit for Windows and Android, shared with a small group of friends and built in phases.

**Design goals**

- **Works together:** every tool uses the same tags, links, fields, queries and results, so anything can link to, roll from, or display anything else.
- **Easy out of the box:** a new campaign is usable in a minute, with starter content and sensible defaults.
- **Deeply customizable:** advanced options live one click away, never in the way.
- **Room to grow:** new modules plug into the same engines without rewrites.

**Principles**

- **Local first, offline always.** Sync is an extra, never a requirement.
- **No outside apps.** Everything is created in the app. Imports are optional.
- **Simple by default, deep on demand.** Every feature has a one-click path; advanced settings sit behind an "Advanced" toggle.
- **Separate tools, shared engines.** Each tool has its own home; tags, links, fields, queries, results and campaign state are shared underneath.
- **Data, not code, for system-specific things.** Rulesets, dice, stat blocks, tables and templates are editable data.
- **Campaign-specific by default.** Rulesets are global; everything else lives in a campaign and moves between campaigns as content packs.
- **Design for sync from day one, build it last.** UUIDs, timestamps and soft deletes on every record.

## At a glance

&#91;embedded content: app architecture · 8 modules, 5 shared engines, storage\]

Tools are what you see, each in its own section; the five shared engines are why they work together. A new tool only has to plug into the engines to link, roll, search, share and offer widgets.

## Tech stack

Recommendation: **Tauri 2 + TypeScript + React + SQLite**, with a small self-hosted sync server added in the last phase.

| Layer | Choice | Why |
| --- | --- | --- |
| App shell | Tauri 2 | One codebase builds for Windows and Android. Small, fast installs. |
| Language | TypeScript | Closest mainstream language to C# (same designer). Strongest library ecosystem for this project. |
| UI | React | Largest community, most examples, most help online. |
| Local database | SQLite | One file per device, reliable, easy to back up. |
| Rich text editor | TipTap or BlockNote | Notion-style editing without writing an editor from scratch. |
| Maps | Leaflet (image mode) or Konva | Pan/zoom over uploaded images, pins, drawn shapes. |
| Sync server (later) | Chosen in phase 9 | Options evaluated then; could be C# if you prefer. |

**Why not C# throughout?** .NET MAUI with Blazor Hybrid would keep you in C#, and it is a reasonable fallback. But the hardest parts of this app (the document editor, maps, local-first sync) have their best tools in JavaScript, and those would need extra wrapping from C#. Since Claude will write most of the code, the stronger ecosystem matters more than language familiarity.

## Tools and libraries

Each tool has its own section in the app's navigation and its own library, organized the way that tool needs.

| Tool | Library holds | Organized by |
| --- | --- | --- |
| Worldbuilding | Documents | Folders, nested documents |
| Cards | Decks, pools, spreads, saved draws | Folders |
| Tables and generators | Tables, generators | Folders (categories) |
| Maps | Maps | Folders, nested maps under their parent |
| Calendar and timeline | Calendars, events, timelines | Folders |
| Encounters | Encounters | Folders |
| Dice | Saved formulas, custom dice | Folders |
| GM screen | Layouts | List |

**Every library item** has a UUID, name, icon, tags, a visibility setting, timestamps and a soft-delete flag. Every library supports folders, tags and search.

**Shared across tools**

- **Links and backlinks:** any item can link to any other, in any tool.
- **Embeds:** documents can show live views of maps, timelines, encounters, tables and decks (see Text and documents).
- **Global search** and the command palette search every library at once.
- **Trash:** deleted items go to a trash with restore; emptied manually or after a set number of days.
- **Version history:** recent versions of documents and other items can be viewed and restored.

## Fields, tags, links and queries

Four shared building blocks every module uses.

**Fields:** one system for document properties, stat blocks and cards.

| Field type | Example | Used by |
| --- | --- | --- |
| Text | Alignment: Chaotic Good | Everything |
| Number | STR 14, card value 7 | Stat blocks, cards |
| Bar (current/max) | HP 22/30 | Stat blocks, encounters |
| Dice formula | Initiative: 1d20+2 | Stat blocks, encounters |
| Dropdown | Status: Alive / Dead / Missing | Filters, timeline lanes |
| List | Actions, Abilities | Stat blocks |
| Link | Faction: The Zhentarim | Backlinks, queries |
| Calendar date / range | Born: 3rd of Frostfall, 1402 | Timeline, calendar |
| Map location | Last seen: pin on the city map | Maps, campaign state |

**Field sets** are reusable groups of fields (an "NPC" set, a ruleset's stat block). Templates and rulesets both use them.

**Tags:** shared across all modules in a project, with optional colors and nesting (Region / Sword Coast).

**Links and backlinks:** link any document, map, pin, card, table, event or encounter from text or a link field. Every item lists what links to it.

**Queries:** one filter builder: item type, tags (and/or/not), field values, folders, links. Saved queries become **smart collections**. Used by search, random table slots, card pools, timeline lanes, GM screen widgets and sharing previews.

## Results engine

Dice rolls, table rolls, card draws and generators all produce the same kind of **result**, so they share one set of tools.

- **Roll log:** one panel listing recent results of every kind, filterable by type.
- **Lock and reroll** any part of a result.
- **Save to session**, save to a document, or copy as text. Links in results stay clickable.
- **Show to players** on the player display.
- **Mixable:** a table entry can include dice (`[2d4] goblins`), an entity slot (`[Person]`), another table, or a card draw (`[draw 1 from Tarot]`). A generator can use all of these.
- **Seeded randomness** behind the scenes, so a result can be reproduced exactly when needed (useful for testing and for undo).

## Campaign state and sessions

Each campaign has a small shared "now" that modules read and update.

- **Campaign state:** current in-game date and time, current session, party location (a map pin or region), current weather, active ruleset and calendar.
- Shown in a slim **status bar** at the top of the app; click any part to change it.
- **Who updates it:** the calendar (advance time), maps (travel advances the date and moves the party), weather rolls, starting or ending a session.
- **Sessions** are documents with a real-world date, in-game start and end dates, and a log tab.
  - "Save to session" always targets the current session.
  - Starting a session can optionally roll weather and open a chosen GM screen layout.
- **Dated DM notes** attach to an in-game date and appear on the timeline.

## Rulesets and content packs

**Rulesets** are global definitions of a game system. Picking one for a campaign configures stat blocks, encounters and dice together.

A ruleset contains:

- **Stat block field sets** (character, monster, vehicle, or whatever the system needs).
- **Encounter rules:** initiative type, statuses (name, effect notes, duration), which fields show in combat.
- **Dice:** saved formulas and any custom dice the system uses.
- **Optional extras:** document templates (NPC, item) and random tables that suit the system.

A campaign can use more than one ruleset (e.g. a main system plus a ship-combat subsystem).

**Content packs** are the app's one bundle format: a zip of library items, assets and settings with a version number.

- **Uses:** full backups, copying items between campaigns, and sharing rulesets, decks, tables or templates with friends.
- **Importing** shows a preview and asks whether to bring linked items along. Imported items remember their source, with "update from original".
- The format is versioned, so packs from older app versions still import.

## Out of the box

A new campaign should be playable within a minute.

**New campaign wizard:** name, ruleset, calendar, and which starter packs to include. Every choice can be skipped and changed later.

**Starter content (built-in packs)**

- **Rulesets:** a generic d20 system and a generic narrative system, plus a blank one to build from.
- **Decks:** a standard tarot deck and a standard playing-card deck, with names, meanings and reversals filled in. You supply or pick the card art.
- **Tables:** fantasy name tables (several cultures), tavern names, NPC quirks, rumors, weather by climate, and an adventure-hook generator using entity slots.
- **Templates:** NPC, Location, Faction, Item, Quest, Session. Other tools get starter blueprints where they help (spread layouts, travel-mode sets).
- **Calendars:** a real-world-style calendar and a simple fantasy calendar with one moon.
- **GM screen:** a default layout with dice, a name generator and pinned documents.

**Ease of use**

- **Command palette** (Ctrl+K, or a button on Android): search, create, roll and jump anywhere by typing.
- **Quick create:** a + button that knows the current context (inside an NPCs folder, it suggests the NPC template).
- **Empty states that teach:** a blank module shows one sentence and a "try an example" button.
- **Advanced toggles:** features like per-position draw sources or terrain overrides stay hidden until turned on.

## Customization

Everything you build with is editable, and the app itself adapts to how you run games.

- **Content:** rulesets, field sets, templates, tables, generators, decks, dice, terrain, travel modes, calendars and statuses are all user-editable data.
- **Appearance:** light/dark themes, accent color, fonts, and per-campaign themes (a gothic campaign can look different from a sci-fi one).
- **Layout:** resizable panels, a customizable sidebar, and saved GM screen layouts.
- **Defaults:** per-campaign settings for things like reversal chance, repeat draws, initiative type and travel mode.
- **Shortcuts:** editable keyboard shortcuts on Windows.
- **Phone vs. tablet layouts** on Android, chosen automatically by screen size.

## Tool: Worldbuilding (documents)

Notion-style documents with fields, templates and tabs, organized in folders.

- **Editor:** headings, fonts, colors, formatting, multi-column layouts, callouts, toggles. Saved text styles apply to a selection in one click.
- **Inline links:** type `@` to link any item in any tool. Type `/` to insert blocks.
- **Tabs** come in two kinds:
  - **Nested document:** a child document shown as a tab, e.g. "Relationships" under a character. It is still a real document with its own links and fields.
  - **Embed:** a live view of an item from another tool's library, e.g. the character's hometown map, a timeline, an encounter, a table or a deck. Editing it in either place changes the same item.
- **Inline embeds:** roll buttons, dice formulas, table results or small map views inside text.
- **Stat blocks:** a document can carry a stat block from its ruleset (see Rulesets).
- **Secret blocks and fields:** mark any block or field GM-only, or reveal it to specific players.
- **Templates:** set fields, tabs (nested documents and embed slots), tags and starter text. Folder placement is not part of templates.
- **Field views:** see documents as a sortable, filterable table (all NPCs by faction and status).

## Tool: Cards

A deck library with draws, spreads and decks in play, all feeding the results engine.

**Organization**

- **Card:** image, name, optional value, notes, tags, and fields (e.g. Suit, Element). Can link to documents.
- **Set:** a group of cards within a deck (Major Arcana, Suit of Cups). A card can be in several sets and decks.
- **Deck:** a collection of cards and sets in the Cards library.
- **Pool:** a saved selection of decks, sets and cards, or a query ("all cards tagged Omen"). A card in two selected sources counts once.

**Drawing**

- **Simple draw:** 1 to 10 cards from any selection, one click.
- **Spreads (advanced):** 3 to 10 named positions ("Past"), each with its own sources. Saved as presets with notes on interpretation.
- **Options:** repeats (off by default), reversals (on, 50% by default, adjustable).
- **Decks in play:** persistent decks where drawn cards stay out until reshuffled or returned. Several can run at once.
- **Saved draws:** name, cards, positions, reversals, notes. Draws also appear in the roll log.
- **Animation:** subtle draw, flip and hover animations, with a setting to reduce motion.

## Tool: Dice

One dice notation used everywhere: the roller, tables, stat blocks and encounters.

- **Standard:** `2d6+3`, keep/drop highest or lowest (`4d6kh3`), advantage/disadvantage.
- **Pools:** count successes against a target (`6d10>=8`).
- **Exploding:** reroll and add on max or a chosen value.
- **Fate/Fudge:** `4dF`.
- **Custom dice:** user-defined faces, including symbols, defined in a ruleset or campaign.
- **Quick buttons** for common dice, plus saved named formulas ("Attack: 1d20+5").
- **Readable results:** shows each die, which were kept or exploded, and the total.

## Tool: Random tables and generators

Tables roll text, dice, cards and your own documents; generators combine rolls into new documents.

**Tables**

- Entries with text, tags and optional weights. View, add, edit and delete freely.
- **Slots** inside an entry can roll: another table, dice, a card draw, or **documents or other items matching a query** (`[Person] is missing [Object]`).
- **Labels** reuse a roll: `[Person as A] ... [A]`. **Field references** pull data: `[A.Faction]`.
- **Unique picks** (`[3 unique Rumors]`), **avoid recent** results, and a depth limit on nesting.
- **Tag filtering:** all combined parts must match by default; toggle to "any part".

**Name generator** (built-in tables): full names, prefix + suffix, or prefix + middle + suffix, with joining rules (capitalization, hyphens, apostrophes). Save a result back to a list.

**Roll context:** a query applied to the whole roll and its nested slots (only documents tagged Sword Coast). Can default to the party's current region from campaign state.

**Generators**

- A named set of rolls that fills a template (NPC: Name, Race, Personality, Secret).
- Shows a **preview** with lock and reroll per field; **Create** makes the document.
- **Fallback** when nothing matches a slot: roll a plain table instead, or offer to generate a new document (via preview).

## Tool: Encounters

An encounter library for building and running combat (or chases, heists, anything turn-based) under the campaign's ruleset.

- **Placement:** encounters live in their own library and can be embedded in documents and placed on map pins.
- **Initiative:** individual, group (sides alternate), or popcorn. Set by the ruleset, changeable per encounter.
- **Rolling:** automatic from the stat block's formula, manual entry, or a mix.
- **Combatants:** add any document with a stat block, or quick-add. Duplicates auto-number (Goblin 1, Goblin 2) with their own bars and statuses.
- **Tracking:** bars, numbers, statuses with durations and turn reminders, round counter.
- **Action log and undo.**
- **Encounter generator:** a generator can roll a group of combatants (`[1d4+1] from Forest Monsters`).
- Finishing an encounter can save the outcome to the session.

## Tool: Maps

A map library; each map annotates an uploaded image with layers, links and travel.

- **Layers:** pins, labels, regions, roads, and paths, each toggleable. Layers can be marked secret.
- **Pins and regions** link to any item, including other maps (nested maps, shown under their parent in the library). Regions can carry a terrain type and act like pins.
- **Fog of war (later):** hide parts of the map on the player display until revealed.
- **Scale:** set by drawing a line over a known distance.
- **Terrain and road types:** user-defined, each with a speed multiplier.
- **Travel modes:** saved base speeds, with optional per-terrain overrides (ships can't cross land).
- **Travel time:** shortest route along roads, or a custom path saved as an offroad path. Speed changes with terrain.
- **Campaign state:** a "party here" marker; confirming a trip moves it and advances the date. The trip can trigger a weather roll or a random encounter table per day.

## Tool: Calendar and timeline

Calendars are built in the app; timelines show anything with a date.

**Calendars**

- Days, weeks, months, years, leap rules, eras, seasons, and any number of moons with their own cycles.
- A campaign can hold **several calendars** (an elven and a human one). One is the **main calendar** that drives the campaign date; dates can be shown converted between calendars.
- **Weather:** generated per day from season and region climate, using weather tables you can edit.
- **Month view** with events, moon phases, holidays and DM notes.
- Fantasy Calendar import: optional, low priority.

**Events**

- Quick events (name, date or range, optional link) in the calendar library.
- **Recurring events** (festivals, holidays).
- **Any document with a date field** appears on timelines too, like an NPC's birth or a city's founding.

**Timelines**

- Live in the library and can be embedded in documents.
- Zoom from centuries to days, centered on the campaign's current date.
- **Lanes** set by a field or tag (one lane per faction), using the shared query system.
- Several timelines can exist (world history, a single campaign arc), each with its own filter.

## GM screen, quick tools and player display

Widgets are built once and appear in two places: the GM screen and the quick tools panel.

**Widgets:** dice roller, card draw, random table or generator, roll log, quick notes, pinned documents, current encounter, campaign state (date, weather, location), and a smart collection ("NPCs in this town"). Every tool can provide widgets, so new tools show up automatically.

**GM screen:** saved layouts of resizable widgets per campaign (combat, social, travel).

**Quick tools:** a panel you can open from anywhere in the app.

- **Windows:** a floating or side panel, opened by button or shortcut (e.g. Ctrl+D for dice), and pinnable while you browse.
- **Android:** a bottom sheet that slides over the current screen.
- You choose which widgets appear. Defaults: dice, card draw, random tables, roll log, quick notes.
- **Players get quick tools too.** The GM chooses per campaign which ones (dice on by default). Player rolls appear in the shared roll log; the GM can always roll secretly.

**Player display:** a second window (TV or second monitor) showing what you choose to share.

- Show any document, image, map (with fog of war), card draw, result, or the encounter's turn order.
- Secrets are never shown. Monster HP displays as a description ("Bloodied") or is hidden.
- On other devices after sync.

## Sync, sharing and permissions

Self-hosted sync for you and your friends, shared by campaign, with GM-only secrets and per-player reveals. Built last; designed for from the start.

- **Sync:** your data syncs across your devices through a server you run. Fully offline-capable; catches up on reconnect.
- **Sharing unit:** the campaign. You invite someone as a **GM** (sees and edits everything) or a **player**.
- **What players can edit:**
  - their own **player space** (character, notes, handouts received), which they control;
  - specific items the GM assigns to them (e.g. the party cartographer editing the world map).
  - Everything else is view-only.
- **Visibility defaults per tool,** changeable in campaign settings. Suggested: documents and maps visible; encounters, generators, tables and GM screen layouts secret.
- **Secrets** at several levels: whole item, document block or field, and map layer.
- **Reveals:** reveal anything to all players or to **specific players** (it arrives as a handout in their space). A later one-click "reveal to all".
- **Security rule:** secret content is never sent to a player's device, not just hidden.
- **"View as player"** preview, for all players or one in particular.

## Room for expansion

New features plug in as modules instead of rewiring the app.

**Module registry:** each module registers what it adds, and the core app picks it up automatically:

- new tools, library item types and embed types
- field types
- table slot types (what can be rolled inside an entry)
- GM screen widgets and player display views
- command palette actions and search results
- content pack data

**Safe data changes:** the database has a schema version and step-by-step migrations, so updates never break existing campaigns. Content packs carry a version too.

**Ideas this structure supports later** (not planned, just possible):

- Relationship web (a board of documents and their links)
- Player-facing character sheets
- Battle maps with tokens and grids
- Ambient audio playlists per scene
- Factions and clocks (progress trackers)
- Shop and loot inventories

## Build phases

Nine phases, each usable at the table. Shared engines are **designed** in Phase 1 but each is **built out** only when the first tool needs it, so the foundation stays small.

1. **Foundation:** app shell, SQLite with migrations, module registry, campaigns, library framework (folders, tags, search, trash), links and backlinks, a plain document editor, basic command palette, content pack export/import (backups). A test build running on Android.
2. **Dice, results and cards:** dice notation, results engine and roll log, widget framework and quick tools panel, deck library, cards, sets, pools, draws, spreads, decks in play. Starter tarot and playing-card decks.
3. **Random tables:** tables with weights, nesting, dice and card slots, labels, unique picks, name generator. Starter tables.
4. **Worldbuilding:** rich text editor, nested document tabs, fields and field sets, templates, queries and smart collections, field views, global search. Then entity slots, roll context and generators. Starter templates.
5. **Rulesets and encounters:** ruleset editor, stat blocks, encounter library and runner, first version of the player display. Starter rulesets.
6. **Time:** calendar builder, multiple calendars, campaign state and status bar, sessions, weather, events, timelines.
7. **Maps:** map library, layers, pins, regions, nested maps, roads, terrain, travel modes, travel time, party marker.
8. **GM screen and polish:** GM screen layouts, embeds of every tool in documents, new campaign wizard, themes, fog of war, animations.
9. **Sync and sharing:** server, device sync, campaign sharing, player spaces, visibility defaults, per-player reveals, view-as-player, player quick tools.

At a few hours a week, phases take several weeks to a few months each. Phases 1, 4, 7 and 9 are the largest.

## Who does what

Claude writes most of the code; you make decisions, run the app on real devices, and judge whether it feels right.

| Area | Claude | You |
| --- | --- | --- |
| Code | Writes features, database schema, tests | Read what changed, ask questions about anything unclear |
| Setup | Gives exact install steps and commands | Install tools (Node, Rust, Android Studio SDK) and accept licenses |
| Testing | Writes automated tests for logic (dice parser, draw rules, calendar math, pathfinding) | Run the app on Windows and your Android phone; try it at the table |
| Bugs | Diagnoses from error messages and screenshots, fixes | Report what happened and paste the error |
| Content | Drafts example rulesets, tables, templates | Card art, your own decks, final say on content |
| Decisions | Proposes options with tradeoffs | Choose. Product taste is yours |
| Git | Writes commit messages, explains changes | Commit after each working step; keep a backup remote (GitHub) |
| Server | Writes server code and setup guide | Choose where it runs, keep it up, own its security |

**Working habits that make this succeed**

- **Claude Code** is the best tool for the build itself: it works directly in your project folder, runs commands and tests, and edits files.
- **Small steps.** One feature at a time, run it, commit it. Easy to undo when something breaks.
- **A project notes file** (`CLAUDE.md`) in the repo holding this spec, decisions and conventions, so each new session starts with context.
- **Tests for the tricky logic,** so later changes don't silently break earlier features.
