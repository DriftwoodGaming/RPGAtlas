# Harbor H4 — Per-project assets: drop folders & auto-discovery (spec)

**Phase:** H4 of Project Harbor (`docs/PROJECT_FOLDERS_ROADMAP.md`)
**Author:** Claude Opus 4.8 (Extra High), 2026-07-09
**Builds on:** the signed on-disk contract + native plumbing (`docs/harbor-1-spec.md`,
tagged `harbor-1`), the desktop Project Manager launcher (`docs/harbor-2-spec.md`,
tagged `harbor-2`), and project-scoped saving (`docs/harbor-3-spec.md`, tagged
`harbor-3`). H4 is the headline feature: **paste a PNG into `assets/tilesets`,
alt-tab back to the editor, and it's there.** The desktop asset library stops living
in the global `<app-data>/library` and moves *into the open project's folder* — files
referenced **in place**, so the whole game (art, audio, and all) is one self-contained
folder you can zip, move, and reopen anywhere.

**Non-negotiables carried from H1–H3 / the roadmap:**
- **Files stay where the child put them.** Per-project `assets/` files are referenced
  **in place** (relPath + content hash in `.atlas/library.json`). A scan, a rename, a
  retag, or a delete **never moves or deletes** a file the user dropped in `assets/`
  (contract §7). Only engine-managed data (`.atlas/cache/` sliced tiles, thumbnails)
  is ever written or pruned by the engine.
- **FORMAT_VERSION stays 2.** The folder document is still today's blob-free project
  JSON; the per-project asset library is metadata *around* it (`.atlas/library.json`),
  never a schema break. `assets.external` embedding still works for shared single-file
  `.json` exports (Export) and RM import intake.
- **The oversliced-library incident (trap 5).** Auto-import keeps the 48px slicer
  default, the overslice warning (>1024 tiles from one sheet), batched index writes,
  and the pooled per-key blob read at boot. A scan reads **source** files only (a few
  per project), never the thousands of derived tiles — those live pre-sliced in
  `.atlas/cache/` and are never re-read by a scan.
- **The e2e boot gate (trap 1).** `#save-ind` is still revealed **last** by `boot()`;
  H4 never touches it. Auto-discovery + import run *after* boot.
- **Desktop-first, browser-safe.** The per-project store is chosen only when a folder
  game is open (`openFolderRoot() != null`, bound by the Project Manager under desktop
  **or** the H2·D `?fakehost` hook). The **pure browser build is byte-identical**: it
  keeps the IndexedDB library and the drag-drop / file-picker flow, and the existing 70
  Playwright specs pass **unmodified**.
- **No filesystem watcher in 1.2.0.** Auto-discovery is scan-on-open + scan-on-focus +
  the Scan button. Focus-scan is the contract (roadmap H4·B).
- **No new webview windows (trap 2), vitest env=node (trap 3), Playwright = browser
  (trap 4).** Pure scan/plan logic lives in `src/shared` with no window/DOM; desktop
  flows are e2e-covered through the `?fakehost` host, additively.

**Rust:** H4 adds a new native module (`src-tauri/src/project_assets.rs`) with the
project-scoped asset filesystem commands the app-data `library_*` commands can't
provide (they are hardwired to `<app-data>/library`). Every command flows through the
H1 `project_paths` guard (canonicalize + `contained_join`), so **no new Tauri
capability** is required (`std::fs` like `library_*`). The commands are cargo-tested;
the desktop exe embeds the frontend and is rebuilt at H6 (trap 6) — the whole phase is
drivable in the browser build through the `?fakehost` host, so every flow is
e2e-covered without the desktop app.

---

## 0. What H4 delivers (and does not)

**Delivers (per stage):**
- **H4·A — Per-project library.** The desktop `AssetStore` is rescoped from
  `<app-data>/library` to the open project: `assets/` files referenced **in place**
  (relPath + hash in `.atlas/library.json`), derived/sliced blobs in `.atlas/cache/`.
  Editor imports (the Asset Browser picker/drag-drop, embedded assets in a shared
  `.json`, RM import) write files into the right `assets/` subfolder. One-time legacy
  bridge: opening a project whose document references global app-data library assets
  copies those blobs into the project's `assets/` (reported in plain language).
- **H4·B — Auto-discovery.** Scan `assets/` on project open, on window focus, and via
  the Asset Browser's **Scan** button. New files route through the import wizard **with
  the slicer safeguards intact** (48px default, overslice warning, batched writes).
  A changed file (new hash at a known relPath) re-imports keeping tags/meta. A file
  that vanished from `assets/` becomes a plain-language **"missing"** state — the entry
  survives, nothing crashes, and putting the file back heals it.
- **H4·C — Asset Browser integration.** An **Open Project Folder** button
  (`project_reveal`), per-type folder hints in the empty state, the per-project
  `assets/` README re-created if the child deleted it, and rename/retag edits that
  touch only the index (never the user's file). A project folder is now fully
  self-contained: **zip it, move it, reopen it — every picture and sound loads.**

**Does NOT deliver (later phases):**
- No argv / single-instance / file association (**H5**).
- No legacy-localStorage migration wizard, no docs, no version bump to 1.2.0, no exe
  rebuild (**H6** — the exe rebuild that ships the desktop half is H6·C, trap 6).

---

## 1. On-disk asset model (final for H4)

The project folder from H1 already scaffolds the tree; H4 populates it:

```
MyGame/
├─ game.rpgatlas            ← the blob-free project document (unchanged)
├─ assets/                  ← the user's files, IN PLACE (never moved/deleted)
│  ├─ characters/  facesets/  enemies/  tilesets/  audio/
│  └─ READ ME — how to add assets.txt
└─ .atlas/
   ├─ library.json          ← the asset index (populated by H4) — array of entries
   ├─ cache/                ← derived blobs: sliced 48px tiles, keyed <hash>
   └─ backup/               ← rolling game.rpgatlas backups (H1)
```

### 1.1 The index — `.atlas/library.json`

A JSON **array** of `AssetMeta` (the same shape `src/shared/services.ts` defines, so
every downstream consumer — the Asset Browser, the used-asset audit, reference
rewriting, export embedding — is untouched), with two H4 additions:

- **`relPath?: string`** — the file's path relative to the project root
  (`assets/<type>/<file>`) when the asset **is** an in-place file. Its bytes live at
  `<root>/<relPath>`.
- **`mtimeMs?: number`** — the source file's last-modified time at import, so a
  focus-scan can skip an unchanged file without reading or hashing it.

Two kinds of entry:
- **In-place asset** (`relPath` set): a whole file the child dropped, or an editor
  whole-file import (simple charset, faceset, enemy, audio, un-sliced tile, flipbook
  sheet). Its blob is the file at `<root>/<relPath>`.
- **Derived asset** (`relPath` unset): a **sliced 48px tile**. Its blob lives at
  `<root>/.atlas/cache/<hash>` (content-addressed, safe to delete/regenerate). It
  carries `meta.meta.sourceRel` / `sourceHash` / `sourceBytes` / `sourceMtime` naming
  the `assets/tilesets/<sheet>.png` it was cut from, so a re-scan knows the sheet is
  already processed and never re-slices it.

`relPath`/`mtimeMs` are **not** carried into `assets.external` export entries
(`embedUsedAssets` copies only `type/name/src/kind/meta/tags`), so a shared `.json`
stays portable and re-lands cleanly on any device.

### 1.2 Identity & the never-purge rule (contract §7)

Identity = **relPath + content hash** (SHA-256, the existing frontend hash). Same-hash
re-add is a no-op; a changed hash re-imports keeping tags/slicer meta/name (relPath is
the stable identity, hash tracks content); a missing file → the `MISSING_ASSET` state,
never a crash, **never an index purge**. That is why `library.json` is kept, not treated
as pure cache: it carries tags/slicer payloads not present in the raw files.

---

## 2. The per-project AssetStore (H4·A)

A new `ProjectAssetStore` implements the existing `AssetStore` interface
(`list/get/getAllBlobs?/put/remove/setMeta`) over a small **`ProjectAssetHost`** — the
same real-vs-fake split H3 used for `save`. So `src/shared/asset-library.ts` is
**unchanged in shape**; only its store implementation differs when a folder game is
open.

`ProjectAssetHost` (added to `ManagerHost`, so `activeManagerHost()` provides it):

| method | behavior |
|---|---|
| `assetIndexRead(root)` | read `.atlas/library.json` → JSON string (`[]` if absent/corrupt) |
| `assetIndexWrite(root, json)` | atomic write `.atlas/library.json` |
| `assetRead(root, relPath, hash)` | read `<root>/<relPath>` if `relPath` set, else `.atlas/cache/<hash>` → `{ data(base64), mime } | null` |
| `assetWriteInPlace(root, type, fileName, base64)` | write into `assets/<type>/<fileName>` (collision-suffixed), return the **actual relPath used** |
| `assetWriteCache(root, hash, base64)` | write `.atlas/cache/<hash>` |
| `assetDeleteCache(root, hash)` | delete `.atlas/cache/<hash>` (best-effort) |
| `assetsScan(root)` | list `{ type, relPath, size, mtimeMs }` for every file under each `assets/<type>/` (cheap — no bytes) |

`ProjectAssetStore`:
- **`list()`** → `assetIndexRead` → `AssetMeta[]`.
- **`get(key)`** → find the meta; `assetRead(root, meta.relPath, meta.hash)` → Blob.
- **`put(meta, blob)`** → **derived slice** (`meta.meta.cellPos` present) → `assetWriteCache(hash)`
  and persist the entry with no `relPath`. **Whole file** → `assetWriteInPlace(type,
  <name>+<ext>)`, store the returned relPath on the entry. Either way, upsert the entry
  into the in-memory index and `assetIndexWrite` once (asset-library already batches a
  sliced sheet into one `importAssets` call, but `put` is per-asset; see §2.1).
- **`remove(key)`** → drop the index entry, `assetIndexWrite`. If the removed entry was
  a **cache** blob whose hash is no longer referenced → `assetDeleteCache`. **An
  in-place `assets/` file is never deleted** (contract §7) — the child owns it.
- **`setMeta(meta)`** → upsert the entry (index-only; tags/kind/name/relPath), write.

The store keeps an in-memory copy of the index and writes it after each mutation — but
to avoid an index write per sliced tile (thousands), it exposes a **batch** the library
uses (§2.1).

### 2.1 Batched index writes (trap 5)

A sliced tileset import calls `store.put` once per tile. Writing `library.json` after
each of 200 tiles is the same O(n²) flood trap 5 warns about. So `ProjectAssetStore`
implements an optional **`putMany(entries)`** fast path (a sibling of the existing
`getAllBlobs?` optional): asset-library's `importAssets` collects the batch and calls
`putMany` once — all blobs written, one index write. When absent (IDB browser store)
the per-item `put` path is used, exactly as today. Concretely: asset-library gains a
tiny "if `store.putMany` exists, buffer the batch and flush once" branch that is inert
for the browser store.

### 2.2 Choosing the store (boot wiring)

`boot.ts` (`bootWithProject`) currently does
`initAssetLibrary(await createDefaultAssetStore())`. H4:

```
const folderRoot = openFolderRoot();            // set by bindFolderProject before boot
const store = folderRoot
  ? createProjectAssetStore(folderRoot)          // desktop OR ?fakehost: per-project
  : await createDefaultAssetStore();             // browser IDB (unchanged) / degrade
```

`createProjectAssetStore(root)` = `new ProjectAssetStore(root, activeManagerHost())`.
Because `openFolderRoot()` is null on the pure browser build, that path is
**byte-identical** to today. `openFolderRoot()` is bound in `bootChosen` before
`runBootWith`, so it is already set when boot runs.

### 2.3 Legacy bridge (one-time global-library copy)

On desktop, existing users have assets in `<app-data>/library`. When a project is
opened whose **document references** `asset:` keys that are present in the global
library but **absent from the project's `.atlas/library.json`**, copy those blobs into
the project (in place, via the store's normal write path) once, and report it in plain
language ("Brought N pictures/sounds into your game's folder"). Pure planning —
`planLegacyMigration(usedKeys, projectMetas, globalMetas)` → the keys to copy — lives in
`src/shared/asset-scan.ts` and is vitest-tested; the copy itself is a thin desktop-only
loop over the global `FsAssetStore` (constructed only for the migration, only when
`isTauri`). Under `?fakehost` the fake host exposes a **seedGlobalLibrary** control so
the bridge is e2e-drivable in the browser.

---

## 3. Auto-discovery (H4·B)

A pure planner `planScan(scanned, index)` (`src/shared/asset-scan.ts`, env=node) turns
a scan snapshot + the current index into a plan:

```
planScan(scanned: ScannedFile[], index: AssetMeta[]) -> {
  newFiles:     ScannedFile[],   // relPath the index has never seen  → wizard
  changedFiles: ScannedFile[],   // known relPath, size/mtime differ  → re-hash to confirm
  missing:      string[],        // index keys whose source file is gone → MISSING_ASSET
}
```

- **Known & unchanged** (size + mtime match the recorded `sourceBytes`/`sourceMtime`,
  or the in-place entry's `bytes`/`mtimeMs`) → skipped, no read, no hash.
- **Known & size-or-mtime differs** → *candidate changed*: the caller reads the file,
  hashes it, and if the hash truly differs re-imports it (keeping tags/meta); a matching
  hash just refreshes the recorded mtime.
- **New relPath** → read + route through `wizardImport` (slicer for tilesets, etc.).
- **A source relPath in the index but not in the scan** → its file is gone → the entry
  (and, for a sliced sheet, all its derived tiles) enter `MISSING_ASSET`; putting the
  file back on a later scan heals it. Never purged.

"Processed source" set = every `meta.relPath` ∪ every `meta.meta.sourceRel`, so a sliced
sheet's own `dungeon.png` is recognised as already-handled and never re-sliced.

The scan is invoked from: (a) the Asset Browser opening (already does this for the
app-data drop-folders — repointed at the project), (b) window focus (the H3·B focus
listener is editor-wide; H4·B adds an asset scan alongside the external-change check,
inert unless a folder game is open), and (c) the Scan button. All three funnel through
one `runProjectScan()` with a re-entrancy guard (the existing `scanning` flag pattern).

---

## 4. Asset Browser integration (H4·C)

- **Open Project Folder** — replaces the app-data "Open Folder" when a project is open;
  `activeManagerHost().reveal(root)` (→ `project_reveal`). The drop-banner copy points
  at the project's `assets/` subfolders, not the app-data inbox.
- **Per-type hints** — the empty state names the exact subfolder for the current type
  ("Drop walking-sprite PNGs into `assets/characters/` …").
- **README regeneration** — if the child deleted `assets/READ ME — how to add
  assets.txt`, a scan re-creates it (the H1 in-place README text).
- **Missing state** — a `MISSING_ASSET` asset renders with the H1 kid copy ("A picture
  or sound is missing" / "Put the file back in your assets folder…") and no broken
  thumbnail; it is not counted as deletable.
- **Index-only rename/retag** — renaming an asset changes its library `name`/`key`
  (and rewrites project references, as today) but leaves the on-disk file exactly where
  it is; the entry keeps its `relPath`. Retag/kind edits are already index-only.

---

## 5. Cross-phase trap acknowledgements (this phase)

- **Trap 1 (e2e boot gate):** `#save-ind` untouched; discovery/import run post-boot.
- **Trap 2 (windows):** no `WebviewWindowBuilder`; playtest unchanged.
- **Trap 3 (vitest env=node):** `asset-scan.ts` (scan plan, legacy-migration plan,
  relPath/ext helpers) is pure — no window/DOM/`audio-deck`.
- **Trap 4 (Playwright = browser):** the per-project store binds only behind
  `openFolderRoot()`; e2e drives it through the `?fakehost` host's new asset methods,
  additively; the 70 run unmodified.
- **Trap 5 (oversliced library):** 48px default + overslice warning kept in the wizard;
  a scan reads only source files (few), never derived tiles; `putMany` batches the index
  write; the boot read stays pooled per-key.
- **Trap 6 (exe embeds the editor):** new Rust ships but the desktop exe is rebuilt at
  H6·C; gates here are cargo test + the browser `?fakehost` e2e.
- **Trap 7 (PS 5.1):** commit with `git commit -F <msgfile>`; docs via Write/Edit.
- **Trap 8 (version sites):** phase exit bumps `js/patch-notes.js` (+ `help.ts` /
  `shims.d.ts` cache-buster) and `css/editor.css?v=` if new styles ship; product version
  stays 1.1.0 until H6. **Trap 9 (path safety):** every new command canonicalizes +
  `contained_join`s; IPC-supplied `type`/`fileName`/`relPath` are validated components.

---

## 6. Exit criteria (H4 phase)

- With the editor open, copy a sprite sheet into `assets/characters` → focus the editor
  → it appears (wizard or auto). Tileset overslice guards hold.
- The project folder is fully **self-contained**: zip it, move it, open it elsewhere —
  every picture and sound loads (in-place `assets/` + `.atlas/cache/` both travel).
- Files the child put in `assets/` are **never** moved or deleted by the engine.
- Browser build byte-identical; the existing 70 Playwright specs pass **unmodified**;
  new H4 specs (via `?fakehost`) green.
- Gates ≥ baseline: **vitest ≥ 952 · node 19 · Playwright 91/91 (+ new H4 specs) ·
  eslint 0 · typecheck clean · cargo test green.** Patch-notes entry added; `help.ts` +
  `shims.d.ts` bumped. Tag **`harbor-4`**.

---

## Stage log

### H4·A — Per-project library — 2026-07-09

- **Authored this spec** (`docs/harbor-4-spec.md`) from the roadmap H4 section.
- **New native module `src-tauri/src/project_assets.rs`** (7 commands, all through the H1
  `project_paths` guard — canonicalize + `contained_join`, so IPC `type`/`fileName`/
  `relPath` are validated components; no new capability): `project_asset_index_read`/
  `project_asset_index_write` (`.atlas/library.json`, atomic via `project::atomic_write`),
  `project_asset_read` (in-place `relPath` **or** cache `hash`; missing → `None`),
  `project_asset_write_inplace` (`assets/<type>/<file>`, collision-suffixed via
  `free_path`, returns the actual relPath; rejects unknown types + traversal),
  `project_asset_write_cache` / `project_asset_delete_cache` (`.atlas/cache/<hash>`), and
  `project_assets_scan` (cheap `{type, relPath, size, mtimeMs}` snapshot, no bytes). Made
  `mime_for_ext` / `IMAGE_EXTS` / `AUDIO_EXTS` / `blob_file_name` / `free_path` /
  `project::atomic_write` `pub(crate)` for reuse. Registered in `lib.rs`'s handler.
- **New per-project `AssetStore` `src/platform/project-asset-store.ts`** over a small
  `ProjectAssetHost` (the real-vs-fake split H3 used for `save`): whole files → in place
  under `assets/<type>/` with `relPath`; derived slices (`meta.meta.cellPos`) → cache;
  `get` reads either; **`remove` deletes a cache blob only when unreferenced and NEVER an
  in-place file** (contract §7); `putMany` writes the index once for a sliced batch (trap
  5); an asset whose `relPath` is preset is **adopted** without rewriting the file (rename
  re-key / H4·B auto-discovery).
- **Wiring:** `AssetMeta` gained `relPath?`/`mtimeMs?` and `AssetStore` gained optional
  `putMany?` (`services.ts`). `ImportItem` gained `relPath?`/`mtimeMs?` and `importAssets`
  now buffers into `putMany` when the store offers it (`asset-library.ts`). `boot.ts`
  selects `new ProjectAssetStore(openFolderRoot(), activeManagerHost())` when a folder game
  is open, else the unchanged `createDefaultAssetStore()` (browser IDB) — so the pure
  browser build is **byte-identical**. Typed façade (`project-host.ts`) + `ManagerHost`
  (`manager-host.ts`) gained the seven asset methods (real host → the new commands) plus
  optional `globalAssetList`/`globalAssetRead` (real host → the existing app-data
  `library_list`/`library_read` — no new Rust for the legacy read side).
- **Legacy bridge** (`legacy-assets.ts` + pure `planLegacyMigration` in
  `src/shared/asset-scan.ts`): opening a project whose document references global-library
  assets not yet in the project copies them into `assets/` (idempotent), then shows a
  kid-friendly "We tidied up your game" notice after boot (never before `#save-ind` — the
  gate). Gated on `folderRoot`, so the browser build never runs it.
- **Fake host (`test-host.ts`)** gained a per-root fake asset filesystem (files/cache/index
  keys) implementing all seven asset methods + `globalAssetList`/`globalAssetRead` over a
  seedable global library, plus test controls (`seedAssetFile`, `deleteAssetFile`,
  `readAssetIndex`, `seedGlobalLibrary`), so H4 is fully e2e-drivable in the browser. The
  H2/H3 manager specs now exercise the per-project store (empty index → no-op) unchanged.
- **New unit tests (11):** `asset-scan` (5 — the migration plan: used-and-not-present,
  idempotent, global-only, order+dedupe, malformed) and `project-asset-store` (6 — in-place
  write+read, derived→cache, adopt-without-rewrite, remove keeps the file but drops the
  entry, `putMany` writes the index once, missing→null). **New e2e (2, additive):** an
  Asset-Browser import lands under `assets/enemies/` referenced in place; the legacy bridge
  copies a used global asset in and shows the notice.
- **Gates:** vitest **963** (952 + 11) · node **19** · cargo **18** (12 + 6) · Playwright
  **93/93** (91 existing **unmodified** + 2 new) · eslint **0** · typecheck **clean**.
  Browser build byte-identical (`openFolderRoot()` null there); frozen map 1 untouched. No
  patch-notes entry yet (phase exit adds it); the desktop exe is rebuilt at H6·C (trap 6).
  Git ritual: branch `harbor-4a` → gates green → commit → merge to `main` → delete branch.
  **Next: H4·B** (auto-discovery — scan `assets/` on open/focus/Scan, changed-hash
  re-import, missing state).

### H4·B — Auto-discovery — 2026-07-09

- **New pure planner `planScan`** (`src/shared/asset-scan.ts`, env=node): diffs an
  `assets/` scan snapshot (`{type, relPath, size, mtimeMs}`) against the index into
  `{ newFiles, changedFiles, missing }`. A known file whose size **and** mtime match is
  skipped (no read, no hash — a focus-scan stays cheap); anything else is a candidate; an
  index source relPath the scan didn't see → its keys are missing. Reads a whole-file
  entry's `relPath`/`bytes`/`mtimeMs` and a sliced tile's `meta.sourceRel`/`sourceBytes`/
  `sourceMtime`, so all tiles of one sheet miss/change together.
- **New orchestrator `src/editor/tools/project-scan.ts`:** `runProjectScan()` reads
  `activeManagerHost().assetsScan`, runs `planScan`, and for new/changed files reads the
  bytes, hashes, and routes them through **the same import wizard** (48px slicer default,
  overslice warning, `putMany` batch — trap 5) with `{relPath, hash, bytes, mtimeMs}` so
  each is **adopted in place** (the child's file is never copied or moved). A changed
  whole-file re-adopts under the same name/key (references keep resolving, tags kept); a
  changed sheet re-cuts; a bare mtime touch is a no-op. Missing keys are recomputed each
  scan into a live set. `installProjectScanFocus()` adds the editor-wide focus/visibility
  scan (inert without a folder game); a re-entrancy guard makes a focus event mid-scan (or
  mid-slicer-prompt) a no-op.
- **`wizardImport` gained a `DiscoverOpts` param** (`import-wizard.ts`): a one-pass
  post-process stamps `relPath`/`mtimeMs` on whole-file items and `sourceRel`/`sourceHash`/
  `sourceBytes`/`sourceMtime` on sliced items — so a dropped sheet stays put in
  `assets/tilesets/` (its slices point back at it) and a re-scan never re-slices it. The
  picker/drag-drop path passes no opts and is unchanged.
- **boot** installs the focus scan and runs one scan on project open (files copied in while
  the game was closed appear immediately); both are folder-gated, so the browser build is
  untouched. **Asset Browser** (`asset-browser.ts`): the Scan button + banner now scan the
  project's own `assets/` when a folder game is open (the app-data inbox stays the legacy
  fallback); a `MISSING_ASSET` asset renders a friendly "missing" card (H1 copy, `⚠`
  thumb, `.ab-badge.missing`) instead of a broken thumbnail; the browser subscribes to
  `onProjectAssetsChanged` so a background focus-scan refreshes its grid. New `.ab-missing*`
  styles in `editor.css` (cache-buster bumped at the phase exit).
- **New unit tests (5):** `planScan` — new, unchanged-skip, changed-by-size/mtime, missing,
  and the sliced-sheet source-via-`meta.sourceRel` (present/gone/re-cut). **New e2e (2,
  additive):** a PNG pasted into `assets/enemies/` appears on window **focus** (the alt-tab
  flow), referenced in place; the **Scan button** pulls in a new faceset, and deleting the
  file then re-scanning degrades it to the friendly **missing** card.
- **Gates:** vitest **968** (963 + 5) · node **19** · cargo **18** (unchanged — no Rust) ·
  Playwright **95/95** (91 existing **unmodified** + 4 H4) · eslint **0** · typecheck
  **clean**. Browser build byte-identical; frozen map 1 untouched. No patch-notes entry yet.
  Git ritual: branch `harbor-4b` → gates green → commit → merge to `main` → delete branch.
  **Next: H4·C** (Asset Browser polish — Open Project Folder, per-type hints, README
  regeneration, index-only rename verification).

### H4·C — Asset Browser integration — 2026-07-09

- **README regeneration.** New Rust command `project_ensure_assets_readme(root)`
  (`project_assets.rs`) re-creates the in-place `assets/` README from the H1 scaffold text
  (`project::ASSETS_README`, now `pub(crate)`) only when it is missing — a child-edited
  README is never clobbered. cargo-tested (recreate-when-missing + never-clobber). Wired
  through `project-host.ts` → `ManagerHost.ensureAssetsReadme` (real host → the command;
  fake host → writes a placeholder into its fake FS). `boot.ts` calls it once on project
  open (folder-gated, best-effort).
- **Asset Browser (`asset-browser.ts`).** The folder-game banner now leads with an **Open
  Project Folder** button (`activeManagerHost().reveal(root)` → `project_reveal`) beside
  Scan; the empty state names the **exact subfolder** for the selected type ("drop files
  into `assets/tilesets/` (map-tile PNGs — big sheets open the 48px slicer)") via a new
  `folderHint()` helper.
- **Index-only rename — verified.** Renaming a project asset re-keys the index and rewrites
  the document's references (as always), but the on-disk file keeps its path: the store's
  `put` **adopts** the preset `relPath` (no rewrite) and `remove` never deletes an in-place
  file — so `renameAsset`'s put-new-then-remove-old re-keys the entry while the file stays
  exactly where the child put it. Proven end to end.
- **Fake-host fidelity.** The fake `assetsScan` now filters to files directly under
  `assets/<knownType>/` with a known image/audio extension (mirroring the native scan), so
  the README and stray top-level files are never mistaken for assets. Added `readAssetIndex`
  was already present; `ensureAssetsReadme` and the scan filter round out the fake FS.
- **New e2e (2, additive):** Open Project Folder is present and the per-type hint names
  `assets/tilesets/` (with the README re-created on open); **renaming** an asset re-keys the
  index (`asset:enemies/goblin` → `asset:enemies/orc`) while `relPath` and the on-disk file
  keep their original name. `.ab-missing*` styles from H4·B carried; no further CSS this
  stage (the cache-buster bump is the phase exit's job).
- **Gates:** vitest **968** · node **19** · cargo **19** (18 + 1) · Playwright **97/97**
  (91 existing **unmodified** + 6 H4) · eslint **0** · typecheck **clean**. Browser build
  byte-identical; frozen map 1 untouched. No patch-notes entry yet (phase exit). Git ritual:
  branch `harbor-4c` → gates green → commit → merge to `main` → delete branch. **Next: phase
  exit** (patch-notes entry + `help.ts`/`shims.d.ts` + `editor.css` cache-buster bump, tag
  `harbor-4`).

### H4 — phase exit — 2026-07-09

- **Patch note added** (`js/patch-notes.js`, prepended): "Your pictures and sounds live in
  your game's folder now" (kid-friendly; names the visible `assets/` drop folders, the
  copy-a-file-and-it-appears auto-discovery + Scan, the 48px slicer + dedupe safeguards,
  the never-move/never-delete promise, the friendly "missing" state, the zip→move→reopen
  self-containment + Open Project Folder, and the one-time tidy-up when opening an older
  desktop game; notes the web version is unchanged). Cache-buster bumped
  `patch-notes.js?v=63 → 64` in **both** `src/editor/help.ts` and `src/editor/shims.d.ts`;
  `css/editor.css?v=60 → 61` in `index.html` for the H4·B/C `.ab-missing*` + project-banner
  styles (per AGENTS.md / trap 8). Product **version stays 1.1.0** (bumps to 1.2.0 at H6);
  `data.js` stays `?v=31`; **FORMAT_VERSION stays 2**.
- **Determinism fix (found in the exit sweep).** Under full-suite CPU contention two
  project-assets specs flaked: a focus-driven scan could overlap a Scan-button scan and the
  module re-entrancy guard silently **dropped** the second request, so a post-delete scan
  never ran. `runProjectScan` now **coalesces** an overlapping request into one guaranteed
  re-run afterwards (the proven `saveToFolder` queue pattern) — a Scan/focus always reflects
  the newest folder state — and the README poll got a generous timeout. Verified stable over
  `--repeat-each=5 --workers=3` (30/30).
- **Final gate sweep:** vitest **968** · node **19** · cargo **19** · Playwright **97/97**
  (70 original browser specs **unmodified** + 21 manager (H2/H3) + 6 project-assets (H4)) ·
  eslint **0** · typecheck **clean** · patch-notes `?v=64` · `editor.css?v=61` ·
  `data.js?v=31`.
- **Self-contained check (the exit criterion), by construction:** a project's `assets/`
  files are referenced in place and its derived tiles live in `.atlas/cache/` — both inside
  the folder — so zipping/moving/reopening carries every picture and sound (the fake-host
  e2e round-trips the index + in-place files + cache through the same store). Files the
  child put in `assets/` are never moved or deleted by a scan, rename, or delete.
- Git ritual: branch `harbor-4exit` → gates green → commit → merge to `main` → delete
  branch. **Phase exit: tag `harbor-4`.** H4 delivers per-project assets — the desktop
  library lives inside the open game's folder (in-place `assets/` + `.atlas/`), files copied
  in are auto-discovered on open/focus/Scan with the slicer safeguards intact, missing files
  degrade friendly, and the folder is fully self-contained — all behind `openFolderRoot()`
  so the browser build is byte-identical. The desktop half ships at H6's exe rebuild (trap
  6). **H5 (launch from the project folder) is cleared.**
