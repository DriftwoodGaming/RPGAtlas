# Harbor H6 — Migration, docs & release (spec)

**Phase:** H6 of Project Harbor (`docs/PROJECT_FOLDERS_ROADMAP.md`) — the final phase.
**Author:** Claude Opus 4.8 (High), 2026-07-09
**Release gate:** Claude Fable 5 (a fresh conversation, after H6·C).
**Builds on:** the signed on-disk contract + native plumbing (`docs/harbor-1-spec.md`,
`harbor-1`), the desktop Project Manager launcher (`docs/harbor-2-spec.md`, `harbor-2`),
project-scoped saving (`docs/harbor-3-spec.md`, `harbor-3`), per-project assets
(`docs/harbor-4-spec.md`, `harbor-4`), and launch-from-the-folder (`docs/harbor-5-spec.md`,
`harbor-5`). H6 is the *finish*: the workflow works end-to-end (create/open a game folder,
paste assets in, save into the folder, double-click to launch); H6 makes sure no existing
user is stranded, writes the story down, rebuilds the desktop exe against the shipped
frontend, and cuts **RPGAtlas 1.2.0**.

**Non-negotiables carried from H1–H5 / the roadmap:**
- **Desktop-first, browser-safe (trap 4).** Everything H6·A adds is gated behind
  `managerActive()` (desktop `isTauri` **or** the H2·D `?fakehost` hook). The pure browser
  build is byte-identical: it never mounts the manager, so it never offers migration; the
  70 original Playwright specs pass **unmodified**. Desktop flows are e2e-covered through
  the `?fakehost` host, additively.
- **The e2e boot gate (trap 1).** `#save-ind` ships hidden and is revealed **last** by
  `boot()`. The migration wizard is a Project Manager screen — it never touches `#save-ind`;
  the gate opens only once the child commits and the editor boots on the new folder game.
- **No new webview windows (trap 2).** H6 adds no windows; the migration wizard renders
  inside `main`, exactly like the New/Open flows.
- **vitest is env=node (trap 3).** The migration decision is a pure core in `src/shared`
  (`folder-migration.ts`) with no `window`/DOM/schema import (the `isProjectLike` predicate
  is injected); the wizard UI + localStorage reads live in the editor.
- **The exe embeds the frontend (trap 6).** H1–H5 shipped **no exe** — the whole workflow
  is drivable in the browser through `?fakehost`. H6·C rebuilds `RPGAtlas-Desktop.exe`
  (`npm run package:exe`) against the final frontend and commits it (killing any running
  instance first so the file lock doesn't abort git ops).
- **Files stay where users put them (locked decision 6).** Migration COPIES the used
  global-library assets into the new folder (the existing H4 bridge); it never moves or
  deletes the source. The global app-data library and its import inbox keep their code for
  migration; H6·B retires them from the *docs*.
- **Version lives in ~7 sites (trap 8).** `package.json`, `package-lock.json` (root),
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the
  `rpgatlas` crate), the README badge, and `help.ts`'s About box — all move to **1.2.0** at
  H6·C, together with the `patch-notes.js?v=` / `editor.css?v=` cache-busters
  (`help.ts` + `shims.d.ts`, index.html). **FORMAT_VERSION stays 2**; the plugin API stays
  frozen for 1.x.

---

## 0. What H6 delivers (and does not)

**Delivers (per stage):**
- **H6·A — Legacy migration.** A desktop user who had a game before Project Harbor (it
  lives only in the localStorage mirror, with no folder) is greeted on launch by a one-click
  "let's put your game in a folder" wizard: the name is prefilled from the game's title, and
  committing scaffolds a real folder from the stored document and copies the game's used
  global-library pictures/sounds into it (the H4 bridge). The old path never strands anyone.
- **H6·B — Docs & story.** Wiki pages ("Your game is a folder", "Adding your own art and
  music"), a docs-site rebuild, a README pass, a gentle browser-build File-menu note that
  project folders live in the desktop app, and retiring the global app-data import inbox
  from the docs (the code stays for migration).
- **H6·C — Release.** A full regression sweep (all gates + the Harbor specs), a rebuilt
  `RPGAtlas-Desktop.exe`, the version bump to **1.2.0** across every site, and a patch note.
  Then **STOP** for the Fable 5 release gate; after the signed verdict lands in the roadmap
  header, tag `harbor-6` + `v1.2.0` and push the tags.

**Does NOT (out of scope, by design):**
- **No filesystem watcher, no auto-migration.** Migration is always the child's explicit,
  one-click choice (with a "Not now" escape hatch); nothing is moved behind their back.
- **No removal of the global app-data library / inbox code.** It survives to power
  migration; only the *docs* stop pointing new users at it.
- **No installer / signing work.** As at H5, the portable exe ships; `fileAssociations` is
  configured and documented.

---

## 1. H6·A — Legacy migration

### 1.1 The signal

Before Project Harbor, a desktop game lived only in the localStorage mirror
(`rpgatlas_project`) — there was no folder on disk. After Harbor the desktop app boots to
the Project Manager (H2), so that old game is now *behind* the launcher, reachable only
through migration. We must detect it precisely and never nag a game that already has a
folder.

The discriminator is the mirror **bookkeeping** (`atlas.mirror.meta`, H3): a folder game
always writes meta on save; a pre-Harbor localStorage-only game has a mirror but **no
meta**. So the legacy signal is exactly:

> `peekMirror()` is a recognizable project document **AND** `peekMirrorMeta()` is null.

Once the child migrates and the editor boots on the new folder, the first save writes meta
for the new root — so the signal clears and the offer is **self-extinguishing**
(idempotent). The mirror itself is left in place; it simply becomes the new folder game's
crash-recovery copy (H3).

### 1.2 The pure core

`src/shared/folder-migration.ts` (env=node, vitest — trap 3):
- `planFolderMigration(mirror, hasMeta, isProjectLike) → { title, documentJson } | null` —
  null when there is no mirror, when meta is present (already a folder game), or when the
  mirror isn't a recognizable project (cleared / junk storage). `isProjectLike` is injected
  so the core has no schema/DOM dependency.
- `migrationTitle(doc)` — the prefilled game name (`system.title`, trimmed, friendly
  fallback `"My Game"`).

### 1.3 The wizard

`src/editor/project-manager/manager.ts`:
- `launchManager()` gains a fourth priority, after the in-session `pendingOpen` (1) and the
  H5 launch path (2) and before the plain launcher (4): **(3) if `currentMigrationPlan()`
  is non-null, `showMigration(plan)`** — the returning pre-Harbor user meets the wizard
  first, not an empty launcher.
- `renderMigrateForm` — a New-Project-shaped screen minus the template chooser: a friendly
  intro, the name prefilled from the game's title (with the live folder-safe preview), a
  parent-directory picker, **Put my game in a folder** (primary), and **Not now**. Commit →
  `migrateToFolder` → `host.create(parentDir, leaf, plan.documentJson)` → the shared
  `bootChosen` pipeline. Because a folder game boots, `bootWithProject`'s existing H4 legacy
  bridge (`migrateGlobalLibraryAssets`) copies the game's used global-library assets into
  the new folder and the "We tidied up your game" notice fires — migration is self-contained
  for free.
- `renderLanding` shows a **`.pm-migrate` banner** whenever the signal persists, so **Not
  now** is never a dead end — the offer stays one click away.
- `mountManagerCard()` factored out of `showProjectManager` so `showMigration` shares the
  overlay/toast scaffolding.

### 1.4 e2e (browser, `?fakehost`)

Additive specs in `tests-e2e/project-manager.spec.mjs` ("Legacy → folder migration
(H6·A)"): seed `rpgatlas_project` **without** `atlas.mirror.meta` → the wizard greets on
launch with the title prefilled; committing scaffolds `/Games/<Name>`, copies a seeded
global-library asset into the folder index, fires the tidy-up notice, and boots (title +
`#save-ind`); **Not now** drops to the launcher with the banner (which re-opens the wizard);
a mirror **with** meta is never offered migration. The pure browser build (no `?fakehost`)
never mounts the manager, so the 70 originals are untouched.

---

## Stage log

### H6·A — Legacy migration — 2026-07-09

**Shipped:** a returning pre-Harbor desktop user is met by a one-click "put your game in a
folder" wizard instead of an empty launcher; the old localStorage-only game becomes a real,
self-contained folder game.

- **Pure core `src/shared/folder-migration.ts` (new, vitest):** `planFolderMigration(mirror,
  hasMeta, isProjectLike)` — the legacy signal is "mirror is a project **and** no folder
  meta"; returns `{ title, documentJson }` (document passed through verbatim) or null. Meta
  present → null (already a folder game); no mirror / junk / non-project → null.
  `migrationTitle(doc)` derives the prefilled name from `system.title` (trimmed; fallback
  `"My Game"`). No `window`/DOM/schema import — `isProjectLike` is injected. Covered by
  `tests-unit/folder-migration.test.ts` (9 cases: every null guard, the offer case,
  title trim/fallback).
- **`manager.ts`:** `launchManager()` priority is now (1) in-session `pendingOpen` → (2) H5
  launch path → **(3) H6·A migration (`showMigration`)** → (4) launcher.
  `currentMigrationPlan()` reads `peekMirror()`/`peekMirrorMeta()` (already imported from
  persistence) through the pure core. `renderMigrateForm` (intro + prefilled name + folder
  picker + **Put my game in a folder** / **Not now**) → `migrateToFolder` →
  `host.create(parentDir, leaf, plan.documentJson)` → `bootChosen`. The **used
  global-library assets are copied for free** by `bootWithProject`'s existing H4 bridge
  (`migrateGlobalLibraryAssets`) since a folder game boots — no new asset code. `renderLanding`
  shows a `.pm-migrate` banner while the signal persists (so **Not now** isn't a dead end).
  `mountManagerCard()` factored out of `showProjectManager`, shared with `showMigration`.
- **CSS (`css/editor.css`):** `.pm-intro` (wizard blurb) + `.pm-migrate*` (landing banner) —
  additive; the `editor.css?v=` cache-buster bump is bundled at H6·C with the version bump
  (as H4 did — the browser never mounts the manager, so the styles are inert there and the
  desktop exe rebuilds at H6·C).
- **e2e (`tests-e2e/project-manager.spec.mjs`, additive):** 4 new specs (wizard greets +
  name prefilled; commit scaffolds the folder + copies the global asset + fires the tidy-up
  notice + boots; **Not now** → launcher + banner → re-open; a folder-game mirror with meta
  is never offered). `#save-ind` stays hidden until the editor boots in every pre-commit
  case (the gate holds, trap 1).
- **No recovery-prompt regression:** `decideRecovery` returns `use-folder` when
  `mirrorMeta == null` (the legacy case), and the folder is created *from* the mirror, so
  migration never trips a spurious "bring your changes back?" prompt.
- **Gates:** vitest **977** (968 + 9) · node **19** · Playwright **107/107** (103 + 4) ·
  eslint **0** · typecheck **clean**. No patch note / version / cache-buster bump yet — H6·C
  bundles the H6 note + the 1.2.0 bump. `patch-notes.js?v=65`, `editor.css?v=61`,
  `data.js?v=31`, FORMAT_VERSION 2, version 1.1.0 — unchanged this stage.
- Git ritual: branch `harbor-6a` → gates green → commit → merge to `main` → delete branch.
  **Next: H6·B (docs & story).**
