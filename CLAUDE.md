# TTRPG Toolkit

A personal, local-first, system-agnostic TTRPG toolkit for Windows and Android, shared with a small group of friends and built in nine phases. **Current phase: 1 (Foundation).**

The full spec is [spec.md](spec.md). This file is a summary; when the two disagree, the spec wins (and tell Katie so the spec can be updated).

## Architecture in brief

- **Eight tools, each with its own library** (folders, tags, search): Worldbuilding (documents), Cards, Tables and generators, Maps, Calendar and timeline, Encounters, Dice, GM screen.
- **Five shared engines** underneath: fields, queries, results (dice/tables/draws/generators + roll log), campaign state, and links/tags. Tools plug into the engines instead of reimplementing them.
- **Module registry:** each module registers its tools, item types, embed types, field types, table slot types, widgets, command palette actions and content pack data. The core app picks them up automatically. New features should plug in here, not rewire the core.
- **Content packs:** one zip format (versioned) for backups, copying between campaigns and sharing.
- **Rulesets** are global; everything else lives in a campaign.

## Tech stack

| Layer | Choice |
| --- | --- |
| App shell | Tauri 2 (one codebase for Windows and Android) |
| Language | TypeScript (strict) |
| UI | React |
| Database | SQLite, one file per device |
| Rich text (Phase 4) | TipTap or BlockNote |
| Maps (Phase 7) | Leaflet (image mode) or Konva |
| Sync server (Phase 9) | Decided then |

## Rules that come from the spec's principles

- **Local first, offline always.** Sync is an extra, never a requirement.
- **Every record has a UUID, timestamps and a soft-delete flag.** Never hard-delete library items; deleted items go to the trash with restore.
- **Schema is versioned with step-by-step migrations.** Migrations are append-only; never edit one that has shipped. Content packs carry a version too.
- **Data, not code,** for system-specific things (rulesets, dice, stat blocks, tables, templates).
- **Simple by default, deep on demand.** Advanced options go behind an "Advanced" toggle.
- **Secret content is never sent to a player's device,** not just hidden in the UI.
- **No outside apps required.** Imports are optional.
- Engines are *designed* in Phase 1 but *built* only when the first tool needs them. Keep the foundation small.

## Phase 1 scope

- [x] App shell (Tauri 2 + React + TypeScript scaffold runs on Windows; still the template UI)
- [ ] SQLite with migrations
- [ ] Module registry
- [ ] Campaigns
- [ ] Library framework (folders, tags, search, trash)
- [ ] Links and backlinks
- [ ] Plain document editor
- [ ] Basic command palette
- [ ] Content pack export/import (backups)
- [ ] Test build running on Android

Later phases: 2 Dice, results, cards · 3 Random tables · 4 Worldbuilding · 5 Rulesets and encounters · 6 Time · 7 Maps · 8 GM screen and polish · 9 Sync and sharing.

## Conventions

*Proposed at project start; edit freely.*

- TypeScript `strict` on; no `any` (use `unknown` and narrow).
- React function components and hooks only.
- npm is the package manager.
- Logic with tricky rules (dice parser, draw rules, calendar math, pathfinding, migrations) gets automated tests (Vitest). UI is checked by running the app.
- Keep UI logic separate from data/engine logic so engines can be tested without React.
- UI must work with touch and small screens (Android phone and tablet) as well as mouse and keyboard.
- Honor a reduce-motion setting for any animation.

## Commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Run on Windows (dev, hot reload) | `npm run tauri dev` |
| Type-check and build the front end | `npm run build` |
| Run on Android | `npm run tauri android dev` (needs `npm run tauri android init` once; not yet done) |
| Tests | `npm test` (Vitest not set up yet) |

Notes:
- The first `tauri dev` compiles all Rust dependencies; later runs are fast.
- In Windows PowerShell 5.1, `New-Item -ItemType SymbolicLink` fails without admin even with Developer Mode on; use `cmd /c mklink` to test symlinks.
- Source layout: React/TypeScript in `src/`, Rust/Tauri in `src-tauri/`. App identifier is `com.katie.ttrpgtoolkit`.

## Working with Katie

- Katie is a junior developer. Explain what you are doing and why, and define unfamiliar terms briefly.
- Work in small steps: one feature at a time, run it, then commit. Katie commits after each working step; suggest a commit message.
- For product decisions, propose options with tradeoffs and let Katie choose.
- Katie runs the app on Windows and her Android phone and reports errors; diagnose from pasted errors and screenshots.
- Ask before installing software or changing system settings.
