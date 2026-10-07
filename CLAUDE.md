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
- [x] SQLite with migrations (rusqlite + migration runner + `campaigns` table; 6 Rust tests)
- [x] Module registry (TypeScript; tools, item types, commands; see Conventions)
- [x] Campaigns (create, list, rename, soft-delete, restore; verified on Windows. Selecting an "open" campaign is deferred to campaign state in Phase 6)
- [ ] Library framework (folders, tags, search, trash)
- [ ] Links and backlinks
- [ ] Plain document editor
- [ ] Basic command palette
- [ ] Content pack export/import (backups)
- [x] Test build running on Android (template app confirmed running on a physical phone)

Later phases: 2 Dice, results, cards · 3 Random tables · 4 Worldbuilding · 5 Rulesets and encounters · 6 Time · 7 Maps · 8 GM screen and polish · 9 Sync and sharing.

## Conventions

*Proposed at project start; edit freely.*

- TypeScript `strict` on; no `any` (use `unknown` and narrow).
- React function components and hooks only.
- npm is the package manager.
- Logic with tricky rules (dice parser, draw rules, calendar math, pathfinding, migrations) gets automated tests. Logic written in Rust is tested with `cargo test` (in `#[cfg(test)]` modules, using in-memory SQLite); logic written in TypeScript uses Vitest (`*.test.ts` next to the code). UI is checked by running the app.
- **Database lives in Rust** (`rusqlite`, bundled SQLite) in `src-tauri/src/db/`. React never touches SQL; it calls Tauri commands. The DB file is `toolkit.db` in the app data dir.
- **Migrations:** numbered `.sql` files in `src-tauri/migrations/`, registered in `src-tauri/src/db/migrations.rs`. Version is tracked in SQLite's `user_version`. To change the schema, add the next numbered file and entry; never edit an existing one.
- **Module registry** (`src/registry/`): a module is a `ModuleDefinition` object (id plus optional `tools`, `itemTypes`, `commands`; types in `registry/types.ts`). To add a feature: create `src/modules/<name>/index.ts` exporting a module, then add it to the list in `src/registry/index.ts`. The app shell (`App.tsx`) builds its navigation from `registry.getTools()`; the command palette will read `registry.getCommands()`. Core code must never import a specific module's screens directly. New contribution kinds (embed types, field types, widgets...) are added to the registry when the first feature needs them. Duplicate ids throw at startup.
- **Library items:** every item of every tool is a row in the shared `items` table (`library` = owning tool id, `item_type`, `folder_id`, `visibility` of `default|visible|secret`). Types needing more data get their own detail table keyed by the same id. Tags, links, search and trash work on `items`, so they work for every tool. Folders (`folders` table, nestable) belong to one tool's `library`; an item and its folder must share campaign and library. Data-layer code is in `src-tauri/src/db/{items,folders}.rs`; all errors use the shared `DbError` (`db/error.rs`).
- **Trash semantics:** deleting a folder soft-deletes its subfolders and items with the *same* `deleted_at`, so restoring the folder restores only that group (things deleted earlier stay deleted). `db/trash.rs` lists "roots of deletion" only, restores items/folders (falling back to the top level if the original parent is still trashed), and permanently deletes (`purge_*`, `empty` with an optional "older than" cutoff). Only trashed rows can be purged. Any future table that references `items` (tags, links...) must use `ON DELETE CASCADE` so purging works. Test databases come from `db::open_in_memory()` so they match production (foreign keys on, fully migrated).
- **Library tables** use this base: `id TEXT` (UUID), `created_at`/`updated_at` (integer ms since Unix epoch, UTC), `deleted_at` (nullable; set = in trash). See `0001_create_campaigns.sql`.
- Keep UI logic separate from data/engine logic so engines can be tested without React.
- UI must work with touch and small screens (Android phone and tablet) as well as mouse and keyboard.
- Honor a reduce-motion setting for any animation.

## Commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Run on Windows (dev, hot reload) | `npm run tauri dev` |
| Type-check and build the front end | `npm run build` |
| Run on Android (phone on USB, same Wi-Fi as PC) | `npm run tauri android dev` |
| Build a debug APK | `npm run tauri android build -- --debug --apk --target aarch64` |
| Rust tests | `cargo test` (run inside `src-tauri/`) |
| TypeScript type check | `npx tsc --noEmit` |
| TS tests | `npm test` (Vitest) |

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
