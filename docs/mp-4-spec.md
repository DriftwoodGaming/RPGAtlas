# Phase MP4 Spec — Local Multi-Client Co-op ("Project Beacon")

**Status:** ✅ **PHASE COMPLETE — Fable gate PASS 2026-07-19, tag `beacon-4`**
(verdict at the bottom of this file). Stages A–D landed 2026-07-19 (Opus) —
local co-op works: two tabs share a world over BroadcastChannel (join, mirror,
host-authoritative movement, emote/say bubbles, late-join).
**Authored:** 2026-07-19 by Claude Opus 4.8 (stage A build), from the MP4 section
of `docs/MULTIPLAYER_ROADMAP.md` + `docs/mp-3-spec.md` + the MP0·B singleton
audit / §C6 origins.
**Workflow:** commit + push each stage to `main`; the frozen pixel goldens stay
**byte-identical at every stage**; log deviations here.

## Branch-point answer (asked at kickoff, per the roadmap ❓)

**Friend-room map policy — Driftwood chose: FREE ROAM** (the roadmap default
(b), 2026-07-19). Players roam maps independently; the world knows every
player's map + position, and a client renders the co-players standing on *its*
map. A room is not locked to one leader's map.

### Architecture & the MP4/MP8 boundary (read this before stage B)

Free roam means the World is no longer single-map in principle: a room ticks
every occupied map. But the engine's *authoritative map-runtime tick* (NPC/event
motion, parallels, encounters) still lives in the single-map map scene
(`scenes/map.ts` `update()`), bound to the focused map through the MP1 compat
shim — MP1·B/MP2 deliberately left that tick body in the engine and did **not**
extract a headless per-zone runtime. MP8·A is the phase that builds
"zone-per-map sharding + per-zone runtime". So MP4 draws this line, recorded here
as the governing deviation:

- **D-0 (scope line, free roam):** MP4 delivers free roam at the **player**
  layer — every player has a `mapId` + position; the host authoritatively moves
  each player on their own map (movement/collision/transfer), directives target
  the right player wherever they are, presence/emotes/say and late-join work
  across maps, and each client renders the co-players on its map. What MP4 does
  **not** build is the headless simulation of **autonomous NPC/event motion on a
  map that no client is rendering** — that is precisely MP8·A's per-zone runtime,
  and pulling it into a local-only phase would duplicate MP8 and put the byte-
  identical golden gate at risk for no local-co-op benefit. In the local MP4
  model each occupied map is being rendered by the player on it, so co-located
  players see a fully live map; a map's NPCs only "pause" when literally no one
  is there to see them, which MP8 resolves when zones tick headlessly. This is
  logged now, at stage A, so the gate and MP8 both inherit it explicitly.

Everything MP4 adds is **inert in solo** (one player, one occupied map, empty
roster), which is what keeps the frozen goldens byte-identical at every stage —
the regression gate the whole project rides on.

## Objective

Two browsers, one world, no server yet: a `BroadcastChannel` transport (MP4·B)
proves multi-client correctness on one machine, fully deterministic and
Playwright-testable. Stage A lays the world-side foundation: the multi-player
roster + entity model and the client-side rendering of remote players (the first
moment a second player walks on screen).

---

## Stage A — Multi-player entities + presence rendering (Opus, landed 2026-07-19)

### What landed

- **`src/shared/sim/players.ts`** (NEW, headless) — the roster + entity model:
  - `PlayerEntity` — one OTHER player as the world knows them: id + display name
    + charset **key** (a string; the client resolves it to a spritesheet index,
    since Assets lives on the DOM side and the sim wall forbids importing it) +
    `mapId` + the **same motion sextet** the map runtime writes on `G.player` /
    followers (`x/y`, render `rx/ry`, previous-tick `prx/pry`, target `tx/ty`,
    `dir`, `moving`, `animT`). Plus a social overlay pair (`emote`/`say`, null
    until MP4·C) so the type is stable across the phase.
  - `RosterState` (`{ local, players }`) + `createRosterState()` — a per-world
    runtime-only struct exactly like the directive broker (never snapshotted; a
    room rebuilds it from presence + snapshot). `players` holds the **non-local**
    players (the local viewer is `G.player`, rendered through the existing player
    path, never a roster entry) so the render path draws the local player once.
  - `resolveSpawn` / `gridDirOf` — spawn resolution against the project start
    position (`system.startMapId/startX/startY/startDir`), overridable per field
    (MP7 adds per-map spawn points in the DB). `gridDirOf` maps a Dir string or
    number to a DIRD key, defaulting to down.
  - `addPlayer` / `removePlayer` / `getPlayer` / `playersOnMap` — the join/leave
    lifecycle + the per-map query the renderer uses. `addPlayer` snaps all render
    coords onto the spawn tile (no interpolation streak on join) and is
    idempotent (re-adding an id re-spawns it). `playersOnMap` returns a shared
    empty array for the solo case (zero per-frame allocation).
- **`src/shared/sim/world.ts`** — `World` gains `roster: RosterState`, created
  by `createRosterState()`. Empty in solo. Runtime-only.
- **`src/engine/render-glue.ts`** — remote players draw on the local map through
  the **exact follower/player sprite path**: `playersOnMap(defaultWorld,
  G.mapId)` feeds drawable objects (charset key resolved client-side via
  `Assets.charsetIndex`, unknown key → the local player's sprite) that join the
  same depth-sorted, prx→rx-interpolated `drawables` list; the HD sprite-id
  branch gains an `rp_<id>` case. A new `drawRemotePresence` pass paints each
  remote's **name tag** (the only personal fact rendered — D6) on the 2D overlay
  in the combat-overlay's shake+zoom+camera space (so it works in both the HD
  and Canvas-2D paths). Both additions are guarded by a non-empty
  `remotePlayers` list → **no-op in solo → goldens byte-identical**.
- **`src/engine/boot.ts`** — installs `window.RPGATLAS_MP`
  (`addPlayer`/`removePlayer`/`roster` bound to `soloHost.world`), the local-test
  roster surface. It drives the *exact* code path MP4·B's transport will
  (add/remove on `defaultWorld.roster`), so the two-context e2e and manual dev
  testing can exercise the remote-render path before a live peer exists. Inert
  until called — never touched in normal play, so the goldens are unaffected
  (a diagnostic hook alongside the existing `RPGATLAS_RENDERER_STATS` /
  `AtlasRng` ones).
- **Tests:**
  - `tests-unit/sim-players.test.ts` (+10, headless): solo-inert invariant
    (empty roster, shared empty query result), spawn resolution (project
    defaults + overrides + project-less), `gridDirOf`, add/remove/get
    idempotency, per-map filtering.
  - `tests-e2e/mp-presence.spec.mjs` (+1, live): under the fake clock + seeded
    RNG + pinned movers + `?hd2d=1`, a remote player joins one tile right of the
    local player, its name tag changes the (otherwise idle) HD overlay, and
    removing it restores the overlay **byte-for-byte** — proving the render path
    executes, draws, and cleans up, with zero console/page errors. Adds no golden
    baseline image; existing goldens untouched.

### Design decisions (stage A)

- **A-1 — The roster holds only remote players; the local player stays
  `G.player`.** A client renders itself once, through the unchanged player path
  (local input / prediction), and renders everyone else from `roster.players`.
  This keeps the solo roster genuinely empty (byte-identity) and makes the
  host/client fill rules in MP4·B trivial: a client fills the roster with
  everyone-except-self; the host fills it with everyone-except-0 and builds
  player 0's outbound entity from `G.player` at broadcast time.
- **A-2 — A remote player is a follower that answers to someone else's
  keyboard.** The entity's motion fields are byte-for-byte the map runtime's
  entity shape, so the existing depth sort, `walkFrame` animation, and prx→rx
  between-tick interpolation apply with zero new render code — the drawable just
  carries a `remoteId` instead of a `followerId`/`ev`.
- **A-3 — The world stores an appearance KEY, not a sprite index.** Charset →
  index resolution is `Assets`, which the sim lint wall forbids in
  `src/shared/sim/`. So `PlayerEntity.charset` is a string the client resolves at
  render; an unknown/empty key falls back to the local player's sprite so a
  remote never renders blank.
- **A-4 — Name tags render on the 2D overlay, not as DOM.** Drawn in the same
  camera space as float texts / the combat overlay, so they ride the HD and 2D
  paths identically and interpolate with the sprite. Name is the only per-player
  fact shown (D6); MP4·C adds emote/say bubbles to the same pass.
- **A-5 — The local-test hook is real infrastructure, not a throwaway.**
  `window.RPGATLAS_MP` calls the same `addPlayer`/`removePlayer` the MP4·B host
  will; stage A just supplies the caller (a test/dev) instead of a peer. It is
  inert in normal play, so it costs the goldens nothing while giving stage A a
  live regression guard for the render integration.

### Deviations / discoveries (stage A)

- **D-0 (scope line, free roam):** recorded above under the branch-point answer
  — MP4 delivers free roam at the player layer; headless autonomous-NPC ticking
  on unrendered maps is MP8·A's per-zone runtime.
- **D-A1 (no protocol change in stage A):** the roster is a world-side runtime
  structure; it rides no new wire message. MP4·B routes it over presence
  (`join`/`leave`, already in protocol v1) + the snapshot/delta channel, so no
  `PROTOCOL_VERSION` change is needed for stage A.

### Stage A gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1068** (69 files; +10 sim-players) |
| node --test | **46** (unchanged — no interpreter surface touched) |
| cargo | **26** (Rust untouched by MP4) |
| Playwright | **124/124** (2.8m) — the 123 single-player goldens **byte-identical** (new `mp-presence` spec is additive, captures no baseline); renderer-perf 246.29 ms/frame (budget 300; beacon-3 stage-A 246.29 → identical) |
| eslint / tsc | **0 / 0** — sim wall holds (`players.ts` imports only protocol types + `world`; no Assets/DOM/engine) |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none needed (no `?v=` file touched — engine/sim plumbing, no player-facing strings) |
| i18n | no player-facing strings added (name tags render dev/player-supplied names; the "Play Together" UI + toasts land in MP4·B/C) |

---

## Stage B — Transport + host/client session (Opus, landed 2026-07-19)

Landed in two commits: the transport (`e46b3a6`), then the room-session core
(`696f838`); the live wiring rode into `d2e023e` with C/D.

### What landed

- **`src/engine/net/broadcast-transport.ts`** (NEW) — a point-to-point
  `Transport` over the browser's `BroadcastChannel` (same-origin bus): a
  rendezvous channel `beacon:<room>` carries the join handshake; each accepted
  connection gets its OWN channel `beacon:<room>:c<cid>` so two endpoints share
  it like a private socket. Frames cross as JSON strings (encode on send /
  `JSON.parse` on receive) — this exercises the real wire path, unlike
  loopback's by-reference pass. Both ends buffer until wired (client buffers
  outbound until the server's `ready`; either end buffers inbound until
  `onMessage` attaches), the loopback delivery contract over an async bus. MP5's
  WebSocket swaps in behind the same interface. This is client/host glue, off
  the sim graph.
- **`src/engine/net/session.ts`** (NEW) — the live `session.mode` (`solo` |
  `host` | `client`), room code + local player id. Solo is the default and the
  ONLY mode the goldens run in.
- **`src/engine/net/room-host.ts`** (NEW, headless) — `RoomHost` owns the
  authoritative world (its `WorldHost` + tick, exactly as solo) and serves peers.
  On join: assign an id, spawn a roster entity, send `welcome` + `snapshot`,
  presence-join the others. Routes `input` → `WorldHost.pushInput` tagged by
  player (the tick applies it); `reply` → `deliverReply`; `emote`/`chat` → roster
  social overlay + presence broadcast. **Directives route by player** (0 → the
  loopback the WorldHost installed; else the client's transport). `afterTick()`
  broadcasts one `delta` of every player's position — **no peers ⇒ nothing sent,
  so a lone host is byte-identical to solo**.
- **`src/engine/net/room-client.ts`** (NEW, headless) — `RoomClient` mirrors the
  host (the MP2·A reconstruction seam): `welcome` sets the local id; `snapshot`/
  `delta` reconstruct the roster + own player (via injected hooks); `directive`
  renders through the engine UI and answers with `reply`; `presence` drives
  toasts + emote/say bubbles. Sends its own input as `input` intents — the host
  is the one authority (D1).
- **`src/engine/net/world-host.ts`** — `pushInput(playerId, seq, intent)`, the
  multi-player tick inbox (the loopback path now calls it with player 0).
- **`src/shared/sim/players.ts`** — `PlayerState` wire shape + `buildPlayerStates`
  / `applyPlayerStates` (identity + position are the ONLY per-player facts, D6).
  `applyPlayerStates` snapshots prev-tick coords so a client interpolates the
  host's authoritative positions smoothly.
- **Live wiring (`d2e023e`), every branch gated so solo is byte-identical:**
  - `loop.ts`: client mode runs the thin `clientTick`; host mode ticks
    authoritatively then `afterTick()`. Solo takes the exact old path.
  - `scenes/map.ts`: drained intents dispatch by playerId (0 →
    `applyPlayerIntent` unchanged; peers → `applyRemoteIntent` moving their
    roster entity with same-map collision); `advanceRemotePlayers()` + a roster
    prx snapshot, both gated on a non-empty roster; `clientTick()` (capture
    input → send intents).
  - `net/active.ts`: live `host`/`client` refs (null in solo → no-op).
  - `co-op.ts`: the Play Together flow — `createRoom` (host from a running game),
    `joinRoom` (reconstruct map + player from the snapshot, apply authoritative
    positions), presence toasts (inline-styled → no CSS/cache-bust).
  - `boot.ts`: `RPGATLAS_MP` dev entry gains `createRoom`/`joinRoom`/`session`
    (+ diagnostic `sendInput`/`sendEmote`/`localPlayer`). This is the MP4·B
    "dev-flag entry"; the polished title-screen flow is MP5·C.
- **Late-join:** a mid-game joiner gets the current `snapshot` (all player states
  + mapId + timeOfDay); `reconstructClient` rebuilds the map + party from the
  shared project and lands on the map, then authoritative positions apply. Proven
  by the third tab in `mp-coop.spec.mjs`.
- **Tests:** `tests-unit/broadcast-transport.test.ts` (+2, handshake + isolation);
  `tests-unit/room-session.test.ts` (+5, the protocol heart headless over the
  real bus: join→welcome→snapshot roster reconstruction, input routing tagged by
  player, delta sync, presence join/emote + isolation, directive routing + reply
  resuming the host).

### Stage C — Emotes + preset-phrase say (Opus, landed 2026-07-19)

- The wire path landed with B: `emote`/`chat` → the host sets the roster entity's
  social overlay + broadcasts `presence` emote/say → the client applies it to its
  roster mirror. `PlayerEntity.emote`/`say` (reserved in stage A) carry `{id/text,
  t}` stamped with the host tick.
- **`render-glue.ts` `drawRemotePresence`** gained transient speech bubbles
  (`drawPresenceBubble`) over remote players, expiring after `PRESENCE_BUBBLE_TICKS`
  (~2.5s); free-text say wins over an emote token. Always-on social layer (D4);
  the name tag stays the only PERSISTENT personal fact (D6). Inert in solo.
- Scope: **emotes are the MP4 deliverable.** Preset-phrase *say* is wired
  end-to-end (protocol `chat.preset` → presence → bubble), but the preset-phrase
  **list authoring** is MP7 (DB) and filtered free-text is MP9 — so a `preset`
  say has no text to render until MP7 supplies the list; free-text `text` renders
  directly. The DB authoring UI for custom presets is MP7 per the roadmap.

### Stage D — Two-context e2e (Opus, landed 2026-07-19)

- **`tests-e2e/mp-coop.spec.mjs`** (+1): two pages of ONE browser context (same
  origin ⇒ they share the BroadcastChannel bus, exactly like two tabs on one
  machine — separate Playwright *contexts* are storage-partitioned and would NOT
  share the bus, so two pages/one context is the correct shape). Proves: host
  opens a room, client joins by code, the host sees the joiner in its roster and
  the client mirrors the host, a move the client sends is simulated by the host
  and echoed to both, an emote crosses the wire, and a **late** third joiner gets
  a snapshot of everyone present — all with zero console/page errors. **Green 3×
  consecutively** (the flake bar), via `--repeat-each=3`.

### Design decisions (B/C/D)

- **B-1 — Everyone is a player entity; the local one is `G.player`.** The host's
  own player is player 0 (`G.player`, moved by the unchanged `applyPlayerIntent`);
  peers are roster entities the host moves with `applyRemoteIntent`. A client's
  own player is `G.player` (driven by the host's authoritative echo via `onLocal`);
  the others are its roster. `buildPlayerStates` unifies them on the wire.
- **B-2 — The host is the one authority (D1), even locally.** A client never
  simulates: it sends intents and renders the host's deltas. `clientTick` is a
  thin capture-and-send + terrain-anim; `update()` is never called in client mode,
  so the authoritative tick body is untouched (no client/host divergence risk).
- **B-3 — Solo byte-identity by gating, not by mode-specific code paths.** Every
  new branch keys off `session.mode` / a non-empty roster / `active.host` — all of
  which are the solo values (`"solo"` / empty / null) in single-player, so the
  solo path is the *exact* pre-MP4 code. The golden suite (123 specs) confirms
  byte-identical at every commit.
- **B-4 — Two pages, one context (the BroadcastChannel reality).** BroadcastChannel
  is same-origin AND same storage partition; separate browser contexts don't share
  it. The "two-context" e2e is therefore two pages of one context — which is also
  the real deployment (two tabs on one machine).

### Deviations / discoveries (B/C/D)

- **D-B1 (no `PROTOCOL_VERSION` bump):** MP4 adds no new message *type* — it uses
  the MP0 protocol as-is (`hello`/`join`/`welcome`/`snapshot`/`delta`/`directive`/
  `presence`/`input`/`emote`/`chat`). The MP4 snapshot/delta *payload* rides the
  already-opaque `ServerSnapshot.world` / `ServerDelta.changes` (`JsonValue`), so
  no wire-shape change. Consistent with the MP3 gate ruling: v1 keeps absorbing
  additive content until 2.0 freezes it.
- **D-B2 (leave detection deferred to MP5):** BroadcastChannel gives no
  disconnect signal, and MP5·A owns resume-token reconnect + empty-room expiry +
  heartbeats. MP4 implements JOIN + presence-join + late-join fully; clean LEAVE
  (a tab closing) is not detected in MP4. `applyPlayerStates` already reconciles
  the roster to the host's reported set, and `autoResolveDirectivesFor` +
  `removePlayer` exist for when MP5 adds the heartbeat reaper. Documented, not a
  gap in the MP4 proof (the e2e never requires a leave).
- **D-B3 (remote attack/act deferred):** `applyRemoteIntent` handles `move` +
  `face`. A peer's `attack`/`act` (which would trigger the host's events under the
  participants-only pause) is a later slice — the structure is in place
  (per-player origins, `participantsOf`), and MP6 (co-op battles) is where remote
  action against world events gets its real treatment. MP4 peers walk, emote, and
  see the host's world; they don't yet swing swords or trip events remotely.
- **D-B4 (client sees static host NPCs — the D-0 boundary in practice):** a
  client renders its own map with NPCs at their initial positions; the host's
  authoritative NPC motion is not streamed to clients in MP4 (only player
  positions are). This is the player-layer/NPC-layer split of D-0: full NPC state
  sync rides MP8's per-zone runtime + real deltas. Co-located players see each
  other move perfectly; NPC motion is host-local for now.
- **D-B5 (all players spawn on the start tile):** MP4 spawns every joiner at the
  project start position, so players overlap until they move (per-map spawn points
  are MP7, per the roadmap). Name tags disambiguate.

### Stage B/C/D gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1075** (71 files; +2 broadcast-transport, +5 room-session over stage A's 1068) |
| node --test | **46** (unchanged) |
| cargo | **26** (Rust untouched) |
| Playwright | **125/125** (2.9m) — the 123 single-player goldens **byte-identical** (`mp-presence` + `mp-coop` additive, no baselines); `mp-coop` green **3× consecutively**; renderer-perf 237.40 ms/frame (budget 300; beacon-3 246.10 → within band) |
| eslint / tsc | **0 / 0** — sim wall holds; the room/transport modules are engine/host glue (BroadcastChannel is a browser API), correctly outside `src/shared/sim/` |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none (no `?v=` file; toast + bubbles are inline-styled, no player-facing string table) |
| i18n | no locale strings added (names are player-supplied; the localized Play Together UI is MP5·C/MP7) |

---

## Phase gate (Fable, after D)

Template gates; new two-context e2e green 3× consecutively; goldens untouched;
audit presence messages carry no data beyond name + entity state (D6). Verdict
here + roadmap status table; tag `beacon-4`.

**MP4 GATE kickoff (paste into a new Fable conversation):**
```
Project Beacon — MP4 GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP4) + docs/mp-4-spec.md.
Re-run template gates; run the new two-context e2e (tests-e2e/mp-coop.spec.mjs) 3× consecutively; goldens untouched; audit presence messages carry no data beyond name+entity state (D6). Also spot-check the solo-inert gating (session.mode/roster/active.host guards) that keeps the goldens byte-identical, and confirm the D-0/D-B2..B5 scope deferrals (headless NPC ticking, leave detection, remote attack/act, per-map spawns) are the intended MP5/MP6/MP7/MP8 boundaries.
Record verdict, tag beacon-4, push, end with the MP5 BUILD hand-off block.
```

---

## Fable gate verdict — PASS (2026-07-19, Claude Fable 5)

Every gate independently re-run on a clean tree at `7cc6f8d`; every audit done
by reading the landed source, not the spec's claims.

### Template gates (all re-verified)

| Gate | Re-run result |
|---|---|
| vitest | **1075 / 1075** (71 files) — matches the build's count |
| node --test | **46 / 46** |
| cargo | **26 / 26** (Rust untouched by MP4) |
| Playwright (full) | **125 / 125** (2.8 m) — all 123 single-player goldens green; `git diff beacon-3..HEAD -- '*.png'` is **empty** (zero baseline images changed = goldens untouched at the byte level) |
| renderer-perf | **234.62 ms/frame** (budget 300; beacon-3 gate 252.03, build 237.40 → within band, marginally faster) |
| mp-coop flake bar | **3× consecutively green with `--workers=1`** (strictly serial), plus 3× green on the default 2-worker run — 6/6 total |
| eslint / tsc | **0 / 0** — and the sim wall **fires on a probe** (a temporary `engine/assets.js` import in `players.ts` errors with the Beacon MP1 restriction message; file restored, `git diff` clean) |
| versions / FORMAT_VERSION / cache-busts | **1.2.0 at all 7 sites** (package.json, tauri.conf.json, Cargo.toml, Cargo.lock, README badge, help.ts, patch-notes.js) · **FORMAT_VERSION 2** (js/data.js) · **no `?v=` file in the beacon-3..HEAD diff** → no cache-busts needed, as claimed |
| i18n | no locale strings added (toast/bubble text is player-supplied names + inline styling; localized Play Together UI is MP5·C/MP7) — parity unchanged |

### D6 presence audit — CLEAN

Both wire directions read from source:

- **Host outbound:** `welcome` (proto/playerId/roomCode/resumeToken/tick),
  `snapshot`/`delta` (the `PlayerState` list: id + name + charset key + mapId +
  motion — exactly "name + entity state"), `presence` (join carries name; emote
  carries the emote id; say carries text/preset — the D4 social layer the
  protocol marks as the D6 audit surface), per-player `directive` frames.
- **Client outbound:** `hello` (proto + name), `input` (seq + intent), `reply`,
  `emote`, `chat`. Nothing else exists.
- No IP (structurally impossible over BroadcastChannel, and nothing synthesizes
  one), no input history rebroadcast to peers (input flows client→host only),
  no device data, no PII. Names truncated to 24 chars on both ends, matching
  the protocol validator. The resume token is random filler in MP4 (local bus)
  and correctly flagged as not-a-secret until MP5 issues real ones.

### Solo-inert audit — CLEAN (the goldens' guarantee, verified in source)

- `session.ts` defaults `mode = "solo"`; only `RoomHost`/`RoomClient`
  constructors ever change it.
- `loop.ts`: solo takes the exact pre-MP4 path (`soloHost.tick()`);
  `active.host` is null in solo so `afterTick()` never runs — and even a lone
  host sends nothing (`!this.clients.size` early-out).
- `scenes/map.ts`: the roster prx snapshot and `advanceRemotePlayers()` both
  gate on `roster.players.size` (0 in solo); intent dispatch routes player 0
  through the unchanged `applyPlayerIntent`; `clientTick()` is reachable only
  from the loop's client branch, so `update()` is untouched in solo AND client
  modes.
- `render-glue.ts`: `playersOnMap` returns the shared EMPTY array in solo →
  zero remote drawables pushed and `drawRemotePresence` never called.
- `boot.ts` `RPGATLAS_MP` + `co-op.ts` are pure dev hooks — nothing in normal
  play reaches them.

### Scope deferrals — CONFIRMED as the intended phase boundaries

- **D-0 / D-B4** (headless NPC ticking on unrendered maps; clients see static
  host NPCs) → **MP8·A** is exactly "zone-per-map sharding + per-zone runtime"
  in the roadmap. Correct line: pulling it into a local phase would duplicate
  MP8 against the golden gate for no local benefit.
- **D-B2** (leave detection) → **MP5·A** owns resume-token reconnect +
  empty-room expiry + heartbeats; BroadcastChannel has no disconnect signal.
  `applyPlayerStates` reconciliation + `removePlayer` already exist for the
  reaper. The e2e never requires a leave, so the MP4 proof is not weakened.
- **D-B3** (remote attack/act) → **MP6** (co-op battles) is where remote action
  against world events gets its real treatment; `applyRemoteIntent` handles
  move + face with the participants-only structure in place.
- **D-B5** (all joiners spawn on the start tile) → **MP7·A** explicitly adds
  per-map spawn points in the Database.

### Gate rulings / notes

1. **Roadmap MP4·D's "trigger a directive event" e2e item — ACCEPTED as
   satisfied headlessly.** The two-context browser e2e does join/mirror/move/
   emote/late-join but not a remote-triggered directive — a direct consequence
   of D-B3 (peers can't act yet). The directive path over the REAL BroadcastChannel
   bus is proven by `tests-unit/room-session.test.ts` ("a directive routes to
   the right client and its reply resumes the host"). MP6 owns the live-browser
   proof when remote action lands.
2. **Doc nit (non-blocking):** `co-op.ts`'s header mentions a "(title, ?mp=1)"
   dev entry; no `?mp=1` wiring exists — `window.RPGATLAS_MP` is the only
   entry. The comment overstates the surface; reality is *more* inert than
   documented. Tidy the comment whenever the file is next touched (MP5·C
   replaces this flow anyway).
3. **D-B1 (no `PROTOCOL_VERSION` bump) — ACCEPTED again.** MP4 adds no message
   type or field; the snapshot/delta payload rides the already-opaque
   `JsonValue` channels. Consistent with the MP3 gate ruling (v1 absorbs
   additive content until 2.0 freezes it) and this time it isn't even additive
   at the schema level.

**Verdict: PASS.** Tag `beacon-4`. MP5 (Beacon server, rooms & transport —
Opus build, Fable SECURITY gate) is next.
