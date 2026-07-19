# Phase MP1 Spec — Instanced Headless World Core ("Project Beacon")

**Status:** stage A landed 2026-07-19 (Fable); stages B–C pending (Opus).
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

## Stage B — World systems onto the instance (Opus, pending)

Per the roadmap: game-state helpers, map runtime movement/collision,
tile-behavior, encounters/steps, quests, inventory/wallet — mechanically
migrated per the MP0·B audit table, engine imports flowing through the shim;
all existing suites stay green. Repeat the stage-A pattern (above) per row;
the remaining world rows are listed in A4. Respect the traps: sim modules
stay DOM-free (vitest env=node is load-bearing), never import `deps.ts` /
`audio-deck.ts` into anything the sim touches.

## Stage C — Headless boot + determinism (Opus, pending)

Node test: create a world from the Atlas_Quest fixture, tick 600, assert
invariants; same seed ⇒ identical state hash (the determinism canary).
Lint wall: `no-restricted-imports` sealing `src/shared/sim/` off from
DOM/engine modules.

## Phase gate (Fable, after C)

Template gates + Playwright goldens byte-identical + determinism hash test +
headless-boot node test + lint wall in place + compat-shim drift spot-audit.
Verdict recorded here + roadmap status table; tag `beacon-1`.
