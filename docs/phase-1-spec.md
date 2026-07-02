# Phase 1 Spec — The Great Refactor

**Status:** COMPLETE (2026-07-01) — all exit criteria met; merged to main, tag `phase-1`.
Both monoliths deleted; ~60 typed modules; behavior-frozen gates held throughout (one
documented exception: the pre-existing export boot crash was fixed, see Stage A note).
**Branch:** `phase-1-refactor` (off `phase-0-toolchain`)
**Architect:** Claude Fable 5 · **Implementation:** Claude Opus (high) — Sonnet is excluded
from this phase onward; former Sonnet fan-out work is consolidated into fewer, larger Opus
work packages.

## Objective

Split the two monoliths (`js/engine.js` 4.0k lines, `js/editor.js` 5.7k lines) into typed
ES modules under `src/`, introduce the service seams and typed project schema every later
phase builds against, and land the storage abstraction and fixed-timestep loop.

**Behavior-frozen.** No user-visible change of any kind. The Phase 0 safety net
(Playwright e2e + win32 golden images + `node --test` + Vitest) gates every merge.

## Non-goals

- No renderer changes (`js/renderer.js` stays as-is; Phase 2 ports it).
- No conversion of `js/assets.js`, `js/data.js`, `js/sfx.js`, `js/plugins.js`,
  `js/quests.js`, `js/journal-view.js` beyond what the deps shim requires — they remain
  classic scripts this phase.
- No new features, no UI polish, no perf work beyond the loop change.

---

## Current-state facts that constrain the design

1. **Load model:** `play.html` loads classic scripts (`assets`, `renderer`,
   `runtime/messages`, `runtime/input`, `sfx`, `plugins`, `data`, `quests`,
   `journal-view`) that populate `window.RPGAtlasDeps` / other globals, then
   `js/engine.js` (classic). `index.html` loads the same base plus `js/editor.js`
   (**module**, imports `js/editor/{project-io,host,i18n}.js`).
2. **Export model:** `js/editor/project-io.js#buildStandaloneGame` **fetches raw source
   files** listed in `js/build-manifest.mjs#STANDALONE_EXPORT_FILES` and inlines them
   into one HTML file (classic scripts in order, engine last as an inline module).
   Splitting `engine.js` therefore requires a **single-file player bundle artifact**
   that the export can fetch instead.
3. **Vite is a passthrough** (`vite.config.mjs`): nothing under `js/` is bundled;
   dist is a verbatim copy. Phase 1 retires the byte-identical constraint for the
   *engine/editor entries only*; `css/`, `img/`, `bin/` stay passthrough (fetched at
   runtime by project-io and assets).
4. **Some Phase-0 tests grep source text** (e.g. `tests/modules.test.mjs` reads
   `js/engine.js`; `tests/interpreter.test.js` asserts `code.includes('case "shake":')`).
   These must be migrated to behavior tests against the extracted modules as part of the
   stages that move the code they grep.
5. `window.RPGAtlasDeps` shim is the sanctioned bridge between classic scripts and
   modules during migration (Phase 0 decision) — keep it until the last classic
   consumer converts (later phases).

---

## Staging plan

Stages land as separate commits/PR-sized units on `phase-1-refactor`, each with the full
gate green. A stage may be several commits, but never merges red.

### Stage A — Module build infrastructure (blocks everything)

*Owner: Opus. The one risky migration; smallest possible diff, no code moves yet.*

- `src/engine/main.ts` and `src/editor/main.ts` become the entries. Initially each is a
  thin re-export/loader that side-effect-imports the existing monolith source moved
  verbatim (see "verbatim move" rule below) — proving the pipeline before any splitting.
- `index.html` / `play.html` switch their final script tag to
  `<script type="module" src="/src/editor/main.ts">` (resp. engine). Vite dev serves
  natively with HMR; `vite build` bundles the two entries through the normal HTML
  pipeline. The passthrough plugin narrows to `css/`, `img/`, `bin/`, and the remaining
  classic `js/` files — it must stop copying files that migrated to `src/`.
- **Player bundle for export:** a Vite plugin `atlas-player-bundle`:
  - *dev:* middleware at `/__atlas/player-bundle.js` that bundles `src/engine/main.ts`
    on demand with esbuild (IIFE, no minify, inline sourcemap off) so exports from
    `npm run dev` are always fresh;
  - *build:* emits `player-bundle.js` into dist via the same esbuild invocation.
- `js/build-manifest.mjs`: `STANDALONE_EXPORT_FILES` replaces `js/engine.js` with the
  bundle URL (dev vs dist resolution handled in project-io, mirroring its existing
  dual-mode manifest loading). Classic deps (`assets`, `sfx`, `data`,
  `runtime/messages`, `runtime/input`, `quests`, `journal-view`, `plugins`) stay
  inlined as classic scripts exactly as today — **note:** audit the current list;
  `runtime/input.js`, `quests.js`, `journal-view.js`, `plugins.js`, `renderer.js` are
  loaded by `play.html` but NOT in `STANDALONE_EXPORT_FILES` — understand why before
  touching (renderer/GLRender presence in exports must not change behavior).
- **New e2e gate:** export smoke test — drive the editor to `buildStandaloneGame`,
  load the produced HTML in a page, assert title scene boots and a golden matches.
- Tauri staging (`scripts/stage-frontend.mjs`) and `package-exe` consume dist output;
  verify both still produce working artifacts.

**Stage A exit:** dev + build + export + exe/Tauri staging all behavior-identical;
export smoke test added and green; goldens unchanged.

> **Stage A audit finding + integrator decision (2026-07-01):** the standalone export
> was already broken *before* Phase 0 — `STANDALONE_EXPORT_FILES` omitted
> `js/quests.js`, `js/journal-view.js`, `js/runtime/input.js`, all hard boot
> dependencies, so every exported game crashed before the title screen (regression
> from the "Save & Events Update" commit, which added quests/journal to the engine
> without updating the export list). Stage A preserved the crash per the freeze rule;
> Fable then fixed it as an isolated follow-up commit — the freeze protects against
> refactor-induced regressions, not pre-existing crashes, and Stages B/C need a
> *booting* export smoke test as their safety net. The export e2e now asserts a
> working title screen.

### Stage B — `engine.js` → `src/engine/` (after A)

*Owner: Opus (single agent, sequential — interpreter, battle, save/load are delicate).*

Target map (monolith sections → modules; keep each file ≤ ~800 lines):

| engine.js section (lines) | module |
|---|---|
| utils (46) | `src/engine/util.ts` |
| input / UI stack (78) | `src/engine/ui-stack.ts` + `src/engine/input.ts` (absorbs the `window.createInputSystem` wiring; `js/runtime/input.js` moves in later, see note) |
| message window (273) | `src/engine/message.ts` |
| game state (285) | `src/engine/state/game-state.ts` |
| map runtime + routes (449) | `src/engine/scenes/map-runtime.ts` (may split routes) |
| interpreter (1011) | `src/engine/interpreter/` — see registry design |
| plugins (1356) | `src/engine/plugin-runtime.ts` + `src/engine/script-api.ts` |
| map scene update (1606) | `src/engine/scenes/map.ts` |
| rendering glue (1775) | `src/engine/render-glue.ts` (adapter calls only; real port is Phase 2) |
| menus + player options (1913) | `src/engine/scenes/menus.ts`, `src/engine/state/player-options.ts` |
| save / load (2554) | `src/engine/state/save.ts` (implements `SaveRepository`) |
| shop (2668) | `src/engine/scenes/shop.ts` |
| battle (2749) | `src/engine/scenes/battle.ts` (~1k lines; split if natural seams exist, don't force) |
| title / gameover (3719) | `src/engine/scenes/title.ts`, `src/engine/scenes/gameover.ts` |
| boot (3888) | `src/engine/boot.ts` |

**Interpreter registry (prerequisite for Phase 4 Atlas Graph):**

```ts
// src/engine/interpreter/registry.ts
export type CommandHandler = (cmd: AnyCommand, ctx: InterpContext) => Promise<void> | void;
export interface InterpContext {
  interp: Interp;                    // runList, exec, testCond, selfKey, callCommonEvent
  state: GameState;                  // G
  services: EngineServices;          // message, quests, scenes, party/inventory ops…
}
export function registerCommand(type: string, handler: CommandHandler): void;
export function getCommand(type: string): CommandHandler | undefined;
```

- Built-ins live in `src/engine/interpreter/commands/*.ts` grouped by domain
  (flow, state, presentation, world, combat), each file registering its handlers.
- `Interp.exec` becomes a registry lookup; unknown types keep today's silent-skip
  behavior (verify what the switch's `default` does and preserve it exactly).
- The plugin bridge (`atlas.registerCommand` in the plugins section) re-routes onto the
  same registry. **Plugin API is frozen** — verify against the four built-in plugins.
- Migrate the source-grepping tests: assert handlers are registered
  (`getCommand("shake")`) and behavior-test them through the real modules, which the
  data-URL import trick in `tests/modules.test.mjs` already supports for ESM.

**Conversion rules (all stages):**
- *Verbatim move first, convert second.* Move code without edits, wire imports, gate
  green; only then TS-ify the file (types, `let`→`const`, etc.) in a separate commit.
  Never rewrite logic "while we're here".
- JS→TS conversion may use `any`/`// @ts-expect-error` liberally where the typed schema
  (Stage D) hasn't landed; Stage D tightens.
- Globals consumed from classic scripts come through one module:
  `src/shared/deps.ts` exporting typed views of `window.RPGAtlasDeps` and friends.
  No other file touches `window.RPGAtlasDeps` directly.

### Stage C — `editor.js` → `src/editor/` (after A; parallel with B)

*Owner: 2–3 Opus agents in git worktrees, partitioned by section with no file overlap;
Fable integrates.*

Package 1 — map editing: tiny DOM builder → `src/editor/dom.ts`; modal framework →
`src/editor/modals.ts`; persistence → `src/editor/persistence.ts` (wraps project-io,
becomes `ProjectRepository` consumer in Stage D); map rendering, palette, painting,
undo/redo, layers, clipboard, map list, HD-2D preview → `src/editor/map-editor/*`.

Package 2 — events: command definitions, location picker, command list widget, event
editor, quick-event builders → `src/editor/event-editor/*`.

Package 3 — database & tools: database (one module per DB tab — the vertical-rail tabs),
tilesets tab, plugin manager, audio manager, event searcher, resource manager, character
generator, help/about, icons → `src/editor/database/*`, `src/editor/tools/*`; actions/
menus/toolbar, modes/zoom, boot/wiring → `src/editor/workspace.ts`.

The editor monolith is one big closure sharing mutable state (`proj`, `curMapId`, tool
state, undo stacks…). **Seam design:** extract that shared state into
`src/editor/editor-state.ts` (a plain mutable state object + change-notification hooks,
no framework) *first*, as part of Package 1, and land it before packages 2/3 branch off.
Fable reviews this seam before the fan-out starts.

### Stage D — Typed schema, services, storage, game loop (interleaves after B lands)

*Owner: Opus for schema breadth; Fable authors the interface files.*

- `src/shared/schema.ts`: full project-document types — `Project`, `SystemData`,
  `GameMap`, `MapEvent`, `EventPage`, `AnyCommand` (discriminated union on `t`),
  `Actor`, `ClassDef`, `Skill`, `Item`, `Weapon`, `Armor`, `Enemy`, `Troop`,
  `CommonEvent`, `Quest`, plugin entries, `formatVersion`. Derived from `js/data.js`
  defaults + `Atlas_Quest.json` ground truth. Lightweight runtime validation
  (hand-rolled guards, no zod dep) used at project load/import boundaries only.
- `src/shared/services.ts` (Fable-authored): `ProjectRepository`, `SaveRepository`,
  `RendererAdapter`, `PluginRuntime`, `MessageService` interfaces; browser adapters in
  `src/platform/browser/`, Tauri stubs in `src/platform/tauri/` (wire-up later phase).
- `ProjectRepository` backed by localStorage (current behavior), interface ready for
  Tauri FS / IndexedDB (Phase 6 dependency).
- **Fixed-timestep loop** (`src/engine/loop.ts`): accumulator at 60 Hz updates,
  render decoupled with interpolation hooks (renderer keeps consuming latest state this
  phase — interpolation lands with Phase 2's renderer). Must not change golden images
  or e2e timing assumptions; if goldens flake, gate behind a flag defaulting on and
  investigate before merge.

---

## Phase exit criteria

1. `js/engine.js` and `js/editor.js` deleted; no source file over ~800 lines.
2. Zero behavior change: full e2e + goldens + unit suites green on win32 and CI Linux.
3. Standalone HTML export and EXE export verified working (export smoke e2e + manual EXE spot-check); Tauri build green.
4. Plugin API unchanged — all four built-in plugins pass a dedicated regression test.
5. Typed schema in place; `npm run typecheck` clean (with documented `any` debt list).
6. `/code-review` pass, sample-project (`Atlas_Quest.json`) playthrough, tag `phase-1`.

## Risk notes

- **Export regression** is the highest-severity failure (users lose shipped games) —
  hence the export smoke test lands in Stage A *before* any code moves.
- **Editor closure state**: splitting shared mutable closure vars is where subtle bugs
  breed; the `editor-state.ts` seam lands first and gets its own review.
- **`node --test` legacy suites** must keep passing throughout; where they grep moved
  source, the migrating stage owns updating them (behavior-preserving rewrites only).
- Patch notes: per AGENTS.md, internal refactors need no entry; add one only at phase
  end if anything user-visible changed (there should be nothing).
