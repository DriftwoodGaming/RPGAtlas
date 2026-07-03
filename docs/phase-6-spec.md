# Phase 6 Spec — Asset & Audio Pipeline

**Status:** IN PROGRESS (branch `phase-6-assets`, off `main` after the Phase 5
merge). Stage log will be prepended here, newest first, as stages land.

Stage D COMPLETE (2026-07-03): audio v2. **Mixer** (js/sfx.js): bgs + me
gains join master (me rides the bgm volume), `setBgsVolume`, `getBuses()`
hands the live context/buses to the deck, `playAt(name, pan, vol)`.
**Routing** (one seam): `Sfx.play`/`playAt` and `Music.play(name, fadeMs?)`
detect `asset:` references and delegate to `window.AtlasAudioDeck`
(registered by `src/shared/audio-deck.ts` — imported for side effect by both
boots); procedural behavior is byte-for-byte otherwise, and Music enforces
one BGM owner (chiptune timer OR deck, never both). **Deck**: two-slot BGM
crossfade (equal linear ramps on per-slot gains, default 800 ms), N looping
**BGS ambience layers** diffed per map (shared layers keep playing across
transfers), **ME** duck-to-20%-and-restore one-shots, **SE** decodeAudioData
LRU cache + BufferSource with optional StereoPanner + distance gain;
autoplay rejections retry on the next gesture; URLs resolve via the library
(object URLs) or RPGATLAS_ASSETS data URLs in exports; `deckState()` for
tests. Pure math split into window-free `audio-math.ts` (`ambienceDiff`,
`panGainForTile`; 7-test vitest suite) — a lesson re-learned: presentation.ts
originally imported G from game-state, dragging the deps bridge into the
sandboxed interpreter test bundle (2 node suites red) → use
InterpContext.state instead. **Schema (additive)**: `map.ambience[]`,
`CmdSe.at`, `CmdMusic.fadeMs`; map.music/system.sounds accept audio keys.
**Engine**: map load syncs ambience; `se` command's `at:"event"` pans by
event↔player tile offset; options menu gains **Ambience Volume**
(playerOptions.audio.bgs, boot-restored). **Editor**: MUSIC_OPTS/SE_OPTS/
BGS_OPTS list imported audio (♪-prefixed) → Map Properties (music +
ambience-layer rows), System sounds, Change Music (crossfade ms field),
Play Sound (Positional checkbox), animation Sound items; Audio Manager v2
previews library audio (bgm/bgs toggle like themes, se/me one-shot).
**Export**: persistence wraps exportUsedExternalAssets to merge
`exportUsedAudioAssets` (library data URLs); assets.js skips audio entries
at prepare time (never image-bound). New player e2e (37th spec): WAV assets
seeded into IDB + start map wired → deck owns bgm + the 0.5-vol ambience
layer after New Game, positional call clean. Verified live (deck state,
AudioContext running, zero console errors). Patch note, wiki (Audio.md
rewrite: four roles, layer tips), `sfx.js?v=10` both HTMLs,
`patch-notes.js?v=19` (+shim +help.ts). Full gate green: tsc, eslint,
node --test (16), vitest (**186**), Playwright **37/37** (goldens
byte-stable).

Stage C COMPLETE (2026-07-03): the importers. **Pure math**
(`src/editor/importers/sheet-math.ts`, 12-test vitest suite): `gridCells`
(offset/gap, partial-edge exclusion), `cellName`, `isCharsetSheet` (3×4 +
squarish-cell guard), `parseAseprite` (hash AND array frame forms, frameTags
with per-tag fps from frame durations, uniform-grid detection), `packFrames`
(near-square repack plan, centered frames). **Wizard**
(`import-wizard.ts`, wired into the Asset Browser's doImport): tileset
slicer modal (source cell 16/24/32/48/64/96 + offset/gap, live grid canvas
with click-to-toggle cells, Blocked/Passable/Terrain naming, every included
cell → one 48px nearest-neighbor tile `<base>-r<row>c<col>[.pass|.terrain]`
with importer provenance in meta); sprite-sheet modal for non-3×4 character
images (walking-charset direct import OR **flipbook sheet** with cell size +
named frame-tag rows → `meta {charset:false, cols, rows, cellW/H, frames}`);
**Aseprite** .json+.png pairs (matched by meta.image or basename; uniform
grids use the PNG as-is, trimmed exports repack via packFrames). Bugfix
caught live: modal buttons must settle the wizard promise BEFORE close()
(onClose's done([]) raced the sliced items away). **Runtime**: `AnimItem.tag?`
(schema; display-only — tags fill from/to/fps at authoring time),
`AnimEnv.resolveSheet` hook in anim-player, `resolvePlaybackSheet`/
`assetUrlSync` in asset-library (library object URLs, falling through to
RPGATLAS_ASSETS data URLs in standalone exports), wired at all three
playAnimation sites (battle, map anim-glue, editor preview). Animations tab
Sheet field → picker (icons · library sheets · custom URL) + **Frame tag**
dropdown that fills From/To/FPS. `bindExternalAssets` skips
`meta.charset===false` sheets (registry-only: playback + export, never the
sprite pickers) and `exportUsedExternalAssets` now carries meta;
`collectUsedExternalKeys` gained animation sheets + commonEvents/troop-page
command scans (pre-existing export gap). **A2 autotiles**: already shipped
in Phase 3 (Tools ▸ Import Autotile Sheet…) — the slicer links to it, no new
code (spec deviation: nothing to build). Verified live (slicer: 96×96 → 4
named .pass tiles in library + palette registry + Assets.tiles; Aseprite:
tags spin@10fps/pop@20fps, sheet excluded from charsets, blob-URL playback
entry; zero console errors) + new tile-slicer e2e (36th spec). Patch note,
wiki (Asset-Browser import-wizard section), `editor.css?v=49`,
`assets.js?v=16`, `patch-notes.js?v=18` (+shim +help.ts). Full gate green:
tsc, eslint, node --test (16), vitest (**179**), Playwright **36/36**
(goldens byte-stable).

Stage B COMPLETE (2026-07-02): the Asset Browser. **Tools ▸ Asset Browser**
(`src/editor/tools/asset-browser.ts`, command `assetbrowser`, Tools menu +
command palette): left type rail with live counts (All/Characters/Facesets/
Enemies/Tiles/Audio), toolbar (search, **Unused only** toggle, **Images as**
type selector, **Import Files…** + full-modal drag-drop with `.ab-drop`
outline), tag chip row (toggle filters, reserved `pack:` tags documented),
thumbnail grid (pixelated `<img>` from the library's object URLs; audio
cards show ♪ + kind badge + duration), per-card **used/unused badge** from
`usedAssetKeys` + footer audit summary (counts + bytes). Actions per card:
audio ▶ preview (single shared element, stopped on modal close), **Rename**
(promptBox → `renameAsset` reference rewrite + live re-bind + rebuildAll +
touch), **Tags** editor, **Export** (blob download w/ mime-mapped
extension), **Delete** (confirmBox; "USED by this project" warning). Imports
route images by the selector, audio automatically; new images live-bind via
`Assets.registerExternalAssets` so pickers/palette update without reload.
Graceful no-store message when IndexedDB is unavailable. New e2e (35th
spec): IDB-clean boot → cmd-palette open → synthetic PNG import → card +
badge + thumb → **reload persistence** → tag edit + chip filter → delete.
Verified live on the dev server (import PNG+WAV: cards, kind BGS guessed,
charset bound into Assets.charsets immediately, "in project" badge after
assigning the charset to an actor, reload persistence, zero console
errors; screenshot). Patch note (covers A+B), wiki page
(The-Asset-Browser + sidebar), `editor.css?v=48`, `patch-notes.js?v=17`
(+shim +help.ts). Full gate green: tsc, eslint, node --test (16), vitest
(167), Playwright **35/35** (goldens byte-stable).

Stage A COMPLETE (2026-07-02): the asset store foundation. **Contracts**
(`services.ts`): `AssetMeta` (key/type/name/tags/bytes/sha-256 hash/mime/
kind/dims/dur/importer meta) + async `AssetStore`
(list/get/put/remove/setMeta). **Drivers**: `src/platform/browser/
idb-asset-store.ts` (IndexedDB `rpgatlas_library`, split meta/blobs stores so
list() never copies blobs, lazy+retrying open) and `src/platform/tauri/
fs-asset-store.ts` over five new Rust commands (`library_list/read/write/
delete/set_meta` in src-tauri/src/lib.rs; `<app-data>/library/index.json`
written via temp-file rename + content-addressed `blobs/<sha>` files shared
by hash, base64 IPC, hex-validated file names; base64 crate added; cargo
check green). `src/platform/default-asset-store.ts` picks FS under
`__TAURI__` (editor + playtest windows share one library), else IDB, else
null. **Service** (`src/shared/asset-library.ts`): catalog init publishes
image entries to `window.RPGATLAS_LIBRARY_ASSETS` (object URLs, audio stays
internal); `importAssets` (slugging, collision suffixes that respect
`.pass`/`.terrain`, hash dedupe w/ tag merge, injectable probe, audio-kind
guessing); `usedAssetKeys` audit (all Phase ≤6 surfaces incl. audio keys,
ambience, system sounds, vehicle charsets, anim flipbook sheets, painted-tile
id inversion, character→faceset pairing); `rewriteAssetKey` + `renameAsset`;
embedded-asset helpers. **assets.js hook**: `discoverExternalAssets` appends
library entries after the shipped catalog (library shadows by bind order;
standalone exports keep the RPGATLAS_ASSETS early return) + new
`registerExternalAssets(items, project)` for mid-session imports
(discovery-warming + dedupe against prepared entries). **Embed policy
wired**: file saves/exports embed used library assets
(persistence.desktopSave/exportProject → `embedUsedAssets`), localStorage
autosaves strip `assets.external` (project-io.saveProject), file
opens/imports consume embeds into the library with reference rewrites on
collision/dedupe landing keys (boot + importProject →
`consumeEmbeddedAssets`). Engine boot inits the library only when
`RPGATLAS_ASSETS` is absent. 21-test vitest suite
(tests-unit/asset-library.test.ts). No user-facing UI yet — patch-note entry
lands with Stage B's browser. `assets.js?v=15` both HTMLs. Full gate green:
tsc, eslint, node --test (16), vitest (**167**), Playwright **34/34**
(renderer goldens byte-stable), cargo check.

**Branch:** `phase-6-assets`
**Architect & implementation:** Claude Fable 5 (roadmap assignment: "asset
reference model — stable IDs across libraries"; per the standing choreography
note Sonnet is excluded and all implementation runs at the Fable/Opus tier).

## Objective

Ship the roadmap's Phase 6: real assets and real audio without abandoning the
procedural-first identity —

1. **Asset browser** — drag-drop import, thumbnails, tagging, a per-device
   library over the shared `img/` catalog, "used/unused" audit; backed by the
   Phase 1 storage abstraction (Tauri FS on desktop, IndexedDB in the browser —
   breaking the localStorage ceiling for binary assets).
2. **Importers** — tileset slicer (any grid size → the 48px pipeline),
   RPG-Maker autotile format, spritesheet slicer with frame tagging,
   **Aseprite JSON** animation import, faceset/battler imports.
3. **Audio v2** — stream OGG/MP3/WAV for BGM/BGS/ME/SE alongside the
   procedural chiptunes; audio bus with crossfades, per-map ambience layers,
   positional SFX; BGS volume in the options menu.
4. **Starter packs** — installable asset packs from a bundled registry (plus
   remote registries by URL); export continues to embed only referenced
   assets.

Everything is **additive and save-compatible**: new schema fields are
optional, projects without them behave byte-identically to Phase 5, renderer
goldens must not change, and a project that never touches the library keeps
working with zero network and zero stored blobs.

## Non-goals (whole phase)

- **No FORMAT_VERSION bump.** Every new project field is optional with
  absent = today's behavior; no migration step is needed (the v2 migration
  from Phase 5 remains the latest). Round-trip stays byte-identical for
  untouched projects.
- **No renderer work.** Imported tiles/charsets flow through the existing
  `bindExternalAssets` pipeline that both renderers already consume.
- **No audio middleware ambitions.** No DSP graph editor, no per-tile
  reverb zones; positional SFX is stereo pan + distance gain, not HRTF.
- **No asset marketplace / accounts.** Packs are static JSON registries +
  plain fetchable files; the bundled pack ships in the repo.
- **Procedural assets stay first-class and default.** The sample game keeps
  building from procedural assets only; nothing in the core flow requires an
  import. `Sfx`/`Music`'s procedural behavior with theme names is FROZEN.
- **No localStorage schema change for autosave.** Embedded asset blobs are
  written only to *exported/saved files*, never into the localStorage
  autosave (the library holds local blobs; see Stage A).

---

## Current-state facts that constrain the design

1. **An external-asset system already exists** (`js/assets.js`): images
   under `img/{characters,facesets,enemies,tilesets}/` are discovered via
   `img/assets.json` (or directory listing), keyed **`asset:<type>/<name>`**
   (`EXTERNAL_PREFIX`), and bound by `bindExternalAssets(project)` into the
   same registries procedural assets use (charsets list, `faceByName`,
   `ENEMY_TYPES`, `tiles[]` + per-project id map `proj.assets.tiles`).
   `collectUsedExternalKeys(project)` walks actors/maps/events/enemies;
   `exportUsedExternalAssets` embeds used images as data URLs into the
   standalone export (`window.RPGATLAS_ASSETS`), which `discoverExternalAssets`
   consumes first on boot. **The `asset:` key IS the stable reference** —
   Phase 6 keeps it, extends the type set, and adds device-library and
   project-embedded *sources* behind the same keys.
2. **Tileset "assets" are single 48px tiles** (one image = one tile, `.pass`
   / `.terrain` name suffixes drive passability/terrain). The slicer's job is
   to turn arbitrary sheets into these.
3. **Storage seam is ready** (`src/shared/services.ts`): sync `StorageDriver`
   over localStorage, with async variants explicitly anticipated for Phase 6.
   Repositories wrap `js/editor/project-io.js` verbatim. The localStorage
   ceiling is only broken for *blobs* — the project JSON document itself
   stays in localStorage (Tauri file save already exists for full projects).
4. **Audio is 100% procedural** (`js/sfx.js`): WebAudio mixer
   `master ← {bgm, se}` gains (volumes persisted in playerOptions), fixed SE
   map, `Music.play(name)` seeded-chiptune `setInterval` player with
   `THEMES` (title/town/field/cave/battle/gameover) + `"none"`. Call sites:
   `map.music`, battle/title `sysBgm`, event commands `playSE`/`playMusic`
   (`presentation.ts` via injected services), Map Properties + System-tab
   sound pickers, Audio Manager modal.
5. **Tauri host = custom invoke commands** (`js/editor/host.js`,
   `src-tauri/src/lib.rs`): 4 commands today; adding `library_*` commands is
   the established pattern. `window.__TAURI__` presence is the feature gate.
   App-data dir is available server-side via `tauri::Manager.path()`.
6. **Phase 5 left the hooks:** `AnimItem.type "flipbook"` has a `sheet` slot
   ("Phase 6 importers will populate these"); autotiles are project-embedded
   47-blob groups (`proj.autotiles`, Phase 3 Stage D) — an autotile importer
   *generates* that shape; `anim-glue`/battle route SE through `Sfx.play`.
7. **Boot loads assets once**: editor (`src/editor/boot.ts`) and engine
   (`src/engine/boot.ts`) both `await Assets.loadExternalAssets(proj)`;
   `workspace.ts`/`persistence.ts` re-bind on project switch. Adding a
   library source only touches `discoverExternalAssets`'s source list.
8. **Gates:** `npm run typecheck` (tsc), `npm run lint`, `npm test`
   (node --test), `npm run test:unit` (vitest), `npm run test:e2e`
   (Playwright, renderer goldens byte-identical). Script-tag version bumps
   in **both** `index.html` and `play.html` (`assets.js?v`, `sfx.js?v`,
   `data.js?v`…), `css/editor.css?v` / `css/play.css?v`,
   `patch-notes.js?v` + `shims.d.ts` + `help.ts`, patch-note entry per
   AGENTS.md, wiki updates.

---

## Design

### The asset reference model (stable IDs across libraries)

**Reference = `asset:<type>/<name>`**, unchanged from today. Types grow from
`characters | facesets | enemies | tilesets` to also include **`audio`**.
Names are slugs (`[a-z0-9._-]`, lowercased on import); name suffix
conventions (`.pass`, `.terrain` on tilesets) keep working. A reference is
resolved at bind time against the merged catalog; a dangling reference
degrades exactly as today (procedural fallback / skipped).

**Three sources, merged per key (later wins):**

1. **Shipped** — `img/<type>/` files (read-only, from the repo/app bundle).
2. **Library** — the per-device store (IndexedDB in the browser, Tauri FS on
   desktop): `AssetRecord = { meta: AssetMeta, blob: Blob }` where

   ```ts
   interface AssetMeta {
     key: string;            // "asset:<type>/<name>" — THE stable id
     type: "characters" | "facesets" | "enemies" | "tilesets" | "audio";
     name: string;           // slug, unique within type
     tags: string[];         // free-form + reserved "pack:<id>"
     bytes: number;
     hash: string;           // SHA-256 hex of the blob — dedupe + pack idempotency
     addedAt: number;        // epoch ms
     kind?: string;          // audio: "bgm" | "bgs" | "me" | "se"
     w?: number; h?: number; // images
     dur?: number;           // audio seconds
     meta?: Record<string, any>; // importer payloads (frame tags, grid, source)
   }
   ```

3. **Project-embedded** — `proj.assets.external?: EmbeddedAsset[]`
   (`{ type, name, src (data URL), kind?, meta? }`). Written **only** when
   saving/exporting to a *file* (Tauri save, browser export) and only for
   *used* keys; **stripped before every localStorage write** (the library
   already holds the blobs on this device). On loading a file that carries
   embedded assets they are imported into the library (hash-deduped), then
   dropped from the in-memory project — the project document stays
   references-only. The standalone game export keeps its existing
   `RPGATLAS_ASSETS` embed path, extended to audio.

**Identity rules:** import dedupes by content hash (same blob = keep existing
key, merge tags); name collisions with different content get `-2`, `-3`…
suffixes; **rename = re-key** and the editor rewrites every reference in the
open project (same walkers as the audit); delete warns when the audit finds
uses. Packs tag every asset `pack:<id>` so installs are idempotent
(hash-match) and uninstalls are a tag query.

**The audit** (`usedAssetKeys(project)`) extends `collectUsedExternalKeys`
to the new reference surfaces: `map.music` / `map.ambience[].key` /
`system.sounds` values / `playSE`/`playMusic` command args (audio keys),
`AnimItem.sheet` (flipbook sheets), and the existing actor/event/enemy/tile
walks. One walker, used by: export embedding, the browser's used/unused
badges, rename rewriting, and delete warnings.

### Stage A — Asset store foundation

- **`AssetStore`** (async, `src/shared/services.ts`):

  ```ts
  interface AssetStore {
    list(): Promise<AssetMeta[]>;
    get(key: string): Promise<Blob | null>;
    put(meta: AssetMeta, blob: Blob): Promise<void>;
    remove(key: string): Promise<void>;
    setMeta(meta: AssetMeta): Promise<void>;   // tags/kind/meta updates
  }
  ```

- **Browser impl** `src/platform/browser/idb-asset-store.ts`: IndexedDB
  `rpgatlas_library` v1, one object store `assets` keyed by `meta.key`,
  value `{ meta, blob }` (Blobs are structured-cloneable). No index needed
  at library scale; `list()` reads metas only (cursor, skip blob copies via
  a separate `meta` store — two stores: `meta`, `blobs`).
- **Desktop impl** `src/platform/tauri/fs-asset-store.ts` + Rust commands
  `library_list / library_read / library_write / library_delete /
  library_set_meta` over `app_data_dir()/library/<type>/<name>` files +
  one `library/index.json` (the AssetMeta list; written atomically via
  temp-file rename). IPC carries base64; the TS side converts to/from Blob.
  Feature-gated by `window.__TAURI__` exactly like host.js; browser build
  never imports it (dynamic pick in one boot spot).
- **`src/shared/asset-library.ts`** — the service everything else calls:
  - `initLibrary(store)` + `libraryCatalog()`: merged shipped+library view
    as `{type, name, src}` entries feeding `discoverExternalAssets`
    (object URLs for library blobs). `js/assets.js` gains ONE hook:
    `window.RPGATLAS_LIBRARY_ASSETS` (same shape as `RPGATLAS_ASSETS`),
    consulted after the manifest/folder scan and before binding — additive,
    exported games and asset-less boots unchanged.
  - `importFiles(files, { type, tags })`: slugging, SHA-256 dedupe,
    dimension/duration probing, collision suffixes → `put` + re-bind.
  - `usedAssetKeys(project)`: the extended audit (pure; vitest-covered).
  - `renameAsset(key, newName, project)`: store re-key + reference rewrite.
  - embedded-assets load/save helpers for project-io (strip-on-autosave,
    embed-used-on-file-save, import-on-file-load).
- **Boot wiring:** editor + engine boot init the store (browser: IDB;
  Tauri: FS) before `loadExternalAssets`; failures degrade to shipped-only
  with a console warning (private-mode IDB, etc.).
- **Tests:** vitest — slugging/collision/dedupe (fake in-memory store),
  audit walker over a fixture project (incl. audio + sheet keys),
  embed/strip round-trip. node --test module-shape pins updated if needed.

### Stage B — Asset Browser

- **Tools ▸ Asset Browser** (new modal beside the Resource Manager, which
  stays for procedural browsing/PNG export): left type rail (All /
  Characters / Facesets / Enemies / Tiles / Audio), toolbar (search box, tag
  filter chips, Import button, "show unused only" toggle), thumbnail grid
  (images: cached canvas thumbs; audio: kind badge + duration + ▶ preview
  via Stage A blob URLs — procedural preview for now, full deck in Stage D).
- **Import**: drag-drop anywhere on the modal + file picker; PNG/WebP/JPEG
  route by the active type tab (Stage C adds the wizard between drop and
  store); OGG/MP3/WAV always land in `audio` with kind guessed from
  name/duration (editable).
- **Per-asset actions**: rename (reference rewrite + confirm), retag
  (chip editor), delete (audit-backed "used by N places" warning),
  export file, "reveal source" (shipped vs library vs pack tag).
- **Used/unused audit view**: badge on each card ("in project" count from
  `usedAssetKeys`), unused filter, and a summary line ("14 assets, 3 unused,
  2.1 MB").
- **Pickers**: no new picker code — imported assets appear in the existing
  charset/face/enemy/tile pickers via `bindExternalAssets` as today; the
  browser is the management surface.
- **e2e**: programmatic file-input import of a generated PNG → thumb
  appears, badge counts update, tag filter narrows, delete removes; reload
  keeps the asset (IDB persistence).

### Stage C — Importers

All importers are **pure slicing/parsing modules** (`src/editor/importers/`)
+ a wizard UI step in the Asset Browser import flow. Every importer output
lands as ordinary library assets (or project autotiles), so downstream code
never knows an importer existed.

- **Tileset slicer** (`slice-tiles.ts`): source grid (16/24/32/48/custom,
  offset+gap), nearest-neighbor scale to 48px, live preview grid, click/drag
  multi-select of cells to import, per-selection passable/terrain toggles
  (→ `.pass`/`.terrain` suffixes), names `"<base>-r<row>c<col>"`.
- **RPG-Maker autotile importer** (`import-autotile.ts`): accepts the A2
  field-format block (2×3 cells of 2× tile size) — the standard VX/Ace/MV/MZ
  layout — and composes the **47-blob group** (Phase 3 `proj.autotiles`
  shape) by quadrant assembly; A1 water accepts frame 1. Output goes to
  `proj.autotiles` via the existing autotile-store (project data, not the
  library), preview before commit.
- **Spritesheet slicer + frame tagging** (`slice-sheet.ts`): grid slice,
  then either **3×4 charset** import (→ `characters`, walk-cycle preview)
  or **flipbook sheet** import: the sheet stays ONE image asset under type
  `characters` with `meta.frames = [{ name, from, to, fps? }]` and
  `meta.charset = false` — the anim player only needs an image + cell math,
  charset-type records already carry images through the whole pipeline, and
  the `meta.charset === false` flag keeps sheets out of the walking-sprite
  pickers (no fifth image type; the browser shows them under a "Sheets"
  filter chip).
- **Aseprite JSON** (`import-aseprite.ts`): hash- or array-frames JSON +
  companion PNG; uniform-grid sheets import directly, non-uniform frames are
  repacked onto a uniform grid canvas at import time; `frameTags` →
  `meta.frames` (with per-tag fps from frame durations).
- **Anim engine hook** (the one runtime change): `AnimItem.sheet` accepts
  `asset:` keys (resolved via the bound catalog image) and
  `AnimItem.tag?: string` picks a named range from `meta.frames`
  (overriding from/to); the Animations tab sheet field becomes a picker
  (icons / asset sheets / URL). Absent = today, byte-identical.
- **Faceset/battler imports**: straight-through type imports (facesets,
  enemies) with a crop/scale preview step.
- **Tests:** vitest on the pure modules (grid math incl. offset/gap,
  autotile quadrant map on a synthetic checkerboard, Aseprite both JSON
  flavors + tag extraction, repack determinism); e2e: slice a generated
  16px sheet → 4 tiles land in the library and paint on a map.

### Stage D — Audio v2

- **`src/shared/audio-deck.ts`** — streamed playback over the existing
  mixer, procedural untouched:
  - sfx.js exposes its buses (`busFor("bgm"|"bgs"|"me"|"se")`, adding `bgs`
    + `me` gains into master; volumes: bgs persisted like bgm/se, me rides
    the bgm volume).
  - **BGM deck**: two `HTMLAudioElement`s → `MediaElementAudioSourceNode` →
    bgm bus; `playBgm(key, { fadeMs = 800 })` crossfades decks (equal-power
    ramps via the per-deck gain), loop = true; `"none"`/procedural theme
    stops the deck (and vice-versa — one BGM owner at a time, enforced in
    `Music.play`).
  - **BGS layers**: N looping elements keyed by asset (per-map ambience);
    `setAmbience(layers: {key, vol}[])` diffs current vs wanted on map
    load/transfer with short fades.
  - **ME**: one-shot element on the me bus; ducks the bgm bus to 20% for
    its duration, then restores (victory jingles).
  - **SE**: `decodeAudioData` buffer cache (LRU ~32) → `BufferSource` on
    the se bus; **positional** `playSeAt(key, tileX, tileY)`:
    `StereoPannerNode` pan from screen-relative x (camera center), gain
    falloff by tile distance (cap radius ~12 tiles); works identically in
    classic/HD-2D since it reads the camera, not the renderer.
- **Routing rule (one place, `Music.play` / `Sfx.play`)**: arg starts with
  `asset:` → deck/buffer path; else procedural exactly as today (FROZEN).
- **Schema (all optional):** `map.ambience?: { key: string; vol?: number }[]`;
  `CmdPlaySE.at?: "event" | "player"` (positional origin);
  `CmdPlayMusic.fadeMs?: number`; `map.music` and `system.sounds` values may
  hold `asset:audio/...` keys (string fields already).
- **Editor:** Map Properties music picker gains an "Imported" optgroup
  (bgm-kind assets) + Ambience rows (add/remove layer, key picker, volume);
  System-tab sound pickers + playSE/playMusic command forms gain imported
  options (+ "at this event" checkbox on playSE); Audio Manager v2 shows a
  Library section with previews next to the procedural grids. Options menu
  (play): **Ambience volume** slider (bgs) beside BGM/SE.
- **Export/engine:** audio embeds through the same used-assets path (data
  URLs feed the deck fine); engine boot passes audio entries into the
  catalog (images-only assumptions in `prepareExternalAssets` get a type
  fork — audio prepares `{src}` without `loadImage`).
- **Tests:** vitest — routing (asset key vs theme name), crossfade
  scheduler with injected clock/elements (fake Audio), ambience differ,
  pan/gain math; e2e smoke: map with `asset:` bgm boots the player without
  errors and the deck element exists paused=false (autoplay-safe: e2e
  starts audio after a synthetic keypress, matching the engine's existing
  first-input resume).

### Stage E — Starter packs + phase exit

- **Registry:** `img/packs/index.json` (bundled) — `{ packs: [{ id, name,
  desc, license, version, files: [{ type, name, url, kind?, tags? }] }] }`;
  URLs may be relative (bundled packs) or absolute (remote). An editor
  setting (localStorage, not project) can add extra registry URLs.
- **Asset Browser ▸ Packs tab:** cards (name/desc/license/size/installed
  state), Install = fetch files → the Stage A import pipeline with tags
  `["pack:<id>", ...]` (hash-dedupe makes reinstall idempotent), Uninstall
  = delete-by-tag with the usual used-warnings. Progress + failure surfacing
  (partial installs resume on retry thanks to dedupe).
- **Bundled pack:** "Driftwood Starter" — a small CC0 (repo-licensed,
  GPL-compatible) pack of HD-2D-ready content **generated by a repo script**
  (`scripts/build-starter-pack.mjs` rendering variations from the
  procedural generators into real PNGs via the existing canvas code under
  Playwright's chromium, committed under `img/packs/driftwood-starter/`):
  recolored terrain tiles, a few charsets/facesets, battlers, plus 2–3
  chiptune-rendered WAV loops. Deviation from the roadmap's "curated CC0
  downloads" noted: curation of third-party packs is registry-ready but no
  third-party content ships in-repo; the bundled pack is self-generated
  CC0-equivalent (project license) so it is offline-safe and
  license-auditable.
- **Phase exit:** wiki (Audio.md rewrite, Characters-and-Custom-Assets.md
  update, new Asset-Browser page, Publishing note on embedded assets),
  patch notes, roadmap tick, acceptance run, tag `phase-6`.

---

## Migration

None (no FORMAT_VERSION bump). All new fields optional; absent = Phase 5
behavior byte-for-byte. The round-trip test gains a fixture asserting a
Phase 5 project loads and re-saves unchanged with the library present but
untouched. `proj.assets.external` is consumed-and-dropped on file load and
regenerated on file save; localStorage autosaves never contain it.

## Stage plan

- **A — Asset store foundation:** AssetStore + IDB/Tauri impls +
  asset-library service (import/audit/rename/embed) + boot wiring +
  assets.js library hook; vitest suites; patch note.
- **B — Asset Browser:** the modal (grid/tags/search/audit/actions) +
  drag-drop import; e2e; patch note + wiki stub.
- **C — Importers:** slicers (tiles/sheets), autotile composer, Aseprite
  import, anim sheet keys + tag ranges + editor picker; vitest + e2e;
  patch note + wiki.
- **D — Audio v2:** buses + deck (crossfade/ambience/ME/positional SE),
  routing, schema fields, editor pickers + Audio Manager v2 + options
  slider; vitest + e2e; patch note + wiki.
- **E — Starter packs + exit:** registry + Packs tab + bundled generated
  pack + docs; acceptance run; tag `phase-6`.

Each stage lands green (full gate), is committed on `phase-6-assets`,
pushed, and merged to `main` per the standing workflow.

### Acceptance criteria (phase exit)

1. A PNG dropped on the Asset Browser persists across a full reload
   (browser IDB and Tauri FS), appears in the existing pickers, paints on a
   map, and round-trips a file save/load on another "device" (cleared
   library) via embedded assets — while localStorage autosaves stay
   blob-free.
2. A 16px RPG-Maker-layout tileset slices to working 48px tiles; an A2
   autotile block becomes a paintable 47-blob autotile; an Aseprite export
   plays as a battle-animation flipbook by tag name.
3. A map with imported BGM + two ambience layers crossfades on transfer;
   a positional SE pans with the player's approach; the victory ME ducks
   and restores BGM; all procedural audio behaves exactly as Phase 5 when
   no asset keys are referenced.
4. The bundled starter pack installs (tagged, idempotent), its assets are
   usable everywhere, uninstall removes exactly the unused ones with
   warnings for used ones; export embeds only referenced assets (images +
   audio) and the exported game runs offline.
5. Full gate green; renderer goldens byte-identical; wiki + patch notes
   updated; script-tag versions bumped in both HTML entry points.
