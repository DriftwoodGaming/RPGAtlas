# Phase MP2 Spec — Loopback Client/Server ("Project Beacon")

**Status:** BUILD COMPLETE — stages A, B, C all landed 2026-07-19 (Opus);
awaiting the Fable phase gate (verdict below) + tag `beacon-2`. Build model:
Opus; Fable gates the phase and tags `beacon-2`.
**Authored:** 2026-07-19 by Claude Opus 4.8, from the MP2 section of
`docs/MULTIPLAYER_ROADMAP.md` + `docs/mp-1-spec.md` + the MP0·C sim-boundary
spec (`docs/mp-0-spec.md` §C5/§C6/§C7).
**Workflow:** commit + push each stage to `main`; the frozen pixel goldens stay
**byte-identical at every stage** (THE gate of the whole project); log
deviations here.

## Objective

Single-player now *runs through the protocol*. The engine captures the player's
input as `InputIntent`s and sends them over an in-process `LoopbackTransport` to
a `WorldHost` that owns the world's tick; the host applies them to the world,
exactly as a network client/server pair will. Modal event commands still call
the UI locally (that seam is MP3). This phase retires the "did the MP1 split
change the game?" risk permanently: the primary gameplay loop — every frame of
movement and interaction — now flows as real protocol messages over a real
transport, and the pixel goldens prove it is byte-identical.

The architecture the phase lands (solo = one process, so client and server
share one world by reference — zero copy, zero serialization):

```
   ctx.Input ──capture──▶ ClientSession.sendInput ──▶ LoopbackTransport ─┐
                                                                          │ {t:"input",seq,intent}
   renderer ◀──reads mirror (== world, by reference in loopback)         ▼
        │                                                        WorldHost.onMessage → inbox
        └──── defaultWorld ◀──── update() applies drained intents ◀── host.tick()/drainIntents
```

---

## Stage A — LoopbackTransport + host/session scaffolding (Opus, landed 2026-07-19)

### What landed

Pure addition — four new modules and one test file, imported by **nothing on
the live path yet** (the engine still calls `update()` directly). The runtime
bundle is therefore unchanged and the goldens are byte-identical by
construction; stage B flips the live loop onto this seam.

- **`src/shared/net/transport.ts`** (NEW, headless) — the `Transport` seam.
  `NetMessage = ClientMessage | ServerMessage`; `Transport` (`send` / `onMessage`
  / `close` / `isOpen`); `createLoopbackPair(): {client, server}`. Loopback
  delivery contract: `send()` hands the **same object reference** to the peer's
  handler **synchronously and in order**; frames sent before a handler attaches
  **buffer and flush in order** when it does. Determinism by construction — the
  receiver observes messages in exactly send-order, on the sender's stack — which
  is what keeps single-player byte-identical once the tick rides this channel.
  The host buffers intents rather than acting on arrival, so synchronous delivery
  never re-enters the tick. No serialization: MP0's round-trip suite already
  proves these objects are wire-safe, so loopback skips `JSON.stringify` without
  hiding a wire bug. MP5 adds the WebSocket implementation of the same interface.
- **`src/engine/net/world-host.ts`** (NEW) — `WorldHost`: owns one `World` and
  its tick. `onMessage` routes inbound `input` frames into a per-tick
  `PendingIntent[]` inbox (`{playerId, seq, intent}`; `playerId` is 0 — the one
  default player — until MP4 keys per player); room-lifecycle frames
  (hello/join/resume/reply/emote/chat) are accepted-and-ignored (MP3/MP5).
  `drainIntents()` takes-and-clears the inbox (idle tick allocates nothing — a
  shared `EMPTY`). `setTickFn(fn)` / `tick()` — tick ownership lives here; the
  world-tick body is **injected**, not imported, so this module stays off the
  engine/DOM graph (the full headless extraction of the tick body is a later
  phase). `broadcastDelta` is a marked no-op (loopback mirror == world).
- **`src/engine/net/client-session.ts`** (NEW) — `ClientSession`: what
  presentation talks to instead of the world directly. `sendInput(intent)` →
  `{t:"input", seq:++, intent}` down the transport (monotonic seq — the
  `delta.ack` prediction hook, MP4). `view` — the world-mirror the renderer
  reads (the world **by reference** in loopback; MP4 makes it a client-local
  reconstruction — the swap touches only this file). `onServerFrame` no-ops
  (nothing to reconstruct yet).
- **`src/engine/net/solo-session.ts`** (NEW) — the single-player composition: one
  `createLoopbackPair()`, `soloHost = new WorldHost(defaultWorld, link.server)`,
  `soloClient = new ClientSession(link.client, defaultWorld)`. The solo analogue
  of what MP5 stands up per room. Inert until stage B binds it.
- **`tests-unit/net-transport.test.ts`** (NEW, +7 → vitest **1035**) —
  by-reference + in-order delivery both directions; buffer-before-handler flush;
  close/`isOpen`; a `ClientSession`'s intents arriving in the `WorldHost` inbox
  in order with client-assigned seqs and `playerId 0`; destructive drain; the
  world-mirror is the world by reference; the injected tick fn drives the world
  (host owns the tick); non-input frames buffer no intent. Pure/headless — pulls
  in no engine or DOM graph (`createWorld(null)` + a loopback pair only).

### Design decisions (stage A)

- **A1 — One `Transport` interface, two implementations over time.** Loopback
  now (by reference), WebSocket at MP5 (encode on send / decode on receive).
  Everything above the transport — host, session, the intent flow — is written
  once and is transport-agnostic. Single-player exercising it every frame is the
  point of the phase.
- **A2 — The host buffers; the tick drains.** An intent is never applied when it
  arrives (that would let message delivery re-enter the simulation and reorder
  world writes). It is buffered and applied at tick time, exactly as a networked
  server would batch a tick's inbound frames. Synchronous loopback delivery is
  therefore safe *and* deterministic.
- **A3 — The tick body is injected, not imported.** `WorldHost.setTickFn` keeps
  the host (and the whole `src/engine/net/` tree) free of the engine/DOM modules
  the current tick body touches — the host is headless-ready even though the
  MP2-era tick body is not. Full extraction of the tick into the headless sim is
  a later phase; MP2's job is the transport + intent + tick-ownership seam.
- **A4 — The mirror is the world by reference (loopback).** A network client
  renders a reconstruction of server state; solo play has one process and one
  world, so the mirror IS the world. The renderer keeps reading it through the
  existing ctx/G shim → `defaultWorld` (byte-identical), and `ClientSession.view`
  is that same object. MP4 replaces `view` with a reconstruction fed by
  snapshot/delta — the seam is isolated to `client-session.ts`.
- **A5 — Stage A is inert.** Nothing on the live path imports the new modules, so
  the bundle and the goldens are unchanged. Landing the plumbing first, fully
  unit-tested, de-risks the stage-B flip.

### Deviations / discoveries (stage A)

- **D-A1:** none. Pure addition; every fast gate green; goldens unchanged by
  construction (no live-path file touched).

### Stage A gate snapshot (2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1035** (66 files; +7 net-transport) |
| node --test | **46** (unchanged) |
| eslint / tsc | **0 / 0** |
| Playwright | byte-identical by construction — no live-path source changed (new modules imported by nothing); full run deferred to stage B where the flip happens |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none needed |

---

## Stage B — Input intents → world + tick ownership (Opus, landed 2026-07-19)

### What landed

The live flip. Single-player's per-tick player control now flows as protocol
`InputIntent` frames over the loopback transport, and the world host owns the
tick — **byte-identical** (full Playwright 123/123, pixel goldens unchanged),
because in loopback capture and apply are one tick and the applier is the old
movement decision moved verbatim.

- **`src/shared/net/protocol.ts`** — additive input intents (protocol v1
  unchanged; new `k` values + one optional field). `move` gains optional
  `dir8?: GridDir` (the engine's numeric grid direction 0..7, so
  eight-direction movement survives the wire; a 4-way peer omits it and the
  world reads cardinal `dir`). New `attack` intent (action-RPG melee, routed
  live). New §C5 menu-verb intents **defined** now for MP4/MP5 to compile
  against: `useItem {id, target?}`, `equip {actor, slot, id}` (id 0 = remove),
  `formation {from, to}`. `checkIntent` validates each (dir8 range, equip slot,
  operands). `GridDir`/`EquipSlot` exported.
- **`src/engine/scenes/map.ts`** — the `update()` map-control block:
  - **Client capture:** reads the device exactly as before (`ctx.Input.dir` peek
    + `consume("attack"/"ok"/"cancel")` in the same order) and emits
    `soloClient.sendInput(...)` — `attack` XOR `move {dir, dir8, run}` (matching
    the old attack-vs-move priority), then `act`. `cancel` opens the pause menu
    directly (a client concern — the world-mutating menu verbs are the §C5
    intents, not this).
  - **World apply:** `applyPlayerIntent(intent)` (NEW) — the movement/ledge/
    touch-event/attack/interact decisions lifted **verbatim** from the old inline
    block, now driven by the drained intent (`intent.dir8` authoritative). The
    loop drains `soloHost.drainIntents()` in send order and applies each.
  - `CARDINAL_OF` (grid dir → cardinal `Dir` projection) + `NUM_OF_CARDINAL`
    (the 4-way fallback for a dir8-less peer).
  - Client-prediction seam marked (empty — zero-latency loopback needs none).
- **`src/engine/loop.ts`** — drives `soloHost.tick()` per fixed step instead of
  `update()`; same accumulator, same tick count. Tick ownership now lives in the
  host (its tick body is the map scene's `update`, injected by boot).
- **`src/engine/boot.ts`** — composition root binds `soloHost.setTickFn(update)`
  (injected, not imported by the host, so `src/engine/net/` stays off the DOM
  graph).
- **Tests** — `tests-unit/net-protocol.test.ts` (+2 → vitest **1037**):
  round-trips for `move+dir8` (8-way), `attack`, and the three §C5 verbs; plus
  strictness rejections (dir8 out of range/non-int, bad equip slot, missing
  operands). The transport suite (stage A) already covers the host/session flow.

### Design decisions (stage B)

- **B1 — Capture and apply are colocated in loopback, but the data really flows
  as protocol frames.** The client reads `ctx.Input`, builds `ClientInput`
  intents, sends them through a real `Transport`; the host buffers and the tick
  drains and applies them. In one process this is one tick, so it is
  byte-identical — but the seam is exactly what MP4 (capture on a remote client)
  and MP5 (apply on the server) split apart, with zero further protocol churn.
- **B2 — `dir8` keeps eight-direction movement honest on the wire.** The
  protocol `Dir` is 4-way (used by `face`); rather than lose diagonals, `move`
  carries the numeric grid direction additively. The world uses `dir8` when
  present (loopback always sets it) and the cardinal otherwise. So a 4-way
  network client and the 8-way engine both round-trip correctly.
- **B3 — Consume order and gating preserved to the letter.** The capture peeks
  `dir` then consumes attack/ok/cancel in the original order; because those are
  three independent edges, consuming them up-front is identical to the old
  interleaved consumes. Apply order (attack/move, then act, then cancel) matches
  the old block. `applyPlayerIntent` is the old decision verbatim — no logic
  rewritten. This is why the goldens are byte-identical and why walking,
  facing, ledges, touch-events, and interaction all behave exactly as before.
- **B4 — `cancel`/`hud`/`dash` stay client-side.** Opening the pause menu, the
  HUD toggle, and the dash-latch are presentation/option concerns, not world
  writes, so they do not ride the intent channel. The menu *verbs* that DO write
  the world are the §C5 intents (B5).
- **B5 — §C5 menu verbs are DEFINED, not yet routed (deliberate).** C5 conditions
  routing on "when the world API they call is real"; the headless world-side
  verb API is not extracted until a later phase (the menus still call the
  in-process helpers directly, which in loopback is the same process as the
  host, so nothing behaves differently). MP2·B lands the wire contract
  (`useItem`/`equip`/`formation` + round-trip tests) — the same "define the
  protocol now, wire the behavior later" pattern MP0 used for directives — so
  MP4/MP5 compile against it. Routing them live is tracked for the verb-API
  extraction phase. Likewise **tap-to-move** (a pointer that sets a path route)
  and **battle input** (its own async scene loop, MP6) remain direct input
  sources; the per-tick keyboard/gamepad control loop — the heart of "runs
  through the protocol" — is what MP2 routes.
- **B6 — Tick ownership at the host, injected tick body.** The loop drives
  `soloHost.tick()`; the host runs the injected `update`. The full headless
  extraction of the tick body (so the host needs no injection) is a later phase
  — MP2's job is the transport + intent + tick-ownership seam, and the injection
  keeps `src/engine/net/` free of the DOM graph today.

### Deviations / discoveries (stage B)

- **D-B1 (verification, not a defect):** the pixel goldens boot to a *stationary*
  map (player idle; only seeded NPC walk draws RNG), so they do not exercise the
  move/act/attack intent path — "no input → no intent → identical advancement"
  is what keeps them byte-identical, but walking itself is uncovered by the
  committed e2e. Verified separately with a trusted-keyboard throwaway spec
  (deleted): held ArrowRight/Left/Down walked the player and updated facing
  through the full `ClientSession → LoopbackTransport → WorldHost.drainIntents →
  applyPlayerIntent` path. (Synthetic `dispatchEvent` does NOT drive the input
  system reliably — only trusted CDP keys do — which is why the manual check
  needed Playwright, not the browser console.)
- **D-B2 (perf, better not worse):** the idle tick adds only a `dir()` peek +
  three consumes it already did, plus a `drainIntents()` that returns a shared
  empty array (no allocation) and a `for` over nothing — so idle frames are
  effectively free. The all-features renderer-perf e2e measured **240.73
  ms/frame** (budget 300), inside budget and slightly *better* than the beacon-1
  gate's 250.92 (SwiftShader run-to-run variance dominates that delta). Stage C
  records it against the ±10% budget.

### Stage B gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1037** (66 files; +2 net-protocol) |
| node --test | **46** (unchanged) |
| Playwright | **123/123** (2.8m) — pixel goldens byte-identical; renderer-perf 240.73 ms/frame (budget 300) |
| eslint / tsc | **0 / 0** |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none needed (no `?v=` file touched) |

---

## Stage C — Perf check (Opus, 2026-07-19)

### What landed

No source — stage C is the perf gate + this write-up. The MP2·C requirement is
the renderer frame budget within **±10% of the pre-MP2 (beacon-1) numbers** on
the showcase map; the beacon-1 gate recorded **250.92 ms/frame** (budget 300,
SwiftShader).

- **Measured (renderer-perf e2e, all-features HD-2D @ 1080p):** **172.96
  ms/frame** standalone; **240.73 ms/frame** under full-suite concurrency. Both
  are inside the 300 ms budget and within ±10% of 250.92 (the standalone run is
  well under it). SwiftShader run-to-run variance and concurrent CPU load
  dominate the spread — there is no measurable regression from the seam.
- **Why it is effectively free:** the only added per-tick work on an idle frame
  is a `drainIntents()` that returns a shared empty array (zero allocation) and
  a `for` over nothing; `dir()`/the three `consume()` calls already ran every
  tick before MP2. Intents allocate only on a tick where the player is actually
  pressing a control — never in the stationary goldens.

### Stage C gate snapshot (2026-07-19)

| Gate | Result |
|---|---|
| Perf | **within budget** — 172.96 ms/frame (standalone) / 240.73 (full-suite), budget 300, beacon-1 250.92 → within ±10%, no regression |
| cargo | **26** (Rust untouched) |

---

## Phase gate (Fable, after C)

Template gates + **full Playwright including pixel goldens byte-identical vs
beacon-1** (THE gate of the whole project) + perf budget held + audit the
loopback path for hidden direct world access from presentation code (grep the
renderer/UI for sim imports that bypass the mirror). Verdict recorded here +
roadmap status table; tag `beacon-2`.

### Gate verdict — ⏳ PENDING (Fable)

Build (Opus) hand-off numbers, to be independently re-verified by the Fable gate:

| Gate | Build result (re-verify) |
|---|---|
| vitest | **1037** (66 files) |
| node --test | **46** |
| cargo | **26** |
| Playwright | **123/123** — pixel goldens byte-identical to beacon-1 (the MP2 diff touches zero golden PNGs; player is stationary in every golden so no-input → no-intent → identical world advancement). Perf 240.73 ms/frame (budget 300). |
| eslint / tsc | **0 / 0** |
| FV / version / cache-busts | 2 · 1.2.0 · none (no `?v=` file touched) |

**Loopback-path audit pointers for the gate** (per the GATE kickoff — "grep the
renderer/UI for sim imports that bypass the mirror"):

- The renderer (`render-glue.ts`) and UI still read world state through the
  existing ctx/G shim → `defaultWorld`, which in loopback **is** the mirror
  (`soloClient.view === defaultWorld`, by reference — MP2·A A4). No presentation
  module imports `src/shared/sim/` directly; the mirror-by-reference is the
  documented loopback posture, and MP4 replaces `ClientSession.view` with a
  reconstruction (the swap is isolated to `client-session.ts`).
- Player map-control input no longer writes the world directly from `update()`:
  it is captured to intents and applied only via `applyPlayerIntent` after the
  transport round-trip (`soloClient.sendInput` → `soloHost.drainIntents`).
- Remaining *direct* input→world sources are documented and intentional (§B5):
  the route-cancel `ctx.Input.dir()` peek (a non-consuming read of the same
  "direction held" signal the move intent carries), tap-to-move (sets a path
  route), the §C5 menu verbs (defined on the wire, routed at the verb-API
  extraction phase), and battle input (its own async scene, MP6).
