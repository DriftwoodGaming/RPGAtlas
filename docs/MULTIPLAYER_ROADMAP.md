# Project Beacon — Online Multiplayer for RPGAtlas

**Mission.** Deployed RPGAtlas games gain real online multiplayer: friends join each
other's games with a room code in under a minute, and ambitious creators run
persistent worlds of 100–1000+ players on their own open-source server. This is
the most-requested feature RPG Maker never had, and we can deliver it because we
own the engine: the required fundamentals get designed **into** the core, not
bolted on. Target release: **RPGAtlas 2.0.0**.

**Status:** ROADMAP APPROVED 2026-07-19 · MP0–MP8 ✅ (tags `beacon-0` … `beacon-8`) ·
**MP9 BUILD complete · RELEASE GATE RUN 2026-07-20 (Fable): ❌ NO-GO — `beacon-9` + `v2.0.0` NOT tagged.**
Every numeric/safety gate re-verified PASS, but the fresh-eyes playthrough fails its co-op-battle leg:
**D5 (co-op battles, "the heart of the promise") is unreachable by any player-facing flow** — parties/shared
battles run only on the local BroadcastChannel transport whose sole entries are dev-console hooks, while the
shipped relay/world servers contain zero party/battle code (party intents silently dropped, `Battle.run`
stubbed to auto-"win" per D-8-6) — and the default relay `beacon.rpgatlas.app` does not resolve in DNS.
Full findings F-1…F-5 + the fix fork for Driftwood: MP9 row below + `docs/mp-9-spec.md` §RELEASE GATE.
Next: MP9·E fix phase (Driftwood picks the fork), then re-run this gate.

---

## Decision ledger (locked with Driftwood 2026-07-19)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Netcode model | **Server-authoritative from day one.** One simulation of the world runs on the server; clients send input intents and receive state deltas + presentation directives. Deterministic lockstep REJECTED (async/modal interpreter makes cross-client determinism a rewrite; one missed await = silent desync). Player-as-host REJECTED (dies at scale, exposes the host's IP, host can cheat). |
| D2 | Hosting | **Hybrid.** Driftwood hosts a free shared relay for friend rooms (2–16 players, room codes, zero setup). Persistent worlds (100–1000+) are self-hosted: the Beacon server is open source with a one-command deploy (Cloudflare free tier or plain Node). Caps Driftwood's costs; the common case stays zero-friction. |
| D3 | Identity | **Passport.** Device-local keypair + display name. No email, no PII — a server knows a player only as a public key. Exportable file to move devices. COPPA-friendly by construction. Friend rooms stay fully anonymous (name only). |
| D4 | Communication | Emotes + dev-authored preset phrases always available. **Opt-in filtered free-text chat**: OFF by default, a game dev must enable it per game in the Database (with plain-language safety guidance shown at the toggle); ships with profanity filter + mute + report + room-owner kick, rate-limited. |
| D5 | Co-op battles | **In 2.0.** Friends fight side-by-side in one shared battle (phase MP6). It is the heart of the promise. |
| D6 | Privacy | **No player ever learns another player's IP.** No P2P, no WebRTC, no STUN — all traffic is TLS WebSocket client↔server only. Presence messages carry display name + entity state, nothing else. See "Kid safety & privacy" below. |
| D7 | Compatibility | Single-player stays **byte-identical** until a game opts in. Every phase lands on main behind the project flag / dev flags; the frozen pixel goldens are the regression gate at every phase. FORMAT_VERSION stays 2 (all project additions are additive with `migrateProject` backfill). Plugin API gains additive net surface — that is the 1.x→2.0 unfreeze. |

---

## Architecture

```
single-player            friend room                 persistent world
┌───────────┐        ┌──────────────────┐        ┌──────────────────────────┐
│  browser   │        │ Beacon relay      │        │ self-hosted Beacon        │
│ ┌────────┐ │        │ (Driftwood-hosted)│        │ (Node or Cloudflare DO)   │
│ │ client  │ │  wss   │ ┌──────────────┐ │  wss   │ ┌─────┐ ┌─────┐ ┌─────┐  │
│ │ (render,│◄├──────► │ │ World instance│ │◄─────► │ │zone │ │zone │ │zone │  │
│ │  UI,    │ │        │ │ (headless sim)│ │        │ │(map)│ │(map)│ │(map)│  │
│ │  input) │ │        │ └──────────────┘ │        │ └─────┘ └─────┘ └─────┘  │
│ └───┬────┘ │        └──────────────────┘        │   + world directory       │
│     │ loopback              ▲                    │   + persistence           │
│ ┌───▼────┐ │                │                    └──────────────────────────┘
│ │ World   │ │         same World code                   same World code
│ │ instance│ │
│ └────────┘ │
└───────────┘
```

- **One sim, three homes.** The world simulation (movement, collision, tile
  behavior, events/interpreter world effects, switches/vars/self-switches,
  encounters, battles, quests, inventory/wallet, RNG) is extracted into an
  **instanced, headless, DOM-free core** (`src/shared/sim/`). Single-player runs
  it in-process over a loopback transport; friend rooms run it in the relay;
  worlds run one instance per map-zone. Same code, same tests, everywhere.
  This is the fundamental engine change and it is *why* the feature works.
- **Client = presentation.** Rendering (HD-2D), audio, HUD, menus, message
  boxes, input capture. Modal event UI (Show Message/Choices/Shop/…) becomes
  **presentation directives**: the server-side interpreter emits `directive`
  messages and awaits the player's `reply` (MP3).
- **Protocol.** Versioned typed messages (`src/shared/net/protocol.ts`),
  JSON on the wire v1 (binary/delta encoding is an MP8 optimization measured,
  not assumed). Input sequence numbers; server tick number is the clock; TCP
  ordering via WebSocket is sufficient. `PROTOCOL_VERSION` handshake —
  mismatch produces a friendly "This game needs a newer version" message.
- **Feel.** Local player uses tile-grid client prediction (predict the walk,
  server confirms, snap-correct on rare divergence). Remote players reuse the
  existing `prx→rx` interpolation seam from render-glue. Interpolation buffer
  ~100 ms.
- **Late join / reconnect.** The existing save-payload machinery
  (`buildSavePayload`-style world snapshot) doubles as join-sync and
  reconnect-resync. Reconnect uses a random per-session resume token.
- **Scale model.** Zone = map. A friend room is one world instance ticking any
  occupied maps. A persistent world shards zones across workers/DOs with a
  world directory for cross-zone transfer handoff, area-of-interest filtering,
  and passport-keyed player persistence (MP8).

### Scale targets (honest numbers, gated by measurement in MP8)

| Tier | Target | Gate | **MEASURED (MP8 LOAD GATE, Fable, 2026-07-20 — dev box, loopback, bots + server share the box)** |
|------|--------|------|------|
| Friend room | 2–16 players, one instance | MP5: 16 bots + 2 real clients, p95 intent→echo ≤ 150 ms local | ✅ MP5: 144 samples, p50 16.4 ms, p95 31.9 ms (budget 150) |
| Zone | ~200 concurrent players per map-zone | MP8: 200 bots/zone, p95 intent→echo ≤ 250 ms, tick budget held | ✅ 200 bots/1 zone in-proc: 15,498 samples, **p50 58.0 / p95 82.6 / p99 83.8 ms** (3× headroom; echo includes the 0–83 ms 12 Hz cadence wait), 200/200 moved, 88 MB rss + ~4.1 s user CPU over ~22 s for the WHOLE process (server + all 200 bots); zone sim CPU ≈ 2.2 % of one core (§A4). With `--data` persistence: p95 82.3 ms (flat), ~129 B/player on disk, graceful flush 6 ms |
| World | 1000+ across zones on one modest box / free-tier DO plan | MP8: 1000 bots across ≥ 8 zones | ✅ 1000 bots/8 zones (worker threads): 69,799 samples, **p50 70.7 / p95 101.8 / p99 117.3 ms** (2.5× headroom), 1000/1000 moved, 259 MB rss + ~17.2 s user CPU over ~22 s (one process = gateway + 8 zone workers + all 1000 bots); in-proc zones remain the Node default (§A4 decision 4) |
| Stretch | multi-thousands | horizontal (more zones/processes); the architecture has no hard ceiling — per-zone density is the practical limit | — (post-2.0; CF multi-DO zone sharding prepared as D-8-7) |

Server tick strategy: **decided by MP8 measurement (§A4): sim 60 Hz everywhere;
world zones broadcast 12 Hz + chunked AOI; friend rooms keep MP5's every-tick
full-roster broadcast; binary/delta encoding NOT demanded (37 KB/s/client peak).**

### Kid safety & privacy (non-negotiable, audited at MP5 and MP9 gates)

1. No P2P of any kind; clients connect only to the server over `wss://`. No
   player-visible IPs, ever. The hosted relay retains IPs only transiently for
   rate limiting/abuse and this is documented publicly.
2. Room codes are unguessable capability tokens (≥ 40 bits entropy, typable),
   join attempts rate-limited, empty rooms expire. **No public lobby/browser**
   on the shared relay — you play with people who have your code.
3. Free-text chat exists only when a game's developer opts in (D4); emotes +
   presets are the always-on default. Mute is client-local and instant; room
   owners can kick/ban; world operators can ban by passport pubkey.
4. No accounts, no email, no PII anywhere in the stack (D3).
5. A parent/teacher-facing plain-language safety page ships in the wiki +
   docs-site (MP9) explaining exactly what connects where.
6. Plain-language errors everywhere, per the audience-beginners rule: a
   7-year-old reads "Couldn't find that room — check the code and try again",
   never a stack trace.

---

## Choreography & workflow

- **Models.** Opus lifts the weights (breadth stages, mechanical migrations,
  server build-out, harnesses, editor UX). **Fable** writes the specs, cuts the
  tricky cores (MP0, MP1·A, MP3·A, MP6·A, MP8·A), and **signs every phase
  gate**. Sonnet is banned from RPGAtlas.
- **One phase per conversation, fresh conversation per phase** (context stays
  lean). Each phase section below ends with copy-paste kickoff block(s): a
  BUILD block (paste into a new conversation running the build model) and,
  where the build model isn't Fable, a separate GATE block (paste into a new
  Fable conversation). The phase tag is created only after the Fable gate
  verdict is recorded.
- **Per stage:** commit + push to main as it lands (house rule). Log deviations
  and discoveries in the phase's stage log `docs/mp-N-spec.md`. Update the
  status table below when a phase completes.
- **Every conversation's last message** ends with the next hand-off block,
  copied from this file (updated if the phase changed anything).
- **Branch-point questions:** when a phase hits a genuine fork (marked ❓ in the
  phase sections), ask Driftwood via the question tool before building.

### Gate template (every phase, plus phase-specific gates)

`vitest N · node N · cargo N · Playwright N/N (single-player goldens UNTOUCHED) ·
eslint 0 · i18n parity (10 locales; DB field labels exempt) · FORMAT_VERSION 2 ·
versions consistent (7 sites) · cache-busts bumped where files changed
(editor.css / patch-notes.js / data.js ?v=)`

**Baseline (LIVE, recorded by MP0·A 2026-07-19):** vitest 983 (62 files) ·
node 44 · cargo 26 · Playwright 123/123 · eslint 0 · version 1.2.0.
(The roadmap's planning-time "last known" numbers — vitest 977+/node 19/cargo
23/Playwright 111 — were already stale at MP0 kickoff, as predicted.)
Re-verify at every gate; never trust written numbers.

### Status table

| Phase | Name | Build | Gate | Tag | Status |
|-------|------|-------|------|-----|--------|
| MP0 | Protocol, singleton audit & sim-boundary spec | Fable | Fable (self) | beacon-0 | ✅ PASS 2026-07-19 — vitest 1013 · node 44 · cargo 26 · Playwright 123/123 (goldens untouched) · eslint 0 · tsc 0 · FV 2 · v1.2.0 consistent · no cache-busts needed (no ?v= files touched) |
| MP1 | Instanced headless world core | Fable A · Opus B/C | Fable | beacon-1 | ✅ PASS 2026-07-19 — vitest 1028 · node 46 · cargo 26 · Playwright 123/123 (goldens byte-identical, perf 250.92/300 ms) · eslint 0 + sim lint wall proven to FIRE on a probe · tsc 0 · determinism golden 46633057 independently re-computed (same-seed identical across two realms, different-seed divergent) · headless boot green · compat-shim drift audit clean (6 engine modules diffed vs 0f9ae0a) · sim purity verified (world.ts imports only shared/rng) · FV 2 · v1.2.0 · no cache-busts needed |
| MP2 | Loopback client/server | Opus | Fable | beacon-2 | ✅ PASS 2026-07-19 — vitest 1037 · node 46 · cargo 26 · Playwright 123/123 (goldens byte-identical vs beacon-1; perf 175.18 standalone / 246.10 full-suite vs budget 300, beacon-1 250.92 → within ±10%) · eslint 0 + sim wall fires on probe · tsc 0 · FV 2 · v1.2.0 ×7 · no cache-busts · loopback audit CLEAN (sim imported only by net seam + shim binding; soloHost/soloClient only in boot/loop/map; renderer/UI/editor read solely via ctx/G shim → defaultWorld === soloClient.view, asserted by reference) |
| MP3 | Interpreter presentation directives | Fable A · Opus B | Fable | beacon-3 | ✅ PASS 2026-07-19 — vitest 1058 · node 46 · cargo 26 · Playwright 123/123 (goldens byte-identical vs beacon-2; perf 252.03/300 vs beacon-2 246.10 → within ±10%) · eslint 0 + sim wall fires on probe · tsc 0 · FV 2 · v1.2.0 ×7 · no cache-busts · 10-handler drift sample CLEAN (renderer reconstructs the exact old UI calls; shop goods {kind,id}-complete; selectItemScene was already zero-arg) · no audio-deck/DOM in handlers (weather = documented D-B3 exception) · world-side wall-clock waits gone (2× sleep(50) → waitFrames(3); 3 survivors all client pacing) · D-B1/D-B2 no-bump ruling ACCEPTED |
| MP4 | Local multi-client co-op | Opus | Fable | beacon-4 | ✅ PASS 2026-07-19 — Fable gate re-ran everything independently: vitest 1075 · node 46 · cargo 26 · Playwright 125/125 (123 goldens green AND zero baseline PNGs changed beacon-3..HEAD = untouched at the byte level; perf 234.62/300 vs beacon-3 252.03) · mp-coop 3× consecutive with --workers=1 (strictly serial; 6/6 green total) · eslint 0 + sim wall fires on probe · tsc 0 · v1.2.0 ×7 · FV 2 · no cache-busts · **D6 audit CLEAN** (wire carries only id/name≤24/charset-key/mapId/motion + emote-id/say + directives; no IP/history/PII, both directions read from source) · **solo-inert audit CLEAN** (session.mode defaults solo; loop/map/render-glue/co-op all gate on mode/roster-size/active refs — solo path is the exact pre-MP4 code) · deferrals CONFIRMED as phase boundaries (D-0+D-B4→MP8·A per-zone runtime; D-B2 leave→MP5·A heartbeats/expiry; D-B3 remote attack/act→MP6; D-B5 spawns→MP7·A) · ruling: roadmap MP4·D "trigger a directive event" satisfied headlessly (room-session.test.ts directive-routing over the real bus) as a D-B3 consequence — live-browser proof rides MP6. Branch point: **FREE ROAM** (roadmap default b). |
| MP5 | Beacon server, rooms & transport | Opus | **Fable security gate** | beacon-5 | ✅ **PASS 2026-07-19 (Fable SECURITY gate)** — every gate independently re-run: vitest **1109** (74 files, test:unit) **+ 7** (test:net, isolated serial) = 1116 · node 46 · cargo 26 · Playwright **126/126** (123 goldens byte-identical — zero baseline PNGs changed beacon-4..HEAD; perf 242.58/300 vs beacon-4 234.62 → within ±10%) · root tsc 0 · server tsc **Node + CF both 0** · eslint 0 + sim wall fires on probe · i18n parity 31 green (MP5 player strings English by D-C5-2 → MP7) · FV 2 · v1.2.0 ×7 · no cache-busts · **16-bot+2-client latency: 144 samples, p50 16.4 ms, p95 31.9 ms (budget 150)** · fuzz 4/4 (5000 garbage frames, adversarial well-shaped, token replay rejected, brute-force capped). **Security audit CLEAN (D6/safety checklist):** wire = typed unions only, both directions enumerated (client hello/join/resume/input/reply/emote/chat ↔ server welcome/snapshot/delta/directive/presence/kick/error); PlayerState = id/name≤24/charset-key/mapId/motion — **no IP anywhere on the wire** (`source` lives only in rate-limit buckets + dev logs; retention documented in server/README "What ships on the wire"); room codes 9×30-alphabet = **44.16 bits ≥ 40**, CSPRNG rejection-sampled, collision-checked; join limiter 30/source/min + ambiguous errors (no room/token oracle) → online brute force hopeless; resume tokens **192-bit CSPRNG, rotated on every use**, replay proven dead; flood = token bucket 40/s burst 80 + 20-strike close + buffer-then-tick (delivery never re-enters the sim); oversized capped at 3 layers (ws maxPayload · core byteLen · protocol cap), binary → malformed; cross-room leakage none (broadcasts scoped to the room's member map; directives routed per-pid; deliverReply validates playerId + re-validates the value); empty-room TTL 60 s + resume grace 30 s + idle 45 s verified; free-text chat **rejected server-side** (default-off D4; presets pass); **wss-only** enforced (ws:// only to loopback, connectSocket throws otherwise); Play Together copy all plain-language (no codes/stack traces; `detail` never rendered); title entry gated on `multiplayerEnabled()` → goldens untouched. Deferrals **D-5-0/D-5-1/D-B5-1/D-B5-2 CONFIRMED** as intended boundaries (player-layer + static walls now; NPC/events/dynamic collision/persistence → MP8·A; one configured game → MP7/MP9; live DO deploy = operator step). Non-blocking notes for MP9 hardening: resume-token compare not constant-time (impractical: 192-bit + network jitter + join limiter); CF `/new` mints codes unthrottled at the HTTP layer (abandoned codes cost nothing; CF fronting absorbs). Details: docs/mp-5-spec.md. |
| MP6 | Co-op battles | Fable A · Opus B | Fable | beacon-6 | ✅ **PASS 2026-07-19 (Fable gate)** — every gate independently re-run: vitest **1145** (77 files, test:unit) **+ 7** (test:net) = 1152 · node 46 (determinism hash **46633057** re-computed live) · cargo 26 · Playwright **127/127** (perf 242.77/300 vs stage B 245.36 → −1.1%; `git diff beacon-5..HEAD -- "*.png"` **EMPTY** = solo battles byte-identical) · `mp-battle` 3× consecutive --workers=1 · root tsc 0 · server tsc Node + CF both 0 · eslint 0 + sim wall fires on probe · v1.2.0 · FV 2 · no cache-busts. **Draw-conservation audit CLEAN**: full added draw surface = TP-init pool `G.party`→`party` (solo `party === G.party` BY REFERENCE), `coopVictoryRewards` per-participant `rollDrops` behind `if (coop)` AFTER the classic sequence (A-8), item site gated `!!a.coopPid` (`useItemOn` deductInv defaults true; classic callsites unchanged); `coop` needs isCoopHost() + openSharedBattle (party+proximity, ≥2 active, ≥1 rebuilt battler) — solo unreachable. Invariants: verbatim enemies statement untouched · `Battle.lastShared` set only under coop + checked at BOTH game-over callsites · blocking = remote pids only, released on sit-out/withdraw/close with `finishCoopBattle` in `finally`; no event-owned bit can collide in MP6 (interpreter origins are pid-0/world only — remote origination is MP8) · 3 validation layers each reject their garbage (protocol structural / directives semantic / battle live-state→guard). Semantics A-6/A-7/A-8/A-10/D-6-1 verified in code; deferrals D-6-0/D-6-5/D-6-6/D-6-8/D-6-B-3 CONFIRMED as boundaries. Non-blocking MP8·A notes: `world.blocking` is a plain Set (refcount or exclude battle/event overlap when remote event origination arrives); wire `ally` idx can cross-target beyond what the UI allows (benign help-only under the same-machine trust model — tighten with passport loadouts). Details: docs/mp-6-spec.md verdict. |
| MP7 | Editor, Database, event commands, plugin API, docs | Opus | Fable | beacon-7 | ✅ **PASS 2026-07-20 (Fable gate)** — every gate independently re-run: vitest **1194** (79 files, test:unit) **+ 7** (test:net) = 1201 · node --test **48** (determinism hash **46633057** re-computed live) · cargo 26 · Playwright **128/128** (perf 255.73/300 vs beacon-6 242.77 → +5.3%, within ±10%; `git diff beacon-6..HEAD -- "*.png"` **EMPTY** = solo byte-identical) · `mp-database` e2e 3× consecutive --workers=1 · root tsc 0 · server tsc Node + CF both 0 · eslint 0 + sim wall fires on probe · v1.2.0 · FV 2 · data.js ?v=36 the only cache-bust. **i18n parity both directions**: editor 31 + Beacon mp-i18n **34** (10 packs × exactly the 33-key EN set, no missing/orphans, placeholders preserved); DB field labels confirmed i18n-EXEMPT by precedent (no key entered the parity set). **migrateProject round-trip verified** (v2 project gains the inert default → `multiplayerEnabled()` false → byte-identical; normalizer clamps every field; idempotent; editor fresh-project fallback now migrates — src/editor/boot.ts). **Plugin surface minimality CONFIRMED** (atlas.mp = exactly 7 members, late-bound via fns.mp, net tree never imported by the runtime; PROTOCOL_VERSION still 1 — `custom` additive within v1; wire arm opaque + byte-capped + token-bucketed + strict-decoded + room-scoped, sender never echoed on relay OR local bus; no IP/PII — MP5 posture unchanged). Semantics A/B/C/D verified in source (capacity only LOWERS the operator ceiling; waitPlayers solo-instant, timeout 1–60 s; Show-Message-To fire-and-forget to peers, awaits only origin; G.pSwitches init/reset/save round-trip; online/playerCount solo false/1; custom both directions on bus + relay; docs-site 27 pages). **D-7-0 CONFIRMED** as the intended boundary (relay runs no events until MP8·A; MP7·B = authoring + solo-correct + headless — the MP3/MP4 precedent). Non-blocking note: engine play-boot sample fallback still skips migrateProject (inert-correct, null-safe readers) — wrap on next touch. Details: docs/mp-7-spec.md verdict. |
| MP8 | Scale: zones, interest mgmt, persistence, load harness | Fable A · Opus B | **Fable load gate** | beacon-8 | ✅ **PASS 2026-07-20 (Fable LOAD gate)** — every gate independently re-run: fast vitest **1252** (88 files, test:unit) · net **11/11 ×3 consecutive** (6 files, test:net — includes the socketed kill-server/restore round-trip + the in-worker interpreter proof) · node --test **48** (determinism hash **46633057** re-computed live) · cargo 26 · Playwright **128/128** (perf 232.21/300 vs beacon-7 255.73 → −9.2 %, within ±10 %; `git diff beacon-7..HEAD -- "*.png"` **EMPTY** = solo byte-identical) · eslint 0 + sim wall fires on probe · root tsc 0 · server tsc Node + CF both 0 · mp-i18n parity 34 (43 keys/pack) · v1.2.0 ×7 · FV 2 · **no `js/` file touched beacon-7..HEAD** (no cache-busts) · both server bundles build + `beacon.mjs --help` evaluates headless (bundled engine slice + window shim stand up in plain Node). **Load harness independently re-run (Scale table above): 200/zone p95 82.6 ms, 1000/8-zones p95 101.8 ms — both match the §A4/§B·5 recorded numbers within noise, 3×/2.5× headroom against the 250 ms budget.** **Transfer under load VERIFIED**: harness scatters every bot through the real `transferPlayer` API on the live world (1000 cross-zone transfers in the world run, all bots subsequently echoed moves in their target zones); independent 200-bot/8-zone `--data` probe persisted exactly 25 records per mapId ×8 + all 8 ZoneSnapshots (records follow transfers durably). **Persistence round-trip VERIFIED**: world-persistence 5 (both stores) + world-smoke net e2e ×3 (full server kill → same store → same passport rejoins at the saved tile, over the socket) + do-store 4 (CF DO storage seam); on-disk inspection: 129 B/player, graceful flush 6–10 ms, p95 flat with persistence on. **Passport no-PII VERIFIED live**: generated passport = exactly `{v, kind, name, created, publicKeyJwk, privateKeyJwk}` (pure P-256 JWK material; test pins the exact key set); persisted record = fingerprint → `{name, mapId, x, y, dir, data, lastSeen}` — no IP, no email, no PII anywhere. Deferrals carried honestly: D-8-6 (per-player party/inv split, server battles), D-8-7 (CF multi-DO sharding), D-8-8 (handoff re-dial untested live — no target emits it), item 6 encoding = NO by measurement. Details: docs/mp-8-spec.md verdict. |
| MP9 | Safety hardening, chat, moderation, packaging, release | Opus | **Fable release gate** | beacon-9 + v2.0.0 | ❌ **RELEASE GATE NO-GO 2026-07-20 (Fable) — NOT tagged.** Every re-runnable gate independently re-verified PASS: fast `test:unit` **1290** (92 files, incl. chat-filter 14 · beacon-moderation 8 · coop-moderation 5 · moderation 3 · beacon-world 17 · net-protocol 34 · mp-i18n parity 34) · net **11/11 ×3 consecutive** (MP5·E p95 31.9 ms) · node --test **48** (determinism **46633057** live) · cargo **26** · **Playwright 130/130** (perf 245.92/300; `git diff beacon-7..HEAD -- "*.png"` EMPTY) · root + server Node/CF tsc 0 · eslint 0 + sim wall fires on probe · load smoke re-run live: **200/zone p95 74.0 ms · 1000/8-zones(workers) p95 104.4 ms**, all bots moved · version 2.0.0 ×7 (incl. Cargo.lock + README badge) · patch-notes ?v=75 in help.ts+shims.d.ts, editor.css v70/data.js v36 untouched · FV 2 · docs-site 28 pages · bundles build + `--help` headless. **Safety checklist PASS:** chat default "off" (chatModeOf), presets-always/text-only-under-"text"+censorChat on ALL four transports (room.ts/zone.ts/RoomHost ×2 via one shared resolveSay) · mute client-local only (protocol carries none) · report frame = 2 public pids+name+hint · moderation logs carry fingerprints, never `source` (MP5 note honored) · room-code 44.16 bits CSPRNG rejection-sampled · no-IP wire audit clean · passport-file trust-tier doc promise kept · parent page accurate except F-5 nit. **Fresh-eyes playthrough (live, real UI):** create→code→friend joins Driftwood Shore ≈30 s ✅ (forgiving code entry, friendly errors, 💬 panel + owner Mute/Report/Kick/Ban, "Free typing is off" note, world join by address + silent passport + `--engine-events` zone ✅; empty-room TTL + 45 s idle reaper observed live) — **but the co-op-battle leg is IMPOSSIBLE: ❌ F-1 (BLOCKER, D5):** parties/shared battles run ONLY on the local BroadcastChannel transport whose only entries are dev hooks (`RPGATLAS_MP.createRoom/joinRoom/partyInvite`; co-op.ts: "Reached only via the RPGATLAS_MP dev hook"; no UI anywhere sends `partyInvite` — social panel/menus/scenes grepped); the shipped title flow is relay-only and `server/src` contains ZERO party/battle code (zone-event-runtime stubs `Battle: { run: async () => "win" }` per D-8-6; relay rooms also run no encounters, D-5-0 never closed for rooms). Confirmed live: relay `partyInvite` silently dropped, no consent prompt. The deferral chain (D-5-0→MP8 · MP6 local-only awaiting MP8 · D-8-6 defers server battles) was each honest per-phase but never reconciled against D5 before release. **F-2:** wiki "Party up and fight together" is transport-silent (reads as general online play) while the events section right above is transport-honest. **F-3:** `DEFAULT_RELAY_URL` `beacon.rpgatlas.app` — **DNS does not exist** (checked live); every "zero setup"/demo flow dies (friendly offline copy) until Driftwood deploys the relay (D-B5-1 operator step, presented as live by 2.0 docs). **F-4 (note):** no client keepalive/auto-reconnect — tab backgrounded ≥45 s is idle-reaped (observed; two-device play unaffected; D-8-8). **F-5 (nit):** Online-Safety "blocks that specific device" — a ban is per-passport, not per-device. **Fix fork (Driftwood decides, then re-gate):** (a) wire parties+shared battles into the server engine-zone runtime (makes D5 true online; the MP6 sim core in `src/shared/sim/` was built headless FOR this) · (b) re-scope 2.0 honestly (explore/chat/events now, battles 2.1 — contradicts locked D5, needs Driftwood sign-off + copy edits) · (c) player-facing same-device co-op entry + Team Up UI with transport-honest docs. Any fork also: deploy the relay (or soften "zero setup"), fix F-2/F-5, rebuild the desktop exe (still 1.2.0-era, flagged by MP9·D). Full detail: docs/mp-9-spec.md §RELEASE GATE. |

### Known engine traps (carry into every phase)

- vitest runs `env=node` → anything the sim core touches must live DOM-free in
  `src/shared/` (this is now load-bearing, not just test hygiene).
- Interpreter handlers must NOT import `audio-deck.ts` (node tests stub window).
- vm-realm `deepEqual` trap in node tests.
- Version lives in **7 places**; patch-notes/editor.css/data.js have `?v=`
  cache-busts; bump only what changed.
- PS 5.1: `git commit -F msgfile` (never inline quotes); edit UTF-8 docs with
  Write/Edit or bash only (Get-/Set-Content double-encodes); fixture-generator
  reruns show LF/CRLF pseudo-drift (content-identical, `git diff` empty).
- Playwright: map 1 (Driftwood Shore) is FROZEN for goldens; frame-2+ DOM bugs
  show only in classic2d/post2 goldens ("2 reds" = suspect DOM overlay, not GPU
  drift); `#save-ind` visibility is the boot-ready gate — never static text.
- Seeded RNG: `?rngseed=` / `window.RPGATLAS_RNG_SEED`; e2e must seed, and
  after MP1 the seed feeds the **world instance** stream.
- Tauri: playtest/main windows are predefined in config — NEVER
  WebviewWindowBuilder from a command (deadlock). Any desktop net-config UI
  reuses existing windows. Check Tauri capability/CSP allows `wss://` at MP5.
- Draw-conservation is THE battle contract — every new roll presence-gated (MP6).
- gh CLI not installed — WebFetch for GitHub.
- Do not break `managerActive()` browser/desktop seam; browser build stays
  byte-identical for non-multiplayer games.

---

## Phases

### MP0 — Protocol, singleton audit & sim-boundary spec (Fable)

The thinking phase with teeth: real protocol code + the audit that de-risks MP1.

- **A — Baseline + protocol v1.** Record the live gate baseline into the status
  table. New `src/shared/net/protocol.ts`: versioned typed message unions —
  client→server `hello / join / resume / input / reply / emote / chat`,
  server→client `welcome / snapshot / delta / directive / presence / kick /
  error` — plus `PROTOCOL_VERSION`, input sequence numbers, and a room-code
  module (entropy ≥ 40 bits, typable format, collision-safe). Pure, DOM-free,
  vitest-covered (round-trip JSON serialization tests — loopback will later
  skip serialization, so tests must prove wire-safety independently).
- **B — Singleton audit.** Inventory every module-level mutable in the engine
  (`G`, `ctx`, `fns`, RNG source, UIStack, interpreter state, map runtime, …)
  into a table in `docs/mp-0-spec.md`, classifying each: **world** (instanced
  into sim core) / **client** (presentation, stays) / **config** (immutable).
  This table IS the MP1 work order.
- **C — Sim-boundary + directive spec.** Which systems are world-authoritative
  vs presentation; the directive/reply shapes MP3 will implement (message,
  choices, number/name input, shop, waits); how `sleep(ms)`/timers/timeOfDay
  become world-tick-based; event execution contexts (triggering player vs
  world). Amend this roadmap if the audit surprises us.

**Gates:** template gates; zero engine behavior change (Playwright untouched);
protocol vitest suite added.

**BUILD+GATE kickoff (Fable, new conversation):**
```
Continue Project Beacon (RPGAtlas online multiplayer) — Phase MP0: Protocol, Singleton Audit & Sim-Boundary Spec.
Model: Fable (build + self-gate). Read docs/MULTIPLAYER_ROADMAP.md (top through "Phases", then the MP0 section) before touching code.
Prior state: roadmap merged; no Beacon code exists. First act: record the live gate baseline (vitest/node/cargo/Playwright/eslint/version) into the roadmap status/baseline lines.
Do MP0 stage-by-stage (A protocol+baseline · B singleton audit · C sim-boundary spec), commit+push each stage to main, log deviations in docs/mp-0-spec.md, run the full gate, record the verdict in the roadmap status table, tag beacon-0, push the tag, and end with the MP1 BUILD and GATE hand-off blocks copied from the roadmap (updated if MP0 changed anything).
```

---

### MP1 — Instanced headless world core (Fable A · Opus B/C · Fable gate)

The fundamental engine change. The world sim becomes `createWorld(project,
{seed})` in `src/shared/sim/` — instanced (no module singletons: a server hosts
many worlds per process), headless (no DOM imports, lint-enforced), and
deterministic under seed.

- **A (Fable) — The instancing seam.** World type + factory; move/wrap `G` and
  the world-relevant slices of `ctx` into the instance; per-world RNG stream
  (`seedRnd` becomes world-scoped; the `?rngseed`/`window.AtlasRng` hooks bind
  to the default world so e2e is unchanged). A compat shim binds the engine's
  existing module imports to a default world instance — **zero behavior
  change**, every existing import keeps working. This stage defines the
  patterns B/C repeat.
- **B (Opus) — World systems onto the instance.** Game-state helpers, map
  runtime movement/collision, tile-behavior, encounters/steps, quests,
  inventory/wallet — mechanically migrated per the MP0·B table, engine imports
  flowing through the shim. All existing vitest suites stay green.
- **C (Opus) — Headless boot + determinism.** Node test: create a world from
  the Atlas_Quest fixture, tick 600, assert invariants; same seed ⇒ identical
  state hash (the determinism canary that guards every later phase). Lint rule
  (`no-restricted-imports`) walling `src/shared/sim/` off from DOM/engine
  modules.

**Gates:** template gates; Playwright goldens byte-identical; determinism hash
test; headless-boot node test; lint wall in place.

**BUILD kickoff (start with Fable for stage A; hand the conversation's stage B/C to Opus, or run B/C as a second conversation on Opus):**
```
Continue Project Beacon — Phase MP1: Instanced Headless World Core.
Model: Fable for stage A (the instancing seam), Opus for stages B–C. Read docs/MULTIPLAYER_ROADMAP.md (top + MP1) and docs/mp-0-spec.md (esp. the singleton audit table) first.
Prior state: beacon-0 tagged; protocol + audit exist; no sim extraction yet.
Do MP1 stage-by-stage per the roadmap, commit+push each stage, keep every existing test green at every stage (the compat shim means zero behavior change), log deviations in docs/mp-1-spec.md, and end with the MP1 GATE block (if built on Opus) or self-gate + tag beacon-1 and the MP2 BUILD block.
```

**GATE kickoff (Fable, new conversation):**
```
Project Beacon — MP1 GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP1 gates) + docs/mp-1-spec.md.
Independently re-run: full vitest, node tests, cargo, full Playwright (goldens must be byte-identical to pre-MP1), eslint, determinism hash test, headless boot test, and spot-audit the compat shim for behavior drift (diff a sample of migrated functions against git history).
Record the verdict in the roadmap status table + mp-1-spec.md, tag beacon-1, push, and end with the MP2 BUILD hand-off block.
```

---

### MP2 — Loopback client/server (Opus · Fable gate)

Single-player now *runs through the protocol*: the engine sends input intents
over an in-process `LoopbackTransport` and applies world deltas, exactly as a
network client will. Modal events still call locally (that seam is MP3's).
This phase retires the "did the split change the game?" risk permanently.

- **A** `LoopbackTransport` (passes structured objects by reference — no
  serialization cost in-process; wire-safety is already proven by MP0's
  round-trip tests) + the client-side world-mirror the renderer reads.
- *MP0·C note:* menu verbs (use item, equip, formation) are world writes and
  ride the intent channel — additive `input` intents defined at stage B here,
  per `docs/mp-0-spec.md` §C5.
- **B** Input intents → world; tick ownership moves into the world instance
  (`loop.ts` drains ticks by driving the world); prediction NOT needed here
  (zero-latency loopback) but the seam for it is left marked.
- **C** Perf check: perf-overlay frame budget within 10% of pre-MP2 numbers on
  the showcase map; fix before gating.

**Gates:** template gates; **full Playwright including pixel goldens
byte-identical** (THE gate of the whole project); perf budget held.

**BUILD kickoff (Opus):**
```
Continue Project Beacon — Phase MP2: Loopback Client/Server.
Model: Opus. Read docs/MULTIPLAYER_ROADMAP.md (top + MP2) + docs/mp-1-spec.md.
Prior state: beacon-1 tagged; world core is instanced+headless; engine still calls it directly.
Do MP2 stage-by-stage (A loopback transport + mirror · B intents/tick ownership · C perf), commit+push per stage, goldens must stay byte-identical at every stage, log deviations in docs/mp-2-spec.md, end with the MP2 GATE block.
```

**GATE kickoff (Fable):**
```
Project Beacon — MP2 GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP2) + docs/mp-2-spec.md.
Independently re-run all template gates + full Playwright (pixel goldens byte-identical vs beacon-1) + perf budget comparison. Audit the loopback path for hidden direct world access from presentation code (grep the renderer/UI for sim imports that bypass the mirror).
Record verdict, tag beacon-2, push, end with the MP3 BUILD hand-off block.
```

---

### MP3 — Interpreter presentation directives (Fable A · Opus B · Fable gate)

The trickiest surgery: modal event commands stop touching UI directly and
instead emit directives through a presentation port; the client renders them
with the existing message/ui-stack code and sends replies. Waits become
world-tick waits. Every command handler stays node-testable (they already are —
extend that discipline). *MP0·C note (risk shrank):* interpreter waits are
ALREADY tick-based (`waitFrames`/`tickTimers`; only 5 `sleep()` sites exist,
all presentation pacing) — stage A is the directive engine + a move of
`tickTimers` into the world, not a wait rewrite. Lifecycle contract:
`docs/mp-0-spec.md` §C3.

- **A (Fable)** The directive/reply engine: per-player interpreter contexts
  (who triggered this event; which player a directive targets), the
  presentation port interface, directive lifecycle (emit → await reply →
  resume), world-tick wait timers replacing wall-clock `sleep`, and conversion
  of the 3–4 hardest commands (Show Message, Show Choices, Open Shop, Wait) as
  the worked pattern.
- **B (Opus)** Convert the remaining modal/timed command handlers to the
  pattern; node tests per handler; the audio-deck import trap stands.
- ❓ **Branch point — ANSWERED 2026-07-19 (Driftwood): PARTICIPANTS ONLY**
  (the roadmap default, confirmed). Solo play pauses exactly as today; shared
  maps pause only the event's participants, others keep playing and see its
  world effects. MP3·A landed the structure (`world.blocking` per-player set +
  interpreter origins + `participantsOf` targeting); MP4 keys participants off
  real map rosters.

**Gates:** template gates; goldens byte-identical (single-player directives run
through loopback and must render pixel-equal); all interpreter suites green.

**BUILD kickoff (Fable stage A, then Opus stage B):**
```
Continue Project Beacon — Phase MP3: Interpreter Presentation Directives.
Model: Fable for stage A (directive engine + worked pattern), Opus for stage B (handler conversions). Read docs/MULTIPLAYER_ROADMAP.md (top + MP3) + docs/mp-2-spec.md. Ask Driftwood the MP3 branch-point question (shared-map cutscene pause semantics) before stage A.
Prior state: beacon-2 tagged; single-player runs through loopback; modal commands still direct-call UI.
Commit+push per stage, goldens byte-identical throughout, log in docs/mp-3-spec.md, end with the MP3 GATE block.
```

**GATE kickoff (Fable):**
```
Project Beacon — MP3 GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP3) + docs/mp-3-spec.md.
Re-run all template gates + goldens byte-identical vs beacon-2. Audit: sample 10 converted handlers vs git history for behavior drift; verify no handler imports audio-deck or DOM; verify wall-clock sleep is gone from world-side waits.
Record verdict, tag beacon-3, push, end with the MP4 BUILD hand-off block.
```

---

### MP4 — Local multi-client co-op (Opus · Fable gate)

Two browsers, one world, no server yet: a `BroadcastChannel` transport proves
multi-client correctness on one machine, fully deterministic and
Playwright-testable. First moment a second player walks on screen.

- **A** Multi-player world entities: spawn points (default = player start; DB
  field comes in MP7), join/leave lifecycle, per-player presence (name tag
  rendering), remote-player rendering reusing party-follower visuals +
  `prx→rx` interpolation.
- **B** `BroadcastChannel` transport + dev-flag "Play Together (local test)"
  entry; snapshot late-join through the save-payload path; presence toasts.
- **C** Emote bubbles + preset-phrase say (baseline D4 layer; the DB authoring
  UI for custom presets is MP7).
- **D** Playwright: two-context e2e under `?rngseed` — join, walk, emote,
  trigger a directive event, late-join snapshot — deterministic and additive
  (existing goldens untouched).
- ❓ **Branch point (ask at kickoff):** friend-room map policy — (a) room locked
  to leader's map (RM-familiar, simple) or (b) free roam, world ticks all
  occupied maps (real-MMO feel; MP8 needs it anyway). Roadmap default: (b),
  budget-checked.

**Gates:** template gates; new multi-context e2e green 3× consecutively (flake
bar); goldens untouched.

**BUILD kickoff (Opus):**
```
Continue Project Beacon — Phase MP4: Local Multi-Client Co-op.
Model: Opus. Read docs/MULTIPLAYER_ROADMAP.md (top + MP4) + docs/mp-3-spec.md. Ask Driftwood the MP4 branch-point (map policy) before stage A.
Prior state: beacon-3 tagged; directives work over loopback; world supports one player.
Do MP4 stage-by-stage (A entities/presence · B BroadcastChannel+late-join · C emotes/presets · D two-context e2e), commit+push per stage, log in docs/mp-4-spec.md, end with the MP4 GATE block.
```

**GATE kickoff (Fable):**
```
Project Beacon — MP4 GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP4) + docs/mp-4-spec.md.
Re-run template gates; run the new two-context e2e 3× consecutively; goldens untouched; audit presence messages carry no data beyond name+entity state (D6).
Record verdict, tag beacon-4, push, end with the MP5 BUILD hand-off block.
```

---### MP5 — Beacon server, rooms & transport (Opus · Fable SECURITY gate)

The open-source server ships: one TypeScript core, two targets (plain Node
`ws`; Cloudflare Durable Objects with WebSocket hibernation — one room/world
per DO). Friend rooms go live end-to-end.

- **A** `server/` package (in-repo, shares `src/shared/` sim+protocol code):
  room lifecycle — create → room code, join by code, snapshot late-join,
  resume-token reconnect, empty-room expiry; Node target first.
- **B** Cloudflare DO target from the same core; deploy recipe (`wrangler`);
  Driftwood's hosted relay is just this, deployed.
- **C** Client "Play Together" title-screen flow behind the project flag:
  enter name → Create room (shows code) / Join by code; friendly errors
  (audience-beginners rule); relay URL from project system settings with the
  Driftwood relay as default. Desktop parity: verify Tauri capability/CSP for
  `wss://` (config-only; predefined windows).
- **D** Hardening: join rate limits, message size/rate caps, malformed-input
  fuzz vitest suite, oversized-payload rejection, wss-only.
- **E** WAN smoke test with the WebSocket transport + 16-bot script (the
  MP8 harness's seed): friend-room latency gate.

**Gates:** template gates + **Fable security gate**: threat-model checklist
(code brute-force, flood, malformed frames, room squatting, token replay,
IP-privacy audit per D6, log-retention documented), fuzz suite green, 16-bot
latency numbers recorded.

**BUILD kickoff (Opus):**
```
Continue Project Beacon — Phase MP5: Beacon Server, Rooms & Transport.
Model: Opus. Read docs/MULTIPLAYER_ROADMAP.md (top + MP5 + "Kid safety & privacy") + docs/mp-4-spec.md.
Prior state: beacon-4 tagged; multi-client works over BroadcastChannel; no network server exists.
Do MP5 stage-by-stage (A Node server+rooms · B DO target+deploy · C Play Together UI · D hardening · E WAN smoke), commit+push per stage, log in docs/mp-5-spec.md, end with the MP5 SECURITY GATE block.
```

**SECURITY GATE kickoff (Fable):**
```
Project Beacon — MP5 SECURITY GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP5 + "Kid safety & privacy") + docs/mp-5-spec.md.
Re-run template gates + fuzz suite. Adversarial audit against the D6/safety checklist: attempt code brute-force math, flood, oversized/malformed frames, token replay, cross-room leakage, and verify no message ever carries an IP or anything beyond name+entity state. Verify room-code entropy and expiry. Verify friendly error copy (no stack traces).
Record verdict, tag beacon-5, push, end with the MP6 BUILD hand-off block.
```

---

### MP6 — Co-op battles (Fable A · Opus B · Fable gate)

Friends fight side-by-side. Deepest battle-logic surgery in the plan (D5).

- **A (Fable)** Party-up system (invite/accept, leader, party follows leader
  through transfers) + shared-battle architecture: shared troop instance in the
  world, join rules (party members in proximity auto-join), per-participant
  battle directives, turn coordination (everyone picks commands; default
  timeout so one AFK friend can't freeze the fight), escape/defeat/reward
  semantics (per-participant EXP/loot draws — **draw-conservation contract
  holds: every new roll presence-gated**), disconnect-mid-battle handling.
- **B (Opus)** Breadth: skills/items/states/luck/dual-wield paths over
  multiple participants; enemy targeting across participants; battle HUD for
  allies; node tests across the battle-logic matrix; two-context battle e2e.
- ❓ **Branch point — ANSWERED 2026-07-19 (Driftwood): SOLO INSTANCED BATTLE**
  (the roadmap default, confirmed). A non-partied player at a partied
  encounter gets their own private battle exactly as today; spectate/assist
  stays in the deferred ledger (post-2.0). A shared battle freezes only its
  participants (the MP3 participants-only pause generalized), so a non-partied
  player never notices a partied fight beyond the participants standing still.

**Gates:** template gates; battle vitest matrix green; determinism hash still
holds; two-context battle e2e 3×; solo battles byte-identical (goldens).

**BUILD kickoff (Fable stage A, then Opus stage B):**
```
Continue Project Beacon — Phase MP6: Co-op Battles.
Model: Fable for stage A (party system + shared-battle core), Opus for stage B (breadth + tests). Read docs/MULTIPLAYER_ROADMAP.md (top + MP6) + docs/mp-5-spec.md. Ask Driftwood the MP6 branch-point before stage A. Remember: draw-conservation is THE battle contract.
Prior state: beacon-5 tagged; friend rooms live; battles are solo-instanced.
Commit+push per stage, log in docs/mp-6-spec.md, end with the MP6 GATE block.
```

**GATE kickoff (Fable):**
```
Project Beacon — MP6 GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP6) + docs/mp-6-spec.md.
Re-run template gates + battle matrix + determinism hash + two-context battle e2e 3×; verify solo-battle goldens byte-identical; audit new rolls for presence-gating (draw conservation).
Record verdict, tag beacon-6, push, end with the MP7 BUILD hand-off block.
```

---

### MP7 — Editor, Database, event commands, plugin API, docs (Opus · Fable gate)

Multiplayer becomes a thing a kid can author, not a dev-flag.

- **A** Database ▸ Multiplayer section: enable toggle (replaces the dev flag),
  max players, per-map spawn points, relay URL override, chat mode
  (off / presets / filtered-text with the plain-language safety note at the
  toggle), preset-phrase authoring list. All additive → `migrateProject`
  backfill at every load boundary; FORMAT_VERSION stays 2.
- **B** Event commands (command picker page): Wait for All Players, Show
  Message To (triggering player / all), per-player vs world switch scope
  selector on the existing switch commands, Is Online / Player Count
  condition operands.
- **C** Plugin API additive net surface (the 2.0 unfreeze): `onPlayerJoin` /
  `onPlayerLeave` / `sendCustom` / custom-message handler — documented,
  minimal, versioned.
- **D** i18n ×10 for all player-facing strings (Play Together UI, presence
  toasts, errors; DB field labels exempt per precedent); wiki pages ("Making
  Your Game Multiplayer", "Hosting a World"); docs-site rebuild; editor e2e.

**Gates:** template gates; i18n parity; migrateProject round-trip vitest; new
editor e2e; docs-site page count recorded.

**BUILD kickoff (Opus):**
```
Continue Project Beacon — Phase MP7: Editor, Database, Event Commands, Plugin API, Docs.
Model: Opus. Read docs/MULTIPLAYER_ROADMAP.md (top + MP7) + docs/mp-6-spec.md.
Prior state: beacon-6 tagged; multiplayer fully works behind dev flags; zero editor surface.
Do MP7 stage-by-stage (A DB section · B event commands · C plugin API · D i18n/wiki/docs-site), commit+push per stage, log in docs/mp-7-spec.md, end with the MP7 GATE block.
```

**GATE kickoff (Fable):**
```
Project Beacon — MP7 GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP7) + docs/mp-7-spec.md.
Re-run template gates + i18n parity (all 10 locales, both directions) + migrateProject round-trip + editor e2e; verify old projects load byte-identically (additive backfill); review plugin API surface for minimality (it's frozen again after 2.0 ships).
Record verdict, tag beacon-7, push, end with the MP8 BUILD hand-off block.
```

---

### MP8 — Scale: zones, interest management, persistence, load harness (Fable A · Opus B · Fable LOAD gate)

Friend rooms become worlds.

- **A (Fable)** Zone architecture: zone-per-map sharding (Node:
  worker_threads/process-per-zone; DO: one DO per zone + world-directory DO),
  cross-zone transfer handoff protocol, area-of-interest filtering (chunked),
  server tick strategy decision (measure 60 Hz vs decimation + interpolation),
  world persistence design (per-zone periodic snapshots + passport-keyed
  player records), **passport identity** (device-local keypair, WebCrypto;
  export/import file; no PII).
- **B (Opus)** Bot load harness (node: N synthetic protocol clients
  random-walking, emoting, triggering events), delta/binary encoding IF
  measurement demands it, persistence implementation, harness CI target
  (small-N smoke in the suite; big-N manual).
- ❓ **Branch point (ask at kickoff):** persistence storage for self-hosted
  Node target — SQLite file (zero-dep, recommended) vs pluggable adapter now?

**Gates:** template gates + **Fable load gate**: the Scale-targets table
numbers measured and recorded (16/room, 200/zone, 1000/world), p95 latencies
within budget, memory/CPU per zone recorded, determinism hash still green.

**BUILD kickoff (Fable stage A, then Opus stage B):**
```
Continue Project Beacon — Phase MP8: Scale — Zones, Interest Management, Persistence, Load Harness.
Model: Fable for stage A (zone architecture + passport + tick-strategy measurement), Opus for stage B (harness + persistence build-out). Read docs/MULTIPLAYER_ROADMAP.md (top + MP8 + Scale targets) + docs/mp-7-spec.md. Ask Driftwood the MP8 branch-point before stage B.
Prior state: beacon-7 tagged; single-instance rooms are feature-complete and authorable.
Commit+push per stage, log in docs/mp-8-spec.md (including ALL measured numbers), end with the MP8 LOAD GATE block.
```

**LOAD GATE kickoff (Fable):**
```
Project Beacon — MP8 LOAD GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP8 + Scale targets) + docs/mp-8-spec.md.
Re-run template gates; independently re-run the load harness at 200/zone and 1000/world and compare against the recorded numbers; verify cross-zone transfer under load; verify persistence round-trip (kill a zone, restore, state intact); verify passport contains no PII.
Record verdict + final numbers in the roadmap Scale table, tag beacon-8, push, end with the MP9 BUILD hand-off block.
```

---

### MP9 — Safety hardening, chat, moderation, packaging, release 2.0 (Opus · Fable RELEASE gate)

- **A** Opt-in filtered text chat (D4): dev toggle already in DB (MP7); filter
  engine (word-list, en full + best-effort for the other locales — document
  honestly), instant client-local mute, report → room-owner/world-operator
  inbox, rate limits. Moderation: room-owner kick/ban, operator ban-by-passport,
  operator CLI/log.
- **B** Packaging: web/itch PWA zip + game EXE exports carry Play Together;
  `npx` one-liner + wrangler recipe for self-hosting documented as the
  "Hosting a World" quickstart; parent/teacher safety page (wiki + docs-site).
- **C** Showcase: Driftwood Shore co-op demo scenario (do NOT edit frozen map 1;
  follow the build-atlas-quest script pattern for derived maps) + a hosted
  demo room flow.
- **D** Release: version → 2.0.0 across the 7 sites, patch note, cache-busts,
  README, docs-site rebuild, plugin API re-frozen for 2.x, roadmap header
  verdict, tags `beacon-9` + `v2.0.0`, memory-file update.

**Gates:** template gates + **Fable release gate** (H6 style): every prior
phase's gate independently re-verified, safety checklist end-to-end (D4/D6 +
chat-off-by-default proven, filter/mute/report/kick exercised in e2e), fresh-
eyes playthrough: create room → friend joins → co-op battle → world visit, all
under 60 seconds to first join. Verdict signed in the roadmap header.

**BUILD kickoff (Opus):**
```
Continue Project Beacon — Phase MP9: Safety, Chat, Moderation, Packaging, Release 2.0.
Model: Opus. Read docs/MULTIPLAYER_ROADMAP.md (ALL of it) + docs/mp-8-spec.md.
Prior state: beacon-8 tagged; everything works at scale; chat/moderation/packaging/release remain.
Do MP9 stage-by-stage (A chat+moderation · B packaging+safety docs · C showcase · D release prep), commit+push per stage, log in docs/mp-9-spec.md, end with the MP9 RELEASE GATE block. Do NOT tag v2.0.0 — the release gate does.
```

**RELEASE GATE kickoff (Fable):**
```
Project Beacon — MP9 RELEASE GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (ALL) + every docs/mp-N-spec.md.
Independently re-verify every phase gate (full vitest/node/cargo/Playwright/eslint/i18n/load-harness smoke), run the end-to-end safety checklist (chat off by default, filter/mute/report/kick, no-IP audit, room-code entropy, parent page accuracy), verify version consistency across the 7 sites + cache-busts + FORMAT_VERSION 2, and do the fresh-eyes playthrough (room → join → co-op battle → world, <60s to first join).
Sign the verdict in the roadmap header, tag beacon-9 + v2.0.0, push with tags, update the Beacon memory file, and end with a summary for Driftwood.
```

---

## Deferred / open-questions ledger

- Binary wire encoding, delta compression: MP8, only if measurement demands.
- Client prediction beyond tile-walk (combat responsiveness): post-2.0.
- Shared-battle spectate/assist for non-partied players: MP6 ❓ ANSWERED
  2026-07-19 — solo instanced battle now; spectate/assist post-2.0.
- Cross-participant ally targeting in shared battles (heal a FRIEND's hero):
  post-2.0 view widening (MP6 D-6-B-3; your-own-party targeting ships in 2.0).
- Co-op ATB/CTB battles: shared battles are turn-based in 2.0 (MP6 D-6-6);
  the timed schedulers' world-side redesign rides MP8's headless battles.
- Filtered-chat quality for non-English locales: honest-docs approach in 2.0;
  community word-lists post-2.0.
- Voice, streaming/spectator mode, matchmaking: explicitly out of scope for 2.0.
- Central abuse-report service for the hosted relay (beyond room-owner tools):
  revisit post-2.0 with real usage data.

## Hand-off protocol (how Driftwood runs this)

1. At the end of every conversation (this planning one included), copy the next
   BUILD block from this file into a **new conversation** with the named model.
2. When a BUILD conversation ends, it hands you the GATE block (if the phase
   gates separately) — paste into a **new Fable conversation**.
3. The GATE conversation tags the phase and hands you the next BUILD block.
4. If any conversation dies mid-phase, start a new one with the same block —
   the stage log `docs/mp-N-spec.md` + git history carry the state.
