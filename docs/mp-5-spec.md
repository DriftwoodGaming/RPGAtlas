# Phase MP5 Spec — Beacon Server, Rooms & Transport ("Project Beacon")

**Status:** ✅ **COMPLETE — Fable SECURITY GATE PASS 2026-07-19** (verdict at the
bottom; tag `beacon-5`). Build: Opus, stages A–E.
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

## Stage B — Cloudflare Durable Object target + deploy recipe (Opus, landed 2026-07-19)

The second target from the same core: one room/world per Durable Object with
WebSocket hibernation.

### What landed

- **`server/src/core/server.ts`** gains one-room-per-DO support: a
  `fixedRoomCode` option + `ensureRoom(code)`. When pinned, a codeless (create)
  or matching-code `join`/`resume` all enter the one room; any other code is
  `room-not-found`. The Node target leaves it unset (many rooms, random codes).
- **`server/src/cf/room-do.ts`** (NEW) — `BeaconRoomDO`: one `BeaconServer`
  (`fixedRoomCode` = its room code) per DO. Accepts sockets via the hibernation
  API (`state.acceptWebSocket`), stashes the room code in the socket's
  `serializeAttachment` so it survives eviction, drives the 60 Hz tick with a
  while-awake `setInterval` (stops when the last socket closes → the DO
  hibernates), and re-arms a storage `alarm` for the expiry sweep. Loads the game
  project once from the `GAME` KV namespace.
- **`server/src/cf/worker.ts`** (NEW) — the Worker front: `GET /new` mints a
  fresh room code (a create), `GET /rt?code=…` routes the WS upgrade to
  `BEACON_ROOM.idFromName(code)`, `GET /health` is a liveness check. `/new` keeps
  the browser client uniform: it asks for a code, then connects to `/rt?code=…`
  for both create and join (the Node target accepts a codeless `join` instead;
  the client handles both, MP5·C).
- **`server/wrangler.jsonc`** (NEW) — DO binding + `new_sqlite_classes`
  migration + `GAME` KV binding + `nodejs_compat`. **`server/tsconfig.cf.json`**
  typechecks `src/cf` + `src/core` against `@cloudflare/workers-types` (the Node
  and Workers runtimes have different globals, so `src/cf` is excluded from the
  Node `tsconfig.json`). **`server/README.md`** documents both deploy recipes.

### Design decisions (stage B)

- **B-1 — Same core, thin adapter.** The DO reuses `BeaconServer`/`BeaconRoom`
  verbatim (via `fixedRoomCode`); only the socket wrapper + tick/alarm wiring is
  DO-specific. Everything the Node core-tests prove holds for the DO.
- **B-2 — `/new` mints the code so the client stays uniform.** Routing a DO
  needs the code up front (`idFromName`), but the create intent has no code, so
  the Worker mints one at the HTTP layer; the client then connects with it.

### Deviations / discoveries (stage B)

- **D-B5-1 (no live DO deploy in this phase).** A Cloudflare account is the
  operator's; the DO is built correct-by-construction and **typechecks against
  `@cloudflare/workers-types`**, reusing the fully-tested core. `wrangler dev`
  (miniflare) + `wrangler deploy` are documented; live deploy is the user's step.
- **D-B5-2 (hibernation eviction resets a room — MP8).** World-state persistence
  across a DO eviction is MP8 (per-zone DO-storage snapshots). MP5's DO rebuilds
  an empty room on a cold start; active friend rooms keep the isolate warm, so
  this is rare. The precise hibernation-friendly tick cadence (60 Hz vs
  decimated) is also an MP8 measurement decision.

### Stage B gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1107** (+2 fixedRoomCode / one-room-per-DO tests over stage A's 1105) |
| node target `tsc` | **0** (`src/cf` excluded) |
| CF target `tsc` | **0** (`tsconfig.cf.json` vs `@cloudflare/workers-types`) |
| root `tsc` / eslint | **0 / 0** |
| goldens | untouched (no engine/render file changed) |

## Stage C — Client "Play Together" flow + wss transport (Opus, landed 2026-07-19)

The browser gets a real title-screen flow to a real server.

### What landed

- **`src/engine/net/socket-transport.ts`** (NEW) — a `Transport` over the
  browser's WebSocket (encode on send / strict-decode on receive; a malformed
  server frame is dropped, never crashes the client). Buffers outbound until
  open + inbound until `onMessage` attaches (the loopback contract). The
  WebSocket constructor is **injectable** (default `globalThis.WebSocket`) so the
  whole client↔server path is testable headlessly against the `ws` package.
  `isAllowedRelayUrl` enforces **wss-only** (or `ws://` to loopback for dev).
- **`src/engine/net/relay-client.ts`** (NEW) — `RelayClient`: the client of a
  real Beacon server (both creator and joiner are clients; the server is the
  authority). Runs the server handshake (`hello` → `join` codeless=create /
  coded=join, or `resume`), and mirrors the server exactly as MP4's RoomClient
  did — `welcome` (learns id + server-assigned code), `snapshot`/`delta`
  reconstruct, `directive` renders + replies, `presence` bubbles, plus `error`/
  `kick` → friendly copy. Reconstruction/rendering are injected hooks (headless-
  testable).
- **`src/engine/net/active.ts`** — `active.client` is now a structural
  `ClientLike` (sendInput/sendEmote/sendChat/close), satisfied by BOTH the MP4
  RoomClient and the MP5 RelayClient, so the loop/map tick stays
  transport-agnostic.
- **`src/engine/co-op.ts`** — the relay flow: `playTogether()` opens a small,
  inline-styled, kid-readable modal (name → Create / Join by code) with
  plain-language errors (`friendlyError`/`friendlyKick`, audience-beginners
  rule); `connectRelay` wires a RelayClient over the socket transport, reusing
  MP4's `reconstructClient`/`writeLocalPlayer`. Relay URL resolves dev override
  (`?relay=` / `window.RPGATLAS_MP.relayUrl`) → project (`system.multiplayer.
  relayUrl`) → `DEFAULT_RELAY_URL`. `multiplayerEnabled()` gates the title entry.
  (Also tidied the header's stale "?mp=1" note the MP4 gate flagged.)
- **`src/engine/scenes/title.ts`** — a **gated** "Play Together" entry, shown
  ONLY when `multiplayerEnabled()` (absent in the frozen fixtures → the title
  menu is byte-identical there → all title-menu e2e + goldens untouched). Built
  as a label→action list so ordering can't desync.
- **`src/engine/boot.ts`** — the RPGATLAS_MP dev hook already exposes
  `roster`/`session`/`localPlayer`/`sendInput`, reused by the relay e2e.
- **Tests:** `tests-unit/relay-client.test.ts` (+4, headless: RelayClient over
  socket-transport ↔ the real Node server — create/join/move/emote/error +
  wss-only guard); `tests-e2e/mp-relay.spec.mjs` (+1, REAL browser: spawns the
  built `dist/beacon.mjs`, two pages Create/Join via the UI over the browser's
  NATIVE WebSocket, move round-trips; no golden baseline).

### Design decisions (stage C)

- **C-1 — Everyone is a client; the server is the authority (D1).** The MP5
  creator is not a browser host (MP4's model) — it's a client of the server,
  exactly like a joiner. `RelayClient` unifies both; the server assigns the code.
- **C-2 — The title entry is gated so the goldens never move.** Multiplayer is
  a per-project flag (`system.multiplayer.enabled`, MP7 adds the DB toggle);
  absent in fixtures, so the title menu, its e2e, and the pixel goldens are all
  byte-identical.
- **C-3 — Injectable WebSocket = the browser path is unit-tested.** socket-
  transport takes a WebSocket ctor, so the full client protocol is proven
  headlessly against `ws`; the browser's native WebSocket is then proven once in
  a real-browser e2e against the real server.

### Deviations / discoveries (stage C)

- **D-C5-1 (Tauri CSP verified, no change needed).** `tauri.conf.json`
  `app.security.csp` is `null` (unrestricted), so a `wss://` WebSocket from the
  desktop webview is already permitted — verified. Tauri *capabilities*
  (`default.json`) gate the Tauri command API, not webview network, so no
  capability change is needed either. An explicit `connect-src` allowlist is a
  packaging-hardening item for MP9 (tightening CSP risks the editor's blob/data/
  worker usage; out of scope here). Windows stay predefined (no runtime window
  creation — the desktop trap holds).
- **D-C5-2 (English strings; i18n is MP7).** The Play Together UI + friendly
  errors ship English in MP5; the roadmap localizes all player-facing MP strings
  in MP7·D. Inline-styled (no CSS file → no cache-bust).

## Stage D — Hardening (Opus, landed 2026-07-19)

Most hardening landed in the core at Stage A (rate limits, byte caps, strict
decode, expiry, resume-token rotation, ambiguous errors, `source` never on the
wire). Stage D adds the dedicated **fuzz gate** the security review requires.

- **`tests-unit/beacon-fuzz.test.ts`** (+4): 5000 seeded random garbage frames
  across many connections — the server never throws, every reply is a valid
  ServerMessage, and a healthy player is unaffected; adversarial well-shaped
  frames (max seq/name/emote, reply to no directive, 200-input burst) don't
  crash; **replayed (rotated) resume token rejected**; **code brute-force capped**
  per source and never finds a random room.

## Stage E — WAN smoke + 16-bot latency gate (Opus, landed 2026-07-19)

- **`tests-unit/beacon-load.test.ts`** (+1, in-gate): **16 bots + 2 clients**
  (18 players) in one room over REAL WebSockets, each random-walking; measures
  intent→echo (send a move, time the first authoritative delta reflecting it),
  asserts every player moves and **p95 ≤ 150 ms**. Measured this run: **p50 ≈
  16.5 ms, p95 ≈ 31.9 ms** (144 samples) — comfortably inside budget.
- **`server/bench/bot-smoke.mjs`** (NEW, standalone) — heavier manual runs
  (spawns `dist/beacon.mjs`, N bots, configurable seconds). 16 bots / 6 s
  recorded **p50 16.1 · p95 31.6 · p99 31.9 · max 32.7 ms** (267 samples). This
  is the seed of the MP8 load harness.
- **WAN note (D-E5-1):** the "WAN" smoke runs against a LOCAL server (loopback) —
  a true cross-internet run needs the relay deployed (the operator's Cloudflare/
  host, D-B5-1). The latency gate's method + numbers are the deliverable;
  real-WAN measurement is an operator step + an MP8 concern.

### Stage C/D/E gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1109** (parallel pool, `npm run test:unit`) **+ 7** (isolated real-socket suite, `npm run test:net`: beacon-ws 2 · relay-client 4 · beacon-load 1) = **1116 total** (41 new over beacon-4's 1075) |
| node --test | **46** (unchanged) |
| Playwright | **126/126** — 123 goldens byte-identical, MP4 mp-coop/mp-presence green, new `mp-relay` green (real server + native WebSocket); perf 262.58/300 |
| root/server tsc · eslint | 0 / 0 / 0 (Node + CF server targets both typecheck) |
| 16-bot latency | p50 ≈ 16 ms · **p95 ≈ 32 ms** (budget 150), 144 samples; standalone bench 267 samples p95 31.6 |
| fuzz | 5000 garbage frames + adversarial + token-replay + brute-force — no crash |

> **Test-runner note (MP5).** The Beacon tests that open REAL TCP sockets +
> run a live 60 Hz tick (beacon-ws, relay-client, beacon-load) are timing-
> sensitive and were flaking perf-budget tests (mz-scale-import) under parallel
> CPU load. They now run isolated + serial via `npm run test:net`
> (`vitest.net.config.mjs`); the parallel `vitest run` covers everything else.
> Two full `vitest run` passes were clean after the split. The security gate
> runs BOTH: `npm run test:unit` (1109) + `npm run test:net` (7).

---

## Phase gate (Fable SECURITY GATE, after E)

Template gates + fuzz suite + adversarial audit against the D6/safety checklist.
Verdict recorded here + the roadmap status table; tag `beacon-5`.

### SECURITY GATE VERDICT — ✅ PASS (Fable, 2026-07-19)

Every gate independently re-run on a clean tree at `77fadbc`; every audit item
below verified by reading the source, not the spec.

**Template gates (re-run):**

| Gate | Result |
|---|---|
| vitest (test:unit, parallel pool) | **1109/1109** (74 files) |
| vitest (test:net, isolated serial) | **7/7** (beacon-ws 2 · relay-client 4 · beacon-load 1) — run alone, CPU quiet |
| node --test | **46/46** (determinism hash 46633057 still green) |
| cargo | **26/26** |
| Playwright | **126/126**; perf 242.58/300 ms (beacon-4 234.62 → +3.4%, within ±10%) |
| goldens | `git diff beacon-4..HEAD -- "*.png"` → **empty** (byte-identical at the byte level) |
| tsc | root **0** · server Node **0** · server CF (`tsconfig.cf.json` vs @cloudflare/workers-types) **0** |
| eslint | **0**, and the sim wall **fires on a probe** (engine import into `src/shared/sim/` → no-restricted-imports error) |
| i18n parity | 31 tests green (MP5 player strings English per D-C5-2; localization is MP7·D) |
| versions / FV / cache-busts | 1.2.0 × 7 sites · FORMAT_VERSION 2 · no `?v=` file touched since beacon-4 |
| **16-bot latency gate** | **18 players (16 bots + 2 clients), 144 samples — p50 16.4 ms · p95 31.9 ms (budget 150)** |
| fuzz | 4/4 — 5000 seeded garbage frames · adversarial well-shaped · token replay rejected · brute force capped |

**Adversarial audit (D6/safety checklist) — CLEAN:**

1. **Code brute-force math.** Codes are 9 chars over a 30-glyph alphabet =
   **44.16 bits ≥ 40**, CSPRNG with rejection sampling (no modulo bias),
   collision-checked at create. Join/resume share one per-source budget
   (30/min default); a miss answers ambiguous `room-not-found` (no room-vs-token
   oracle). At the capped rate a single source needs ~10⁵–10⁶ years to hit a
   room even with 1000 concurrently active — online guessing is hopeless.
2. **Flood.** Per-connection token bucket (40 msg/s, burst 80) + 20-strike
   close; joins separately capped per source; movement is buffer-then-tick
   (one pending move per member — delivery never re-enters the sim), so an
   input flood cannot reorder or wedge the world. Fuzz proves a healthy player
   is unaffected during a 5000-frame garbage storm.
3. **Oversized / malformed frames.** Three independent caps: `ws` `maxPayload`
   at the socket, `byteLen` (true UTF-8 bytes) in the core, and the protocol
   decoder's length cap. Every inbound frame goes through `decodeClientMessage`;
   failure → counted strike + `malformed`, never a throw. Binary frames map to
   malformed. The client symmetrically strict-decodes server frames and drops
   invalid ones (survives a malicious self-hosted server).
4. **Resume-token replay.** Tokens are 32-char CSPRNG (192 bits), issued per
   session, **rotated on every successful resume**; the fuzz suite replays the
   pre-rotation token and gets `room-not-found`. Tokens match live members
   never (only `conn === null` slots resume), so a sniffed token can't hijack a
   connected player.
5. **Cross-room leakage.** `broadcastDelta`/`broadcastPresence` iterate only
   the room's own member map; each room owns a separate `createWorld` instance;
   directives route per-pid to that member's socket; `deliverReply` rejects a
   reply whose `playerId` doesn't own the pending directive and re-validates
   the value against the directive shape.
6. **No IP / PII on the wire.** All seven server→client sends enumerated
   (welcome/snapshot/delta/directive/presence/kick/error): payloads are typed
   unions; `PlayerState` = id + name(≤24) + charset key + mapId + motion only.
   `source` (the IP bucket) appears solely in the join limiter and dev log
   events — never in any `encodeMessage` call, either direction. Retention is
   documented (server/README "What ships on the wire (privacy)" + roadmap
   safety rule 1).
7. **Expiry / grace.** Empty-room TTL 60 s, resume grace 30 s, idle timeout
   45 s — all enforced in `sweep()` (injectable clock, covered by
   beacon-server tests); DO target re-arms a storage alarm so the sweep runs
   through hibernation.
8. **Chat default-off (D4).** Free-text `chat` is rejected server-side with
   `chat-disabled` until the MP7 DB toggle exists; presets pass. Verified in
   code + tests.
9. **Friendly copy.** `friendlyError`/`friendlyKick` cover every ErrorCode /
   kick code with plain language; `detail` and decode reasons are dev-facing
   and never rendered; the Play Together modal shows status text, not codes.
10. **wss-only.** `connectSocket` throws on a non-wss URL (`ws://` allowed only
    to localhost/127.0.0.1/::1 for dev); `connectRelay` pre-checks and shows
    friendly copy. Tauri CSP already permits wss (D-C5-1, no change).
11. **Title gating / goldens.** "Play Together" renders only when
    `multiplayerEnabled()`; absent in the frozen fixtures — proven by the empty
    PNG diff + 126/126.

**Scope deferrals CONFIRMED as intended boundaries:** D-5-0 (server = player
layer + static wall collision; NPC/event sim, dynamic collision, zone overlays,
loop edge-wrap, directive ORIGINATION → MP8·A per-zone runtime — routing is
wired + tested now), D-5-1 (one configured game per process; arbitrary-game
relay → MP7/MP9 packaging), D-B5-1 (live DO deploy = operator's Cloudflare
account), D-B5-2 (world persistence across DO eviction → MP8).

**Non-blocking notes carried to MP9 hardening:** resume-token comparison is not
constant-time (impractical to exploit: 192-bit token, network jitter dwarfs the
compare, and resumes burn the join budget) · CF Worker `/new` mints codes with
no HTTP-layer throttle (an abandoned code costs nothing — the DO spawns only on
`/rt` — and Cloudflare's fronting absorbs; revisit with the MP9 packaging CSP
pass) · `main.ts` writes the abuse-event `source` to stdout on strike-close /
idle-timeout — inside the documented transient-retention allowance, keep it out
of any player-correlated logging when MP9 adds moderation logs.

Tag: `beacon-5`.

**MP5 SECURITY GATE kickoff (paste into a new Fable conversation):**
```
Project Beacon — MP5 SECURITY GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP5 + "Kid safety & privacy") + docs/mp-5-spec.md.
Re-run template gates + the fuzz suite (tests-unit/beacon-fuzz.test.ts) + the latency gate (tests-unit/beacon-load.test.ts, 16 bots + 2 clients, p95 ≤ 150 ms). Independently typecheck both server targets (server: `npm run typecheck` → Node + CF). Adversarial audit against the D6/safety checklist: attempt code brute-force math (room-code entropy ≥ 40 bits + join rate limits), flood, oversized/malformed frames, resume-token replay (rotation), cross-room leakage, and verify NO message ever carries an IP or anything beyond name + entity state (grep both wire directions in src/shared/net/protocol.ts + server/src/core). Verify empty-room expiry + resume grace. Verify the "Play Together" copy is friendly (no codes/stack traces to players) and the title entry is gated so the goldens stay byte-identical. Verify wss-only. Confirm the D-5-0/D-5-1/D-B5-* scope deferrals (server player-layer only + wall collision; NPC/events/persistence → MP8; one configured game → MP7/MP9 relay) are the intended boundaries.
Record verdict + the 16-bot numbers, tag beacon-5, push, and end with the MP6 BUILD hand-off block.
```
