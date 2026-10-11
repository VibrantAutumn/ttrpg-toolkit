# Starting Phase 6 (Time) in a new chat

Open a new chat in this project and paste the prompt below.

## Before you start

- Phases 1 to 5 are committed and pushed. Phase 5 is rulesets, stat blocks, encounters, the player display and starter rulesets.
- If any of your Windows checks of Phase 5 turned up problems (especially the player display window), tell the new chat first so it can fix them before starting Phase 6.
- Still outstanding and not blocking: the phone checks for Phases 4b and 5. An Android phone cannot open the second player-display window.

## The prompt

> Please read CLAUDE.md in full, then these parts of spec.md: "Project state and sessions", "Tool: Calendar and timeline", "Tool: Random tables and generators" (for weather), "Tool: Dice" only if needed, "Out of the box" (calendars and the GM-screen line), and the Phase 6 line of the build order. Phases 1 to 5 are done and committed. Phase 6 is Time: a calendar builder with several calendars per project (days, weeks, months, years, leap rules, eras, seasons, moons), project state and its status bar (in-game date and time, current session, party location, weather, active ruleset and calendar), sessions (documents with a real-world date, in-game start and end dates and a log tab, plus "Save to session"), weather generated from the weather tables, quick and recurring events, dated DM notes, a month view, timelines with lanes (using the query engine), and the date and location property kinds the spec says wait for this phase. Also two small leftovers: saving an encounter's outcome to the current session (`outcomeText` in `lib/encounters/engine.ts`), and a starter real-world-style calendar and a simple fantasy calendar with one moon.
>
> Before building anything: say your plan in a few lines (steps, decisions, what is deliberately out of scope). Ask me about the real design forks, with options. Likely ones: how a calendar is stored and whether calendars are global like rulesets or per project; how a date is stored (one number of days or year/month/day parts) and how dates convert between calendars; how the date property kind plugs into properties, queries and search; where the status bar sits and what it shows on a phone; what a session is (a page type with a property set, or its own item type); how recurring events are expressed; how moon phases and weather are computed; what a timeline shows and how lanes work. Don't guess on product decisions. Ask before installing any package.
>
> Work in small steps and test what you can yourself (cargo test, npm test, npx tsc --noEmit, npm run build, and the browser preview for layout). Calendar math is tricky, so write its automated tests first. Keep a running list of what only I can check on Windows. The phone is not testable right now. Plug new features into the module registry and the existing engines (properties, queries, results, links, tags, rulesets, encounters) instead of rewiring the core. Add new data to the content-pack format as optional files, and never edit pack_v1.ttrpgpack. Commit only when I say "commit please", and record new design rules in CLAUDE.md as you go.

## Handy facts for the new chat

- Next migration number is 0028 (the last is 0027, encounters).
- The module registry is in `src/registry/`; a new module goes in `src/modules/<name>/` and is listed in `src/registry/index.ts`.
- Properties (fields) already have a kind list in `src/lib/fields/definition.ts`; the spec says date and map-location kinds arrive with the calendar and maps.
- Encounter outcomes: `outcomeText(state)` in `src/lib/encounters/engine.ts`; "Save to session" should use it.
- Bash heredocs choke on big or quoted content: write edit scripts to the scratchpad with the Write tool and run them with `python -I`.
- Run the browser preview with `preview_start` using the `web-preview` server; `src/dev/mockBackend.ts` pretends to be the backend there.
