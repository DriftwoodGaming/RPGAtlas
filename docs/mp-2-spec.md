# Phase MP2 Spec — Loopback Client/Server ("Project Beacon")

**Status:** IN PROGRESS — stage A landed 2026-07-19 (Opus). Build model: Opus;
Fable gates the phase and tags `beacon-2`.
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
