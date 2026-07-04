# Phase 8 Spec — Advanced Map Editor (Tiled-class mapping)

**Status:** IN PROGRESS — Stages A, B & C landed 2026-07-04. Stage log accumulates
below, phase-3-spec style, as stages land. Next: D/E (parallel worktrees), then F/G.
**Authored:** 2026-07-04 by Claude Fable 5 (grand designer / orchestrator)
**Branch (when work starts):** `phase-8-advanced-map` (off `main`)
**Sources:** Codex feasibility discussion (2026-07-03, recovered from
`~/.codex/sessions/2026/07/03/rollout-...19f2886.jsonl`), the three UI mockups
(main advanced editor / Terrain & Autotile Studio / objects-zones + automap rules),
and a code audit of `main` at `3fc10b9`.

## Objective

Give RPGAtlas the mapping power of Tiled — generalized layers, a terrain/autotile
studio, object & gameplay zones, stamps, tile transforms, and visual automapping —
**natively**, with no third-party app, behind a new **"Advanced Map Editor" tab**.

The existing simple map editor is **not replaced**. Standard and Advanced are two
views over the same map document: everything painted in one is visible in the other,
one unified undo stack spans both, and a project that never opens the Advanced tab
is byte-identical to today.

## Decisions locked at planning time

1. **No Tiled embedding, no TMX dependency.** Tiled is C++/Qt; RPGAtlas is
   TypeScript/Tauri. We build the capabilities, not the integration. TMX/TSX
   import/export is deferred post-phase as optional compatibility.
2. **Additive schema only — no destructive layer migration.** Codex's plan proposed
   replacing `map.layers` with a generalized array behind "compatibility aliases".
   The document is plain JSON; there are no aliases, only a big-bang migration.
   Instead we follow the house pattern (`EventPage.graph`, `map.lights`,
   `map.regions`: optional field, absent-is-meaningful): the four core arrays stay
   the storage for role-bound tile layers; a new optional `map.layersAdv` defines
   the full ordered stack when present. See "Data model".
3. **The Advanced Map Editor is a dock panel**, registered like World View and
   Console (`src/editor/dock/panels.ts`) — it appears as a tab beside Map, toggled
   from the View menu / command palette. Sub-views open from within it:
   - **Terrain & Autotile Studio** → fullscreen modal wizard (Database-modal precedent)
   - **Objects & zones** → the Objects palette tab inside the Advanced panel
   - **Automap Rules** → collapsible bottom drawer inside the Advanced panel
4. **Scope trims vs. the mockups/Codex list** (v1 non-goals below): no infinite
   maps, no isometric/hexagonal, no arbitrary tile sizes (engine is fixed
   `Assets.TILE = 48`; importers re-slice, as today), no TMX interchange.

## Non-goals (whole phase)

- No isometric/hexagonal orientation (collides with the HD-2D renderer's geometry
  model; would be its own phase).
- No infinite/chunked maps (large engine change, low value at RPG map sizes).
- No Tiled TMX/TSX import/export (post-phase optional compatibility).
- No arbitrary tile sizes — 48px pipeline unchanged; the Studio re-slices imports.
- No level-scaling combat semantics: the mockup's encounter-zone "Min/Max Level"
  fields have no engine counterpart and are **omitted** (not stored dead).
- Exports and old projects must be byte-identical when the new fields are absent —
  the same behavior-freeze discipline as Phases 1–3, gated by goldens + Playwright.

## Current-state facts that constrain the design

1. **Fixed-layer coupling is small.** `layers.ground/decor/decor2/over` is read at
   ~28 sites across 9 files: editor (`map-render.ts`, `painting.ts`, `clipboard.ts`,
   `map-list.ts`, `hd-viewport.ts`, `sample-maps.ts`, `location-picker.ts`), engine
   (`map-runtime.ts` `prerenderMap` — ground+decor+decor2 → lowerBuf, over →
   upperBuf), renderer (`three-renderer.ts` — water reads ground, overhead reads
   over). `LAYER_ORDER`/`LAYER_LABELS` live in `src/editor/editor-state.ts`.
2. **All four tile draw paths route through one primitive** —
   `src/shared/autotile-draw.ts` `drawLayerCell` (Phase 3 Stage D consolidation).
   Any per-tile decode (autotile resolve today; flip/rotate flags tomorrow) has a
   single seam.
3. **The 47-blob autotile engine already exists**: pure core `src/shared/autotile.ts`
   (256-mask corner rule, 16 unit tests), registry + assembled-canvas cache
   (`autotile-registry.ts`, reserved ids from `AUTOTILE_BASE = 1_000_000`), A2 sheet
   import (`src/editor/autotile-store.ts`), palette strip + brush sizes
   (`map-editor/autotile-ui.ts`), shared engine/editor/HD-2D resolution. The Studio
   is a front-end + generalization of this, not a new engine.
4. **The dock workspace, command registry, palette, and unified undo are done**
   (Phase 3). New panels = `registerDockPanel` + `registerCommand`; new undoable
   edit domains = the `edit-scope.ts` transaction seam or whole-map snapshots.
5. **Editor state is one shared mutable object** (`editorState` / `S`) with explicit
   change calls (`touch()`, `renderMap()`); no framework. The Advanced editor gets
   its own *view*-state but must mutate the same document through the same seams so
   autosave (`touch()`), undo, and the HD-2D viewport's `viewportDirty()` all fire.
6. **Schema discipline**: additive optional fields, absent-is-meaningful, migration
   registry in `js/data.js` (`FORMAT_VERSION = 2`), forward-compat guard returns
   newer documents untouched. Editor saves the whole in-memory object, so unknown
   fields survive round-trips through an old build's editor; an old *engine* simply
   ignores the new fields (new-format maps degrade to their core four layers).
7. **Gates:** `tsc --noEmit`, eslint, `node --test tests/`, `vitest run`, full
   Playwright including golden-image renderer specs (byte-identical unless a stage
   deliberately adds new goldens). Patch-notes entry per stage (AGENTS.md);
   `css/editor.css?v` bump when styles change; i18n via `editorI18n.t`.

---

## Data model (all fields optional & additive)

Types below land in `src/shared/schema.ts`. Pure helpers land in `src/shared/` so
editor and engine share one implementation. `FORMAT_VERSION` stays 2 — nothing
needs backfill; if Stage A review finds a repair that must run at load, bump to 3
and add it to the registry.

### Typed custom properties (shared)

```ts
/** Tiled-style user properties. Type is carried by the JS value. */
export type TypedProps = Record<string, string | number | boolean>;
```

### Generalized layers — `map.layersAdv`

```ts
/** When present, defines the full ordered layer stack (bottom → top) for both
 *  editors and the renderer composite. Core entries REFERENCE the four role
 *  arrays in map.layers (which remain the tile storage — every existing paint/
 *  clipboard/autotile path keeps writing them); "tile" entries carry their own
 *  data. Absent ⇒ classic stack, byte-identical rendering. */
export interface AdvLayerBase {
  id: number;            // unique within the map
  name: string;
  visible?: boolean;     // default true
  locked?: boolean;      // editor-only: blocks edits, not rendering
  opacity?: number;      // 0..1, default 1
  blend?: "normal" | "add" | "multiply" | "screen";  // default "normal"
  tint?: string;         // CSS color multiplied over the layer (editor+2D first)
  props?: TypedProps;
}
export type AdvLayer =
  | (AdvLayerBase & { type: "core"; role: "ground" | "decor" | "decor2" | "over" })
  | (AdvLayerBase & { type: "tile"; data: number[];      // width*height tile ids
      slot?: "below" | "above" })                        // engine buffer; default "below"
  | (AdvLayerBase & { type: "group"; children: AdvLayer[] });
// stretch (Stage B, only if the engine hook is cheap):
// | (AdvLayerBase & { type: "image"; image: string; parallax?: {x:number;y:number} })
```

Invariants (enforced by a pure `layer-view` module with repair-on-open):

- A valid `layersAdv` contains **exactly one** core entry per role; repair inserts
  missing cores in classic order and drops duplicates/unknowns (same posture as
  `validateLayout` in the dock).
- Render order = flattened list order. Shadows keep their classic position:
  drawn immediately below the first `slot:"above"` / core-`over` layer.
- Engine `prerenderMap`: `slot:"below"` layers composite into `lowerBuf`,
  `slot:"above"` into `upperBuf`, honoring opacity/blend via `globalAlpha` /
  `globalCompositeOperation`. HD-2D folds them into the same two buffers it
  already consumes. When `layersAdv` is absent the classic four-array loop runs
  unchanged (golden-proof).
- The Advanced panel's Layers list additionally shows **Events** and **Collision**
  pseudo-layers (mockup 1). These are mode switches, not stored layers.

### Tile transform flags (Stage E)

```ts
// src/shared/tile-flags.ts (pure, unit-tested)
export const TILE_FLAG_H   = 1 << 28;  // horizontal flip
export const TILE_FLAG_V   = 1 << 29;  // vertical flip
export const TILE_FLAG_R   = 1 << 30;  // 90° clockwise rotation
export const TILE_ID_MASK  = (1 << 28) - 1;
export function tileId(raw: number): number;
export function tileFlags(raw: number): { h: boolean; v: boolean; r: boolean };
```

- Decode lives centrally in `drawLayerCell` (fact 2), so all four draw paths get
  transforms at once. `AUTOTILE_BASE` ids sit far below bit 28; every existing
  `id >= AUTOTILE_BASE` / equality comparison is audited to mask first
  (`isAutotileId` and palette-highlight checks are the known sites).
- Flags apply to plain tiles only in v1; autotile groups already resolve shape
  (their flip/rotation story lives in the terrain set, below).

### Terrain sets — generalize `Autotile` (Stage C)

Extend the existing interface additively; absent fields = today's A2 47-blob:

```ts
export interface Autotile {
  id: number;
  name: string;
  sheet: string;                       // data URL (existing)
  terrain?: boolean;                   // existing
  pass?: boolean;                      // existing
  // ---- Phase 8 (Terrain Studio) ----
  kind?: "blob47" | "edge16" | "corner16" | "a1" | "a3" | "a4";  // absent = blob47/A2
  variants?: { sheet: string; weight: number }[];   // weighted visual variations
  allowFlipH?: boolean; allowFlipV?: boolean; allowRot?: boolean; // pattern completion
  preferOriginal?: boolean;            // prefer authored tiles over derived transforms
  anim?: { frames: number; fps: number };           // A1-style frame strips
  props?: TypedProps;
}
```

- `autotile-registry.ts` gains per-kind resolvers (edge16/corner16 are subsets of
  the 47-mask table; A3/A4 are the RPG-Maker building/wall layouts; A1 = blob47 ×
  frames). The map still stores one reserved id per group — save format untouched.
- **Animated terrain runtime:** `prerenderMap` records the cells whose resolved
  group has `anim`; a shared ticker redraws only those cells onto `lowerBuf` at
  `fps` (editor 2D, engine, HD-2D texture refresh). Cap redraw cost; absent
  `anim` ⇒ zero new work.

### Objects & gameplay zones — `map.zones` (Stage D)

```ts
export type ZoneShape =
  | { type: "rect"; x: number; y: number; w: number; h: number }   // tile units
  | { type: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { type: "poly"; pts: { x: number; y: number }[] }
  | { type: "point"; x: number; y: number };

export interface MapZone {
  id: number;
  name?: string;
  kind: "encounter" | "transfer" | "sound" | "weather" | "spawn"
      | "collision" | "nav" | "custom";
  shape: ZoneShape;
  props?: TypedProps;                  // free-form; the whole payload for "custom"
  // per-kind payloads (only the matching one is read):
  encounter?: { troops: number[]; rate: number; regionFilter?: number[] };
  transfer?:  { mapId: number; x: number; y: number; dir?: 0|1|2|3 };
  sound?:     { key: string; vol?: number; falloff?: "none" | "linear" };
  weather?:   { kind: string; power: number };
}
```

Runtime semantics (all behind `map.zones` absence ⇒ zero change):

- **encounter**: while the player stands inside, the zone's pool replaces
  `map.encounters.troops` for the roll — same precedence family as `byRegion`
  (zone > region > time > default).
- **transfer**: fires on enter (edge-triggered), routed through the ordinary
  interpreter `transfer` command.
- **sound**: loops an ambience-bus layer while inside; `falloff:"linear"`
  attenuates by distance to the shape (reuses Phase 6 positional-audio math).
- **weather**: applies while inside, restores the map's weather on exit.
- **spawn**: named point, resolved at **edit time** — the transfer-command location
  picker offers spawn points and writes plain coordinates. Zero runtime cost.
- **collision / nav**: rasterized once at map load into the pass grid
  (force-block / force-pass, same values as `passOv`), so the movement hot path
  is untouched. Pure helper `src/shared/zone-raster.ts`.
- **Light** in the Objects palette edits the existing `map.lights` (no zone kind).
- **custom**: inert to the engine; exposed to plugins/Script via
  `atlas.zonesAt(x, y)` — the plugin-facing win of the whole model.
- Point-in-shape checks precompute bounding boxes; polygon test is the standard
  even-odd rule in a pure, unit-tested module (`src/shared/zone-geom.ts`).

### Stamps — `proj.stamps` (Stage E)

```ts
export interface Stamp {
  id: number;
  name: string;
  w: number; h: number;
  /** same shape as the tile clipboard: per-core-role tile arrays (+ shadows) */
  layers: Partial<Record<"ground" | "decor" | "decor2" | "over", number[]>>;
  shadows?: number[];
  tags?: string[];
}
```

A stamp is a persisted clipboard entry: capture = "Save selection as stamp",
placement = the existing paste path. Random-stamp mode scatters within the brush
footprint with per-stamp probability.

### Automap rules — `map.automapRules` (Stage F)

Per-map in v1 (matches the mockup's panel); a project-level shared library with
copy/paste between maps reuses the Phase 3 DB-clipboard pattern as a stretch.

```ts
export interface AutomapRule {
  id: number;
  name?: string;
  enabled?: boolean;      // default true
  if: RulePredicate[];    // ANDed
  then: RuleAction[];
  seed?: number;          // deterministic preview/apply
}
export type RulePredicate =
  | { kind: "terrainIs"; terrain: number }                    // autotile group / tile id, ground
  | { kind: "tileIs"; layerId: number | "core:ground" | "core:decor" | "core:decor2" | "core:over"; tile: number }
  | { kind: "near"; terrain: number; radius: number }
  | { kind: "notNear"; terrain: number; radius: number }
  | { kind: "regionIs"; region: number }
  | { kind: "passable"; value: boolean };
export type RuleAction =
  | { kind: "placeTile"; layerId: AdvLayer["id"] | string; tile: number; probability?: number }
  | { kind: "placeStamp"; stampId: number; probability?: number }
  | { kind: "setRegion"; region: number };
```

Editor-only: evaluation is a pure function `(map, rules, seed) → cell edits`
(`src/shared/automap.ts`, fixture-grid unit tests); **Preview** renders the diff as
an overlay; **Apply** commits it as one labeled undo entry. Zero runtime/export cost.

### Map tree folders (Stage A shell, editor-only)

```ts
// proj.mapFolders?: { id: number; name: string; parentId?: number | null }[]
// map.folderId?: number      // absent = root
```

Purely organizational (mockup 1's World ▸ Region ▸ maps tree); the flat `maps`
array and every `byId` lookup are untouched.

---

## UI shell

- **Panel:** `registerDockPanel({ id: "adv", title: "Advanced Map Editor",
  mount: mountAdvancedEditor, closable: true })` + `registerCommand("panel-advanced", …)`
  (View menu, palette, and a keyboard chord). Lazy `mount` like HD-2D/World/Console.
- **Inside the panel** (own DOM, own view-state `advState`: tool/zoom/selection/
  active layer — *not* shared with `S`'s map view): left rail = Map Tree + Layers
  list (with Events/Collision pseudo-layers); center = its own canvas driven by the
  shared render core; right rail = Tiles / Terrain / Stamps / Objects tabs +
  contextual Properties (selection-driven: layer ⇒ opacity/blend, zone ⇒ kind
  payload, terrain ⇒ set link); bottom = tool strip + coordinates + Automap drawer.
- **Shared render core:** Stage A extracts `renderMapView(g, map, view)` from
  `map-render.ts` — the existing `renderMap()` becomes a thin wrapper binding `S`.
  Behavior-frozen (the painting e2e and a canvas-hash assertion gate the refactor).
- **Document mutation** goes through the same seams as the simple editor:
  `touch()` for autosave + `viewportDirty()` + `worldDirty()`, whole-map snapshots
  (`pushUndo`) for paint/zone edits, `edit-scope` transactions for
  properties-panel edits — so Ctrl+Z works identically from either editor.
- **Terrain & Autotile Studio:** fullscreen modal (mockup 2) with the 5-step rail
  (Source / Layout / Terrain Types / Rules / Preview), pattern-completeness
  check-marks, live preview painting on a scratch map, Save Draft (localStorage)
  and Create Terrain Brush (writes `proj.autotiles`).

---

## Stage plan

Stages C, D, E are independent areas and can run as parallel worktrees once B
lands; F needs C (terrain predicates) and E (stamp actions); G closes the phase.

### Stage A — Foundation & shell *(Fable)*

Schema types + `layer-view` pure module (ordering, repair, opacity/blend resolve —
unit tests); `renderMapView` extraction (behavior-frozen); the Advanced panel
skeleton: dock registration, Map Tree (with folders), Layers list rendering the
layer-view model read-only, command registrations, css tokens.
**Exit:** tab opens and renders any map; simple editor pixel-identical (e2e +
canvas hash); full gate green; goldens untouched.

### Stage B — Generalized layer system *(Opus)*

`layersAdv` CRUD in the Layers panel (add/rename/reorder/group/visibility/lock/
opacity/blend/tint); painting/fill/rect/clipboard/undo against any tile layer
(active-layer routing through the existing `painting.ts` seams); engine
`prerenderMap` composite path + HD-2D buffer folding; classic path proven
byte-identical (all existing goldens); **new** goldens for a `layersAdv` fixture
map (2D + HD-2D).
**Exit:** a map with 3 user layers + blend/opacity renders identically in editor,
playtest, and export; old projects untouched; gate green.

### Stage C — Terrain & Autotile Studio *(Opus core; Sonnet wizard breadth)*

Registry generalization (per-kind resolvers, variants, transform completion,
`anim`); animated-cell ticker (editor/engine/HD-2D); the Studio wizard UI with
per-format presets, auto-detection (grid + arrangement heuristics over the sheet),
completeness validation, weighted variations, live preview; A2 importer folded in
as the "quick path".
**Exit:** each preset format imports → paints correctly in both editors and
playtest; animated water animates in all three surfaces; absent `anim`/`kind` ⇒
goldens byte-identical; pure-core tests for every new resolver kind.

### Stage D — Objects & gameplay zones *(Opus runtime; Sonnet editor breadth)*

`zone-geom` + `zone-raster` pure modules; drawing tools (rect/ellipse/poly/point,
vertex editing, snap); Objects palette + per-kind inspectors (mockup 3); runtime
semantics per kind behind absence guards; `atlas.zonesAt` script/plugin surface;
"Test Encounter in This Area" (launches playtest with a forced roll).
**Exit:** each zone kind demonstrably works in playtest and export; a
zone-heavy map shows no measurable movement-loop regression (perf spec); zones
absent ⇒ engine byte-identical; e2e draws a polygon encounter zone and round-trips
it through save/load.

### Stage E — Stamps, tile transforms & palette upgrades *(Sonnet fan-out; Opus reviews the flag-bit audit)*

`tile-flags` module + central decode in `drawLayerCell` + comparison-site audit;
flip/rotate UI (X/Y/R keys in Advanced, applied to brush or selection); stamp
capture/library/placement + random mode; categorized & searchable tile palette
(mockup 1 right rail; categories from tile metadata, shared with Standard's
palette where it fits).
**Exit:** flipped/rotated tiles render correctly in editor/engine/HD-2D and
survive save/export; autotile id checks proven flag-safe (unit tests over the
mask helpers + an autotile-adjacent flag fixture); stamps round-trip; gate green.

### Stage F — Visual automapping *(Opus rule engine; Sonnet UI)*

`automap.ts` pure evaluator (seeded RNG, fixture-grid tests incl. determinism);
the IF/AND/THEN rule editor (mockup 3 bottom drawer) with predicate/action
pickers bound to terrains/layers/stamps; preview overlay diff; apply-as-one-undo.
**Exit:** the mockup's example (grass + near-water ⇒ scatter reeds 35%) is
buildable in the UI, previews, applies, and undoes as one step; rules stored on
the map do nothing at runtime (export unchanged); gate green.

### Stage G — Polish, docs & integration *(Fable sign-off; Sonnet breadth)*

i18n sweep of every new string; keyboard/palette completeness (every new action a
registered command); wiki updates (`Maps-and-Tiles.md`, `The-Editor-Interface.md`,
a new `Advanced-Map-Editor.md`); patch-notes entries reconciled; big-map perf pass
(64×64 with 8 layers + 50 zones); an "Advanced Meridian Village" showcase map in
the sample project exercising layers/terrain/zones/automap; final `/code-review`
+ regression playthrough + tag `phase-8`.

---

## Orchestration

Same choreography that shipped Phases 0–7: **Fable designs and integrates, Opus
builds the hard cores, Sonnet parallelizes the well-specified breadth.**

| Role | Model | Phase 8 responsibilities |
|---|---|---|
| Grand designer / integrator | **Claude Fable 5** | This spec; Stage A; the `layersAdv`/zones/terrain-set contracts; review gate on every merge; the Stage E flag-bit audit sign-off; Stage G QA |
| Heavy systems engineer | **Claude Opus (high effort)** | Stage B layer engine + renderer composite; Stage C registry/anim core; Stage D zone runtime; Stage F rule engine |
| Parallel feature squad | **Claude Sonnet (high effort)** | Studio wizard steps, zone inspectors, stamps/palette, automap UI, tests, i18n, wiki, patch notes — one worktree per module |

Working agreement per stage: spec-first (this file gains a per-stage section on
entry, phase-3 style), worktrees for parallel modules, nothing merges without the
full gate + Fable review, patch-notes entry per user-facing stage.

## Risk register

| Risk | Mitigation |
|---|---|
| Dual layer sources of truth (`layers` roles vs `layersAdv`) drift | One pure accessor module owns the merged view; repair-on-open; invariant unit tests; core arrays remain the only tile storage for role layers |
| Tile flag bits break id comparisons (autotile, palette, props) | Central decode in `drawLayerCell`; audited comparison sites; mask helpers unit-tested; flags excluded from autotile ids in v1 |
| Animated terrain regresses perf or goldens | Animated-cell list only (no full re-render); absent `anim` ⇒ path not entered; goldens use non-animated fixtures |
| Zone checks in the movement hot path | collision/nav rasterized at load; encounter/weather/sound checked on tile-enter only, with bbox pre-filter |
| Advanced/Standard undo divergence | Both editors funnel through `pushUndo`/`edit-scope`; e2e: edit in Advanced, undo in Standard, and vice versa |
| Renderer composite breaks HD-2D parity | `layersAdv` absent ⇒ classic loop untouched (existing goldens); new behavior only under new goldens |
| Scope creep toward full Tiled parity | Non-goals list above is the contract; stage exits are checklists; deferred items get their own future specs |

## Deferred (post-phase candidates, in rough priority order)

1. Tiled TMX/TSX import/export (interchange, not capability)
2. Image/parallax layers (if not landed as the Stage B stretch)
3. Project-level automap rule library shared across maps
4. Isometric / hexagonal orientations
5. Infinite/chunked maps
6. Scriptable map tools / plugin-defined brushes (extends the Stage D plugin surface)

## Stage log

### Stage A — Foundation & shell (landed 2026-07-04, Fable)

Open items 1–3 resolved as recommended: HD-2D per-layer blending may be
approximate in v1 (documented, Stage B stretch); image/parallax layers stay a
Stage B stretch; the Advanced panel opens as a normal dock tab (the dock
already persists the user's layout).

Shipped:

- **Schema** (`src/shared/schema.ts`): `TypedProps`, `AdvLayer` union +
  `map.layersAdv`, `MapZone`/`ZoneShape` + `map.zones`, `AutomapRule` +
  `map.automapRules`, `Stamp` + `proj.stamps`, `MapFolder` + `proj.mapFolders`
  / `map.folderId`, and the Phase 8 `Autotile` extensions (`kind`, `variants`,
  transform-completion flags, `preferOriginal`, `anim`, `props`). All optional,
  absent-is-meaningful; `FORMAT_VERSION` stays 2.
- **`src/shared/layer-view.ts`** (pure, 13 unit tests in
  `tests-unit/layer-view.test.ts`): `classicStack`, `repairLayersAdv`
  (one core per role — missing cores inserted in classic order, duplicate
  cores/unknown types dropped, ids uniqued), `flattenLayers` (group
  visibility ANDs, lock ORs, opacity multiplies, blend validated),
  `layerView`, `shadowIndex` (shadows immediately below the first
  `slot:"above"` entry), `nextLayerId`.
- **`renderMapView(g, map, view)`** extracted from `map-render.ts`;
  `renderMap()` is now the thin wrapper binding `S` via `viewFromS()`.
  Behavior-frozen: same draw calls in the same order; the painting e2e and
  the full Playwright suite pass unchanged. The source-regex guards in
  `tests/editor-playtest-sync.test.js` were updated to the new `v.` spelling.
- **Advanced panel** (`src/editor/advanced/adv-panel.ts`): dock id `adv`,
  lazy `mount`, tab caption "Advanced". Left rail = Map Tree (folders CRUD:
  ＋ creates, double-click renames, ✕ deletes with children reparented,
  drag a map row onto a folder to file it — `touch()` on every mutation) and
  the read-only Layers list (Events/Collision pseudo-rows + the layer-view
  stack top-first, opacity/blend/lock badges). Center = canvas driven by
  `renderMapView` under the panel's own `advState` (zoom only, this stage).
  Rebuild discipline mirrors the World View: `advDirty()` wired into
  `touch()`, debounced, ResizeObserver catches shown-while-dirty.
- **Command** `panel-advanced` (F4; View menu; palette) in `dock/panels.ts`;
  F4 chord in `boot.ts`.
- **i18n**: 9 new chrome keys ("Advanced", "Advanced Map Editor", "Map Tree",
  "Layers", "Events", "Collision", "New Folder…", "Rename…", "Folder name")
  added to all 10 locales; panel-internal keys added to the parity gate's
  curated list.
- **CSS**: `.adv-*` block appended to `css/editor.css`; `?v=54 → 55`.
- Patch-notes entry ("Advanced Map Editor — first look"); `patch-notes.js`
  `?v=35 → 36` (help.ts + shims.d.ts).

Gate: tsc, eslint, `node --test` 16/16, vitest 314/314 (incl. the new
layer-view suite and i18n parity), Playwright 37 passed. Known pre-existing
failures NOT from this stage, confirmed identical on clean `main` @ `3fc10b9`:
(a) `tests/schema-version.test.js` asserted the bundled sample predates
`meta.formatVersion`, but the Phase 7 Stage D HD rebuild ships it stamped at 2
— assertion updated to expect the stamp; (b) the 8 WebGL renderer goldens +
showcase spec mismatch on this machine (GPU/driver drift vs. the recording
machine, ~3–6% pixels); goldens were NOT re-recorded.

Verified live (vite dev + preview): panel opens via F4, tree renders the
sample project's 3 maps, folder create/file-into works and autosaves, map
selection syncs Advanced ↔ classic both ways, Layers list shows the classic
stack read-only, canvas renders at the panel's own zoom, zero console errors.

### Stage B — Generalized layer system (landed 2026-07-04, Opus)

Both Stage A open items 1–2 resolved as recommended (documented below); image/
parallax layers deferred to the post-phase list (not needed for the exit).

Shipped:

- **Shared composite** (`src/shared/layer-composite.ts`, pure-ish): `drawEntryTiles`
  (per-layer draw with tint via a confined offscreen multiply) and
  `composeAdvBuffers` (folds the flattened stack into the engine's lower/upper
  buffers — `slot:"below"→lower`, `above→upper`, honoring opacity/blend/tint).
  `layer-view.ts` gained `BLEND_COMPOSITE` (blend→globalCompositeOperation) and
  `entryArray` (a flattened entry's live tile array: role array for cores, own
  `data` for tile layers).
- **Three render sites branch on `layersAdv`**, classic path kept **verbatim**
  (byte-identical, golden-proof): `renderMapView` (editor 2D — new inline
  `drawAdvLayers` with shadow interleave at `shadowIndex` + active-layer dim via
  the new `MapView.activeLayerId`), engine `prerenderMap`, and the live HD-2D
  `buildBuffers`. HD-2D gets blend/opacity **exactly** (baked into the 2D buffers
  it textures) — the Stage A "approximate HD-2D blend" caveat is moot.
- **Undo captures `layersAdv`**: `snapshotOf`/`applySnapshot` now deep-clone and
  restore it, so Advanced-editor paints/reorders/props undo (and cross-editor
  undo stays consistent). Absent on classic maps ⇒ undefined round-trips.
- **Advanced panel is editable** (`adv-state.ts` view-state + pure nested-stack
  ops; `adv-layers.ts` Layers UI; `adv-paint.ts` canvas painting; `adv-panel.ts`
  wires them via a cycle-safe `advHooks`): add tile layer / group, group /
  ungroup, reorder (▲▼), delete (cores protected), rename, 👁 visibility, lock,
  and a properties block (opacity slider, blend select, tint colour, draw slot).
  Painting (pen/erase/fill/rect) routes to the **active** layer through
  `pushUndo`/`touch()`; the tile palette + brush size are shared with the
  Standard editor. `ensureLayersAdv` promotes a classic map to a stored stack
  only on first edit, so untouched projects stay byte-identical.
- **i18n**: 18 new layer keys added to all 10 locales + the parity gate's curated
  list. **CSS**: `.adv-layers-toolbar` / `.adv-layer-props` / `.adv-prop-*` block;
  `?v=55 → 56`. Patch-notes "Advanced Map Editor — paintable layers"; `?v=36 → 37`
  (help.ts + shims.d.ts).

Gate: tsc, eslint clean; vitest **324** (+10: `adv-layers-ops` 8, `layer-view`
+2); `node --test` 16/16; Playwright renderer-golden — the **3 new
`generalized layers` tests pass** and the pre-existing **8 failures are byte-for-
byte identical to a clean-`main` run** (7 heavy-WebGL post goldens + the stale
`classic2d` baseline; confirmed via `git stash` A/B). New goldens use **in-run
comparison** (no committed PNG): 2D defaults-only composite == classic (0 pixel
diffs, proving `composeAdvBuffers` reproduces the four-array loop buffer-for-
buffer); 2D user blend/opacity layers change the frame and are boot-deterministic;
HD-2D folding adds no divergence beyond the classic-vs-classic WebGL noise floor.

Stage B traps / decisions:
- **The `classic2d-meridian-village.png` golden is stale on `main`** (New Game
  loads `system.startMapId=10` "Murky Swamp", but the baseline is Meridian) — it
  fails 0.31 on any machine now, pre-existing. Stage B goldens therefore avoid
  committed baselines entirely (in-run pixel comparison). Consider re-recording
  or renaming that baseline in Stage G.
- Golden fixtures MUST target the **start map** (`system.startMapId`), not
  `maps[0]` — the earlier version applied `layersAdv` to Meridian while the engine
  rendered the swamp, so the composite path was never exercised (0 diffs for the
  wrong reason).
- `renderMapView` composite path only runs when `map.layersAdv` is present; the
  sample maps have none, so the editor canvas-hash / painting e2e still exercise
  the classic branch — untouched.
- Opacity is applied live on the slider (mutate + render + save on release) but is
  **not** pushed to undo (continuous sliders would spam the stack); discrete props
  (blend, tint, slot, visibility, lock) and structural ops all push one undo entry.
- Dynamic `import()` in the preview returns a **fresh** module instance (proj null)
  — verify live editor state through the DOM + `localStorage`, not module imports.

### Stage C — Terrain & Autotile Studio (landed 2026-07-04, Opus)

Registry generalization + animated terrain across all three surfaces + the
five-step Studio wizard. Additive throughout; a project with no `kind`/`anim`/
`variants` renders byte-identically (the sample maps have no autotile groups at
all, so the classic path is untouched; the pure Canvas2D "defaults-only stack ==
classic" e2e still passes 0-diff).

Shipped:

- **Pure per-kind resolvers** (`src/shared/terrain-kinds.ts`, 24 unit tests):
  `resolveTile(kind, same, frame)` maps a neighbourhood to a source rect (+ optional
  corner minitiles). `blob47`/`a1`/`a4` route through the existing corner rule
  (`a1` offsets the block right by `frame`); `edge16`/`corner16`/`a3` are whole-tile
  wang layouts via `edgeMask`/`cornerMask`. Plus `pickVariant` (deterministic
  cumulative-weight pick), `cellHash` (stable per-cell salt), `detectKind` (Layout
  auto-detection from sheet dimensions), `requiredTileCount`/`frameTileGrid`
  (completeness metadata). Every kind is proven in-bounds over all 256 masks.
- **Generalized registry** (`autotile-registry.ts`): `registerAutotile(id, block,
  meta?)` now carries `kind`/`anim`/weighted-`variants`; `resolveAutotileCell(id,
  same, TILE, frame, x, y)` is the new generalized draw seam (per-kind resolve +
  variant pick + frame). A group registered with no meta reproduces the Phase 3
  blob47 output bit-for-bit (the blob path keys its cache on the raw 8-neighbour
  mask, so no fold-collision can serve a wrong shape). `autotileAnim`/
  `anyAutotileAnimated`/`autotileKind` expose metadata; the legacy `autotileCanvas`
  (swatch/preview path) is kept, mask-keyed.
- **Central decode seam** (`autotile-draw.ts`): `drawLayerCell` gained a trailing
  optional `frame = 0` and now routes through `resolveAutotileCell`. Kept tightly
  scoped — one new default param, no signature reshuffle — so Stage E's flip/rotate
  flags drop into the same function without conflict.
- **Animated-terrain runtime** (`src/shared/autotile-anim.ts`, 10 unit tests):
  `scanAnimatedCells` records only the cells whose group animates (empty ⇒ the
  surfaces never enter the loop); `redrawAnimatedCells(cells, frameFn, prev,
  recompose)` re-composites just the cells whose frame changed, via a caller
  `recompose(x,y,frame)` that redraws the whole below-stack column for that cell
  (`recomposeLowerCell` in `layer-composite.ts`) so a bridge over animated water is
  preserved; the engine also re-lays the cell's shadow quads. Frame derives from
  `frameAtTick(globalT, fps, frames, 60)` in the engine (deterministic under the
  golden frozen clock) and wall-clock `frameAt` in the editor previews.
  - **Engine** (`map-runtime.ts`): records animated cells at prerender (capped at
    2048 to bound worst-case redraw), `tickMapAnim(ctx.globalT)` called each map
    update (before the menu early-return, so water flows under menus); re-textures
    the HD lower buffer only when a frame changed.
  - **Editor 2D** (`map-render.ts`): a self-starting rAF loop re-renders the map
    (and any registered advanced canvas) at 4fps while any group animates; `MapView`
    gained an optional `frame` threaded into every `drawLayerCell`/`drawEntryTiles`.
  - **HD-2D viewport** (`hd-viewport.ts`): rebuilds its buffers when the shared
    preview frame advances; `buildBuffers(m, frame)`.
- **Terrain & Autotile Studio** (`src/editor/advanced/terrain-studio.ts` + CSS):
  fullscreen modal, five-step rail (Source / Layout / Terrain Types / Rules /
  Preview). Source: drop/pick a sheet, or the classic A2 importer as the "Quick
  path". Layout: `detectKind` pre-selects the arrangement with a grid overlay; all
  six kinds selectable. Terrain Types: name + terrain/pass + transform-completion
  flags. Rules: animation (frames/fps) + weighted variant sheets. Preview: an 8×8
  scratch field painted through the SAME `resolveAutotileCell` the engine uses
  (animates live if `anim` is on) + completeness check-marks. **Save Draft**
  (localStorage) and **Create Terrain Brush** (`createTerrainGroup` in
  `autotile-store.ts`, which writes `proj.autotiles` + re-syncs the registry).
  Launched from a rail button in the Advanced panel and the `terrain-studio`
  command (palette-reachable).
- **i18n**: 37 Studio chrome keys across all 10 locales + the parity gate's curated
  list (help/body text falls back to English by design, per the Phase 7 scope rule).
  **CSS**: `.studio-*` + `.adv-studio-btn` block; `?v=56 → 57`. Patch-notes "Terrain
  & Autotile Studio"; `?v=37 → 38` (help.ts + shims.d.ts).

Gate: tsc + eslint clean; `node --test` 16/16; vitest **358** (+34: terrain-kinds
24, autotile-anim 10). Playwright (authored, not part of the parallel-worktree
run): the two classic-2D Stage-C e2e specs pass live against the built bundle —
`terrain-anim.spec.mjs` "animated water changes frame over time, deterministically"
and "preset terrain paints and differs from ground"; the editor `Terrain & Autotile
Studio` spec opens the wizard from the palette, renders all 5 steps + 6 kinds, and
closes with zero page errors. The Stage-B pure-Canvas2D byte-identity spec ("2D:
defaults-only core stack == classic") still passes **0-diff**, proving the new
`drawLayerCell`/composite path leaves the classic render untouched. WebGL goldens +
the animated-water/preset HD-2D specs were left for the integrator's single e2e run
(three parallel worktrees must not thrash the GPU); the known pre-existing 8 golden
failures are unchanged by this stage (classic path byte-identical).

Stage C traps / decisions:
- **Determinism trap (important):** the engine anim clock MUST derive from
  `ctx.globalT` (the tick counter every other renderer animation keys off), NOT
  `performance.now()`. An early `performance.now()` version failed the animated-water
  e2e with a full-field diff at the *same* virtual time — Playwright's frozen clock
  advances ticks deterministically but the wall-clock read raced. `frameAtTick` fixed
  it; the editor previews (not under the frozen clock) keep the wall-clock `frameAt`.
- **Cache-key trap:** the blob-family cache MUST key on the raw 8-neighbour mask
  (0..255, unique per shape), not a folded corner-set hash — an early fold into 10
  bits risked serving a wrong-but-cached shape, which would break goldens. Wang kinds
  key on their whole-tile index.
- **Recompose, don't blit:** an animated cell can sit under decor/a bridge, so the
  redraw clears+re-composites the entire below-stack column for that one cell (clipped
  to the cell rect) and re-lays its shadow — a naive single-tile blit would erase the
  overlay. Only the lower buffer animates (terrains are ground-family); the overhead
  buffer is never touched.
- **Shared-file collisions (for the integrator):** Stage C touched `autotile-draw.ts`
  (added a trailing `frame = 0` param to `drawLayerCell`) and `layer-composite.ts`
  (threaded `frame` through `drawEntryTiles`/`composeAdvBuffers`, added
  `recomposeLowerCell`). Stage E is separately adding flip/rotate bit-flags to
  `drawLayerCell` — the change here is purely additive (one optional trailing param,
  no reshuffle) to minimise the merge conflict; the flag decode still slots into the
  same `isAutotileId`/`drawTile` fork.
- **Preview registry id:** the Studio previews under a transient reserved id
  (`AUTOTILE_BASE + 900_000`) so it never collides with real groups; it is
  unregistered on modal close (`onClose`).
- Vite dev/preview served stale `?v=55/56` from a concurrent chat's dev server
  sharing this worktree's `.vite` cache — a live-preview artifact, not a code issue;
  the built bundle + the fresh-build e2e are the ground truth (both correct).

## Open items to confirm before Stage A starts

1. **Blend modes in HD-2D:** classic 2D gets full blend support via canvas
   composite; the three.js path folds layers into two buffers, so per-layer blend
   beyond opacity may render approximately there in v1. Acceptable? (Recommend: yes,
   document it; exact HD-2D blending is a Stage B stretch.)
2. **Image/parallax layers:** include as Stage B stretch or defer entirely?
   (Recommend: stretch — take it only if the engine hook stays under ~a day.)
3. **Panel vs. maximized default:** should opening the Advanced tab maximize it
   over the dock (mockup 1 is full-window), or open at the Map region's size and
   let the user maximize? (Recommend: open as a tab, remember the user's layout —
   the dock already persists this.)
