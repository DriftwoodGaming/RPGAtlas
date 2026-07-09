# RPGAtlas Roadmap — "Project Harbor": real project folders

**Status:** 🚧 H0 (setup) complete — H1 not started
**Authored:** 2026-07-09 by Claude Fable 5 (grand designer / orchestrator)
**Goal:** Make RPGAtlas work the way RPG Maker MZ/MV and Godot do: the engine opens to a
**Project Manager** (create a new game / open an existing one), every game is a **visible
folder on disk** the user can browse, back up, and copy-paste assets into, and the engine
can be launched **directly from a project folder**. The installed engine is never modified
per-game. This is the single biggest "I finally understand the workflow" win for our
audience of kids and first-time devs.

---

## The mandate (improved prompt)

> RPGAtlas currently behaves like a browser app wearing a desktop shell: the project lives
> in localStorage, assets live in a hidden per-device library (IndexedDB in the browser,
> `<app-data>/library/` on desktop), and "saving to a file" is an optional export. That
> confuses users — especially kids and first-time devs — who expect the RPG Maker / Godot
> model: *the engine opens to a Project Manager, and a game is a folder you can see.*
>
> Rebuild the desktop workflow around real project folders:
>
> 1. **Project Manager on launch (desktop).** When RPGAtlas Desktop starts with no project
>    specified, show a Project Manager instead of the editor: **New Project** (game name +
>    parent-directory picker + starter template) and **Open Project** (recent-projects list
>    plus Browse…). Creating a project scaffolds a folder; opening one boots the editor on it.
> 2. **A game is a folder.** Each project folder contains the project file (`game.rpgatlas`
>    — our FORMAT_VERSION 2 JSON, blob-free) and visible asset drop-folders
>    (`assets/characters`, `assets/tilesets`, `assets/audio`, …). Everything about a game
>    lives in its folder; the base engine is never touched per-game.
> 3. **Copy-paste assets just work.** Files copied into the project's asset folders are
>    discovered automatically (on project open, on window focus, and via a Scan button) and
>    imported through the existing wizard pipeline, with the slicer safeguards intact.
>    Files stay where the user put them — nothing is silently moved.
> 4. **Edits save to the folder.** Autosave writes the project file in the project folder
>    (atomically), with localStorage kept only as crash recovery. Playtest keeps working.
> 5. **Launch from the project.** Double-clicking a `.rpgatlas` file (file association) or
>    invoking the exe with a project path opens the engine directly into that game,
>    skipping the manager.
> 6. **Nothing breaks.** The pure-browser build keeps its current localStorage workflow
>    untouched (all existing Playwright specs stay green); existing desktop users get a
>    friendly "turn this into a project folder" migration; FORMAT_VERSION stays 2; frozen
>    goldens stay frozen; all text a user can hit is written for kids.
>
> Deliver this as a multiphase roadmap in the Project Compass style: Opus 4.8 implements
> every stage (Sonnet is banned from this repo), Fable 5 signs the on-disk format contract
> and the release gate, each stage follows the git ritual (branch → gates green → merge to
> main), and every phase ends by printing the next phase's kickoff prompt verbatim so each
> phase runs in one fresh conversation.

---

## Locked decisions (2026-07-09)

1. **Model choreography:** **Opus 4.8 does all implementation** (settings per phase below:
   High / Extra High). **Sonnet is banned from RPGAtlas.** **Fable 5** is used at exactly
   two gates: the H1 on-disk contract sign-off and the H6 release review.
2. **Git ritual — after EVERY stage, no exceptions:** work on branch `harbor-<phase><stage>`
   (e.g. `harbor-2a`), finish with vitest + node tests + Playwright + eslint + typecheck
   green, commit, push, merge to `main`, push `main`, delete the branch. Phase exit
   additionally tags `harbor-N`.
3. **Hand-off protocol:** every phase's finishing conversation prints the *next phase's
   kickoff prompt* (the fenced block in that phase's section below) **verbatim, as the last
   thing in its final message**, so the user can paste it into a fresh conversation. One
   phase = one conversation (split at stage boundaries if context runs long — the git
   ritual makes any stage a safe resume point).
4. **Format policy:** **FORMAT_VERSION stays 2.** The `.rpgatlas` project file IS the
   existing project JSON document (blob-free). Project-folder structure is metadata
   *around* the document, never a schema break. Plugin API stays frozen for 1.x.
5. **Desktop-first, browser-safe:** the Project Manager and folder persistence are
   desktop-only (`isTauri`-gated). The browser build keeps today's localStorage flow
   *bit-for-bit* — the 70 existing Playwright specs must pass unmodified. New desktop
   behavior gets e2e coverage through a fake-host test hook (H2·D), not by weakening
   browser parity.
6. **Files stay where users put them.** Unlike the current app-data import inbox (which
   archives originals into `Imported/`), per-project asset folders are *in-place*: the
   library index references files by relative path + content hash. A user's file is never
   moved or deleted by a scan. (The legacy global inbox keeps its old semantics until H6
   retires it from the docs.)
7. **Audience rule (always):** every dialog, error, and README a user can encounter is
   written for kids and first-time devs. "Your game lives in this folder — here's what
   each part is", never a stack trace or jargon.

---

## Orchestration & hand-off

| Role | Model | Used for |
|---|---|---|
| Grand designer / gates | **Claude Fable 5** | This roadmap, H1 contract sign-off, H6 release review |
| Everything else | **Claude Opus 4.8** | All implementation stages |

**Setting legend:** *High* = well-specified breadth work · *Extra High* = persistence
boundaries, native plumbing, asset-pipeline cores.

**Working agreement per stage (bake into every conversation):**
1. Read this roadmap's phase section + `docs/harbor-N-spec.md` (create the spec from the
   phase section on the phase's first stage; append a stage-log entry every stage) +
   `AGENTS.md`.
2. Implement to the stage's exit criteria. New logic gets vitest coverage (pure cores in
   `src/shared` — vitest runs env=node); anything user-visible gets a `js/patch-notes.js`
   entry (bump `help.ts` + `shims.d.ts` cache-buster versions per AGENTS.md).
3. Never touch frozen map 1 (Driftwood Shore goldens). Baseline is **0** e2e failures.
4. Git ritual (locked decision 2). Then print the next stage/phase kickoff verbatim.

**Gate baseline at H0 (2026-07-09, commit f011967):** vitest 917 · node tests 19 ·
Playwright 70/70 · patch-notes `?v=61` · data.js `?v=31` · eslint 0 · FORMAT_VERSION 2.
Every stage leaves these ≥ baseline.

---

## Current state (verified against the codebase 2026-07-09)

What exists — build on it, don't rebuild it:

- **Tauri v2 desktop shell** (`src-tauri/`): `main` + `playtest` windows predefined in
  `tauri.conf.json`; commands in `src-tauri/src/lib.rs` — `save_project` /
  `save_project_to_path` / `open_project` (single-file dialogs), `open_playtest`
  (reload-only, hide-on-close), and a full **app-data asset library**
  (`library_list/read/write/delete/set_meta` over `<app-data>/library/index.json` +
  content-addressed `blobs/`), plus an **import inbox**
  (`library_import_dir/reveal_import/scan_import` over
  `<app-data>/library/import/{characters,facesets,enemies,tilesets,audio}` with a
  kid-friendly README and archive-to-`Imported/` semantics).
- **Host shim** `js/editor/host.js` (`isTauri` gate) and platform adapters
  `src/platform/tauri/fs-asset-store.ts`, `src/platform/browser/{idb-asset-store,
  project-repository,save-repository,local-storage-driver}.ts`, chosen by
  `src/platform/default-asset-store.ts`.
- **Persistence** (`src/editor/persistence.ts`): debounced autosave → localStorage
  (`rpgatlas_project`) via `BrowserProjectRepository`; desktop Ctrl+S binds to one `.json`
  path (`currentProjectPath`), saved files embed used assets (`embedUsedAssets`); import
  consumes embedded assets into the device library.
- **Boot** (`src/editor/boot.ts`): composition root; loads stored project or creates the
  default; **`#save-ind` ships hidden and is revealed LAST — that visibility is the e2e
  "editor is interactive" gate** (then `RPGATLAS_BOOT_MS`). A boot-failure overlay offers
  reload/reset.
- **Asset pipeline**: import wizard + slicers (48px default, oversliced-library
  safeguards), content-hash dedupe, Asset Browser with Scan for New Files.
- Exports (single-file .json with embedded assets, standalone HTML/EXE/web-zip), sample
  maps, console, RM import — all orthogonal; they keep working unchanged.

What changes: *where the truth lives.* Today truth = localStorage + a global hidden
library. After Harbor (desktop): truth = the open project's folder; localStorage is a
crash-recovery mirror; the global library survives only for legacy migration.

---

## The on-disk contract (draft — H1·A finalizes, Fable gate signs)

```
MyGame/
├─ game.rpgatlas            ← the project document (FORMAT_VERSION 2 JSON, blob-free).
│                              Fixed name: folder path and file path are interchangeable
│                              project identifiers. Double-clickable (H5 association).
├─ assets/                  ← the user's drop folders. Files STAY here (in-place library).
│  ├─ characters/              Walking sprites (PNG)
│  ├─ facesets/                Message-box faces (PNG)
│  ├─ enemies/                 Battlers (PNG)
│  ├─ tilesets/                Map tiles (PNG → 48px slicer)
│  ├─ audio/                   OGG/MP3/WAV/M4A/FLAC
│  └─ READ ME — how to add assets.txt   (per-project version of the inbox README)
├─ .atlas/                  ← engine-managed (Godot's .godot/ analogue) — safe to gitignore
│  ├─ library.json             asset index: relPath, hash, kind, name, slicer payloads
│  ├─ cache/                   derived data (sliced tiles, thumbnails) — safe to delete
│  └─ backup/                  rolling autosave backups (last 5 saves of game.rpgatlas)
└─ saves/                   ← playtest save slots (H3 stretch; optional in 1.2.0)
```

Contract rules H1·A must pin down (and Fable signs):
- **Path safety:** every project-scoped Rust command canonicalizes its target and verifies
  it stays inside the project root; IPC-supplied names/hashes are never trusted as path
  components (extend the existing `blob_file_name` discipline).
- **Atomicity:** `game.rpgatlas` and `library.json` write tmp-then-rename (the existing
  `write_index` pattern).
- **Identity:** an asset = relative path + content hash. Same-hash re-add is a no-op;
  changed hash re-imports (keeping tags/slicer meta); missing file = plain-language
  "missing asset" state, never a crash, never an index purge.
- **Names:** project name → folder-safe sanitization rule (shared pure core, unit-tested).
- **Recents registry:** `<app-config>/projects.json` — `[{name, path, lastOpened}]`,
  pruned of unreadable paths at display time (with a "can't find this game anymore" row,
  not a silent drop).
- **Error taxonomy:** the finite list of user-visible failures (folder exists, no
  permission, disk full, file vanished, second instance) with the exact kid-friendly copy.

---

## Phase H0 — Setup (this document) ✅

*Fable 5, complete 2026-07-09.* Improved the mandate, verified the codebase, authored this
roadmap, committed it to `main`. Exit: the H1 kickoff prompt printed as the final message
of the authoring conversation.

---

## Phase H1 — On-disk contract & native plumbing — **Opus 4.8 (Extra High)**, contract gate by **Fable 5**

*No user-visible change yet. Everything later builds against a signed contract.*

### H1·A — The contract (spec first)
- Write `docs/harbor-1-spec.md`: finalize the on-disk contract above (layout, path
  safety, atomicity, identity, names, recents, error copy). Resolve the open choices:
  fixed `game.rpgatlas` name (recommended) vs `<Name>.rpgatlas`; `.atlas/` dot-folder on
  Windows (recommended: keep the dot; Explorer shows it fine) vs `atlas-data/`.
- **Fable gate:** a fresh Fable 5 conversation reviews the spec against this roadmap and
  signs it (verdict recorded in the spec header) **before H1·B writes code**.

### H1·B — Rust project commands
- `src-tauri/src/lib.rs` (or a new `project.rs` module): `project_create(parentDir, name,
  template)` → scaffolds the folder tree + README + starter document, returns the project
  path; `project_open(path)` → accepts folder or `game.rpgatlas` path, returns the
  document + resolved root; `project_save(root, json)` → atomic write + rolling backup;
  `recents_list()` / `recents_touch(path)` / `recents_remove(path)` over
  `<app-config>/projects.json`; `project_reveal(root)` (reuse `reveal_path`).
- A `project_paths` guard module owning canonicalize-and-contain; unit-tested in Rust
  (`cargo test`) for traversal attempts.

### H1·C — Host + platform adapter
- Extend `js/editor/host.js` with the project surface; add
  `src/platform/tauri/project-host.ts` (typed façade, same custom-invoke pattern as
  `fs-asset-store.ts`).
- Pure cores in `src/shared` (env=node vitest): project-name sanitizer, recents ordering/
  pruning, template descriptor. No editor wiring yet.

**Exit criteria:** cargo builds + `cargo test` green; commands drivable from devtools on a
scratch folder (create/open/save/recents round-trip, traversal rejected); zero frontend
behavior change; all H0 gates ≥ baseline. Tag `harbor-1`.

**Kickoff prompt (paste into a fresh conversation):**

```
You are Claude Opus 4.8 (Extra High) working on RPGAtlas at M:\AI\DriftwoodEngine\RPGAtlas.
Execute Phase H1 (On-disk contract & native plumbing) of docs/PROJECT_FOLDERS_ROADMAP.md —
read that file's H1 section, its "on-disk contract" and "cross-phase traps" sections, and
AGENTS.md first. Memory context: the project-harbor memory file.

Stages, in order:
- H1·A: write docs/harbor-1-spec.md finalizing the on-disk contract (layout, path safety,
  atomicity, asset identity, name sanitization, recents registry, kid-friendly error
  taxonomy). Then STOP and tell the user to run the Fable 5 contract gate (the roadmap's
  H1·A gate) in a fresh conversation before you continue; resume H1·B only after the spec
  header carries the signed verdict.
- H1·B: Rust commands project_create/project_open/project_save/recents_*/project_reveal
  with a canonicalize-and-contain path guard module + cargo tests.
- H1·C: host.js project surface + src/platform/tauri/project-host.ts + pure cores
  (name sanitizer, recents logic) in src/shared with vitest (env=node — no window/DOM).

Ritual per stage: branch harbor-1<stage>; vitest + node tests + Playwright + eslint +
typecheck green (baseline: vitest 917 · node 19 · Playwright 70/70 · eslint 0); commit
(PS 5.1: use git commit -F <msgfile>); push; merge to main; delete branch. Phase exit:
tag harbor-1. Zero user-visible change this phase; no patch-notes entry yet. Never touch
frozen map 1. Prepend C:\Users\Zatara\.cargo\bin to PATH for cargo. Append a stage log to
docs/harbor-1-spec.md each stage. When H1 is done, print the H2 kickoff prompt from
docs/PROJECT_FOLDERS_ROADMAP.md verbatim as the last thing in your final message.
```

---

## Phase H2 — Project Manager launcher — **Opus 4.8 (High)**

*The engine now opens like RPG Maker/Godot: create or open a game.*

### H2·A — The manager surface
- A desktop-only (`isTauri`) pre-boot screen rendered **inside the main window** (never a
  new webview window — see trap 2): logo, **New Project**, **Open Project**, recents list.
  The editor's `boot()` runs only after a project is chosen; on the browser build the
  manager never mounts and boot is byte-identical to today.
- **e2e gate discipline:** `#save-ind` stays hidden until the *editor* finishes booting —
  the manager being interactive is NOT the boot signal. Document this in the spec.

### H2·B — New Project flow
- Name field (live folder-safe preview via the H1 sanitizer), parent-directory picker
  (dialog plugin), template choice: **Blank**, **Starter** (DataDefaults — today's
  first-run project), **Atlas Quest** (the sample). Scaffolds via `project_create`, then
  boots the editor on it.

### H2·C — Open flow & in-editor rewiring
- Recents (name, path, last-opened; missing-folder rows say so in plain language),
  **Browse…** picks `game.rpgatlas` or a folder. `File ▸ New Project` / `Open Project`
  inside the editor route back through the manager (guarding unsaved work); window title
  becomes "<Game Name> — RPGAtlas".

### H2·D — Testability
- A fake host hook (e.g. `window.__ATLAS_TEST_HOST__`, installed by a `?fakehost` query
  param in dev/test builds only) that simulates the Tauri project surface in the browser,
  so Playwright can drive the manager: create → editor boots; reopen → recents shows it;
  missing folder → friendly row. New specs additive; the existing 70 run unmodified.

**Exit criteria:** desktop boots to the manager; create/open/recents/browse all work
against real folders; browser build behavior unchanged; new Playwright manager specs
green; patch-notes entry. Tag `harbor-2`.

**Kickoff prompt:**

```
You are Claude Opus 4.8 (High) working on RPGAtlas at M:\AI\DriftwoodEngine\RPGAtlas.
Execute Phase H2 (Project Manager launcher) of docs/PROJECT_FOLDERS_ROADMAP.md — read that
file's H2 section, the signed docs/harbor-1-spec.md contract, the cross-phase traps, and
AGENTS.md first. Create docs/harbor-2-spec.md from the H2 section and append a stage log
per stage.

Stages, in order: H2·A manager surface (desktop-only, rendered inside the main window —
NEVER a new webview window; #save-ind stays hidden until the editor itself finishes boot,
it is the e2e boot gate); H2·B New Project flow (name + directory picker + Blank/Starter/
Atlas Quest templates via project_create); H2·C Open flow + recents + in-editor File menu
rewiring + window title; H2·D fake-host hook so Playwright (browser build) can drive the
manager, plus new additive specs — the existing 70 must pass unmodified.

All user-facing copy is written for kids and first-time devs. Ritual per stage: branch
harbor-2<stage>; vitest + node tests + Playwright + eslint + typecheck green (baseline in
the roadmap); commit (git commit -F <msgfile> on PS 5.1); push; merge to main; delete
branch. Phase exit: patch-notes entry (bump help.ts + shims.d.ts versions per AGENTS.md),
tag harbor-2. When H2 is done, print the H3 kickoff prompt from
docs/PROJECT_FOLDERS_ROADMAP.md verbatim as the last thing in your final message.
```

---

## Phase H3 — Project-scoped saving & playtest — **Opus 4.8 (Extra High)**

*Edits now land in the folder. localStorage demotes to crash recovery.*

### H3·A — Autosave rebind
- With a project open on desktop, the debounced `saveNow()` path writes
  `<root>/game.rpgatlas` via `project_save` (atomic + rolling backup), keeping the
  localStorage mirror for crash recovery. `#save-ind` semantics unchanged (`●`/`✓`/`⚠`).
  Ctrl+S = immediate flush. The old first-save Save-As dialog disappears; **Export**
  keeps the dialog and keeps `embedUsedAssets` (a shareable single-file copy).
- Folder saves are **blob-free** — assets live in the project folder (H4 completes this;
  until then the embedded-asset import path still works).

### H3·B — External changes & recovery
- On window focus, compare `game.rpgatlas` mtime; if it changed outside the editor, offer
  a friendly reload-or-keep-mine choice. On boot, if the localStorage mirror is *newer*
  than the file (crash evidence), offer recovery. Kill-process test in the spec.

### H3·C — Playtest bridge
- Keep the proven same-origin localStorage bridge: the editor autosaves to the mirror
  right before `open_playtest`; the playtest window stays reload-only (trap 2). Document
  that `saves/` slots stay in browser storage for 1.2.0 (folder slots = stretch).

**Exit criteria:** edit → quit → relaunch → open from folder: everything is there; crash
(killed process) recovers from the mirror; backups rotate at 5; Export still produces a
portable single file; gates green + patch note. Tag `harbor-3`.

**Kickoff prompt:**

```
You are Claude Opus 4.8 (Extra High) working on RPGAtlas at M:\AI\DriftwoodEngine\RPGAtlas.
Execute Phase H3 (Project-scoped saving & playtest) of docs/PROJECT_FOLDERS_ROADMAP.md —
read that file's H3 section, docs/harbor-1-spec.md, the cross-phase traps, and AGENTS.md.
Create docs/harbor-3-spec.md and append a stage log per stage.

Stages, in order: H3·A rebind desktop autosave to <root>/game.rpgatlas via project_save
(atomic, rolling backup, localStorage stays as crash-recovery mirror; #save-ind semantics
unchanged — it is still revealed LAST in boot and is the e2e gate; Export keeps the dialog
+ embedUsedAssets); H3·B external-change detection on focus + crash recovery from a newer
mirror, with a kill-process test; H3·C playtest bridge stays the same-origin localStorage
reload (never touch the predefined-playtest-window pattern — building windows from
commands deadlocks).

Persistence cores stay pure/unit-testable where possible (vitest is env=node). Ritual per
stage: branch harbor-3<stage>; all gates green (baseline in the roadmap); commit
(git commit -F <msgfile>); push; merge to main; delete branch. Phase exit: patch-notes
entry + version bumps per AGENTS.md, tag harbor-3. When H3 is done, print the H4 kickoff
prompt from docs/PROJECT_FOLDERS_ROADMAP.md verbatim as the last thing in your final
message.
```

---

## Phase H4 — Copy-paste assets: drop folders & auto-discovery — **Opus 4.8 (Extra High)**

*The headline feature: paste a PNG into `assets/tilesets`, alt-tab back, it's in the editor.*

### H4·A — Per-project library
- Rescope the desktop `AssetStore` from `<app-data>/library` to the open project:
  `assets/` files referenced **in place** (relPath + hash in `.atlas/library.json`),
  derived/sliced data in `.atlas/cache/`. Imports through the editor (wizard, embedded
  assets in a shared .json, RM import) write the files into the right `assets/` subfolder.
- Legacy bridge: opening a project that references global-library assets copies those
  blobs into the project's `assets/` (one-time, reported in plain language).

### H4·B — Auto-discovery
- Scan `assets/` on project open, on window focus, and via the Asset Browser's Scan
  button. New files route through the import wizard pipeline **with the slicer
  safeguards** (48px default, oversliced warnings, batched index writes — see trap 5).
  Changed files (new hash) re-import keeping tags/meta; deleted files become a
  plain-language "missing" state (asset entries survive; nothing crashes; re-adding the
  file heals it). No filesystem watcher in 1.2.0 — focus-scan is the contract.

### H4·C — Asset Browser integration
- "Open Project Folder" button (`project_reveal`); per-type folder hints in empty states;
  the per-project `assets/` README written at scaffold time (H2 template) and re-created
  if missing. Rename/retag edits touch only the index, never the user's file.

**Exit criteria:** with the editor open, copy a sprite sheet into `assets/characters` →
focus the editor → it appears (wizard or auto, per spec); tileset overslice guards hold;
project folder is fully self-contained (zip it, move it, open it elsewhere — everything
loads); gates green + patch note. Tag `harbor-4`.

**Kickoff prompt:**

```
You are Claude Opus 4.8 (Extra High) working on RPGAtlas at M:\AI\DriftwoodEngine\RPGAtlas.
Execute Phase H4 (per-project assets: drop folders & auto-discovery) of
docs/PROJECT_FOLDERS_ROADMAP.md — read that file's H4 section, docs/harbor-1-spec.md,
the cross-phase traps (especially trap 5, the oversliced-library incident), and AGENTS.md.
Create docs/harbor-4-spec.md and append a stage log per stage.

Stages, in order: H4·A rescope the desktop AssetStore to the open project (in-place
assets/ references by relPath+hash in .atlas/library.json, derived data in .atlas/cache/,
editor imports write into assets/, one-time legacy copy from the global app-data library);
H4·B auto-discovery — scan assets/ on open, on window focus, and via the Scan button,
routing new files through the import wizard with slicer safeguards intact (48px default,
overslice warnings, batched writes), changed-hash re-import keeps meta, missing files
degrade to a friendly "missing" state; H4·C Asset Browser integration (Open Project
Folder, per-type hints, README regeneration, index-only renames).

A project folder must end the phase fully self-contained (zip → move → reopen works).
Files the user put in assets/ are NEVER moved or deleted by the engine. Ritual per stage:
branch harbor-4<stage>; all gates green; commit (git commit -F <msgfile>); push; merge to
main; delete branch. Phase exit: patch-notes entry + version bumps, tag harbor-4. When H4
is done, print the H5 kickoff prompt from docs/PROJECT_FOLDERS_ROADMAP.md verbatim as the
last thing in your final message.
```

---

## Phase H5 — Launch from the project folder — **Opus 4.8 (High)**

*Double-click your game to open it.*

### H5·A — CLI / argv
- `RPGAtlas-Desktop.exe <path>` (folder or `game.rpgatlas`) boots straight into that
  project, skipping the manager; an unreadable path falls back to the manager with a
  friendly note.

### H5·B — Single instance
- `tauri-plugin-single-instance`: a second launch focuses the running app and asks it to
  open the requested project (respecting unsaved-work guard). No orphan windows.

### H5·C — File association
- `.rpgatlas` association via the bundler/installer config (icon included); README/docs
  cover the portable-exe "Open with…" path on Windows. Double-click = H5·A flow.

**Exit criteria:** double-clicking `game.rpgatlas` opens the engine into that game (fresh
launch and already-running both behave); `Create Desktop Shortcut.cmd`-style affordances
still work; gates green + patch note. Tag `harbor-5`.

**Kickoff prompt:**

```
You are Claude Opus 4.8 (High) working on RPGAtlas at M:\AI\DriftwoodEngine\RPGAtlas.
Execute Phase H5 (launch from the project folder) of docs/PROJECT_FOLDERS_ROADMAP.md —
read that file's H5 section, the cross-phase traps, and AGENTS.md. Create
docs/harbor-5-spec.md and append a stage log per stage.

Stages, in order: H5·A argv handling — exe invoked with a folder or game.rpgatlas path
boots straight into that project (bad path → manager + friendly note); H5·B
tauri-plugin-single-instance — second launch focuses the running app and opens the
requested project, guarding unsaved work; H5·C .rpgatlas file association via the
bundler/installer config + docs for the portable-exe "Open with…" path.

Never create webview windows from commands (predefined-window pattern only). Ritual per
stage: branch harbor-5<stage>; all gates green; commit (git commit -F <msgfile>); push;
merge to main; delete branch. Phase exit: patch-notes entry + version bumps, tag harbor-5.
When H5 is done, print the H6 kickoff prompt from docs/PROJECT_FOLDERS_ROADMAP.md verbatim
as the last thing in your final message.
```

---

## Phase H6 — Migration, docs & release — **Opus 4.8 (High)**, release gate by **Fable 5**

### H6·A — Legacy migration
- Desktop boot with a localStorage project and no folder → "Let's put your game in a
  folder" one-click wizard (name prefilled from the project title, used global-library
  assets copied in). The old path never strands anyone.

### H6·B — Docs & story
- Wiki pages ("Your game is a folder", "Adding your own art and music") + rerun
  `scripts/build-docs-site.mjs`; README; the browser build's File menu gets a gentle
  "project folders live in the desktop app" note. Retire the global app-data inbox from
  the docs (code stays for migration).

### H6·C — Release
- Full regression sweep (all gates + the new Harbor specs); **re-run
  `npm run package:exe`** (RPGAtlas-Desktop.exe embeds the editor — trap 6) and commit the
  rebuilt binary; version bump to **1.2.0** across all version sites per AGENTS.md;
  patch notes. **Fable gate:** a fresh Fable 5 conversation audits phase exits vs this
  roadmap and signs the release (verdict in this file's header). Tag `harbor-6` + `v1.2.0`.

**Exit criteria:** a brand-new user's first minute is: launch → "New Project" → name it →
editor opens → paste a sprite into the folder → it appears. Release signed and tagged.

**Kickoff prompt:**

```
You are Claude Opus 4.8 (High) working on RPGAtlas at M:\AI\DriftwoodEngine\RPGAtlas.
Execute Phase H6 (migration, docs & release) of docs/PROJECT_FOLDERS_ROADMAP.md — read
that file's H6 section, all harbor-N spec stage logs, the cross-phase traps, and
AGENTS.md. Create docs/harbor-6-spec.md and append a stage log per stage.

Stages, in order: H6·A legacy migration wizard (localStorage project + no folder →
one-click "put your game in a folder", copying used global-library assets); H6·B docs
(wiki pages + rerun scripts/build-docs-site.mjs, README, browser-build File-menu note,
retire the app-data inbox from docs); H6·C release — full gate sweep, re-run
npm run package:exe and commit the rebuilt RPGAtlas-Desktop.exe (it embeds the editor and
goes stale otherwise; kill any running instance before git ops touch it), bump version to
1.2.0 in every version site per AGENTS.md, patch notes, then STOP and tell the user to run
the Fable 5 release gate in a fresh conversation. After the signed verdict lands in the
roadmap header, tag harbor-6 and v1.2.0 and push tags.

Ritual per stage: branch harbor-6<stage>; all gates green; commit (git commit -F
<msgfile>); push; merge to main; delete branch. Your final message ends with a short
release summary — there is no next phase.
```

---

## Cross-phase traps (learned the hard way — every conversation reads these)

1. **The e2e boot gate:** `#save-ind` ships hidden in index.html and `boot.ts` reveals it
   LAST (just before `RPGATLAS_BOOT_MS`). Its visibility means "editor interactive" — the
   Project Manager must not reveal it, and it must never get static text again (the old
   static "✓ saved" swallowed a Ctrl+P and flaked 24 gates).
2. **Playtest / windows:** never `WebviewWindowBuilder` from a `#[tauri::command]` — it
   deadlocks the main thread (white window + frozen editor). Windows are predefined in
   `tauri.conf.json`; `open_playtest` is reload+show+focus; close = hide. The Project
   Manager is a screen inside `main`, not a window.
3. **vitest is env=node:** pure logic (sanitizers, recents, index diffing, scan planning)
   lives in `src/shared` with no `window`/DOM imports; nothing in interpreter/engine paths
   may import `audio-deck.ts`.
4. **Playwright drives the BROWSER build:** desktop behavior hides behind `isTauri`; e2e
   coverage of desktop flows goes through the H2·D fake-host hook, additively. The
   existing 70 specs run unmodified, baseline 0 failures, frozen map 1 untouched.
5. **The oversliced-library incident (2026-07-06):** a 16px slicer default once produced a
   7.7k-tile library that crashed every boot (transaction flood + O(n²) + 32,767px canvas
   cap). Auto-import must keep 48px defaults, overslice warnings, batched writes, and
   count guards.
6. **RPGAtlas-Desktop.exe embeds the editor at build time** — it goes stale on any
   frontend change; re-run `npm run package:exe` before release commits, and kill running
   instances before git ops that touch the exe (file lock aborts merges).
7. **Windows/PS 5.1:** `git commit -m` mangles embedded quotes — use `-F <msgfile>`;
   don't round-trip UTF-8 docs through `Get-Content`/`Set-Content` (double-encodes) — use
   Write/Edit or bash. Cargo lives at `C:\Users\Zatara\.cargo\bin` (not on system PATH).
8. **Version sites:** the version string lives in ~7 places (package.json, tauri.conf.json,
   help.ts, shims.d.ts cache-busters, patch notes, README, docs-site) — see AGENTS.md;
   bump together in H6.
9. **Path safety:** every Rust command canonicalizes and contains paths inside the project
   root; IPC strings are never path components without validation.
10. **gh CLI is not installed** — use WebFetch for anything GitHub.
