# Phase MP1 Spec — Instanced Headless World Core ("Project Beacon")

**Status:** ✅ **PHASE COMPLETE** — stages A (Fable), B, C (Opus) landed
2026-07-19; Fable phase gate **PASS** 2026-07-19, tag `beacon-1`.
**Authored:** 2026-07-19 by Claude Fable 5, from the MP1 section of
`docs/MULTIPLAYER_ROADMAP.md`; the work order is the MP0·B singleton audit
table in `docs/mp-0-spec.md`, the scope fence is `docs/mp-0-spec.md` §C7.
**Workflow:** commit + push each stage to `main`; every existing test green at
every stage (the compat shim means zero behavior change); Fable gates the
phase, tags `beacon-1`.

## Objective

The fundamental engine change: the world sim becomes `createWorld(project,
{seed})` in `src/shared/sim/` — instanced (no module singletons; a server
hosts many worlds per process), headless (no DOM imports; lint wall at C),
deterministic under seed. The engine keeps working through a compat shim that
binds its historical module-level names to ONE default world.

---

## Stage A — The instancing seam (Fable, landed 2026-07-19)

### What landed

- **`src/shared/sim/world.ts`** (NEW) — the seam. `World` interface +
  `createWorld(proj, {seed})` + `createInitialGameState()`. A world owns, per
  the MP0·B audit's stage-A rows:
  - `g` — the game state (the engine's `G`), initial literal moved verbatim
    from `game-state.ts`;
  - the **ctx world slice**: `map`, `evRTs`, `blockingRun`, `parallels`,
    `commonParallels`, `tick` (né `ctx.globalT` — THE world clock),
    `cameraZoom` (nature-2, world block until MP4), `proj` (config nature,
    held by reference);
  - the **RNG stream**: `seedRnd/rnd/rndf` per world; unseeded IS
    `Math.random`, seeded IS `mulberry32` (`src/shared/rng.ts`), seeds coerce
    `>>> 0` (NaN→0) — all three exactly the old `util.ts` semantics, including
    capturing the `Math.random` *function value* at seed time.
- **`src/engine/state/default-world.ts`** (NEW) — `defaultWorld =
  createWorld(null)`: THE solo session's world; the module servers never
  import. Created unseeded before `util.ts` evaluates, preserving the exact
  pre-boot seeding order.
- **Compat shim** (the zero-behavior-change contract):
  - `engine-context.ts` — the 8 world-classed ctx fields are redefined **in
    place** as enumerable accessors over `defaultWorld`
    (`ctx.globalT ⇄ world.tick`; the literal keys stay, so enumeration order
    is byte-identical). Client/config fields stay plain data properties.
  - `game-state.ts` — `export const G: any = defaultWorld.g`: same const
    object reference for the session's life, so the quest runtime's closure,
    save/load's field mutation, and New Game's reset are all untouched.
  - `util.ts` — `seedRnd/rnd/rndf` delegate to the default world; the
    `?rngseed=` / `window.RPGATLAS_RNG_SEED` / `window.AtlasRng` hooks stay
    in `util.ts` (client-side) and now bind the default world — e2e seeding
    is unchanged, and after MP1 the seed feeds the world instance's stream,
    exactly as the roadmap's trap list requires.
- **`tests-unit/sim-world.test.ts`** (NEW, 13) — fresh-state pins (initial
  `g` = the boot literal; world slice = the ctx initializers), two-world
  isolation (state + RNG streams), the RNG contract (seeded ≡ mulberry32
  64-draw pin, unseeded ≡ Math.random, null-reseed, `>>> 0`/NaN coercion),
  and the ctx shim (identities, both write directions, enumeration order —
  first key still `proj`, `globalT` still between `commonParallels` and
  `loopLast`). **vitest 1013 → 1026.**
- **`tests/world-shim.test.js`** (NEW) — the shim proven end-to-end in the
  node:test harness (esbuild + vm + classic-script window stub, the
  `interpreter.test.js` pattern): `G === defaultWorld.g`; ctx accessors are
  live in both directions; `util.seedRnd` and `world.rndf` draw ONE stream
  (interleaved draws match one mulberry32 reference); `window.AtlasRng`
  seeds/unseeds the default world; a pre-boot `RPGATLAS_RNG_SEED` on the
  window stub drives the very first roll. **node 44 → 45.**

### The pattern stages B/C repeat (write once, here)

1. Move the state row into `World` (initializer copied verbatim; audit table
   names the rows).
2. Rebind the legacy module-level name as a view of `defaultWorld` — an
   accessor (for `let`-style/reassigned names) or a const alias (for
   stable-identity objects). Never change call sites.
3. Pin the identity + both write directions in a test (vitest if the module
   is window-free at eval; the node esbuild+vm harness if it pulls
   `deps.ts`).

### Design decisions (stage A)

- **A1 — Shim by accessor, not by call-site rewrite.** ~200+ `ctx.<field>`
  sites keep compiling and behaving identically; `Object.defineProperty` over
  the existing literal keys preserves `Object.keys(ctx)` order (pinned in the
  vitest spec). Audited first: nothing in `src/` enumerates, spreads, clones,
  or wholesale-assigns `ctx` or `G`.
- **A2 — `ctx.proj` rides the world.** Boot's `ctx.proj = loadProject()` now
  lands the project on `defaultWorld.proj` — the audit's "world holds a
  reference" with zero boot changes; `setSysProjectProvider(() => ctx.proj)`
  is world-bound for free.
- **A3 — RNG semantics preserved to the letter.** The stream captures the
  `Math.random` function at creation/seed time (old `let random =
  Math.random` behavior); `seed >>> 0` coercion keeps `?rngseed=garbage` ≡
  seed 0; the default world is created unseeded and the pre-boot hook seeds
  it at `util.ts` module eval — identical ordering, so seeded goldens draw
  identical sequences.
- **A4 — `World` ships only stage-A fields.** Stage B appends the remaining
  audit rows (quest runtime, `tickTimers`, `lastTimeBand`,
  `forcedEncounterArmed`, zone-runtime's world part, presentation-runtime's
  per-player sextet) as it migrates each system — pre-declaring dead slots
  would prejudge B's shapes.
- **A5 — Scope fence held (§C7).** No transport, no directive engine, no
  per-player keying, no protocol integration; `snapshot`/`delta` payload
  shapes stay MP2's business.

### Deviations / discoveries (stage A)

- **D1 (test-side only):** first cut of two vitest RNG mocks spied
  `Math.random` *after* the capture point and failed — the closure holds the
  function value, faithfully reproducing old util.ts behavior. Tests fixed to
  spy before capture; the semantics are pinned in a comment so B/C don't
  "fix" the capture into a live property lookup (that WOULD be a behavior
  change under AtlasRng mid-run reseeding... it wouldn't match old util.ts).
- **D2 (free coverage):** `tests/playtest-through.test.js` already writes
  `runtime.ctx.map = {…}` — the existing node suite exercises the new
  accessor setters without modification, exactly the regression net the shim
  wants.
- **D3 (perf, recorded for MP2·C):** the 8 shimmed fields now cost an
  accessor call per read in hot paths (render reads `ctx.globalT`/`ctx.map`
  per frame). Monomorphic getters inline; the Playwright renderer-perf
  budget spec passed unchanged (241.66 ms/frame avg on SwiftShader, budget
  300). MP2·C re-measures against its ±10% budget — do not pre-optimize.

### Stage A gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1026** (65 files; +13 sim-world) |
| node --test | **45** (+1 world-shim) |
| cargo | **26** |
| Playwright | **123/123** (2.8m) — single-player goldens untouched |
| eslint / tsc | **0 / 0** |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none needed (no ?v= file touched) |

---

## Stage B — World systems onto the instance (Opus, landed 2026-07-19)

### What landed

The remaining MP0·B world rows (the A4 list) now live on the `World`
instance; each owning engine module binds its historical module-level name to
`defaultWorld` through the compat shim, exactly the stage-A pattern. **Zero
behavior change** — every existing suite green, goldens byte-identical.

- **`src/shared/sim/world.ts`** — appended the stage-B fields with initializers
  copied verbatim from the owning modules: `questRuntime` (null until built);
  `tickTimers` (`[]`), `lastTimeBand` (`""`), `forcedEncounterArmed` (`false`);
  `zone` (the zone-runtime `emptyState()` shape — `map/hasZones/passGrid/inside
  (Set)/weatherApplied/weatherBaseline/soundActive`); and the presentation
  sextet `pictures` (Map), `tint` (`[0,0,0,0]`), `tintTween` (null), `timer`
  (`{running:false,frames:0,common:0}`), `scroll` (`{x:0,y:0}`), `scrollTween`
  (null). Still headless — no new imports (only `../rng.js`).
- **`src/engine/state/game-state.ts`** — `initQuestRuntime()` builds the runtime
  onto `defaultWorld.questRuntime` (it closes over `G`, so it is world-scoped);
  the live-`let` exports (`questRuntime/Quests/questState/objectiveDone/
  evaluateQuestFailures/noteBattleFailure/onEnemyKilled`) mirror that world's
  runtime — the same "`G = defaultWorld.g`" mirror pattern. Import sites
  unchanged.
- **`src/engine/scenes/map.ts`** — `tickTimers`, `lastTimeBand`,
  `forcedEncounterArmed` now read/write `defaultWorld.*` (imports
  `defaultWorld`). `frameWaiters` stays module-level (per-**rendered**-frame
  render pacing = client, not world — audit ✓).
- **`src/engine/scenes/zone-runtime.ts`** — `Z` is now a **stable const alias**
  of `defaultWorld.zone` (like `G`). `resetZoneState` resets **in place**
  (`Object.assign(Z, emptyState())`) instead of reassigning `Z`, so the alias
  stays the live object for every reader — behavior-identical (all 7 fields
  overwritten, `inside` gets a fresh `Set`).
- **`src/engine/scenes/presentation-runtime.ts`** — `pictures` and `scroll`
  become stable const aliases of `defaultWorld.*` (mutated in place, so their
  many call sites are untouched); the reassigned members (`tint`, `tintTween`,
  `timer`, `scrollTween`) reference `defaultWorld.*` at each site. `__test`
  hooks + `serialize/restorePresentation` route through the world.
- **Tests** — `tests-unit/sim-world.test.ts` (+2 → **15**): fresh-init + per-
  instance isolation for every new row. `tests/presentation-runtime.test.js`:
  identity pins (`__test.pictures() === world.pictures`, `scroll`) + write-
  through (tint/timer/picture/scroll land on the world). `tests/world-shim.test.js`:
  `initQuestRuntime` builds `defaultWorld.questRuntime`, the game-state exports
  mirror it, and the runtime closes over the world's own `G` (RPGAtlasQuests
  stubbed under the classic-script window). **node --test stays 45** (asserts
  added to existing files, no new file).

### The stage-B binding rule (which arm of the A pattern per row)

- **Reassigned scalars/refs** (`tickTimers`, `lastTimeBand`,
  `forcedEncounterArmed`, `tint`, `tintTween`, `timer`, `scrollTween`) →
  reference `defaultWorld.<field>` at each site (a module `let` can't carry an
  accessor; these are module-**private**, so there are no external call sites to
  preserve — only the owning module's own references move).
- **Stable-identity objects** (`Z`, `pictures`, `scroll`, and `G`/quest
  runtime) → a **const alias** captured once, mutated in place. The one
  reassignment that would have staled an alias (`Z = emptyState()`) became an
  in-place reset.

### Deviations / discoveries (stage B)

- **D-B1:** `resetZoneState` had to switch from wholesale reassignment to
  in-place `Object.assign` so the const alias `Z` stays the world's live object.
  Verified behavior-identical (fresh `Set` for `inside`, all fields reset).
- **D-B2:** the zone-state shape is duplicated in `world.ts`'s initializer
  (commented "kept in sync with `emptyState()`") because `world.ts` may not
  import `zone-runtime.ts` — it pulls `audio-deck` (the sim headless law / the
  MP1·C lint wall). This is the only intentional shape duplication in stage B.
- **D-B3 (free coverage, like A's D2):** the existing
  `tests/presentation-runtime.test.js` round-trips (show/move/tint/timer/scroll
  + serialize/restore) all pass unmodified against the world-backed state — the
  regression net the shim wants, now proving the presentation state IS the
  world's.

### Stage B gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1028** (65 files; +2 sim-world) |
| node --test | **45** (asserts added to world-shim + presentation-runtime) |
| cargo | **26** (untouched) |
| Playwright | **123/123** (2.8m) — single-player goldens byte-identical; perf 243.32 ms/frame (budget 300) |
| eslint / tsc | **0 / 0** |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none needed (no ?v= file touched) |

## Stage C — Headless boot + determinism (Opus, landed 2026-07-19)

### What landed

- **`tests/sim-headless-boot.test.js`** (NEW, node --test → **46**) — the
  headless-boot + determinism canary:
  - **Boot:** `createWorld(Atlas_Quest.json, {seed})` under esbuild+vm with the
    classic-script window stub — the world boots seeded, project bound by
    reference, fresh `g`, tick 0; a second world from the same fixture shares no
    state (the server-hosting isolation the whole extraction exists for).
  - **Tick 600 + determinism:** a fixed driver ticks the world 600× through its
    OWN surface — the seeded RNG stream (NPC random-walk + step/encounter rolls,
    consuming the stream exactly where `update()`/`onPlayerStep()` do) plus the
    REAL migrated world subsystem `scenes/presentation-runtime` (tint/picture/
    scroll ops with RNG-drawn params, its per-tick tweens + timer advanced by
    `updatePresentation()`/`tickTimer()`). A stable FNV-1a hash over the
    resulting world state (`tick/steps/encSteps/vars/rngSeed/tint/scroll/
    serializePresentation()`) is asserted: **same seed ⇒ identical hash** (two
    independent realms), **different seed ⇒ different hash** (RNG truly drives
    it), and the SEED_A hash is **pinned** (`46633057`) so a change to
    `mulberry32` or the world RNG draw order is caught. Invariants: exactly 600
    ticks, 75 steps, encounter counter in `[0, rate)`, non-negative integer
    battle count.
- **`eslint.config.mjs`** — the **headless-world lint wall**: a config block
  scoped to `src/shared/sim/**` with `no-restricted-imports` (blocks
  `**/engine/**`, `deps`, `audio-deck`, `**/renderer/**`, `render-glue`,
  `**/platform/**`, `three`) + `no-restricted-globals` (window, document,
  location, localStorage, navigator, Image). Verified it FIRES on a probe file
  (engine + audio-deck imports and a `window` reference all error) and is CLEAN
  on the real tree (`world.ts` imports only `../rng.js`).

### Design decisions (stage C)

- **C1 — The canary tests the world *instance's* determinism, by necessity.**
  MP1's scope fence (mp-0-spec §C7) keeps the engine's real per-tick driver
  (`update()`/`onPlayerStep()`, which are render/input/DOM-bound) OUT of the
  world until MP2 moves tick ownership in. So "tick 600" at MP1 is a test-side
  driver over the world's own surface — the RNG stream + the migrated world
  subsystems — mirroring the engine's per-tick world RNG consumption. It runs
  REAL migrated code (`presentation-runtime`) and REAL world state, so it
  catches genuine nondeterminism (a stray `Math.random`/`Date.now()` in world
  logic, an RNG algorithm drift). **MP2's gate re-runs determinism through the
  real loopback tick** — this canary is the guard that lets it.
- **C2 — Golden decoupled from the fixture.** The pinned hash depends only on
  `seed` + `mulberry32` + the fixed driver, NOT on fixture contents, so a future
  Atlas_Quest regeneration doesn't spuriously break it. The fixture is still
  genuinely exercised — the world is *created from it* and its `proj`/`maps`/
  `system` are asserted at boot.
- **C3 — Two realms, not reset-in-place.** Same-seed determinism is proven by
  two independent vm realms (fresh default world each), a true two-instance
  compare — the isolation guarantee, not just repeatability.
- **C4 — Lint wall = imports AND globals.** `no-restricted-imports` alone can't
  catch `document`/`window` *usage* (those are globals, not imports), so the
  wall pairs it with `no-restricted-globals` — the sim can't reach the DOM by
  either door.

### Deviations / discoveries (stage C)

- **D-C1 (the vm-realm `deepEqual` trap, as warned):** `assert.deepEqual(w.g.party,
  [])` failed with `actual: [], expected: []` — the sandbox realm's `Array`
  prototype differs from the test realm's, and strict deepEqual is prototype-
  sensitive across realms. Fixed with a structural check
  (`Array.isArray(...) && .length === 0`), the same workaround
  `presentation-runtime.test.js` uses (`jsonEq`).

### Stage C gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1028** (unchanged — stage C adds a node test + lint config, no vitest) |
| node --test | **46** (+1 sim-headless-boot) |
| cargo | **26** |
| Playwright | **123/123** — goldens byte-identical (stage C changed no runtime source; only eslint config + a new node test) |
| eslint / tsc | **0 / 0** (the new sim lint wall is clean and proven to fire) |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none needed |

## Phase gate (Fable, after C)

Template gates + Playwright goldens byte-identical + determinism hash test +
headless-boot node test + lint wall in place + compat-shim drift spot-audit.
Verdict recorded here + roadmap status table; tag `beacon-1`.

### Gate verdict — ✅ PASS (Claude Fable 5, 2026-07-19)

Every number below independently re-run at `66790ad`, trusting nothing
written above:

| Gate | Independent result |
|---|---|
| vitest | **1028** passed (65 files) |
| node --test | **46** passed (incl. `tests/sim-headless-boot.test.js`) |
| cargo | **26** passed |
| Playwright | **123/123** (2.9m) — all renderer goldens pass against the pre-MP1 committed PNGs; the MP1 diff (`0f9ae0a..66790ad`) touches **zero** golden files, so passing = byte-identical. Perf spec 250.92 ms/frame (budget 300). |
| eslint / tsc | **0 / 0** |
| Lint wall | Probe file in `src/shared/sim/` importing `engine-context` + `deps` + `audio-deck` and using `window`/`document` → **5 wall errors fired** (3× no-restricted-imports, 2× no-restricted-globals); probe deleted; real tree clean. Wall config verified: scoped to `src/shared/sim/**`, blocks engine/deps/audio-deck/renderer/render-glue/platform/three imports AND window/document/location/localStorage/navigator/Image globals. |
| Determinism canary | Re-run standalone: golden **46633057** re-computed and matched for seed 20260719; same-seed identical across two independent vm realms (true two-instance compare); different-seed divergent; 600 ticks / 75 steps / encSteps ∈ [0,30) invariants held. Canary honestly guards the **world instance's** surface only — the engine tick-driver stays out until MP2, which re-gates determinism through the loopback tick (spec §C1 confirmed accurate). |
| Headless boot | World created from the real `Atlas_Quest.json` fixture under esbuild+vm, seeded, tick 0, fresh `g`; two worlds from one fixture fully isolated. |
| Sim purity | `src/shared/sim/` = `world.ts` only; sole import `../rng.js` (pure). No DOM/engine/audio reachable. |
| FV / version / cache-busts | FORMAT_VERSION **2** (`js/data.js`) · version **1.2.0** · no `?v=` file touched in MP1 → no busts needed. |

**Compat-shim drift spot-audit (all 6 migrated engine modules diffed against
pre-MP1 `0f9ae0a`) — CLEAN, zero behavior drift found:**

- `state/game-state.ts` — the `G` literal moved **verbatim** into
  `createInitialGameState()` (field-by-field compare: identical keys, order,
  comments); `G = defaultWorld.g` is a stable const alias; `initQuestRuntime`
  builds the identical runtime (same args, same `getProj`/`now` closures),
  stores it on `defaultWorld.questRuntime` first, then mirrors to the same
  live exports.
- `scenes/map.ts` — `waitFrames`/`tickTween`/`pumpTickTimers` reproduce the
  exact swap-drain algorithm against `defaultWorld.tickTimers` (unfinished
  timers re-pushed into the fresh array, so a `step` callback scheduling a new
  wait behaves identically); `lastTimeBand`/`forcedEncounterArmed` initial
  values match `world.ts` (`""`/`false`); `frameWaiters` correctly stays
  module-level (client render pacing).
- `scenes/zone-runtime.ts` — `Z` is a const alias of `defaultWorld.zone`;
  `resetZoneState`'s in-place `Object.assign(Z, emptyState())` covers **all 7**
  `ZoneState` fields (interface field-count verified), so no stale state can
  survive vs the old wholesale reassignment; fresh `Set` for `inside`.
- `scenes/presentation-runtime.ts` — `pictures`/`scroll` stable aliases;
  every `tint`/`tintTween`/`timer`/`scrollTween` read/write site lands on
  `defaultWorld.*`; timer semantics preserved (in-place `frames--` on the live
  object; wholesale reassign on `startTimer`/`restore` with all readers
  fetching `defaultWorld.timer` at call time — no staleness);
  serialize/restore + `__test` hooks route through the world.
- `state/engine-context.ts` — the 8-field world slice redefined **in place**
  over the existing literal keys (enumeration order preserved, pinned in
  vitest); literal initializers match `createWorld()`'s exactly
  (`null/1/null/[]/false/Map/Map/0`); accessors enumerable + live both ways.
- `util.ts` — `seedRnd/rnd/rndf` delegate to the default world;
  capture-at-seed-time semantics preserved to the letter (including capturing
  the `Math.random` function value on null reseed); `?rngseed=` /
  `RPGATLAS_RNG_SEED` / `AtlasRng` hooks stay client-side in `util.ts` and
  bind the default world (proven in `tests/world-shim.test.js`, incl. the
  pre-boot-seed-drives-first-roll assert).

MP1 diff footprint confirmed tight: 6 engine modules + 2 new seam files
(`sim/world.ts`, `state/default-world.ts`) + eslint config + spec + 4 test
files — no renderer/boot/UI source touched.
