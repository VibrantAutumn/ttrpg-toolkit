# Starting Phase 7 (Maps) in a new chat

Open a new chat in this project and paste the prompt below.

## Before you start

- Phases 1 to 6 are committed. Phase 6 is time: calendars, the status bar and project state, sessions, weather, events, month view and timelines.
- If any of your Windows checks of Phase 5 or 6 turned up problems, tell the new chat first so it can fix them before starting Phase 7.
- Still outstanding and not blocking: the phone checks for Phases 4b, 5 and 6.

## The prompt

> Please read CLAUDE.md in full, then these parts of spec.md: "Tool: Maps", "Fields, tags, links and queries" (the map location field), "Project state and sessions" (the party location), "Tool: Calendar and timeline" (travel advances the date and can roll weather), "GM screen, quick tools and player display" (only the player display and fog of war lines), and the Phase 7 line of the build order. Phases 1 to 6 are done and committed. Phase 7 is Maps: a map library where each map annotates an uploaded image, with layers (pins, labels, regions, roads, paths; each toggleable and markable secret), pins and regions that link to any item including other maps (nested maps shown under their parent), a scale set by drawing a line over a known distance, user-defined terrain and road types with speed multipliers, travel modes with optional per-terrain overrides, travel time along roads or a saved off-road path, and a "party here" marker in the project state so confirming a trip moves the party and advances the date (optionally rolling weather or a random encounter table per day). Also the map-location property kind that Phase 6 left out, and the party location slot in the status bar. Fog of war is marked "later" in the spec, so leave it out unless I say otherwise.
>
> Before building anything: say your plan in a few lines (steps, decisions, what is deliberately out of scope). Ask me about the real design forks, with options. Likely ones: which map library to use (the stack table says Leaflet in image mode or Konva; installing a package needs my OK) and how it behaves on a phone; how a map's image is stored and sized (the card pictures are resized in the WebView and kept as blobs apart from the item); how pins, regions, roads and paths are stored (one row per shape, or the whole map as JSON like encounters); how coordinates are stored so they survive a replaced image; how nested maps work and how a pin can open a child map; how terrain and road types and travel modes are stored (per project, or part of a ruleset); how the shortest route is found (graph over road segments, with terrain along the way); how a trip updates the date using the Phase 6 calendar (`advanceNow` in `state/timeActions.ts`) and the party marker; how the map-location property kind plugs into properties, queries and search; and how secret layers stay off players' devices. Don't guess on product decisions. Ask before installing any package.
>
> Work in small steps and test what you can yourself (cargo test, npm test, npx tsc --noEmit, npm run build, and the browser preview for layout). Pathfinding and scale maths are tricky, so write their automated tests first. Keep a running list of what only I can check on Windows. The phone is not testable right now. Plug new features into the module registry and the existing engines (properties, queries, results, links, tags, project state, calendar) instead of rewiring the core. Add new data to the content-pack format as optional files, and never edit pack_v1.ttrpgpack. Commit only when I say "commit please", and record new design rules in CLAUDE.md as you go.

## Handy facts for the new chat

- Next migration number is 0029 (the last is 0028, time).
- The module registry is in `src/registry/`; a new module goes in `src/modules/<name>/` and is listed in `src/registry/index.ts`.
- Project state (`db/project_state.rs`, `state/timeState.tsx`) has no party location yet; add a column in a new migration. The status bar is `components/shell/StatusBar.tsx`.
- Moving time: `advanceNow` and `rollWeatherFor` in `state/timeActions.ts`. Items embed in pages through tabs (`EmbedBody` renders the target type's own registered editor), so a map's editor works as an embed automatically.
- Properties have a kind list in `src/lib/fields/definition.ts`; the date kind (Phase 6) is the model for adding a location kind (definition, `coerceValue`, `formatValue`, `indexValue`, the Rust `KINDS` list, the value editor and query tests).
- Secret items: `items.visibility` and `setItemVisibility` exist; keeping secret content off players' devices is Phase 9's job, but never put secret data in anything a player display can receive.
- Bash heredocs choke on big or quoted content: use the Write tool for files and `python -I` scripts (written to the scratchpad) for edits.
- If port 1420 is taken, a leftover dev server is running; stop it before `npm run tauri dev`.
