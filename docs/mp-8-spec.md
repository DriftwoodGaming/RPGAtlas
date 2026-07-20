# Phase MP8 Spec — Scale: Zones, Interest Management, Persistence, Load Harness ("Project Beacon")

**Status:** Stage A ✅ landed 2026-07-20 (Fable). Stage B pending (Opus).
Commits: A1 `2a87897` (passport + protocol) · A2 `0f315e7` (zones/AOI/world/
workers) · A3 `c40ff82`+`314afc0` (tick-strategy measurement + decision).
**Authored:** 2026-07-20 by Claude Fable 5, from the MP8 section of
`docs/MULTIPLAYER_ROADMAP.md` + `docs/mp-7-spec.md`.
**Workflow:** commit + push each stage to `main`; frozen pixel goldens stay
byte-identical (every MP8 addition is server-side or solo-inert); log
deviations here. **ALL measured numbers live in this file** (§A4).

## Objective

Friend rooms become worlds. Stage A (Fable) cuts the architecture: zone-per-map
sharding behind a location-agnostic seam, chunked area-of-interest filtering,
the cross-zone transfer handoff, passport identity, the tick-strategy
measurement + decision, and the persistence *design*. Stage B (Opus) does the
breadth: the bot load harness + CI target, durable persistence per the
branch-point answer, the Cloudflare DO world target, and the per-zone event
runtime (the D-5-0/D-6-0/D-7-0 unfreeze — see §B).

The three-tier model after MP8:

| Tier | Server core | Identity | Broadcast | Sim |
|------|-------------|----------|-----------|-----|
| Friend room (2–16) | `BeaconServer`/`BeaconRoom` (MP5, **untouched**) | anonymous (name only, D3) | 60 Hz, full roster | player layer (world runtime → MP8·B) |
| Zone (~200/map) | `BeaconWorld` + `Zone` (NEW) | **passport** | 12 Hz + AOI (measured, §A4) | 60 Hz, player layer now; engine runtime = stage B |
| World (1000+) | `BeaconWorld`, zones sharded | passport | per zone | per zone |

---

## Stage A — architecture, passport, measurement (Fable, landed 2026-07-20)

### §A1 Passport identity + protocol arms (commit A1)

**`src/shared/net/passport.ts`** (NEW, pure, DOM-free — runs in browsers,
Node ≥ 20, workerd):

- ECDSA **P-256 + SHA-256 via WebCrypto** — deliberately boring: the one
  signature suite green across every runtime this project ships on. (Ed25519
  rejected: WebCrypto support still uneven.) Keys are extractable BY DESIGN —
  the passport must export to a file to move devices (D3); the file is the
  same trust tier as a save file and the docs will say so (MP9).
- A passport is exactly `{v, kind, name, created, publicKeyJwk,
  privateKeyJwk}` — **no PII by construction** (asserted by test).
- Auth flow: connect → server `challenge {nonce}` (24-byte CSPRNG) → client
  `hello {…, pub, sig}` where `sig` = ECDSA over the **domain-separated**
  nonce (`"rpgatlas-passport-v1:" + nonce`) → server `verifyChallenge` →
  `fingerprintOfPub` (SHA-256 of the raw key, base64url, 43 chars) is the
  player's identity key (records + bans). Per-connection nonce ⇒ a captured
  signature replays into nothing. Verify fails closed on ANY garbage.
- `encodePassportFile`/`decodePassportFile`: strict import validation — a
  hostile or corrupt file returns null, never crashes, never half-loads.

**`src/engine/net/passport-store.ts`** (NEW): device custody — localStorage
key `rpgatlas_passport`, auto-created on first use (a kid never sees a
signup), corrupt storage heals by re-creating, rename keeps keys,
export/import text helpers. Injectable KV store ⇒ headless-tested. UI wiring
(export/import buttons in the world-join flow) rides stage B with the i18n.

**Protocol (additive within v1, the MP0/D-6-3 precedent — no version bump):**
`hello` gains optional `pub`/`sig` (base64url, structurally validated);
new server frames `challenge {nonce}` and `handoff {mapId, token, url?}`
(the socket-per-zone transfer for the CF DO world, stage B — defined + wire-
tested now so the client can be built against it); error code `auth-failed`;
kick code `replaced`. Friend-room relays send no challenge and ignore
`pub`/`sig` — **friend rooms stay fully anonymous** (D3).

i18n: `kickReplaced` added to EN + all ten packs → the Beacon mp-i18n parity
set is now **34 keys/pack** (was 33).

### §A2 Zone architecture (commit A2)

**Zone = map.** `server/src/core/zone.ts`: one `Zone` wraps one headless sim
`World` pinned to one map — membership, buffered move intents, authoritative
grid movement (the same `motion.ts` + `collision.ts` the MP5 room uses),
anti-stack, emote/say/custom relay, directive routing (the MP5 seam kept
live), decimated broadcast (§A4), chunked AOI (§A3).

**The sharding seam.** Everything a zone consumes is fire-and-forget calls
(`ZoneApi`: admit/remove/frame/requestSnapshot/applyShared/tick/stop) and
everything it produces leaves through a fire-and-forget outbox (`ZoneOutbox`:
send/sendMany/transferOut/sharedSet/recordPatch). **No return values cross
the boundary** — snapshots are PUSHED by the zone (admit/requestSnapshot →
outbox), so the SAME class runs in-process, behind a worker_threads
MessagePort, or inside a Durable Object without changing a line. This is the
load-bearing design decision of the phase.

**`server/src/core/beacon-world.ts`** — the world directory:

- Connections + the MP5 hardening pipeline (byte cap → token bucket → strict
  decode → route; strikes close floods). **Deliberately duplicated** from
  `BeaconServer` rather than refactored, so the MP5-security-audited room path
  stays byte-identical; same constants, same semantics (§A6).
- Passport gate: challenge on connect; async verify with a small frame queue
  (a pipelined `join` right behind the `hello` parks, cap 8, overflow =
  strike); ban-by-fingerprint (live kick + refused at the door); **one live
  session per passport** — a new sign-in supersedes the old (kick
  `replaced`), so a crashed session never locks a player out.
- Player table: world-unique pids, world-scoped resume tokens (rotated on
  use, **fingerprint-bound** — a stolen token without the matching passport
  is refused, ambiguous error, no oracle), resume-grace reaping.
- Zone lifecycle: get-or-create per occupied map (`zoneFactory` injectable —
  the sharding adapters plug in here), occupancy tracked directory-side,
  empty-zone TTL expiry.
- **Cross-zone transfer handoff, gateway model** (Node): the socket never
  moves. `transferPlayer(pid, mapId, x?, y?, dir?)` = exit-position capture →
  old zone `remove` (presence leave to its interest set) → new zone
  `admit` → the new zone pushes a fresh `snapshot` (client re-renders exactly
  like a late join). Stage B's transfer events drive this same API through
  `ZoneOutbox.transferOut`. The CF DO world uses the `handoff` frame instead
  (client reconnects to the target zone DO with a transfer token — stage B).
- World-shared state (§A5 partition): directory-owned `shared` map fanned out
  to every zone replica and **replayed into fresh zones** on creation.
- Passport-keyed **player records** (in-memory in stage A): position + `data`
  bag; refreshed 1 Hz + on every leave/transfer path; a rejoin with the same
  passport lands where you left off. Stage B makes them durable (§A5).

**Per-zone runtime (the D-5-0/D-6-0/D-7-0 boundary).** The zone runs the
player layer today, exactly like the MP5 room. The stage-A survey confirmed
the unlock for stage B: `tests/mp-commands.test.js` already runs the REAL
interpreter registry headlessly in a bare vm with a tiny `window.RPGAtlasDeps`
stub + `initInterpServices`. Because the engine's module-level `G`/`ctx` bind
to ONE default world through the MP1 compat shim, **one zone per
process/worker is what makes the engine event runtime usable server-side
unchanged**: the zone worker binds the default world to its zone's world and
esbuild-bundles the engine slice (interpreter + map runtime driver), stubbing
the presentation port with the directive broker that is already wired. That
is why the seam ships now and why worker sharding exists even though the
player layer alone doesn't need it (§A4). Events/NPCs/encounters on the
server = **stage B** (deviation D-8-0).

### §A3 Sharding adapters

- **In-process (default):** the directory calls the `Zone` directly;
  `startNodeWorldServer` drives `tickZones()` at a drift-compensated 60 Hz.
- **worker_threads (`--world --zone-workers`):** `server/src/node/
  zone-worker.ts` (a second esbuild bundle, `dist/zone-worker.mjs`) runs one
  zone per thread, self-ticking; `worker-zone.ts` marshals the ZoneApi/outbox
  ops over the MessagePort. Position mirror at 1 Hz + exit patches (stamped
  with the zone's mapId; the directory drops patches from a zone the player
  already left) + 5 s drop-tombstones keep records fresh across the boundary.
  Proven end-to-end by `tests-unit/zone-worker.test.ts` (real threads, real
  timers → lives in the isolated `test:net` suite per the MP5 rule).
- **Cloudflare DO (stage B):** one DO per zone + a world-directory DO; the
  socket terminates ON the zone DO (that's what DO WebSockets are), so
  cross-zone transfer uses the `handoff` frame (reconnect with a transfer
  token). The directory DO owns records/shared/bans in DO storage; a zone DO
  snapshots its own state (§A5) — that closes MP5·B's documented
  "hibernation eviction resets the room" boundary for worlds.

**Windows timer discovery (real defect fixed in stage A):** a
`setInterval(16.7 ms)` quantizes to ~31 ms on Windows in worker threads AND
in the world gateway process — the sim ran at ~32 Hz (half speed: slow
motion, doubled echo latency; measured p50 126 ms before, 64 ms after).
Both world drivers (zone-worker + startNodeWorldServer) now use a
drift-compensated loop: an 8 ms interval that advances however many whole
60 Hz ticks of wall time elapsed (capped at 30 so a stall can't spiral).
The MP5 room driver is untouched (audited; its measured numbers were and
remain within budget). The stage-B DO zone driver must use the same pattern.

### §A4 Tick strategy — MEASUREMENT + DECISION

**Question (roadmap):** 60 Hz broadcast vs decimation + interpolation. The
sim rate itself is not a knob — motion constants are per-tick — so this is
about the *state broadcast* cadence.

**Headless matrix** (`server/bench/tick-strategy.mjs`: one 128×128 zone,
10 sim-seconds per config, hold-to-walk bots, dev box, 2026-07-20):

| players | bcast | AOI | CPU ms/sim-s | KB/s/client | zone MB/s |
|--------:|------:|:---:|-------------:|------------:|----------:|
| 50 | 60 Hz | off | 5.1 | 371.5 | 18.14 |
| 50 | 60 Hz | on | 19.0 | 50.9 | 2.48 |
| 50 | 20 Hz | off | 1.6 | 122.8 | 6.00 |
| 50 | 20 Hz | on | 6.2 | 16.8 | 0.82 |
| 50 | 12 Hz | off | 0.9 | 74.3 | 3.63 |
| 50 | 12 Hz | on | 3.8 | 10.2 | 0.50 |
| 50 | 6 Hz | off | 0.6 | 37.0 | 1.81 |
| 50 | 6 Hz | on | 2.0 | 5.1 | 0.25 |
| 100 | 60 Hz | off | 6.9 | 738.8 | 72.15 |
| 100 | 60 Hz | on | 47.1 | 94.3 | 9.21 |
| 100 | 20 Hz | off | 2.6 | 244.5 | 23.87 |
| 100 | 20 Hz | on | 15.5 | 31.2 | 3.05 |
| 100 | 12 Hz | off | 1.8 | 147.8 | 14.43 |
| 100 | 12 Hz | on | 10.0 | 18.9 | 1.84 |
| 100 | 6 Hz | off | 1.2 | 73.6 | 7.18 |
| 100 | 6 Hz | on | 5.4 | 9.4 | 0.92 |
| 200 | 60 Hz | off | 14.4 | 1484.2 | 289.88 |
| 200 | 60 Hz | on | 106.3 | 185.0 | 36.13 |
| 200 | 20 Hz | off | 5.6 | 491.7 | 96.03 |
| 200 | 20 Hz | on | 35.5 | 61.3 | 11.97 |
| **200** | **12 Hz** | **on** | **22.4** | **37.0** | **7.23** |
| 200 | 12 Hz | off | 4.2 | 296.9 | 57.99 |
| 200 | 6 Hz | off | 2.9 | 147.9 | 28.88 |
| 200 | 6 Hz | on | 12.4 | 18.4 | 3.60 |
| 400 | 60 Hz | off | 29.9 | 2968.1 | 1159.43 |
| 400 | 60 Hz | on | 205.1 | 352.0 | 137.50 |
| 400 | 20 Hz | off | 12.9 | 984.9 | 384.74 |
| 400 | 20 Hz | on | 69.9 | 116.8 | 45.63 |
| 400 | 12 Hz | off | 10.0 | 593.8 | 231.96 |
| 400 | 12 Hz | on | 45.6 | 70.4 | 27.51 |
| 400 | 6 Hz | off | 7.5 | 296.0 | 115.64 |
| 400 | 6 Hz | on | 25.7 | 35.1 | 13.71 |

**Reading it:** CPU is never the binding constraint — the target config
(200 players, 12 Hz, AOI) costs 22.4 ms per sim-second ≈ **2.2 % of one
core per zone**. The WIRE is the constraint: 60 Hz full-roster at 200
players is **1.48 MB/s per client** (unshippable); decimation (5×) × AOI
(~8× at 200) together cut it **40×** to 37 KB/s/client, 7.2 MB/s/zone.
6 Hz would halve that again but spends up to 167 ms — two-thirds of the
250 ms p95 budget — on cadence alone and makes remote motion visibly steppy.

**Socketed smoke** (`server/bench/world-smoke.mjs`: real WebSockets, real
P-256 challenge sign-ins, bots scattered via `transferPlayer`, hold-to-walk +
emotes every ~3 s; intent→echo INCLUDES the 0–83 ms cadence wait — that is
what a player experiences; dev box, loopback, bots + server share the box so
numbers are conservative):

| config | samples | p50 | p95 | p99 | moved |
|--------|--------:|----:|----:|----:|------:|
| 50 bots / 1 zone (in-proc, pre-timer-fix) | 1,943 | 125.8 | 141.7 | — | 50/50 |
| 50 bots / 1 zone (in-proc) | 3,166 | 64.1 | 79.8 | 80.5 | 50/50 |
| **200 bots / 1 zone (in-proc)** | 17,844 | **58.2** | **83.1** | 84.2 | 200/200 |
| 200 bots / 1 zone (worker) | 17,879 | 66.9 | 82.4 | 83.8 | 200/200 |
| **1000 bots / 8 zones (workers)** | 82,577 | **69.4** | **100.1** | 112.8 | 1000/1000 |
| 1000 bots / 8 zones (in-proc) | 81,337 | 69.7 | 83.6 | 90.7 | 1000/1000 |

Resources at 1000/8 (ONE process = gateway + all bots + zones): in-proc
121 MB rss, ~14.4 s user CPU over ~25 s wall; workers 260 MB rss, ~17.2 s.
Zone-tier budget (roadmap: p95 ≤ 250 ms at 200/zone) holds with **3×
headroom**; the 1000/8 world holds with 2.5×.

**DECISION (measured, not assumed):**

1. **Sim stays 60 Hz** everywhere (motion fidelity; intents apply on the
   next sim tick regardless of broadcast cadence).
2. **World zones broadcast at 12 Hz** (`broadcastEveryTicks: 5` in
   `DEFAULT_WORLD_LIMITS`) **with chunked AOI** (§A3). 12 Hz over 20 Hz:
   ~40 % less egress for ≤ 40 ms extra mean echo against a 250 ms budget;
   over 6 Hz: cadence must not dominate the budget.
3. **Friend rooms keep MP5's every-tick full-roster broadcast** — ≤ 16
   players is trivial wire, and the audited room path stays byte-identical.
4. **In-process zones are the Node default.** At player-layer load the
   thread hop costs more than parallelism buys (see 1000/8 table).
   `--zone-workers` is the prepared scale-out for stage B's per-zone event
   runtime, when zones become CPU-heavy (the engine interpreter + NPC motion
   change the arithmetic — re-measure then).
5. **Binary/delta encoding: NOT demanded by measurement** at these rates
   (37 KB/s/client peak-config). Stage B skips it unless the event-runtime
   deltas change the numbers; the roadmap's "only if measurement demands"
   clause resolves to *no* for now.
6. Client-side remote-player smoothing (dead reckoning between 12 Hz
   deltas) ships with the browser world-join flow in stage B — bots don't
   render; nothing in stage A needs it.

### §A5 Persistence DESIGN (stage B implements)

**What state lives where** (extends the D-6-1 partition):

| State | Owner | Persistence unit |
|-------|-------|------------------|
| Player position (mapId/x/y/dir) + name | directory record | **PlayerRecord** (passport fingerprint → record) |
| Per-player durable data: `pSwitches[pid]`, and party/inv/gold/wallet slices once zone events run | directory record `data` bag (zones push via `recordPatch`) | PlayerRecord |
| World-shared: `switches`, `vars`, `timeOfDay` | directory `shared` map (zones hold replicas; writes fan out via `sharedSet`) | **WorldSnapshot** (+ bans) |
| Zone-local: `selfSw` (keys are map-scoped), event runtime positions/pages, respawn timers (stage B) | the zone's world | **ZoneSnapshot** per mapId |
| Runtime-only (never persisted): rosters, directives in flight, parties, co-op battles, resume tokens, connections | — | — (the MP4/MP5 precedent) |

**Write cadence:** PlayerRecord — refreshed in memory at 1 Hz + every
leave/transfer (already true in stage A); flushed durably on leave/reap +
in the periodic batch. WorldSnapshot + ZoneSnapshots — every ~30 s
(staggered per zone) + on empty-zone expiry + graceful shutdown. **Crash
loss budget: ≤ 30 s of world state, ≤ 30 s of player state** — documented
honestly in the Hosting-a-World docs (MP9).

**Storage adapter (narrow, async, both targets):**

```ts
interface WorldStore {
  loadWorld(): Promise<{ shared: Record<string, JsonValue>; bans: string[] } | null>;
  saveWorld(w: { shared: ...; bans: ... }): Promise<void>;
  loadRecord(fingerprint: string): Promise<PlayerRecord | null>;
  saveRecords(batch: Array<[string, PlayerRecord]>): Promise<void>;
  loadZone(mapId: number): Promise<ZoneSnapshot | null>;
  saveZone(mapId: number, snap: ZoneSnapshot): Promise<void>;
}
```

- **Cloudflare:** directory DO storage holds world + records (records are
  small; DO storage is SQLite-backed and transactional); each zone DO stores
  its own ZoneSnapshot → hibernation/eviction restores instead of resetting.
- **Node:** ❓ **THE MP8 BRANCH POINT** (asked before stage B): the zero-dep
  default. (a) JSON snapshot files with atomic rename (works on any Node
  ≥ 18, human-readable, plenty at this scale — a 1000-player world's records
  are ~1 MB); (b) `node:sqlite` (single crash-safe file, but requires
  Node ≥ 22.5 — the dev box runs 20.17); (c) native better-sqlite3 (rejected:
  breaks the zero-dep one-command deploy). Either way the adapter interface
  above ships, so the answer only picks the default implementation.
- Load-gate criterion ("kill a zone, restore, state intact") = a stage-B e2e
  against the adapter.

### §A6 Security posture (MP5 gate carried forward)

- The world pipeline duplicates the MP5 constants/semantics verbatim (byte
  cap → token bucket → strict decode → route; 20 strikes; join limiter per
  source; ambiguous resume errors). Divergence risk is accepted and
  documented in both file headers; the MP9 audit reads both.
- New inbound surface = `hello.pub/sig` (structurally validated, then
  WebCrypto-verified, fails closed) and the challenge nonce (server-generated
  only). No new client-controlled bytes reach any store un-validated; the
  fingerprint is derived server-side.
- Records are keyed by fingerprint and hold position + game data only —
  **no IP, no PII** (D6 unchanged; `source` still never leaves rate-limit
  buckets). The passport name is the same display name that already crosses
  the wire.
- Anonymous mode (`requirePassport: false`) is TEST/TOOL-ONLY (connection-
  scoped identities; records don't persist across connections) — production
  worlds require passports; the CLI has no flag to disable them.
- 1000 sockets/one source worked only because the bench lifts
  `joinsPerSource` — the limiter itself is unchanged.

### Stage-A deviations ledger

- **D-8-0 (scope):** the per-zone ENGINE runtime (events/NPCs/encounters on
  the server — the D-5-0/D-6-0/D-7-0 promise "MP8·A per-zone runtime") ships
  its SEAM in stage A (zone worlds + directive routing + transferOut/
  sharedSet/recordPatch outbox + the one-zone-per-process insight §A2) but
  the engine-slice driver itself is **stage B work**, alongside the harness.
  Rationale: the roadmap's own MP8·A bullet list scopes stage A to
  architecture/passport/measurement; the stage-B kickoff below carries the
  runtime explicitly so the promise lands inside MP8.
- **D-8-1:** CF DO world target (zone DO + directory DO + `handoff` client
  flow) = stage B; the protocol arm + design land in stage A.
- **D-8-2:** worker-mode position freshness is ≤ 1 s (the 1 Hz mirror) +
  exit patches on every leave/transfer; in-process zones are exact. A
  crash-window of ≤ 1 s of movement is accepted (persistence cadence
  dominates it anyway, §A5).
- **D-8-3:** AOI does not wrap across looping-map seams (loop-edge handling
  is deferred wholesale per D-5-0; the wrap-aware interest neighborhood rides
  with it in stage B's runtime work if a looping map hosts a zone).
- **D-8-4:** client world-join UI (relay-client challenge handling, passport
  hello, world address entry, dead-reckoning smoothing, i18n for the new
  strings) = stage B; the engine ships passport custody + `kickReplaced`
  copy ×11 locales now, and the friend-room flow is untouched.
- **Windows half-rate timer defect** (§A3) found + fixed in both NEW world
  drivers; MP5 room driver deliberately untouched.

### Stage-A gate snapshot (all green, 2026-07-20)

| Gate | Result |
|---|---|
| vitest `test:unit` | **1227** (83 files; +33 over beacon-7: passport 10 · passport-store 5 · interest 4 · beacon-world 13 · protocol +4 · i18n parity 34 incl. `kickReplaced`) |
| vitest `test:net` | **8** (7 + zone-worker sharding proof, isolated serial) |
| node --test | **48** (determinism hash 46633057 untouched) |
| tsc | root **0** · server Node **0** · server CF **0** |
| eslint | **0** |
| Playwright (spot) | `mp-relay` (real server) + `mp-coop` green post-protocol-change; no golden touched (full suite = the phase LOAD GATE) |
| server build | `dist/beacon.mjs` + `dist/zone-worker.mjs` |
| versions | 1.2.0 · FORMAT_VERSION 2 · **no `js/` `?v=` file touched** |

---

## Stage B — work order (Opus)

Per the roadmap MP8·B + the stage-A deviations, in rough order:

1. **Per-zone event runtime (D-8-0).** esbuild-bundle the engine slice
   (interpreter registry + a headless map-runtime driver: NPC/event motion,
   page refresh, triggers, parallels, encounters) into the zone; bind the
   MP1 default-world shim to the zone's world (one zone per process/worker —
   §A2); presentation port = the already-wired directive broker; transfer
   events → `ZoneOutbox.transferOut`; world-switch writes →
   `sharedSet`; per-player switch writes → `recordPatch`. Solo/friend-room
   behavior byte-identical (this runs only in world zones). Carry the MP6
   notes: `world.blocking` refcount vs battle/event overlap; ally-idx
   cross-target tightening with passport loadouts; loadout-order writeback.
2. **Persistence** per Driftwood's branch-point answer (§A5): the
   `WorldStore` adapter + Node default + CF DO storage; flush cadences;
   kill-a-zone/restore e2e (the load-gate criterion).
3. **CF DO world target (D-8-1):** zone DO + directory DO, `handoff`
   reconnect flow, drift-compensated DO tick driver, hibernation restore
   from ZoneSnapshots.
4. **Client world-join (D-8-4):** relay-client handles `challenge` (sign
   with the stored passport), `handoff`, `replaced`; world address entry in
   the Play Together flow; passport export/import UI; dead-reckoning
   smoothing for 12 Hz remote motion; i18n ×10 for every new string.
5. **Load harness + CI target:** grow `bench/world-smoke.mjs` into the
   MP8·B harness (bots that also trigger events + transfer through doors
   once the runtime lands); a small-N smoke in `test:net`; big-N manual.
   Re-measure §A4 WITH the event runtime; revisit decision #4/#5 (workers
   default, encoding) if the numbers move.
6. **Delta/binary encoding:** measurement says NO for the player layer
   (§A4 decision 5) — only revisit if the runtime deltas demand it.

**Stage B gates:** template gates + the two flake-barred net suites 3× +
goldens untouched + the §A4 tables re-run with the runtime + persistence
round-trip e2e. Then the separate **MP8 LOAD GATE** (Fable) re-runs
everything per the roadmap block and tags `beacon-8`.
