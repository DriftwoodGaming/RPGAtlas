# Phase MP0 Spec — Protocol, Singleton Audit & Sim-Boundary Spec ("Project Beacon")

**Status:** IN PROGRESS — stages A and B landed; C (sim-boundary spec) follows
in this document.
**Authored:** 2026-07-19 by Claude Fable 5 (build + self-gate per the roadmap
choreography), from the MP0 section of `docs/MULTIPLAYER_ROADMAP.md`.
**Workflow:** commit + push each stage directly to `main` (house rule). Phase
exit records the gate verdict in the roadmap status table and tags `beacon-0`.

## Objective

The thinking phase with teeth: real protocol code (stage A) plus the two
documents that make MP1 (world-core extraction) and MP3 (presentation
directives) mechanical instead of exploratory — the singleton audit table
(stage B, THE MP1 work order) and the sim-boundary/directive spec (stage C).
Zero engine behavior change: no existing file's runtime behavior may differ;
Playwright goldens stay untouched.

---

## Stage A — Baseline + protocol v1 (landed 2026-07-19)

### Live gate baseline (recorded into the roadmap, first act)

| Gate | Live 2026-07-19 | Roadmap "last known" |
|------|-----------------|----------------------|
| vitest | **983** (62 files) | 977+ |
| node --test | **44** | 19 |
| cargo | **26** | 23 |
| Playwright | **123/123** (2.8m) | 111 |
| eslint | **0** | 0 |
| version | 1.2.0 (7 sites) | 1.2.0 |

Every count had drifted upward since the roadmap was written — the "never
trust these written numbers" rule earned its keep on day one.

### What landed

- **`src/shared/net/protocol.ts`** — wire protocol v1. `PROTOCOL_VERSION = 1`;
  client→server `hello / join / resume / input / reply / emote / chat`;
  server→client `welcome / snapshot / delta / directive / presence / kick /
  error`; input sequence numbers (`input.seq` echoed as `delta.ack` for the
  MP2 prediction seam); typed `Directive` + `DirectiveReplyValue` unions for
  all five modal kinds (message, choices, numberInput, nameInput, shop) so MP3
  compiles against wire truth; strict structural decoders
  (`decodeClientMessage` / `decodeServerMessage`) that return `{ok:false,
  error}` instead of throwing — the seed of the MP5·D fuzz gate. Protocol-level
  limits exported as constants (frame/name/chat/emote caps).
- **`src/shared/net/room-code.ts`** — capability-token room codes: 9 chars
  from a 30-char alphabet (digits + consonants; **no vowels** so a code can
  never spell a word in front of a kid; no L) = **44.15 bits entropy** (floor
  is 40); CSPRNG with rejection sampling (no modulo bias, injectable byte
  source for deterministic tests); `normalizeRoomCode` repairs real typing
  (lowercase, separators, O→0/I→1/L→1) and returns `null` — never throws — for
  the friendly-error path; display format `XXX-XXX-XXX`.
- **`tests-unit/net-protocol.test.ts`** (18) + **`tests-unit/net-room-code.test.ts`**
  (12) — every union arm round-trips encode→decode (this is the wire-safety
  proof the MP2 loopback transport will lean on, since loopback skips
  serialization); hostile-input rejection matrix; entropy/uniformity/
  normalization pins. **vitest 983 → 1013.**

### Design decisions (stage A)

- **A1 — Room creation rides `join`.** The roadmap's fixed client-message list
  has no `create`; `{t:"join"}` with no `code` means "create a room and make
  me owner". Keeps the message list exactly as specified.
- **A2 — Presets/chat/emotes on the wire:** `chat` carries exactly one of
  `text` (free text, D4 opt-in, server rejects with `chat-disabled` when off)
  or `preset` (index into dev-authored phrases — always available). Server
  broadcasts all social traffic via `presence` (kinds `join/leave/emote/say`)
  — the fixed server-message list has no separate chat-broadcast type.
- **A3 — Errors are codes, not copy.** `ServerError.code` picks localized
  plain-language client copy (audience-beginners rule); `detail` is
  dev-console-only. Copy itself lands client-side in MP5·C with i18n in MP7.
- **A4 — Both decoders are strict**, not just the server's: a client must
  survive a buggy/malicious *self-hosted* server, so server frames validate
  too (D2 makes hostile servers a real threat model).
- **A5 — Forward compat:** unknown extra fields on known messages are
  accepted (additive evolution — e.g. passport pubkeys arrive in MP8 without
  a version bump); unknown message types are rejected.
- **A6 — Shop replies are transcripts.** One `shop` directive → one reply
  carrying the whole buy/sell log; the server re-validates every line against
  authoritative stock/wallet before applying (client shop UI is presentation,
  not authority). Capped at 200 lines.
- **A7 — Snapshot/delta payloads are `JsonValue`-opaque at MP0.** MP1 owns the
  world-state shape (save-payload machinery doubles as join-sync per the
  roadmap); pinning it now would prejudge the MP1 extraction.

### Deviations / discoveries (stage A)

- **Baseline drift** (table above) — recorded, no action needed.
- **Tooling trap (new, Windows):** writing a regex character class of raw
  control characters (a bracket class spanning U+0000 through U+001F as
  *actual bytes*, not `\uXXXX` escapes) into a source
  file makes ripgrep treat the file as binary (silently unsearchable) and
  trips the harness's hidden-character guard on shell commands. Fix: keep the
  class in escaped `\uXXXX` form in source (a `fix-regex.mjs` scratchpad
  script did the byte surgery). Rule of thumb: **no raw bytes < 0x20 (beyond
  tab/LF/CR) in any source file, ever.**

---

## Stage B — Singleton audit (landed 2026-07-19)

Every module-level mutable in the engine (and the engine-relevant shared
modules), classified:

- **world** — becomes per-instance state of `createWorld()` in
  `src/shared/sim/` (MP1). The set of world rows below IS the MP1·B work order.
- **client** — presentation/input/audio/DOM; stays module-level in the client
  bundle (a browser tab is one client — module scope is correct there).
- **config** — immutable after load, or a pure/deterministic cache; safe to
  share across many world instances in one server process.

Method: grepped every `src/engine/**` + engine-relevant `src/shared/**` module
for top-level `let`/`var` and top-level `const` collections/objects, then read
each site. The classic `js/` runtime scripts (messages, input, sfx, renderer,
assets) are client-by-construction (browser-only, loaded via `deps.ts`) and
never enter the sim — audited as one row.

### The engine context (`src/engine/state/engine-context.ts`)

`ctx` is the monolith's old closure — it is not one singleton but ~30 fields
of three different natures. MP1·A splits it: world fields move into the world
instance; client fields stay in a client-side context; config is bound at
world creation.

| Field(s) | Class | Notes for MP1 |
|---|---|---|
| `proj` | config | live project; world holds a reference (immutable during play) |
| `stage` `canvas` `g2d` `uiLayer` `fader` | client | DOM roots |
| `SCREEN_W` `SCREEN_H` | config | from system settings at boot |
| `scene` | client | scene flow; the world's own notion of "in battle" arrives with MP6 shared battles |
| `menuOpen` | client | |
| `playtestMode` | config | editor-launch flag |
| `cameraZoom` | **world (per-player)** | event-driven AND saved (in the save payload) — lives in per-player world state, client renders it |
| `shakePower/Speed/Duration/Timer`, `flashColor/Opacity/Duration/Timer` | client | transient screen effects, not saved; events drive them → MP3 directives |
| `Input` | client | input system instance |
| `richText` `showMessage` `setMsgSpeed` | client | late-bound message system — this trio is the seam MP3 turns into the presentation port |
| `map` | **world** | live map runtime (loaded map + derived buffers refs); one per occupied map = the MP8 zone unit |
| `lowerBuf` `upperBuf` `hdActive` `animCells` | client | render buffers/caches (assigned by map-runtime) |
| `evRTs` | **world** | event runtime states: positions, move routes, active page — core sim state |
| `blockingRun` | **world** | "a blocking interpreter is running" — per-world, becomes per-player-context in MP3 |
| `parallels` `commonParallels` | **world** | parallel-interpreter scheduling maps |
| `globalT` | **world** | THE tick counter — becomes `world.tick`, the protocol's clock |
| `loopLast` `loopAcc` | client | rAF accumulator (server drives ticks its own way; tick ownership moves in MP2·B) |
| `playerOptions` `dashLatch` `dashPrev` | client | per-device settings + input edge state |

### The game state (`src/engine/state/game-state.ts`)

| Mutable | Class | Notes |
|---|---|---|
| `G` (all fields) | **world** | the whole object: switches, vars, selfSw, quests, party, inv, gold, wallet, mapId, steps, encSteps, timeOfDay, player, plus the dynamically-added families (vehicles/vehicle/vehicleImages, bgs/savedBgm/jingles, menuDisabled/saveDisabled/encounterDisabled/formationDisabled/followersHidden, windowTone). MP1 moves `G` wholesale into the world instance. The per-player vs world-shared partition *within* G (party/inv/gold per player; switches/vars shared) is a stage-C boundary question — MP1 does NOT split it, MP4 does. |
| `questRuntime` `Quests` `questState` `objectiveDone` `evaluateQuestFailures` `noteBattleFailure` `onEnemyKilled` (live `let` exports) | **world** | quest runtime closures over G; created per world at `initQuestRuntime()` |

### Engine root modules

| Module · mutable | Class | Notes |
|---|---|---|
| `util.ts` · `random` | **world** | the gameplay RNG stream — roadmap-named MP1·A work: per-world `seedRnd`, with `?rngseed`/`window.AtlasRng` binding to the default world so e2e is unchanged |
| `util.ts` · `getSysProject` | config | provider installed at boot; becomes world-bound |
| `ui-stack.ts` · `UIStack`, `getUiLayer` | client | modal UI stack |
| `hud.ts` · `root` `layoutSignature` `nodes` `designSource` `cachedDesign` | client | HUD DOM + design cache |
| `perf-hud.ts` · all 7 | client | debug overlay |
| `anim-glue.ts` · `fxBundle` `fxLayer` | client | battle-FX bundle handles |
| `message.ts` / `input.ts` / `loop.ts` | — | no module state (bind into `ctx`); `TICK_MS` is config |
| `plugin-runtime.ts` · `Plugins` | config | registry (text processors, command handlers, hooks). Plugin-authored state is the plugin's own business — the additive net API (MP7·C) is where plugins learn about multiplayer |
| `script-api.ts` · `scriptApi` | config | facade over G/ctx; its world-touching methods must resolve through a world handle post-MP1 |
| `boot.ts` · `EngineServices` | config | composition root; becomes per-world services object at MP1 (it closes over world state) |
| `playtest-bridge.ts` / `developer-mode.ts` | client | editor-only surfaces |
| `render-glue.ts` + `src/renderer/**` | client | rendering; reads world via the `prx→rx` interpolation seam (the remote-player seam MP4 reuses) |

### Interpreter

| Module · mutable | Class | Notes |
|---|---|---|
| `interp.ts` · `EngineServices` | config | injected service surface; MP1 makes it per-world (its getters close over world state) |
| `registry.ts` · `handlers` | config | command registry, write-once at module eval + plugin registration |
| `Interp` instances | **world** | already instanced per event run — no singleton to break ✓ |

### Scenes

| Module · mutable | Class | Notes |
|---|---|---|
| `map.ts` · `tickTimers` | **world** | tick-accurate wait timers — ALREADY tick-based (see discovery below) |
| `map.ts` · `frameWaiters` | client | per-rendered-frame waits (render pacing) |
| `map.ts` · `lastTimeBand` | **world** | day/night page-refresh edge detector (derived from G.timeOfDay) |
| `map.ts` · `forcedEncounterArmed` | **world** | forced-encounter latch |
| `map-runtime.ts` · `ANIM_FRAME_STATE` `autotilesSyncedFor` `parallaxState` `mapFloatTexts` | client | render caches + floating text (world events *spawn* float texts → delta/presence in MP) |
| `tile-behavior.ts` · `maps` `presentFlags` `terrainPresent` | config | per-project bake over the pure core in `src/shared/tile-behavior-core.ts` (the sim reuses the pure core) |
| `zone-runtime.ts` · `Z` | **world** (mixed) | `passGrid`/`hasZones` are config-derived per map; `inside` is per-player world state; `weatherApplied`/`soundActive` are client ambience mirrors. MP1 instances the world part per map; the ambience applier stays client |
| `presentation-runtime.ts` · `pictures` `tint` `tintTween` `timer` `scroll` `scrollTween` | **world (per-player)** | event-driven AND save-serialized (`serializePresentation`) — same nature as `cameraZoom`: authoritative per-player state in the world, rendered by the client |
| `battle.ts` · `Battle` | — | const namespace; ALL battle state is closure-local per `Battle.run` — already instanced ✓ (MP6 lifts it into a shared troop instance in the world; no singleton in the way) |
| `battle-logic.ts` / `shop.ts` / `title.ts` / `gameover.ts` / `input-scenes.ts` / `menus.ts` (`journalView`) | client | pure logic (battle-logic) + UI flows |

### Engine-relevant `src/shared/`

| Module · mutable | Class | Notes |
|---|---|---|
| `audio-deck.ts` · slots/buffers/unlock state | client | audio output. The *logical* audio state (bgs/savedBgm/jingles) already lives in `G` ✓ — the node-test import trap stays respected: sim never imports audio-deck |
| `asset-library.ts` · `store` `metas` `urls` | client | editor/asset browser |
| `formula.ts` · `cache` | config | pure memo (formula string → compiled fn); deterministic, safe shared across worlds |
| `autotile-registry.ts` · `registry` | client | decoded sheet blobs for rendering |
| `deps.ts` · `Assets` `Music` `Sfx` `RA` `DataDefaults` | config | window-bridge facades; `Music`/`Sfx` are client audio, `RA` is pure helpers. The sim must NOT import deps.ts (window at module eval) — MP1's lint wall enforces |
| `js/**` classic runtime (messages, input, sfx, renderer, assets, plugins, data, quests) | client | browser-only by construction; reached solely through `deps.ts` |
| `src/platform/browser/save-repository.ts` | client | per-device storage; in MP the world snapshot takes the payload's role server-side |

### Audit summary (what MP1 actually moves)

World rows to instance: **`G` + quest runtime, `random` (RNG), and the world
slice of `ctx`** (`map`, `evRTs`, `blockingRun`, `parallels`,
`commonParallels`, `globalT`, `cameraZoom`) **plus the scene-module world
state** (`tickTimers`, `lastTimeBand`, `forcedEncounterArmed`, zone-runtime's
world part, presentation-runtime's per-player sextet). Everything else stays
put. No module holds hidden world state beyond these — battle and interpreter
instances are already closure-scoped.

### Deviations / discoveries (stage B)

- **Discovery B1 (good news, de-risks MP3):** interpreter waits are ALREADY
  tick-based — the Wait command runs `services.waitFrames(frames)` against
  `tickTimers`, drained by `update()` per 60 Hz tick, not wall-clock. Exactly
  five `sleep(ms)` call sites exist in the whole engine (battle sting/ATB idle
  poll ×2, transfer fade beats ×2, fadeTo ×1) and every one is presentation
  pacing, not world logic. MP3's "waits become world-tick-based" is therefore
  a *move*, not a rewrite.
- **Discovery B2:** battle state is closure-local per `Battle.run` — the MP6
  shared-battle work has no singleton to dismantle, it "only" has to lift the
  closure into a world-owned troop instance.
- **Discovery B3:** `cameraZoom` + presentation-runtime's saved sextet form a
  third state nature — **per-player world state** (event-driven, snapshotted,
  but rendered locally). Stage C gives it a name; MP1 keeps it in the world
  block; MP4 keys it per player.
- **Discovery B4:** `ctx` is not one singleton but three natures interleaved
  (world/client/config, table above) — the MP1·A "split ctx" framing in the
  roadmap is confirmed accurate, and the field-level split is now written down.
