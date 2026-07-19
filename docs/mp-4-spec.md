# Phase MP4 Spec — Local Multi-Client Co-op ("Project Beacon")

**Status:** stage A landed 2026-07-19 (Opus); stages B–D pending; phase gate
pending (Fable).
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

## Stage B — BroadcastChannel transport + late-join (Opus, work order)

`BroadcastChannelTransport` implementing the `Transport` interface (encode/decode
via the protocol codec — BroadcastChannel is cross-context, so this exercises the
real wire path, unlike loopback's by-reference pass); a dev-flag "Play Together
(local test)" title entry (host election: room creator owns the authoritative
world + tick); the client-mirror reconstruction fed by snapshot/delta + presence
(the `ClientSession.view` seam MP2·A marked); snapshot late-join through the
save-payload path; presence toasts. Free-roam player movement per **D-0**.

## Stage C — Emotes + preset-phrase say (Opus, work order)

Emote bubbles + preset-phrase say (the D4 baseline layer): `emote`/`chat`
client→server → `presence` emote/say broadcast → the `drawRemotePresence` pass
gains transient bubbles keyed on `PlayerEntity.emote`/`say` (the fields stage A
reserved). The DB authoring UI for custom presets is MP7.

## Stage D — Two-context e2e (Opus, work order)

Playwright two-context e2e under `?rngseed`: join, walk, emote, trigger a
directive event, late-join snapshot — deterministic, additive, existing goldens
untouched. Must pass **3× consecutively** (flake bar).

## Phase gate (Fable, after D)

Template gates; new two-context e2e green 3× consecutively; goldens untouched;
audit presence messages carry no data beyond name + entity state (D6). Verdict
here + roadmap status table; tag `beacon-4`.
