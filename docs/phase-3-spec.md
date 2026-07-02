# Phase 3 Spec — Editor Platform

**Status:** IN PROGRESS. Stage log accumulates here, phase-2-spec style.

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
- **D — Autotiles & terrain brushes** (Sonnet): 47-blob autotile engine for procedural
  terrain, import of RPG-Maker-format autotile sheets, terrain brushes, configurable
  brush sizes; palette UI for autotile groups. Revisit Phase 2's deferred cliff
  auto-texturing with the autotile data.
- **E — World view & database upgrades** (Sonnet): map-connection graph (parsed from
  transfer commands), drag to re-link, bird's-eye multi-map layout, per-map notes;
  database searchable/filterable lists everywhere, bulk edit, copy-paste entries
  between projects, formula fields for stats/damage.
- **F — Unified undo & UI polish** (Sonnet, Fable sign-off): one history spanning map,
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
