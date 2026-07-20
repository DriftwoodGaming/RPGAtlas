# Phase MP5 Spec — Beacon Server, Rooms & Transport ("Project Beacon")

**Status:** 🚧 **IN PROGRESS** (Opus build). Stage A landed 2026-07-19. Ends with
the **Fable SECURITY GATE** (block at the bottom).
**Authored:** 2026-07-19 by Claude Opus 4.8, from the MP5 section of
`docs/MULTIPLAYER_ROADMAP.md` + the "Kid safety & privacy" rules + `docs/mp-4-spec.md`.
**Workflow:** commit + push each stage to `main`; the frozen pixel goldens stay
**byte-identical at every stage** (MP5 adds a headless server + a client join
UI — the solo/golden path is untouched); log deviations here.

## Objective

The open-source Beacon server ships: one TypeScript core, two targets (plain
Node `ws`; Cloudflare Durable Objects). Friend rooms go live end-to-end — a
player connects over `wss://`, creates a room (gets a code), a friend joins by
code, and both walk one shared world the **server** owns authoritatively (D1).

## Branch-point answer (asked at kickoff)

MP5 has no ❓ in the roadmap, but building the server surfaced a genuine fork on
the MP4→MP8 scope line, so it was put to Driftwood (2026-07-19):

**Server simulation depth — Driftwood chose: PLAYER-LAYER AUTHORITY + MINIMAL
WALL COLLISION NOW.** The server runs the headless sim over the player layer
(roster, positions, directives, presence) AND blocks movement against **static
map walls** (a headless passability bake, `collision.ts`). It does NOT run
autonomous NPC/event motion, encounters, or event execution — that stays MP8·A's
per-zone runtime (roadmap D-0). So the server is authoritative over *where
players may walk*; it is not yet running the game's events.

### The governing deviation (read before the stages)

- **D-5-0 (server scope line).** The Beacon server is a HEADLESS authority. The
  engine's authoritative tick body (`scenes/map.ts` `update()` — NPC/event
  motion, parallels, encounters, dynamic event collision) is DOM/engine-bound
  and its headless extraction is **MP8·A's per-zone runtime** (D-0, reaffirmed
  by the MP4 gate: "pulling it into a local phase would duplicate MP8"). MP5
  therefore ships:
  - **In:** connection/room lifecycle, authoritative grid **movement with static
    wall collision** (`collision.ts`), player anti-stack, presence/emotes/say,
    late-join snapshot, resume-token reconnect, empty-room expiry, per-player
    **directive routing** (wired + tested, so MP8 drops its runtime in behind it).
  - **Out (→ MP8):** headless NPC/event simulation, so **no directive ORIGINATES
    on the MP5 server yet** (nothing runs events), and **dynamic** collision
    (an event/NPC blocking a tile), Phase-8 gameplay-zone pass overlays, ledge
    jumps, and precise looping-map edge-wrap arrival. The server blocks walls and
    water; it does not yet block on an NPC standing in a doorway.
- **D-5-1 (server hosts ONE configured game).** The server is started with a
  game project (`--project game.json`); every room in the process hosts that
  game and shares its (read-only) project. Driftwood's free relay is this,
  deployed with a featured game; a self-hosted world is this, deployed with the
  operator's game (roadmap D2 "one-command deploy"). A shared relay that hosts
  *arbitrary* games via a client-supplied project (zero dev setup for any game)
  is a packaging concern deferred to MP7/MP9 — out of MP5's server+transport
  scope. The browser "Play Together" flow (MP5·C) connects to a relay running the
  same game the client is running.

---

## Stage A — Node server + rooms (Opus, landed 2026-07-19)

The transport-agnostic server core + the plain-Node `ws` target.

### What landed

- **`src/shared/sim/collision.ts`** (NEW, headless) — the static map-passability
  core the server bakes movement against. Mirrors the engine's `tilePassable`
  layer stack (`passOv` override 1/2/3 → decor2 → decor → ground; a cell with no
  ground is blocked) but derives everything from `proj` + map data with **no
  Assets/DOM**: built-in tile pass from `builtin-tile-pass.ts`, project tiles
  from the `.pass`/`.terrain` asset-key convention (`proj.assets.tiles`),
  autotiles from `autotilePassable(proj.autotiles, id)`. Bakes a boolean grid
  once per map (`bakeMapCollision`); `isPassable` / `diagStepClear` / `canStep`
  are array reads. STATIC walls only (D-5-0). Imports only pure shared modules —
  sim lint wall holds.
- **`src/shared/sim/builtin-tile-pass.ts`** (NEW, pure data) — the pass flag of
  every one of the 58 built-in tiles (ids 0–57), which the engine reads off the
  DOM-built `Assets.tiles[]` the server can't load. **CI drift-guarded**:
  `collision.test.ts` re-parses `js/assets.js` and asserts the table still
  matches the `defTile` source, so a future built-in-tile edit can't silently
  desync server collision from the engine.
- **`server/`** (NEW in-repo package, its own `package.json`/`tsconfig.json`,
  dep `ws`) — the Beacon server. Shares `src/shared/` (sim + protocol) by
  relative import; esbuild inlines it into one runnable file (`server/build.mjs`
  → `dist/beacon.mjs`), so a deployed binary needs only Node + `ws`.
  - **`server/src/core/connection.ts`** — `ServerConnection`, the transport-
    agnostic client-link seam (`send`/`close`/`onMessage`/`onClose` + `id` +
    `source`). `source` is a coarse IP bucket for rate-limiting **only** —
    transient, never stored, never on the wire (D6).
  - **`server/src/core/config.ts`** — `BeaconLimits` (per-room player cap, room
    cap, message + join rate limits, byte cap, resume grace, empty-room TTL, idle
    timeout) with free-tier defaults.
  - **`server/src/core/room.ts`** — `BeaconRoom`: one authoritative headless
    world (`createWorld(project)`). Admits players (spawn → welcome → snapshot →
    presence-join others), routes in-room frames, runs the 60 Hz movement tick
    (buffered intents → grid step + `canStep` collision + player anti-stack →
    `advanceStep`; one delta of every player broadcast per tick), resume,
    detach, sweep (reap stale members + expire), close. Every player is a roster
    `PlayerEntity` (no server-side `G.player`). Directive `send` routes per pid.
  - **`server/src/core/motion.ts`** — headless `startStep`/`advanceStep`
    ported faithfully from the engine's `startMove`/`updateEntityMotion`
    (WALK 0.085 / RUN 0.13 tiles/tick), plus `translateIntent` (move/face only).
  - **`server/src/core/tokens.ts`** — CSPRNG resume tokens (32 url-safe chars,
    matching the protocol `isResumeToken` shape), rotated on every use so a
    sniffed token is dead.
  - **`server/src/core/server.ts`** — `BeaconServer`: the room table + connection
    lifecycle (handshake → create/join/resume), per-connection message token
    bucket, per-source join limiter (code brute-force cap), byte cap, strict
    decode of every frame (`decodeClientMessage` → `malformed`, never crash),
    idle/expiry sweep, room-code collision check, `stats()`.
  - **`server/src/node/ws-server.ts`** — the Node `ws` adapter: wraps each socket
    as a `ServerConnection` (`maxPayload` byte cap, X-Forwarded-For source behind
    `--trust-proxy`), drives the 60 Hz tick + 1 Hz sweep on `unref`'d timers,
    exposes a `/` health endpoint + graceful `close()`.
  - **`server/src/node/main.ts`** — the CLI (`node beacon.mjs --project game.json
    [--port] [--max-players] [--trust-proxy]`) with friendly help + startup log.
- **Tests (+30 vitest):**
  - `tests-unit/collision.test.ts` (+11): the drift guard, the layer stack,
    project/autotile pass, looping wrap, `canStep`/`diagStepClear` corner rule.
  - `tests-unit/beacon-server.test.ts` (+17, in-memory connection): handshake →
    create → join → authoritative move with wall collision → anti-stack →
    presence/emote → resume → expiry, plus MP5·D hardening (malformed/oversized/
    message-flood/join-flood/chat-off) and directive routing.
  - `tests-unit/beacon-ws.test.ts` (+2, REAL WebSockets): two clients join over
    `ws://`, one walks, both receive the authoritative delta; health endpoint;
    graceful close.

### Design decisions (stage A)

- **A-1 — One core, two targets, from the sim outward.** The room/server core
  speaks only `ServerConnection` + `src/shared/` sim/protocol; the Node `ws`
  adapter (and MP5·B's DO) is a thin socket wrapper. The 60 Hz tick + expiry
  sweep are driven by the adapter, so the SAME room logic runs headless anywhere.
- **A-2 — The server owns collision (not the client).** Per Driftwood's branch
  answer, wall collision is baked server-side from the project (`collision.ts`),
  so movement is genuinely server-authoritative — a client cannot walk through a
  wall by lying, only ask to move and be told the authoritative result. Faithful
  to the engine's `tilePassable` (drift-guarded), MINUS the dynamic layers that
  are MP8's runtime (D-5-0).
- **A-3 — Every server player is a roster entity.** There is no `G.player` on the
  server (that is a per-client notion). Snapshots/deltas are built from the
  roster alone; each client treats its own id's entity as its player and the
  rest as its roster (`applyPlayerStates`, unchanged from MP4).
- **A-4 — Resume tokens are real secrets now.** Unlike MP4's local-bus filler,
  MP5 issues CSPRNG tokens and rotates them on every resume, so a captured token
  can't be replayed. Bad resume answers `room-not-found` (no room/token oracle).
- **A-5 — Buffer-then-tick, never apply on arrival.** A client `input` buffers
  the latest move/face onto the member; the tick applies it. Message delivery
  never re-enters the sim (the MP2/MP4 discipline), so a flood of inputs can't
  reorder the simulation — it's just capped by the rate limiter.

### Deviations / discoveries (stage A)

- **D-5-0 / D-5-1** — recorded above (server scope line; one-configured-game).
- **D-A5-2 (no `PROTOCOL_VERSION` bump).** MP5 adds no message type or field —
  it stands up a real socket behind the MP0 protocol as-is. The snapshot/delta
  payload rides the already-opaque `JsonValue` channels, exactly as MP4. The
  `RoomSnapshot` shape (`{ players, mapId, timeOfDay }`) is unchanged.
- **D-A5-3 (server-spawned players have no appearance key).** The protocol's
  `hello` carries only name (no charset); the server spawns with `charset: ""`,
  and the client falls back to the local sprite (players.ts A-3). Per-player
  appearance is MP7.
- **D-A5-4 (`ws` added to root devDependencies).** `ws` + `@types/ws` are dev/
  server deps; nothing in `src/` imports them, so the Vite editor bundle is
  unaffected. The `server/` package also declares `ws` as a runtime dep for
  standalone deploy.

### Stage A gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1105** (74 files; +11 collision, +17 beacon-server, +2 beacon-ws over beacon-4's 1075) |
| node --test | **46** (unchanged — no interpreter/engine surface touched) |
| server `tsc` | **0** (server/tsconfig, strict) |
| root `tsc` | **0** (server excluded from the root program) |
| eslint | **0** — sim wall holds (collision.ts imports only pure shared modules); `server/dist` ignored |
| server bundle | `server/build.mjs` → `dist/beacon.mjs` builds; runs over real `ws` sockets (beacon-ws.test.ts) |
| Playwright / goldens | untouched this stage (no engine/render file changed — only new headless server code + eslint-ignore + a devDep); full golden re-run rides MP5·C (client UI) + the gate |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none (no `?v=` file; no player-facing strings yet — the Play Together UI is MP5·C) |

---

## Stage B — Cloudflare Durable Object target + deploy recipe (Opus, PENDING)

## Stage C — Client "Play Together" title-screen flow + wss transport (Opus, PENDING)

## Stage D — Hardening (Opus, PENDING — much already landed in the core at A)

## Stage E — WAN smoke test + 16-bot latency gate (Opus, PENDING)

---

## Phase gate (Fable SECURITY GATE, after E)

Template gates + fuzz suite + adversarial audit against the D6/safety checklist.
Verdict recorded here + the roadmap status table; tag `beacon-5`.

**MP5 SECURITY GATE kickoff (paste into a new Fable conversation):** _(filled in
when stages B–E land.)_
