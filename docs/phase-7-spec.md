# Phase 7 Spec — Polish, Performance & Release (1.0)

**Status:** IN PROGRESS (started 2026-07-03). Stage log below, newest first.

Stage E COMPLETE (2026-07-03): export upgrades. **Shared template** (new
`js/standalone-template.mjs`, importable from browser AND Node like
build-manifest): `assembleStandaloneHtml` extracted verbatim from
project-io's buildStandaloneGame (which now just fetches + delegates;
literal dynamic imports kept so Vite bundles them — a variable-specifier
import 404s in builds, caught during refactor), plus the PWA pieces:
`injectPwaHooks` (manifest link + SW registration, zip variant ONLY;
file:// guarded), `webManifestFor`, `serviceWorkerFor` (cache name =
content CRC). **Zip writer** (`src/editor/export-web.ts`): dependency-free
STORE zip (local headers + central dir + CRC-32, UTF-8 flag, fixed-date
deterministic), `renderGameIcon` (canvas: dark tile + gold ring +
initial), `buildWebZipEntries` (index.html/manifest/sw/icon-192/512 —
itch.io layout). **Modal**: "Web / itch.io (.zip)" button + native-exe
hint. **Native packager** (`scripts/package-game-exe.mjs`): vite build →
assemble via the SAME template/manifest (embedded assets ride along;
shipped asset: refs embedded from img/ with warnings) → stages
src-tauri/game-dist + a per-game --config overlay (productName/identifier/
frontendDist/single window sized from system.screenW/H, bundle off,
RFC-7396 merge drops the playtest window) → `tauri build --no-bundle` →
copies the exe out; game-dist + game.conf.json gitignored. **Validated for
real**: packaged Atlas_Quest.json → 3.7 MB native exe, launched, alive at
6 s with window title "Atlas Quest", killed clean (1m46s warm cargo).
**Tests**: vitest ×8 (CRC vectors incl. 0xCBF43926, zip parsed back
structurally + roundtrip + determinism, template order/PWA/manifest/SW
content) → 212; new e2e (`export-web.spec.mjs`): real menu click →
download → STORE unzip → itch layout assert → served on a local http
server → SW controller claimed → context.setOffline(true) → reload →
FULL OFFLINE REPLAY into a new game. Wiki (Publishing rewrite: format
table + static-host/PWA + native packaging section); patch note;
`patch-notes.js?v=25` (+shim +help.ts). Full gate green: tsc, eslint,
node --test (16, incl. the refactored export harness), vitest (**212**),
Playwright **46/46** (goldens byte-stable).

Stage D COMPLETE (2026-07-03): Atlas Quest HD. **Spec correction learned up
front**: the renderer goldens do NOT synthesize their own maps — all eleven
render Meridian Village's real tiles/heights/lights/events (several without
overriding map.lights), so **map 1 is visually frozen** and the showcase
lives elsewhere. **Script** (`scripts/build-atlas-quest-hd.mjs`,
deterministic + idempotent, CRLF/1-space serializer proven byte-identical
on an untouched project): Whispering Cave gains 2 crystal lights +
ssao/aces + an east-wall passage (decor carve at 15,10 + touch transfer);
Cottage gets the full interior treatment (tilt 48, ambient .32, firelight
#ffb060 + window #88bbff, materials, dropShadows, vignette, aces, fxaa);
**new map 4 "Driftwood Shore"** (24×14): height-3 cliff ridge (cliffs
auto-texturing), grass→path→sand→water→deepwater bands, LCG-scattered
pines/bushes/flowers/rocks, a bridge-tile dock running into the water with
a lantern at its end, 4 point lights, dusk day/night (timeOfDay 17.2,
ambient .5) + shadows + water + materials + bloom + ssao + aces + warm LUT
+ vignette + fxaa + fog #241a26; events: touch-transfer back, showcase
sign, wandering Old Fisherman (billboard sprite under dusk light). Quest
chain/battles/start untouched → playthrough green; goldens byte-stable
(map 1 frozen held). Verified live twice (first pass too dark at ambient
.42/17.5 → brightened; screenshots: shore + dock; zero console errors).
New e2e (`showcase.spec.mjs`): warps to map 4 via seeded common event,
asserts hd2d feature set + live GL draw calls + event roster. Wiki
(Your-First-Game: "Tour the HD-2D showcase"); patch note;
`patch-notes.js?v=24` (+shim +help.ts). Full gate green: tsc, eslint,
node --test (16), vitest (204), Playwright **45/45** (goldens byte-stable).

Stage C COMPLETE (2026-07-03): i18n completion. **Dictionaries**
(js/editor/i18n.js rewrite): es/fr/de now cover the full post-overhaul
chrome — the View menu, World View, HD-2D Viewport, Region Mode, Command
Palette…, Asset Browser…, Import Autotile Sheet…, Keyboard Shortcuts…,
Zoom 1:1, dock layout commands (Maps/Tiles Panel, Focus, Reset/Save/Saved
Layouts), autotile palette chrome (Autotiles/Brush/Import…/Zoom), dock tab
captions (Map/HD-2D/World — dock.ts panelTitle now routes through t()),
UI Font Size, Save/Delete buttons, and the Region status template; stale
keys fixed (HD-2D Preview → Viewport, event/passability status strings
updated to their current wording, de "Scale" Ansicht→Maßstab freeing
Ansicht for View). **Anti-rot gate**
(tests-unit/i18n-parity.test.ts, 10 tests): computes the chrome key set
from the real sources — index.html data-i18n attrs, every `label:` in
workspace.ts + dock/panels.ts, registerDockPanel titles (regex tolerates
constant ids), LAYER/TOOL_LABELS tables (source-regexed; editor-state is
window-bound), + a curated status/dialog list — and asserts every locale
has exactly that set (missing AND orphan checks, plus {placeholder}
integrity). Scope rule holds: tooltips/modal bodies fall back to English
by design. Verified live in Spanish (menubar incl. Ver, toolbar labels,
dock tabs Mapas/Mosaicos/Mapa, status line, Automosaicos/Importar…).
Patch note; `patch-notes.js?v=23` (+shim +help.ts; i18n.js itself is
Vite-hashed, no query bump). Full gate green: tsc, eslint, node --test
(16), vitest (**204**), Playwright **44/44** (goldens byte-stable).

Stage B COMPLETE (2026-07-03): accessibility. **Pure resolvers**
(`src/shared/a11y.ts`, 8-test vitest suite): `resolveMotion` (auto/on/off
over the system preference), `resolveTextScale` (0.5–2 clamp, else 1),
`gaugePalette` (classic green/blue vs Okabe–Ito #e69f00/#56b4e9),
`weatherMotionScale` (0.3 reduced), `TEXT_SCALE_STEPS`. **Player options**
(player-options.ts wraps them with ctx + the prefers-reduced-motion
matchMedia, watched live while "auto"): `motionReduced()` /
`applyMotionClass()` (a `reduced-motion` class on #stage) /
`textScale()`+`applyTextScale()` (`--ui-scale` custom property) /
`gaugeColors()`. **Engine gates** (render-glue, one resolve/frame): shake
amp zeroed, full-screen flash alpha halved (photosensitivity), weather
density → `extra.motionScale` consumed in three-renderer (absent = 1, so
goldens + editor viewport byte-identical). **CSS**: #stage font-size becomes
`calc(var(--font-size) * var(--ui-scale, 1))`; `.reduced-motion` class
mirrors the media-query block (sprite bob/lunge/shake/HUD-flash off) and the
media query gains quest-HUD flash. **Options menu** rows: Reduced Motion
(Auto/On/Off), Text Size (4 steps), Colorblind Assist (gauges via
`gaugeColors()` at the 4 bar() call sites; popups already sign-redundant).
**Editor**: Help ▸ Interface Language… gains UI Font Size (90/100/110/125%,
`rpgatlas_editor_font_scale` device setting, applied via documentElement
zoom at boot). New e2e (`a11y.spec.mjs`, 2 specs): seeded options apply at
boot (class + 19.5px computed + Okabe–Ito rgb() in pause-menu bar fills) and
defaults stay authored with the three rows visible in Options. Patch note;
wiki (Troubleshooting: Accessibility section); `play.css?v=24`;
`patch-notes.js?v=22` (+shim +help.ts). Full gate green: tsc, eslint,
node --test (16), vitest (**194**), Playwright **44/44** (goldens
byte-stable).

Stage A COMPLETE (2026-07-03): the performance pass. **Perf overlay**
(`src/engine/perf-hud.ts`, wired in boot + loop): `?perf=1` or F3 (capture-
phase listener) toggles a `.perf-hud` DOM box on #stage — fps / frame ms
avg+p95 (120-frame ring) / per-frame work ms, HD-2D GPU counters via the new
`Renderer.stats()` (three renderer.info: calls, triangles, alive geometries/
textures, programs), JS heap where exposed. Zero cost hidden (loop gates on
`perfActive()` before any timing). **Diagnostics hooks**: engine + editor
boots set `window.RPGATLAS_BOOT_MS` at boot-complete; engine exposes
`window.RPGATLAS_RENDERER_STATS()`. **New gate**
(`tests-e2e/load-perf.spec.mjs`, 4 specs): editor/player boot budgets
(measured 42/36 ms in-harness; 15 s budgets = order-of-magnitude canaries),
160×160 stress map (200 cloned-page random-move events, 16 lights, all
features: ~190 ms/frame SwiftShader vs 500 ms budget) + overlay smoke (F3
show/verify/hide), and the memory canary: transfer cycles via seeded common
events + `Atlas.game.callCommonEvent`, geometries must hold baseline EXACTLY
(15→15), textures +6 slack for the lazy walk-frame CanvasTexture cache
(bounded; a real setMap dispose leak adds ~4/cycle and trips it; measured
31→31). Audit conclusion: **no disposal leaks** (mapDisposables covers map
resources; sprite tex cache is a WeakMap on frame canvases). Learned live:
transfers driven from evaluate must wait for scene==="map" && player after
New Game (first attempt raced the new-game load, G.player null). Wiki:
Troubleshooting gains a Performance section (overlay, per-map feature cost,
big-map guidance). Patch note; `play.css?v=23` (.perf-hud);
`patch-notes.js?v=21` (+shim +help.ts). Full gate green: tsc, eslint,
node --test (16), vitest (186), Playwright **42/42** (goldens byte-stable).

**Branch:** `phase-7-release`
**Architect & implementation:** Claude Fable 5 (per the standing choreography
note Sonnet is excluded and all implementation runs at the Fable/Opus tier).

## Objective

Ship the roadmap's Phase 7 and close the Atlas HD overhaul at **RPGAtlas 1.0**:

1. **Performance pass** — load-time budgets, a memory/disposal audit, big-map
   stress coverage, and an in-player perf overlay; fix what the measurements
   surface.
2. **Accessibility** — reduced-motion mode, colorblind-safe defaults, font
   scaling (player and editor).
3. **i18n completion** — extend `js/editor/i18n.js` coverage across the
   Phase 2–6 UI surfaces, with a locale-parity test so it can't rot silently.
4. **"Atlas Quest HD"** — upgrade the sample game into the definitive HD-2D
   showcase using the systems the overhaul built.
5. **Export upgrades** — itch.io-ready zip, PWA/offline web export, and a
   proper native desktop game package via the Tauri infrastructure.
6. **Docs site + release** — a static docs site generated from `wiki/`,
   plugin/script API reference, migration guide, bug-bash QA pass, version
   1.0.0, tags `phase-7` + `v1.0.0`.

Everything stays **additive and save-compatible**: no FORMAT_VERSION bump; new
`playerOptions` keys and export formats are optional; renderer goldens stay
byte-identical except where a stage explicitly regenerates them (none planned).

## Non-goals (whole phase)

- **No engine feature work.** Phases 2–6 delivered the systems; Phase 7 tunes,
  hardens, and presents them. Bug fixes found by the perf/QA passes are in
  scope; new gameplay systems are not.
- **No new locales.** en/es/fr/de remain the set; "completion" means the
  existing locales cover the post-overhaul UI chrome. Dynamic/project content
  is never translated (existing rule).
- **No accounts, telemetry, auto-update, or code signing.** The Windows
  launcher stays unsigned (documented); PWA updates ride the service-worker
  cache version.
- **No docs-site framework dependency.** The generator is a repo script with a
  minimal built-in Markdown renderer; output is static HTML committed for
  GitHub Pages.
- **Community beta itself happens outside the repo.** This phase delivers
  release *readiness* (QA'd build, docs, exports); running the beta is a
  human step. The bug bash here = full gate + code review + live playthrough.

---

## Current-state facts that constrain the design

1. **A perf gate already exists**: `tests-e2e/renderer-perf.spec.mjs` holds the
   Phase 2 frame budget (all-features 1080p, SwiftShader-calibrated 300 ms
   budget, `RPGATLAS_PERF_BUDGET_MS` override). Phase 7 adds *load-time* and
   *stress/memory* coverage beside it, same calibration philosophy.
2. **Options menu** (`src/engine/scenes/menus.ts`) already has rows for Text
   Speed / Dash / Screen Shake (`playerOptions.shakeScale`) + volume sliders;
   `player-options.ts` persists via SaveRepository per-game. New a11y options
   follow the same pattern.
3. **`css/play.css` already has a `prefers-reduced-motion` block** (battle
   sprite animation/shake). The reduced-motion *option* generalizes this: a
   `reduced-motion` class on `#stage` forced by option or media query.
4. **i18n** (`js/editor/i18n.js`): `createEditorI18n` with `t()`,
   `localizeStatic` over `[data-i18n]`/`[data-i18n-title]`, SHARED dicts for
   es/fr/de (~60 keys — the Phase 0-era chrome). Phase 2–6 added many
   menus/tools/tabs that are English-only today.
5. **Standalone export** (`js/editor/project-io.js`): `buildStandaloneGame`
   inlines CSS + classic scripts + player bundle + project JSON + used assets
   into ONE html string; EXE = launcher + `RPGATLAS_GAME_PAYLOAD_V1` marker +
   payload. Zip/PWA exports wrap this same builder — no second build path.
6. **Native shell**: `src-tauri/` builds RPGAtlas-Desktop.exe embedding the
   staged frontend (`scripts/stage-frontend.mjs` → `src-tauri/dist`);
   `scripts/package-exe.mjs` is the one-command packager. A *game* package
   reuses this pipeline with the exported game HTML as the dist.
7. **Sample game**: `Atlas_Quest.json` (110 KB, FORMAT_VERSION 2) is the
   regression playthrough target; e2e fixtures load it via
   `fixtures/atlas-quest.mjs` with per-test `transformProject` — so showcase
   upgrades to the committed file must keep the playthrough e2e green, and
   renderer goldens (which synthesize their own fixture maps) untouched.
8. **Docs**: `wiki/` has 17 pages incl. `_Sidebar.md` nav; no site generator.
9. **Gates:** `npm run typecheck`, `npm run lint`, `npm test` (node --test,
   16 suites), `npm run test:unit` (vitest, 186), `npm run test:e2e`
   (Playwright, 38 specs, goldens byte-identical), cargo check when Rust
   changes. Script-tag `?v=` bumps in both HTMLs + `shims.d.ts` + `help.ts`,
   patch-note entry per AGENTS.md, wiki updates.

---

## Design

### Stage A — Performance pass

- **Perf overlay** (`src/engine/perf-hud.ts`): toggled by `?perf=1` or F3
  during play; shows fps, frame ms (avg / p95 over a rolling window), draw
  calls + triangles + geometries/textures (from `renderer.info` when HD-2D),
  and JS heap when `performance.memory` exists. Pure DOM overlay on `#stage`;
  zero cost when hidden (no sampling unless visible).
- **Load-time budgets** (new `tests-e2e/load-perf.spec.mjs`): editor
  boot-to-interactive and player boot-to-title timed via `performance.now`
  deltas exposed on `window`; budgets SwiftShader-calibrated with generous
  headroom (catching order-of-magnitude regressions, not noise), env
  override like the frame budget.
- **Stress coverage** (same spec file): a synthesized 160×160 map with ~200
  events, 16 lights, full HD-2D features — built by `transformProject` (no
  committed fixture blob); asserts boot + frame budget at stress scale.
- **Memory/disposal audit**: repeated map-transfer loop e2e asserting
  `renderer.info.memory` (geometries/textures) returns to a stable baseline
  across N transfers (catches three.js dispose leaks); code audit of
  `three-renderer.ts` disposal paths + `asset-library` object-URL lifecycle;
  fix whatever the audit finds.
- **Deliverables:** overlay + budgets green locally; any hot-spot fixes; patch
  note; wiki (Troubleshooting gains a perf section).

### Stage B — Accessibility

- **Reduced motion**: `playerOptions.reducedMotion: "auto" | "on" | "off"`
  (default `"auto"` = follow `prefers-reduced-motion`). One resolver
  (`motionReduced()`), applied as a `reduced-motion` class on `#stage` +
  runtime gates: screen shake forced to 0, battle flash/act transforms off
  (extends the existing CSS block to the class), weather particle density
  scaled to ~30%, quest-HUD flash off. Options row beside Screen Shake.
- **Colorblind assist**: `playerOptions.colorAssist: boolean` (default off) —
  switches HP/MP/ATB gauge fills to the Okabe-Ito colorblind-safe palette
  (distinguishable by luminance too) and adds explicit +/− signs to damage
  and heal popups so color is never the only channel. Defaults audit:
  poison/KO/state indications already carry icons/text (verified in stage);
  document in wiki.
- **Font scaling**: player `playerOptions.textScale` (Small 0.85 / Normal 1 /
  Large 1.15 / Huge 1.3) via a `--ui-scale` CSS custom property consumed by
  message window + menu font sizes in play.css; editor: device-level UI font
  size (Interface Language modal grows a "UI Font Size" row; localStorage
  `rpgatlas_editor_font_scale`; sets a root `font-size` on the editor
  document). Both persist; both live-apply.
- **Deliverables:** three option rows + editor setting; CSS wiring; vitest
  for the option resolvers; e2e: toggling Large text scales the message
  window; patch note; wiki.

### Stage C — i18n completion

- **Key sweep**: enumerate the post-Phase-1 chrome — menu bar additions
  (World View, Command Palette, Asset Browser, Packs, Import wizard, Audio
  Manager v2 sections, Database vertical tabs, dock captions, graph editor
  toolbar, options-menu row labels used by the editor-side pickers) — add
  `data-i18n` attributes / `t()` calls where missing, and fill es/fr/de
  entries for every key.
- **Parity test** (vitest): extracts the union of keys used by `index.html`
  `data-i18n*` attributes plus a registered list of `t()`-only keys, and
  asserts every SHARED locale defines exactly that set (no missing, no
  orphaned). This is the anti-rot gate the roadmap asked for.
- **Scope rule**: editor chrome only (labels, titles, buttons, tab names,
  status templates). Dynamic strings (asset names, project content, patch
  notes, wiki) stay untranslated by design.
- **Deliverables:** expanded dicts; parity vitest; patch note.

### Stage D — Atlas Quest HD showcase

- **Deterministic upgrade script** `scripts/build-atlas-quest-hd.mjs`:
  reads `Atlas_Quest.json`, applies the showcase configuration map-by-map
  (HD-2D enabled everywhere with per-map tuned tilt/lighting/post; day/night
  on the overworld with a warm-evening default; water + shore on coastal
  maps; rain ambience + BGS layer on one dungeon; point lights in interiors;
  soft shadows everywhere; a couple of Atlas Graph-authored events where they
  demo well), and writes the file back. Committed output + rerunnable script
  (same philosophy as `build-starter-pack.mjs`).
- **Constraints**: playthrough e2e stays green (no gameplay-breaking edits:
  start position, transfers, battles, quest chain untouched); procedural-only
  assets (no library dependencies in the sample); renderer goldens untouched
  (they synthesize their own maps).
- **Deliverables:** upgraded sample + script; live playtest verification
  (screenshot proof); patch note; wiki (Your-First-Game pointer to the
  showcase).

### Stage E — Export upgrades

- **Zip writer** (`src/editor/export-zip.ts`): minimal STORE-method zip
  builder (local headers + central directory + CRC-32), pure TS, no deps,
  vitest-covered against a known-good byte layout.
- **Web/itch.io export**: "Export for Web (.zip)" in the standalone-export
  modal — zip root: `index.html` (the standalone game), `manifest.webmanifest`
  (name/icons/display standalone/theme color from the project),
  `sw.js` (cache-first service worker precaching `./` + `index.html`,
  versioned by content hash so re-exports update), `icon-192.png` /
  `icon-512.png` (generated from the project icon tile via canvas). The HTML
  gains a tiny registration snippet ONLY in the zip variant (single-file
  export stays untouched). itch.io requirement (index.html at zip root) and
  PWA/offline are the same artifact.
- **Native desktop game**: `scripts/package-game-exe.mjs <project.json>` —
  builds the standalone game HTML headlessly (Node + the same
  `buildStandaloneGame` sources via Playwright chromium, mirroring
  build-starter-pack.mjs), stages it as a minimal Tauri dist (game window
  config: title from the project, fixed initial size from
  system.screenWidth/Height), and runs `cargo build --release` with a
  game-specific conf overlay → `<Game>.exe` with no browser dependency.
  Editor's export modal documents it ("native EXE — repo script, needs the
  Rust toolchain") while the existing no-toolchain launcher EXE stays the
  one-click path.
- **Deliverables:** zip/PWA export live-verified (install + offline reload);
  vitest for zip bytes + manifest/sw generation; the packaging script
  validated (cargo check + one real build if toolchain present); patch note;
  wiki (Publishing-Your-Game rewrite).

### Stage F — Docs site + 1.0 release

- **Docs site generator** `scripts/build-docs-site.mjs`: dependency-free
  Markdown renderer (headings/lists/code/tables/links/images/bold/italic +
  wiki-style `[[Page]]` links), `_Sidebar.md` → nav, dark theme consistent
  with the editor, output committed under `docs-site/` (GitHub Pages-ready).
- **New reference pages** (source in `wiki/`, rendered into the site):
  `Plugin-and-Script-API.md` (the `atlas.*` plugin bridge +
  script/eval APIs + node registration), `Migration-Guide.md` (format
  versions, what migrates automatically, pre-overhaul → 1.0 upgrade notes).
- **Release**: README refresh (1.0 positioning, docs-site link, quickstart);
  `package.json` 1.0.0 + About modal version; "RPGAtlas 1.0" patch note
  summarizing the overhaul; bug bash = full gate + `/code-review` pass +
  live editor+playtest QA sweep; roadmap ticked; tags `phase-7` + `v1.0.0`;
  merge to main.

---

## Migration

None. No FORMAT_VERSION bump; no project-schema changes at all this phase
(new keys live in `playerOptions` / device settings / export artifacts only).

## Stage plan

- **A — Performance:** overlay + load/stress/memory budgets + fixes; gate.
- **B — Accessibility:** reduced motion, color assist, font scaling; gate.
- **C — i18n completion:** key sweep + dict fill + parity test; gate.
- **D — Atlas Quest HD:** upgrade script + showcase sample + live proof; gate.
- **E — Export upgrades:** zip/PWA export + native game packaging; gate.
- **F — Docs + 1.0:** docs site + API/migration pages + README + QA bash +
  version 1.0.0; tags `phase-7`, `v1.0.0`.

Each stage lands green (full gate), is committed on `phase-7-release`,
pushed, and merged to `main` per the standing workflow.

### Acceptance criteria (phase exit)

1. Perf: editor and player boot inside their budgets; the stress map holds
   its frame budget; repeated transfers leave `renderer.info.memory` stable;
   the perf overlay reports live numbers in playtest.
2. A11y: reduced-motion (auto/on/off) verifiably stills shake/flashes/weather;
   color-assist gauges use the safe palette with sign-redundant popups; text
   scaling works in player (four steps) and editor (device setting), all
   persisted.
3. i18n: switching to es/fr/de localizes the Phase 2–6 chrome; the parity
   test fails on any missing/orphaned key.
4. Atlas Quest HD demos lighting, day/night, water, weather, ambience, and
   graph-authored events with the full playthrough e2e green.
5. Exports: the web zip installs as a PWA and replays offline; the zip is
   itch.io-shaped (index.html at root); `package-game-exe.mjs` produces a
   native game EXE from a project file.
6. Docs site builds from `wiki/` with API reference + migration guide;
   README points at it; version 1.0.0 everywhere; full gate green; tagged
   `phase-7` and `v1.0.0`; merged to main.
