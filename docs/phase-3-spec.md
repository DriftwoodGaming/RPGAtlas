# Phase 3 Spec — Editor Platform

**Status:** IN PROGRESS. Stage log accumulates here, phase-2-spec style.

Stage F COMPLETE (2026-07-02): unified undo + UI polish. **Unified undo** —
implemented exactly per the design note below (one stack, tagged entries, no
command-pattern rewrite), with one deliberate refinement: instead of wrapping
each bound-input helper in dom.ts, the transaction hook lives in `touch()`
itself (`persistence.ts` → `noteEdit()`), which catches bound inputs AND
structural ops (New/Delete/Duplicate/Bulk/Paste/resize) through one seam.
Pure core `src/editor/scoped-restore.ts` (`ScopeSpec`, `cloneScoped` with
top-level `skip`, recursive in-place `restoreInto` that preserves object/array
identity so every live reference — S.proj, S.proj.items, a map's layers —
survives a restore; 11 unit tests). Transaction engine
`src/editor/edit-scope.ts`: `beginEdit(scope)` baselines EAGERLY at dialog
open (edits mutate before touch() fires, so lazy capture would be too late),
`noteEdit()` debounces an 800 ms commit window, `commitEdit()` always diffs —
never gated on a dirty flag, because Map Properties' OK mutates, close()s,
and only then touch()es. `map-editor/history.ts` becomes the unified stack:
map snapshots gain `kind:"map"` + a per-call-site label ("Paint", "Cut tiles",
"Event edit", …), scoped entries are `{kind:"scope", label, scope, data}`;
undo/redo `commitEdit()` first (pending typing becomes undoable instantly),
then dispatch on the tag; scoped restores run `withEditsSuppressed` +
`resyncEditBaseline` so an undo never re-enters the transaction. Scopes wired:
**Database** (one scope = S.proj minus `maps`, shared across opens; a
module-level `liveRefresh` routes the post-restore redraw to whichever DB
dialog is open now, else map list + map re-render) and **Map Properties**
(scope = the whole map object, so name/hd2d/notes AND resize undo as one
labeled step); event edits were already whole-map snapshots. **Keyboard
completeness**: Ctrl+Z/Y now reach the shared history inside scoped dialogs
(boot.ts modal branch; text-ish fields keep native text undo — checkbox/
select/list focus undoes), and ↑/↓ in any DB search box walks the filtered
list (form follows, row scrolled into view). **UI polish**: Edit menu /
palette / toolbar tooltips name the next step via `EditorCommand.menuLabel`
("Undo — Database edit"); css/editor.css gets a token pass — 20 surface/line/
text tokens + a small/tiny type scale in :root, ~120 literals replaced and
near-duplicate shades collapsed (#30344b→--line-2 etc.), `:focus-visible`
gold rings on all buttons, thin themed scrollbars everywhere (`scrollbar-
width/color`). Empty states audited: db-empty/autotile/trait/searcher/palette
all already present. `editor.css?v=44`, `patch-notes.js?v=11` (+ shim), wiki
(Editor-Interface shortcut table, Database "Working with the lists").
Verified live (DB rename+New undone/redone inside the open dialog with tab
refresh; closed-dialog undo restores through localStorage byte-exact —
items back to 4, "Potion"; Map Properties rename+resize 30→24 as ONE undo,
ground array back to 408; menu shows "Undo — Map properties") + 11 new pure
unit tests + 2 new e2e (DB-edit undo/redo via menu label + Ctrl+Z inside the
open dialog). Full gate green: tsc, eslint, node --test (16), vitest (86),
Playwright 28/28 — editor(10) + golden (11, byte-identical) / player / export
/ perf. Implementation + design sign-off: Claude Fable 5 (exceeds the
"Opus + Fable sign-off" floor — Sonnet remains excluded). **Phase 3 stage
plan A–F is complete.**

Stage E COMPLETE (2026-07-02): World View & database upgrades. **World View** — a
dockable bird's-eye panel (dock id `world`, toggled by F3 / View menu / the
`worldview` command; lazy `mount` like the HD-2D viewport). It draws the whole
project as a map-connection graph over a pure, unit-tested core
(`src/shared/world-graph.ts`: `collectTransfers` walks each map's events —
recursing if/choices exactly like the editor's `walkCommands` — `buildWorldGraph`
aggregates directed edges per (from,to) with counts and flags danglers/self-
loops, `autoLayout` gives a deterministic BFS-column layout per connected
component, `retargetEdge` rewrites the transfer commands behind one link).
`src/editor/map-editor/world-view.ts`: SVG edges + DOM nodes on a scaled/scroll
stage — drag a node to arrange (persists `map.worldPos`, an additive editor-only
field, snapped to quarter-cells), click to select, double-click to open the map,
edit per-map notes (`map.notes`) in the inspector, and **drag-to-relink** by
dragging an arrow's ↻ handle onto another map (hit-tested → `retargetEdge`).
Rebuilds on show and via `worldDirty()` wired into `touch()` (same pattern as
`viewportDirty`). **Database list upgrades** — the shared `listFormTab` scaffold
(`database/shared.ts`) gains a search box, per-row multi-select checkboxes, and a
bulk bar: **Bulk Edit** a shared numeric field (set/add/mul over dotted paths),
**Duplicate**, cross-project **Copy/Paste** (localStorage clipboard keyed by a
new per-tab `kind`), and multi **Delete** — all backed by pure helpers in
`database/bulk.ts` (`sharedNumericFields`, `applyBulk`, `cloneEntries`,
`read/writeDbClip`). **Formula fields** are realised as editor-only computed
previews (no engine/runtime change, per the phase non-goals): the Classes tab
shows a live stat-curve table (levels 1/25/50/99) via the exact engine curve
`floor(base + growth·(level−1))`, and the Skills tab an interactive damage
preview using the engine's phys/magic/heal formulas. `map.notes` also editable in
Map Properties. Schema: `GameMap.notes?` + `GameMap.worldPos?` (optional,
absent-is-meaningful → no forced backfill, like `lights?`/`heights?`).
`editor.css?v=43`, `patch-notes.js?v=10` (+ shim), wiki updated. Verified live
(World View renders 3 nodes / 4 arrows / re-link handles for the sample game;
Lv99 Warrior HP preview = 930 = 48+9·98 exact; DB search empties+restores, bulk
bar on check, cross-project paste) + 15 new pure unit tests (world-graph 7,
db-bulk 8) + 2 new editor e2e (World View node-per-map + drag-persists-worldPos;
DB search + bulk-bar). Full gate green: tsc, eslint, node --test (16), vitest
(75), Playwright editor(8)+golden(11, byte-identical)/player/export/perf (26).
Next Stage F (unified undo + UI polish, Opus + Fable sign-off).

Stage D2 COMPLETE (2026-07-02): cliff auto-texturing (Phase 2's deferred
terrain item, split out of Stage D to keep parity risk off that merge). New
**OFF-by-default `map.hd2d.cliffs` flag** in the three.js renderer
(`src/renderer/three-renderer.ts`). When on, the exposed walls of raised height
blocks are sculpted into rock cliffs entirely inside the existing vertex-tint
pipeline — no new texture, no new shader, no save-format change: a top-down
ambient-occlusion gradient (`CLIFF_AO`) darkens each face toward the cliff base,
the crest edge keeps a sunlit lip (`CLIFF_LIP`), and vertical corners darken
(`CLIFF_EDGE`) where the exposed run ends laterally — the corner test is the
same 8-neighbour connectivity (`hAt(neighbour) <= k`) the 47-blob floor
autotiles use. The three south/east/west wall loops route through a new
per-corner `quad4` + pure `cliffShade(base, level, h, foot, edge)`; passing one
value for all four corners reproduces the old `quad(...,tint)` byte-for-byte, so
**cliffs OFF is byte-identical to Stage E** and all nine pre-existing HD-2D/
classic goldens hold. Ramp skirts (stairs) are left flat — cliffs are vertical
block walls only. Editor: a "Cliff auto-texturing (sculpted block walls)"
checkbox in Map Properties ▸ HD-2D (`map-list.ts`, read+save `hd.cliffs`),
resolving live in the HD-2D Viewport (same renderer). New golden
`hd2d-cliffs-meridian-village.png` (a 3-tall block exposing all faces; also
proves the flag changes pixels). `patch-notes.js?v=9`; no `editor.css` change
(no new styles). Verified: full gate green — tsc, eslint, node --test (16),
vitest (60), Playwright editor(6)+golden(11, cliffs baseline captured)/player/
export. Phase 2's cliff-auto-texturing deviation is now closed.

Stage D COMPLETE (2026-07-02): autotiles & terrain brushes. **47-blob
RPG-Maker-A2 autotile engine.** Map layers stay plain integer tile ids — the
blob shape is resolved at DRAW TIME from 8-neighbour connectivity, so the save
format and the Phase 2 golden suite are untouched (sample maps have no autotile
groups → the resolver is never entered; all 9 goldens byte-identical). Pure core
`src/shared/autotile.ts` (`cornerSources(mask)` → the four 24px minitile sources
per corner via the five-state corner rule; `neighborMask(same)` collapses the
256-input space onto the 47 valid shapes by masking diagonals whose edges are
open). The per-corner minitile coordinates were reverse-engineered from RPG Maker
MV's `Tilemap.FLOOR_AUTOTILE_TABLE` (entry 0 = connected, 47 = isolated,
single-bit-flip entries) and cross-validated for mirror symmetry — 16 unit tests
cover all 256 masks + the canonical MV entries. Runtime registry
`src/shared/autotile-registry.ts` (reserved id `AUTOTILE_BASE = 1_000_000` per
group, per-mask 48×48 assembled-canvas cache) + shared draw primitive
`src/shared/autotile-draw.ts` (`drawLayerCell`) replace the four bare
`Assets.drawTile` cell loops (2D map-render, HD viewport `buildBuffers`, tile-
paste preview, engine `prerenderMap`) so autotiles resolve identically in the 2D
editor, the live HD-2D viewport, AND playtest. Group management
`src/editor/autotile-store.ts` (proj.autotiles CRUD, A2-sheet slice import into
96×144 blocks, swatches) + shared decode `src/shared/autotile-load.ts`
(`syncAutotileRegistry`, used by editor boot and engine map load). Tiles-panel UI
`src/editor/map-editor/autotile-ui.ts`: brush-size selector (1/3/5, keys `[`/`]`,
`S.brushSize` footprint in the pen/eraser) + autotile swatch strip with Import
(also a registered `autotile-import` command, Tools menu + palette). Selecting a
group sets `S.selectedTile` to its reserved id, so all existing paint/fill/rect/
copy-paste code works unchanged; `resolvePaintLayer` routes autotiles to ground
under Auto. `schema.ts` gains `Autotile` + `Project.autotiles?`. `editor.css?v=42`,
`patch-notes.js?v=8`. Verified live (import a synthetic A2 sheet → swatch appears
→ paint with brush 5 → bordered blob renders in the HD-2D viewport, no console
errors) + 16-test pure-core suite + an autotile e2e (in-page File import → paint
→ reserved ids in ground layer). Full gate green: tsc, eslint, node --test (16),
vitest (60), Playwright editor(6)+golden/player/export(15). Deferred to a
follow-on **D2**: cliff auto-texturing (Phase 2's deferred item) — it lives in the
HD-2D renderer, so it is split out to keep parity risk off this merge.

Stage C COMPLETE (2026-07-02): live HD-2D viewport. The Phase 2 three.js
renderer, embedded as a dockable panel (dock id `hd`, the id the Stage B layout
tests already reserved) via a lazy `mount` factory
(`src/editor/map-editor/hd-viewport.ts`) — it supersedes and replaces the old
floating `hd-preview.ts` (deleted). The panel drives the renderer's existing
`available/setMap/renderFrame` surface: the per-frame rAF loop re-reads the map
so every Map-Properties/height/event edit shows live (`touch()` →
`viewportDirty()` rebuilds the tile prerender; lights + camera are per-frame),
and idles cheaply while parked (the dock hides inactive/closed panels in
`#panel-store`, so `offsetParent` is null → no GPU work). A **viewport camera
decoupled from the game camera**: grab-the-ground pan, wheel zoom-to-cursor
(both exact via rigid XZ translation of the look-at center), and Shift/right-drag
tilt — the renderer's only free camera axis is pitch (fixed azimuth), so "orbit"
= tilt; passes viewport-local `zoom`/`tilt` to `renderFrame`, never touching
`map.hd2d.tilt`. **Drag gizmos for point lights** (the first editor affordance
for `map.lights`; previously only `light #rgb radius` events fed the renderer):
handles float over each `map.lights` entry, projected by a new pure, unit-tested
camera module (`src/editor/map-editor/hd-camera.ts` — `makeCam`/`projectToScreen`
/`screenToPlane`, orthonormal-basis forward+ground unproject, exact inverses so
handles track the rendered light and drags land under the cursor). Double-click
adds a light (snapped to the half-tile grid), drag moves it, a HUD inspector sets
colour/radius and deletes, all via `touch()` (autosave + live). `hd2d.lights ===
false` still hides the glow but leaves handles editable (with a status hint). F2
/ the `hdpreview` action upgraded from side-panel toggle to **panel focus**
(`toggleViewport`: show+focus when hidden/unfocused, else hide); added to the
View menu beside the other panels. Golden/perf renderer specs untouched
(editor-only page). `editor.css?v=41`, `patch-notes.js?v=7`. Verified live (docks
as a tab, renders Meridian Village in HD-2D, pan/zoom/tilt HUD, add/select/edit/
persist a light with real-time glow, no console errors) + a 5-test hd-camera unit
suite (basis orthonormality, project/unproject round-trip across tilt/zoom/pan,
clamps, behind-camera) + a viewport e2e (View-menu open, double-click drops a
persisted `map.lights` entry). Full gate green: tsc, eslint, node --test (16),
vitest (44), Playwright editor(5)+golden/player/export(16).

Stage B COMPLETE (2026-07-02): dockable workspace. Pure layout tree
(`src/editor/dock/layout.ts` — split/tabs nodes + floats; in-place edits so a
drop-target reference survives the drag's remove-then-reinsert, structural
cleanup deferred to `normalize()`; `validateLayout` parses untrusted/persisted
JSON, dropping unknown+duplicate panels) drives the DOM engine
(`src/editor/dock/dock.ts` — flex splits with weight-based draggable resizers,
tabbed regions, tab drag-to-dock with 5 drop zones / drag-out-to-float, floating
windows move+resize, localStorage persistence + named layouts, focus model).
Built-in panels (Maps/Tiles/Map) are the existing editor DOM *relocated* out of
`#panel-store` — IDs preserved so boot's listeners and the canvases' bitmaps
survive every re-layout (scroll positions saved/restored across reparent). All
dock/panel ops are registered commands (View menu + palette + F6). `index.html`
`#main` → `#dock-root` + `#panel-store`; `editor.css?v=40`, `patch-notes.js?v=6`.
Verified live (default render, command toggle+persist, drag-to-float, float→west
re-dock with same-dir flatten, resizer weight transfer, reload round-trip) + 16
pure-layout unit tests + a drag/float/reset e2e. Stage C embeds the HD-2D
renderer as another registered panel on this engine (floats stay single-region;
splitting is main-tree only — the seam Stage C's viewport slots into).

Stage A COMPLETE (2026-07-02): command registry typed (`EditorCommand`,
`registerCommand`, `commandEntries()` with menu-derived categories); the boot.ts keydown
cascade is now a declarative `KeyBinding[]` dispatched by the new pure `keymap.ts`
(tri-state modifiers; a bare `{ctrl:true}` barrier preserves "unmatched Ctrl chords
never fall through"; height-digits-over-layer-digits order kept); command palette
(`command-palette.ts` + pure `fuzzy.ts`) on Ctrl+P / Ctrl+Shift+P / Tools menu — fuzzy
scoring is substring > word-start subsequence > scattered subsequence, taking the best
of a word-start-greedy and a plain-greedy walk (word-start-greedy alone can jump past
text a later query char needs). Palette mounts in #modal-root so the existing
modal-open key guard covers it; disabled commands are hidden. Verified live (palette
open/search/run/Esc; W/Q tools, Tab cycle, Ctrl+K inertness) + unit suites for
keymap/fuzzy + a palette e2e spec.

**Branch:** `phase-3-editor` (off `main` at tag `phase-2`)
**Architect & Stage A implementation:** Claude Fable 5 (roadmap assignment: "workspace
architecture, command registry"). Stage B–C cores: Claude Opus. Stages D–F fan-out:
Claude Sonnet, per-stage specs written on entry.

## Objective

Make the editor feel like a modern tool (roadmap Phase 3): a dockable workspace with a
command palette, the Phase 2 renderer live inside the editor, autotiles, a world map view,
database quality-of-life, unified undo, and a UI polish pass — without changing the
project schema's meaning or any runtime behavior.

## Non-goals (whole phase)

- No engine/runtime feature work (that's Phases 4–5); the player and exports must be
  byte-identical in behavior.
- No project-schema changes except purely additive editor-side fields (e.g. per-map
  notes, world-view positions), added to both new-project defaults and migration
  backfill per the established rule.
- No framework adoption. The editor stays vanilla TS + the `h()` DOM builder; docking
  and the palette are built on the same primitives.

---

## Current-state facts that constrain the design

1. **The workspace hub already exists**: `src/editor/workspace.ts` holds `ACT` — a
   string-keyed action registry ({label, icon, key, tip, enabled?, active?, run}) that
   the toolbar, menubar (`MENUS`), and shortcut dialog all drive. It is the seed of the
   Phase 3 command registry; 8 modules import from workspace.ts, so its exports
   (`ACT`, `runAct`, `actionLabel`, `refreshToolbar`, mode/tool/layer/zoom setters)
   must stay stable.
2. **Keyboard handling is a hardcoded cascade** in `boot.ts` (one big keydown listener)
   with load-bearing ordering: input/modal guards → Escape cascade → `?` → Tab mode
   cycle → Ctrl block (which swallows *all* Ctrl chords, matched or not) → F-keys →
   height-mode digits → mode-scoped tool/layer keys → zoom/delete. Any keymap
   centralization must reproduce this ordering exactly, including the
   "Ctrl+<unbound> does nothing" barrier and "height digits win over layer digits".
3. **Editor layout is a fixed CSS grid** in `index.html`: `#menubar` / `#toolbar` /
   `#main` = `#sidebar` (map list) + `#palette-section` (palette canvas) + `#mapscroll`
   (map canvas) + `#status`; modals mount in `#modal-root`. The HD-2D preview
   (`map-editor/hd-preview.ts`, F2) self-manages a side panel. The Database is a modal
   with a left tab rail (`.dbtabs-vert`, `.db-modal`).
4. **Undo/redo is map-snapshot-only** (`map-editor/history.ts`): full snapshots of
   {layers, shadows, passOv, heights, events} per map, 60 deep, in
   `S.undoStack/S.redoStack`. Database edits mutate `S.proj` directly via bound inputs
   (`dom.ts` tIn/nIn/sel/chk → `touch()`) with **no** history. Event-editor edits commit
   whole events (covered by map snapshots).
5. **State/reactivity model**: one shared mutable `editorState` (S) + explicit
   change calls (`touch()`, `renderMap()`, `refreshToolbar()`, `rebuildAll()`).
   No framework, no observers. Docking/viewport panels must fit this: explicit
   notify-on-change, no reactive bindings.
6. **i18n**: every user-visible string routes through `editorI18n.t` (falls back to the
   key). Menus/toolbar/dialog labels are t()'d at build time and rebuilt on language
   change (`buildMenubar`/`buildToolbar`).
7. **Tests**: Playwright e2e (`tests-e2e/editor.spec.mjs` boot + painting; golden
   renderer specs must stay untouched by editor DOM work), vitest unit
   (`tests-unit/`), node:test (`tests/`). Gates: `tsc --noEmit`, `eslint`,
   `node --test tests/`, `vitest run`, `playwright test`.
8. **Asset & cache discipline**: `css/editor.css?v=N` and classic-script `?v=N` query
   versions must be bumped when those browser-loaded files change; patch-note entry
   required per AGENTS.md.

---

## Stage plan

- **A — Workspace core: command registry, contextual keymap, command palette**
  (Fable, this session — detailed below).
- **B — Dockable workspace** (Opus): panel registry + docking/tabbing/floating engine
  over the existing regions (map list, palette, map view, HD-2D preview, world view
  slot), saved/named layouts (localStorage + project-independent), drag handles,
  keyboard focus model. The Stage A command registry is the contract: every
  dock/show/hide/focus operation is a registered command (palette- and
  menu-invocable for free). Database stays modal until Stage E.
- **C — Live HD-2D viewport** (Opus): the Phase 2 three.js renderer embedded as a
  dockable panel — orbit/pan camera decoupled from the game camera, drag gizmos for
  point lights (writes `map.hd2d.lights`), real-time response to every map/HD-2D
  property edit (hooks into `touch()`), F2 upgraded from side-panel toggle to panel
  focus. Golden specs unaffected (editor-only page).
- **D — Autotiles & terrain brushes** (Opus — DONE; cliff auto-texturing split to D2): 47-blob autotile engine for procedural
  terrain, import of RPG-Maker-format autotile sheets, terrain brushes, configurable
  brush sizes; palette UI for autotile groups. Revisit Phase 2's deferred cliff
  auto-texturing with the autotile data.
- **E — World view & database upgrades** (Opus): map-connection graph (parsed from
  transfer commands), drag to re-link, bird's-eye multi-map layout, per-map notes;
  database searchable/filterable lists everywhere, bulk edit, copy-paste entries
  between projects, formula fields for stats/damage.
- **F — Unified undo & UI polish** (Opus, Fable sign-off): one history spanning map,
  event, and database edits (design note below); consistent spacing/type scale, dark
  theme refinement, empty states, keyboard-navigation completeness.

**Unified-undo design note (for Stage F, decided now so D/E don't dig the hole
deeper):** the map history stays snapshot-based; database/event history becomes
*scoped snapshots* — the bound-input helpers in `dom.ts` gain an optional transaction
wrapper (`beginEdit(scope)` … debounced commit) pushing {scope, before, after} entries
into the same stack as map snapshots. One stack, entries tagged by domain, `undo()`
dispatches on the tag. No command-pattern rewrite of every editor mutation.

---

## Stage A — Workspace core (this session)

*Owner: Fable. The architecture stages B–F build on: every editor capability becomes a
registered, palette-invocable command; keyboard dispatch becomes data, not code.*

### File map

| File | Role |
|---|---|
| `src/editor/workspace.ts` | `ACT` typed as `EditorCommand`; `registerCommand` exported; `commandEntries()` — palette feed with menu-derived categories |
| `src/editor/keymap.ts` | NEW — pure ordered-binding key dispatcher (`KeyBinding`, `matchBinding`, `dispatchKey`); no imports, unit-testable |
| `src/editor/fuzzy.ts` | NEW — pure fuzzy scorer for the palette (substring > word-start subsequence > subsequence); no imports, unit-testable |
| `src/editor/command-palette.ts` | NEW — Ctrl+P overlay: search field + result list in `#modal-root` |
| `src/editor/boot.ts` | keydown cascade rewritten as a declarative `KeyBinding[]` fed to `dispatchKey` — semantics preserved binding-for-binding |
| `src/editor/help.ts` | shortcuts dialog gains the palette row |
| `css/editor.css` | `.cmdpal*` styles (bump `?v`) |
| `tests-unit/editor-keymap.test.ts`, `tests-unit/editor-fuzzy.test.ts` | vitest for the two pure modules |
| `tests-e2e/editor.spec.mjs` | palette e2e: open, search, run (opens Database), Esc closes |

### Design decisions

- **Evolve `ACT`, don't replace it.** The registry the whole editor already drives *is*
  the command registry; Stage A gives it a type (`EditorCommand`), a public
  registration function (for stages B–F and later plugin/graph phases), and a query
  surface (`commandEntries()`: id + localized label + key hint + category + enabled).
  Categories derive from `MENUS` membership (first menu wins; unmenued commands get
  "Other") — no second source of truth for grouping.
- **Keymap is data with tri-state modifiers.** `KeyBinding = {combo, codes?/key?,
  ctrl: true|false|undefined (require/forbid/ignore), shift?, preventDefault?, when?,
  run}`; first match in array order wins; a trailing `{ctrl: true}` barrier reproduces
  today's "Ctrl chords never fall through" rule. The *display* strings on commands
  (`key: "Ctrl+S"`) stay purely presentational — the binding table in boot.ts is the
  execution truth, exactly as today, just declarative.
- **Palette skips disabled commands** (an un-runnable row is noise, not affordance),
  closes before running (commands may open modals), and mounts in `#modal-root` so the
  existing "modal open ⇒ global keys off" guard covers it with zero new special cases.
  Ctrl+P and Ctrl+Shift+P both open it (muscle memory from both browsers and VSCode);
  `preventDefault` suppresses the browser print dialog.
- **No panel registry yet.** Stage B owns the docking contract; landing an interface
  with no implementation now would just be speculative API. Stage A's deliverable to
  Stage B is the command registry + this spec's stage-B scope.

### Acceptance criteria (Stage A)

1. Ctrl+P (and Ctrl+Shift+P, and Tools ▸ Command Palette) opens the palette; typing
   filters every registered command with fuzzy matching; Enter/click runs; Esc/outside
   click closes; disabled commands don't appear; key hints shown.
2. Every pre-existing shortcut behaves byte-identically (the keymap rewrite is
   observable only in code): mode-scoped tools/layers/digits, Ctrl chords, F-keys,
   Tab cycle, Escape cascade, height-digit precedence, Ctrl+<unbound> inertness.
3. Full gate green: `tsc --noEmit`, `eslint`, `node --test tests/`, `vitest run`,
   full Playwright suite (goldens untouched).
4. Patch-notes entry; shortcuts dialog and wiki (The-Editor-Interface.md) mention the
   palette; `css/editor.css?v` bumped.
