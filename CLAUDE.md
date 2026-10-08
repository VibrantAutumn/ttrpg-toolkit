# TTRPG Toolkit

A personal, local-first, system-agnostic TTRPG toolkit for Windows and Android, shared with a small group of friends and built in nine phases. **Current phase: 1 (Foundation) is complete; Phase 2 (dice, results, cards) is next.**

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
- [x] Library framework (folders, tags, search, trash; generic `LibraryScreen`, verified on Windows and phone)
- [x] Links and backlinks (links table, item page, link picker, back-stack; verified on Windows and phone)
- [x] Plain document editor (Markdown text, autosave, text search; verified on Windows and phone)
- [ ] Basic command palette
- [x] Content pack export/import (backups) (verified PC to phone and phone to PC)
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
- **Trash semantics:** deleting a folder soft-deletes its subfolders and items with the *same* `deleted_at`, so restoring the folder restores only that group (things deleted earlier stay deleted). `db/trash.rs` lists "roots of deletion" only, restores items/folders (falling back to the top level if the original parent is still trashed), and permanently deletes (`purge_*`, `empty` with an optional "older than" cutoff). Only trashed rows can be purged. Any table that references `items` (links...) must use `ON DELETE CASCADE` so purging works.
- **Tags** (`db/tags.rs`, migration 0003): campaign-wide, optional `#rrggbb` colour, nestable (loops refused), unique among live siblings ignoring case (checked in code and by a unique index). Soft-deleted with their sub-tags under one shared timestamp; restore mirrors folders and refuses a name clash. `item_tags` links carry timestamps and `deleted_at` (a removed link is kept, so removals can sync later; re-adding revives it). `tags::items_with_tag(.., include_subtags)` finds items by tag. Tags can only attach to live items/tags in the same campaign.
- **Tauri commands** all live in `src-tauri/src/commands.rs` (thin wrappers over tested `db/` functions; register each in `lib.rs`'s `generate_handler!`). TypeScript calls them only through typed wrappers in `src/api/` (`campaigns.ts`, `library.ts`), never raw `invoke` strings in components. JS passes camelCase args; Rust names are snake_case.
- **Library screen:** `src/components/library/LibraryScreen.tsx` is the generic UI any tool reuses: `<LibraryScreen library="<tool id>" title="..." itemTypes={[...]} />` gives folders, items (rename/move/tags/delete with undo), search and a Trash panel for the open campaign. See `src/modules/worldbuilding/` for the pattern (a module registers its tool + item types and renders `LibraryScreen`). Pure helpers (breadcrumbs, move menus, grouping tags) are in `library/helpers.ts` with Vitest tests. Destructive actions use `ConfirmButton` (two taps), since `window.confirm` is unreliable on Android WebViews. Not built yet: tag manager (rename/recolour/nest/delete tags), opening an item (editor arrives in Phase 4).
- **Links and backlinks** (`db/links.rs`, migration 0006): the `links` table is the single source of truth; backlinks are the reverse query. A link is (source item, target item, `source_ref`): `'manual'` for the item page's Links list now, later `'body'` for editor @mentions and `'field:<name>'` for link fields, so those write rows to the same table rather than a new mechanism. One-way, no self-links, both items live and in the same campaign, any tool to any tool. Removal is soft (row kept, `deleted_at` set; re-adding revives it). Trashing an item hides its links on both sides and restoring brings them back; purging removes them (`ON DELETE CASCADE`). Not built yet: `target_ref` (linking to a spot inside an item, e.g. a map pin; add the column when maps need it).
- **Item page and navigation:** `ItemView` (`src/components/item/`) is an item's page: tags, Links (with a `LinkPicker` that searches every tool), and "Linked from". Any screen opens an item with `useNavigation().openItem(id)` (`src/state/Navigation.tsx`); the shell keeps a stack so Back retraces links, keeps the tool mounted underneath (hidden) so its state survives, and clears the stack on campaign change. `itemDisplay.ts` has the icon/type/tool labels (via the registry). The document body/editor will live in `ItemView`.
- **Document text** (`db/documents.rs`, migration 0007): a document is an `items` row with `item_type = 'document'`; its body is **Markdown text** in `document_content` (one row per item, same id, `ON DELETE CASCADE`; the item's trash state governs it). Markdown is the storage format so the Phase 4 rich editor (TipTap/BlockNote, both read/write Markdown) can replace the plain editor without converting data, and so content packs stay human-readable. `get_body`/`set_body` only work on live documents; saving bumps the item's `updated_at`; bodies over 2 MB are refused. Search now indexes the body too (name > tags > text in ranking); migration 0007 rebuilt the FTS table because FTS5 columns can't be altered. Not built yet: version history (spec: recent versions viewable/restorable), snippets/highlights in search results.
- **Item editors via the registry:** an `ItemTypeDefinition` can have an optional `editor` component (`{ itemId }` prop); `ItemView` renders whatever the item's type registered, so core code never mentions documents. Worldbuilding registers `DocumentEditor` (plain textarea) in `modules/worldbuilding/documentType.ts`; maps/decks will bring their own the same way.
- **Autosave** (`src/lib/autosave.ts`, tested): `createAutosaver({save, delayMs, onStatus})` debounces edits (800 ms in the editor), runs saves one at a time in order, keeps unsaved text if a save fails (retried on next flush), and `flush()` never rejects. The editor flushes on blur, on unmount and on `visibilitychange` to hidden (Android may kill hidden apps). Reuse it for any text-like editor. Note: `tsconfig` targets ES2020, so avoid newer array methods like `.at()`.
- **Content packs** (`src-tauri/src/pack/`, migration 0008): a `.ttrpgpack` file is a zip with `manifest.json` (`format: "ttrpg-toolkit-pack"`, `formatVersion`, `packId`, app/schema versions, campaign name, counts) plus `data/{folders,items,tags,item_tags,links,documents}.json` (and a reserved `assets/`). The JSON records in `pack/format.rs` are deliberately separate from the DB structs, so DB changes never silently change the file format. **Export** (`export.rs`) writes one whole campaign including trashed rows. **Import** (`import.rs`) *always creates a new campaign* "<name> (imported)" with fresh ids (never overwrites), in one transaction (all-or-nothing); items keep `origin_pack_id`/`origin_item_id` for a future "update from original". Reading is separate from writing: `read_pack` enforces size limits (zip-bomb guard), refuses non-packs and packs from a newer `formatVersion`, and *repairs and reports* inconsistent data as warnings (dangling references dropped, parent loops broken, clashing tag names renamed, parents ordered before children). Unknown files/fields are ignored; missing data files count as empty. **Evolving the format:** optional new fields are not breaking (use `#[serde(default)]`); a breaking change bumps `FORMAT_VERSION`, adds an upgrade step in `parse_manifest`, and adds a NEW golden file (`src-tauri/tests/fixtures/pack_v2...`). **Never edit or regenerate `pack_v1.ttrpgpack`**: the `the_committed_version_1_pack_still_imports` test is the promise that old packs keep importing. To add a new kind of data to packs: add its record type and file to `format.rs`, export it, sanitize + import it, extend `populate`/`snapshot` in `pack/tests.rs`. Files travel to/from Rust as **base64 text** (`src/lib/base64.ts` in JS, `pack::encode_for_transport`/`decode_from_transport` in Rust), never raw bytes. **Android gotcha:** Tauri never delivers a raw request body to commands on Android (`InvokeBody::Raw` is unsupported there; it always sends JSON), so a command taking raw bytes works on Windows and fails on the phone. Any command that moves a file or other binary data must use the text transport; there is one code path for all platforms so tests on Windows cover what the phone runs. JS saves/opens files with the Tauri dialog + fs plugins (verified on Android: content URIs work, `.ttrpgpack` names are kept). The pack commands are `async` so big packs don't freeze the window. UI: Export on each campaign row, "Import pack..." with a preview step on the Campaigns screen. Not built yet: importing selected items into an existing campaign, "bring linked items along", "update from original", assets, rulesets.
- **Command palette** (`components/palette/CommandPalette.tsx`): opened with Ctrl/Cmd+K or the status bar's Search button (the way in on Android). Lists `registry.getCommands()` filtered/ranked by `matchCommands` (`src/lib/palette.ts`, tested) plus matching items from the open campaign (`searchItems`, any tool); choosing an item calls `openItem`, a command runs with `{ openTool }`. To add a palette entry, register a `CommandDefinition` in a module; don't edit the palette. Not built yet: quick-create actions, rolling dice, switching campaigns from the palette, per-command shortcuts.
- **Current campaign:** which campaign is open is a per-device setting in the `app_settings` table (migration 0005; never sync it), read with `settings::current_campaign()`, which returns none if the chosen campaign is gone or trashed (and it returns once restored). The first campaign created becomes current. In React, use `useCurrentCampaign()` (`src/state/CurrentCampaign.tsx`) and call its `refresh()` after anything that could change it. The slim `StatusBar` shows it; Phase 6 adds date/session/weather/location to that bar. Library screens must show "choose a campaign" when it is null.
- **Search** (`db/search.rs`, migration 0004): an FTS5 table `search_index` (item name + its live tag names) kept current by database triggers on `items`, `item_tags` and `tags`, so never write to it from code. Whether an item is trashed is not in the index; `search()` joins `items` and filters `deleted_at`. User text is turned into quoted prefix terms (`fts_query`), so punctuation can't break the query. Name matches outrank tag-only matches. When a new item type gets searchable text (e.g. document body in Phase 4), extend the index through a new migration. Test databases come from `db::open_in_memory()` so they match production (foreign keys on, fully migrated).
- **Library tables** use this base: `id TEXT` (UUID), `created_at`/`updated_at` (integer ms since Unix epoch, UTC), `deleted_at` (nullable; set = in trash). See `0001_create_campaigns.sql`.
- Keep UI logic separate from data/engine logic so engines can be tested without React.
- UI must work with touch and small screens (Android phone and tablet) as well as mouse and keyboard.
- Honor a reduce-motion setting for any animation.
- **File encoding on Windows:** source files are UTF-8 and contain non-ASCII characters (curly quotes, ✓, emoji). Windows PowerShell 5.1 reads files as ANSI by default, so rewriting a source file with `Get-Content` + `WriteAllText` silently turns those characters into garbage like `â€œ`. Edit files with the editor tools; if a script must rewrite a file, read and write with an explicit UTF-8 encoding (`[IO.File]::ReadAllLines($p, (New-Object Text.UTF8Encoding($false)))`). After any scripted edit, search the repo for `â|Ã|Â` to catch damage.

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
