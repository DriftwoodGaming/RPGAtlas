# RPGAtlas Production Roadmap — "Atlas HD" Overhaul

**Status:** COMPLETE — all eight phases shipped; **RPGAtlas 1.0** released 2026-07-03
(tags `phase-0` … `phase-7`, `v1.0.0`; per-phase specs in `docs/phase-N-spec.md`)
**Authored:** 2026-07-01 by Claude Fable 5 (grand designer / orchestrator)
**Goal:** Bring RPGAtlas to feature and quality parity with modern engines (reference point:
Godot 4.5 Forward+) for its niche — HD-2D RPG creation — while keeping the things that make
it special: the single-JSON project model, the RPG-maker authoring workflow, instant playtest,
and self-contained exports.

## Locked decisions (2026-07-01)

1. **Architecture:** Evolve the document-based engine. No Godot-style node-tree rewrite.
   Add an internal scene representation where it pays off, and ship **node-based visual
   scripting** as an authoring layer that compiles to the existing event-command model.
2. **Toolchain:** Full modern toolchain — Vite + TypeScript + npm dependencies (three.js
   et al.). The *export* remains self-contained (single-file HTML / EXE); the *repo* gains a
   build step. README identity badges will be updated accordingly.
3. **Pillars (all four):** HD-2D rendering & VFX · Editor tools & UX · Gameplay systems ·
   Asset & audio pipeline.
4. **Execution:** Phase-by-phase. Each phase is a session (or several) with explicit model
   assignments; a phase ends with tests green, review passed, and a tagged milestone.

---

## Orchestration model

Three-model choreography. The principle: **Fable designs and integrates, Opus builds the
hard cores, Sonnet parallelizes the well-specified breadth.**

| Role | Model | Responsibilities |
|---|---|---|
| Grand designer / integrator | **Claude Fable 5** | Phase specs, public API & interface design, risky migrations (renderer port skeleton, interpreter refactor), cross-cutting review gate, merge/integration, final QA sign-off per phase |
| Heavy systems engineer | **Claude Opus (high effort)** | Large single-owner subsystems: three.js renderer features, node-graph runtime & compiler, battle/animation engines, complex debugging and perf work |
| Parallel feature squad | **Claude Sonnet (high effort)** | Fan-out work with crisp specs: module extraction under existing tests, editor panels, database editors, asset importers, unit tests, docs, patch notes, i18n |

**Working agreement per phase:**
1. Fable writes/updates the phase spec (interfaces first, acceptance criteria, file map).
2. Implementation tasks are dispatched — Opus for the phase's "core," Sonnet agents in git
   worktrees for independent modules.
3. Nothing merges without: tests passing, typecheck clean, a Fable review pass, and (for
   renderer work) golden-image comparisons.
4. Every user-facing change lands a `js/patch-notes.js` entry (per AGENTS.md).
5. Phase exit: `/code-review`, sample project regression playthrough, git tag `phase-N`.

---

## Phase 0 — Toolchain & Safety Net

*Nothing user-visible changes; everything after this gets faster and safer.*

- **Vite + TypeScript adoption, incremental.** `allowJs: true`, existing files stay JS and
  are converted module-by-module in later phases. New code is TS. Two Vite entries
  (editor, player). `window.RPGAtlasDeps` global-shim preserved during migration.
- **Repo layout:** `src/engine/`, `src/editor/`, `src/shared/`, `src/renderer/` — current
  `js/*` files move under `src/` as they are converted; a compatibility staging step keeps
  `index.html`/`play.html` working throughout.
- **Testing:** keep `node --test` suites running; add Vitest for new TS code and a
  Playwright smoke suite (boot editor, paint tile, playtest, battle, save/load).
  **Golden-image render tests** for the WebGL2 renderer (headless GPU via Playwright)
  — the safety net for the Phase 2 renderer port.
- **Export integrity:** single-file HTML export rebuilt on `vite build` +
  `vite-plugin-singlefile`; EXE packaging (`scripts/package-exe.mjs`) and Tauri staging
  (`scripts/stage-frontend.mjs`) consume the same build manifest (kills the packaging-drift
  risk from the architecture doc).
- **CI:** GitHub Actions — typecheck, lint (ESLint + Prettier), unit tests, build, smoke
  tests, Tauri bundle on tags.
- **Schema versioning:** explicit `project.formatVersion`, migration registry in
  `data` core, round-trip migration tests against `Atlas_Quest.json`.
- **Bug audit:** sweep open issues + a structured playtest pass; triage into phase backlogs.
- **README/docs update:** new contributor story (npm i, npm run dev), badge changes.

**Exit criteria:** `npm run dev` serves editor+player with HMR; `npm run build` produces
working exports byte-comparable in behavior to today; CI green; golden images captured.

**Assignments:** Fable — build architecture, migration strategy, export manifest design.
Opus — Vite/TS integration and the export pipeline rebuild. Sonnet — CI, lint config,
Playwright smoke tests, golden-image harness, docs.

---

## Phase 1 — The Great Refactor

*Break the two monoliths along the seams the architecture doc already identified.*

- **`js/engine.js` (4k lines) →** `src/engine/`: `boot.ts`, `scenes/` (title, map, battle,
  menus, shop, gameover), `interpreter/` (event commands as a registry — prerequisite for
  node scripting), `state/` (game state + save/load repository), `plugin-runtime.ts`,
  `script-api.ts`, `input.ts` (absorb `runtime/input.js`).
- **`js/editor.js` (5.7k lines) →** `src/editor/`: `map-editor/`, `event-editor/`,
  `database/` (one module per DB tab), `modals.ts` (the modal/UI framework), `tools/`
  (resource manager, character generator, audio manager, event searcher), `workspace.ts`.
- **Explicit services** (from the architecture doc): `ProjectRepository`,
  `SaveRepository`, `RendererAdapter`, `PluginRuntime`, `MessageService` — typed
  interfaces, host adapters at the edges (browser / Tauri / standalone).
- **Typed project schema:** TS types (+ lightweight runtime validation) for the whole
  project document; this becomes the contract every later phase builds against.
- **Storage abstraction:** `ProjectRepository` backed by localStorage today, Tauri FS and
  IndexedDB next — this is the FS-abstraction shim the desktop packaging plan needs, and
  it removes the localStorage size ceiling before Phase 6 brings real assets.
- **Fixed-timestep game loop** with interpolation; render decoupled from update.

**Exit criteria:** no behavior change (Playwright + golden images prove it); no source file
over ~800 lines; plugin API unchanged and verified against the four built-in plugins.

**Assignments:** Fable — service interfaces, interpreter registry design, integration.
Opus — engine.js split (interpreter, battle, save/load are the delicate ones).
Sonnet — editor.js split fan-out (one agent per feature area, worktrees), test backfill.

---

## Phase 2 — Rendering Core v2 (three.js HD-2D)

*The flagship phase. Port the WebGL2 renderer to three.js behind `RendererAdapter`,
reach strict parity, then blow past it.*

- **Parity port first.** Scene graph: chunked extruded terrain meshes, billboard
  character sprites, overhead layer, perspective tilt camera, bloom, DoF, distance fog,
  16+ point lights, ambient — validated against Phase 0 golden images. The current raw
  WebGL2 renderer stays as a runtime fallback flag until parity is signed off, then is
  retired. `planWalls`/`planLightOccluders` pure helpers and their tests carry over.
- **Then the new capabilities:**
  - Real-time **shadow maps** (directional sun + point light shadows, PCF-soft) —
    characters and extruded terrain cast/receive.
  - **Material system for tiles:** normal + emissive maps auto-generated for procedural
    tiles, importable for custom tiles; specular highlights on wet/metal surfaces.
  - **Water:** animated water plane with planar reflections, refraction, shore foam.
  - **Day/night cycle:** sun color/angle curve, per-map time-of-day, window emissive
    glow at night; a `time` system with script/graph hooks (gameplay tie-in Phase 5).
  - **Post stack:** ACES tone mapping, color-grading LUTs per map, vignette, SSAO,
    FXAA/MSAA — each per-map toggleable like today's `map.hd2d` flags.
  - **GPU particles:** weather (rain/snow/fog volumes) rendered *in* the 3D scene,
    ambient motes, waterfalls; shared particle engine reused by Phase 5 battle VFX.
  - **Terrain upgrades:** slopes/stairs (ramp tiles between heights), cliff auto-texturing,
    soft character drop shadows.
- **Performance budget:** 60 fps at 1080p on integrated GPUs; instancing for terrain
  chunks and particles, frustum culling, texture atlases. Perf CI check on the sample map.

**Exit criteria:** parity goldens pass; new features each demoed in an "Atlas Quest HD"
showcase map; fallback renderer removed; 60 fps budget met.

**Assignments:** Fable — three.js scene architecture + parity skeleton, perf sign-off.
Opus — shadows, water, post stack, particles (the GPU-heavy cores). Sonnet — material
authoring UI hooks, per-map settings plumbing, day/night curve editor, golden updates.

---

## Phase 3 — Editor Platform

*Make the editor feel like a modern tool.*

- **Dockable workspace:** panel docking/tabbing/floating (map, palette, HD-2D live view,
  database, outliner), saved layouts, command palette (Ctrl+P) for every editor action.
- **Live HD-2D viewport:** the Phase 2 renderer embedded in the editor with orbit/pan
  camera, drag gizmos for lights, real-time response to every map/HD-2D property.
- **Autotiles:** 47-blob autotile engine for procedural terrain + import support for
  standard RPG-maker-format autotile sheets; terrain brushes; configurable brush sizes.
- **World view:** map-connection graph (which transfer leads where), drag to re-link,
  bird's-eye multi-map layout; per-map notes.
- **Database upgrades:** searchable/filterable lists everywhere, bulk edit, copy-paste
  entries between projects, formula fields for stats/damage.
- **Unified undo:** one history spanning map, event, and database edits.
- **UI polish pass:** consistent spacing/type scale, dark theme refinement, empty states,
  keyboard navigation completeness.

**Assignments:** Fable — workspace architecture, command registry. Opus — docking system
and live viewport embedding. Sonnet — autotiles, world view, DB upgrades, polish fan-out.

---

## Phase 4 — Atlas Graph (node-based visual scripting)

*The "node-based engine" answer: nodes as an authoring layer, not an engine rewrite.*

- **Graph runtime that compiles to event commands.** Graphs are stored per event page and
  compile deterministically into the Phase 1 interpreter's command registry — so graphs,
  classic command lists, playtest, saves, and plugins all stay mutually compatible, and
  every graph feature works in exported games with zero runtime cost.
- **Graph editor:** custom canvas UI (pan/zoom, minimap, comments/frames, reroute dots),
  live validation, "convert page to graph" and "view graph as command list" both ways.
- **Node library v1:** flow (branch, loop, wait, label/jump), state (switches, variables,
  self-switches, party/gold/items), presentation (messages, choices, pictures, camera,
  transitions, weather, audio), world (transfer, move routes, events), combat (battle
  start/outcomes, shop), custom **Script node** and **Plugin node** (plugins can register
  their own nodes via the existing `atlas.registerCommand` bridge).
- **Stretch:** expression nodes for variable math; shared "function graphs" callable from
  multiple events (compiles to common events).

**Assignments:** Fable — graph IR + compiler design. Opus — graph runtime/compiler and
editor canvas core. Sonnet — node library breadth, validation UX, docs + tutorial project.

---

## Phase 5 — Gameplay Systems

- **Animation engine + editor:** keyframed, particle-and-flipbook skill/battle animations
  with a timeline editor; hit flashes, screen shake, projectiles; reuses Phase 2 particles.
- **Battle options:** keep default turn-based; add **ATB/CTB** modes, action sequences
  (via Atlas Graph!), battle events per troop turn/HP threshold, formations/row,
  richer enemy AI (condition-weighted actions).
- **Movement & world:** A* pathfinding for move routes and touch-to-move, party followers,
  vehicles (boat/ship/airship), jump/ledge tiles, region tags driving encounters/terrain FX.
- **Player-facing systems:** minimap, quest tracker HUD polish, options menu (key/gamepad
  rebinding, volume sliders, window/full toggle), full gamepad navigation of all menus,
  day/night gameplay hooks (shops close, encounters change).

**Assignments:** Fable — animation data model, battle-mode architecture. Opus — animation
engine + ATB core + pathfinding. Sonnet — followers, vehicles, minimap, options menu,
regions, quest polish (parallel agents).

---

## Phase 6 — Asset & Audio Pipeline

- **Asset browser:** drag-drop import, thumbnails, tagging, per-project library over the
  shared `img/` library, "used/unused" audit; backed by the Phase 1 storage abstraction
  (Tauri FS on desktop, IndexedDB in browser — breaking the localStorage ceiling).
- **Importers:** tileset slicer (any grid size → 48px pipeline), RPG-maker autotile formats,
  spritesheet slicer with frame tagging, **Aseprite JSON** animation import, faceset/battler
  packs.
- **Audio v2:** stream OGG/MP3 for BGM/BGS/ME/SE alongside procedural chiptunes; audio bus
  with crossfades, per-map ambience layers, positional SFX in HD-2D; volume mixing in the
  options menu.
- **Starter packs:** curated CC0 HD-2D-ready tile/sprite/audio packs downloadable from the
  editor; export continues to embed only referenced assets.

**Assignments:** Fable — asset reference model (stable IDs across libraries). Opus — audio
engine v2 + storage-backed asset browser. Sonnet — importers fan-out, starter-pack curation.

---

## Phase 7 — Polish, Performance & Release

- Full performance pass (load time budget, memory profiling, big-map stress maps).
- Accessibility: reduced-motion mode, colorblind-safe defaults, font scaling.
- i18n completion across new UI (extending `js/editor/i18n.js`).
- **"Atlas Quest HD"** — rebuild the sample game as the definitive HD-2D showcase.
- Export upgrades: proper native desktop game export via Tauri, itch.io-ready zip,
  PWA/offline player.
- Docs site generated from `wiki/`, plugin/node API reference, migration guide.
- Community beta, bug bash, then **RPGAtlas 1.0**.

---

## Risk register

| Risk | Mitigation |
|---|---|
| Renderer port regressions | Golden-image tests from Phase 0; fallback flag until parity sign-off |
| Build step alienates contributors | `npm run dev` one-liner; README rewrite; keep exports dependency-free artifacts |
| Project compatibility breaks | `formatVersion` + migration registry + round-trip tests every phase |
| localStorage limits w/ real assets | Storage abstraction lands in Phase 1, before Phase 6 needs it |
| GPL-3 + deps | three.js/Vite are MIT — compatible; audit each new dep's license in review |
| Monolith split introduces subtle bugs | Phase 1 is behavior-frozen: Playwright + goldens gate every merge |
| Scope creep inside phases | Stretch items marked; phase exits are checklists, not vibes |

## Sequencing notes

- Phases 0→1→2 are strictly ordered (safety net → seams → renderer).
- Phases 3 and 4 can overlap once 2 lands (different code areas).
- Phase 5 depends on 2 (particles) and 4 (action sequences); Phase 6 depends on 1 (storage).
- Every phase ships user-visible value except 0/1 — those buy the velocity for the rest.
