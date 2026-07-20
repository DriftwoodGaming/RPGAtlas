# Phase MP6 Spec — Co-op Battles ("Project Beacon")

**Status:** IN PROGRESS — stage A (Fable) building.
**Authored:** 2026-07-19 by Claude Fable 5, from the MP6 section of
`docs/MULTIPLAYER_ROADMAP.md` + `docs/mp-5-spec.md` + the MP0·C sim-boundary
contract (`docs/mp-0-spec.md` §C).
**Workflow:** commit + push each stage to `main`; the frozen pixel goldens stay
**byte-identical at every stage** (every MP6 branch is presence-gated — solo
play takes the exact pre-MP6 code path); log deviations here.

## Objective

Friends fight side-by-side (D5, "the heart of the promise"): a party-up system
(invite/accept, leader, party follows the leader through transfers) and shared
battles — one troop instance in the world, party members in proximity
auto-join, each participant commands their own heroes via battle directives,
turn coordination with an AFK timeout, per-participant EXP/loot draws.
**Draw-conservation is THE battle contract: every new roll is presence-gated**,
so solo battles consume the exact pre-MP6 RNG stream (the determinism hash and
the 123 pixel goldens are the proof).

## Branch-point answer (asked at kickoff, per the roadmap ❓)

**Non-partied player at a partied encounter — Driftwood chose: SOLO INSTANCED
BATTLE** (the roadmap default, 2026-07-19). A player who is not in the party
gets their own private battle exactly as today; spectate/assist stays in the
deferred ledger (post-2.0). Since a shared battle freezes only its
participants (the MP3 participants-only pause generalizes), a non-partied
player never even notices a partied fight beyond the participants standing
still.

## The governing reality (read before the stages)

- **D-6-0 (where battles run).** Battles execute in the ENGINE battle scene
  (`scenes/battle.ts`, DOM) on the world **authority**. After MP5, the
  authority in a relay room is the headless Beacon server — which, per D-5-0,
  runs **no events, no encounters, no battles** until MP8·A's per-zone runtime.
  So in MP6 the live co-op battle proof runs on the **MP4 local co-op path**
  (BroadcastChannel; the host browser IS the authority and has the full
  engine), while everything world-side (party state, shared-battle
  coordination, directives, timeouts, wire shapes) is built **headless in
  `src/shared/sim/`** so MP8's server runtime inherits it the same way it
  inherits MP5's directive routing. Relay rooms reject/ignore party intents
  until MP8 (an invite that can never battle would be a lie to a kid).
- **D-6-1 (per-player parties — the G partition line).** The MP0·B audit
  (row `G`) named the partition: **party/inv/gold are per-player; switches/
  vars/selfSw/timeOfDay are world-shared.** MP4 already made this real in
  practice (every client owns a full `G`; the roster carries only
  identity+position). MP6 builds on it: each participant brings **their own
  party** into a shared battle as a validated wire loadout
  (`BattlerLoadout[]`: actorId/level/hp/mp/equips/row/states — the authority
  rebuilds full actors from the SHARED project via `makeActor` + overrides,
  clamped to derived maxima), and each participant's rewards apply to **their
  own** `G` (EXP to their actors, loot to their inventory, gold to their
  wallet) from the per-participant end frame. Client-supplied loadouts are the
  MP6-local trust model (same-machine bus); MP8's passport-keyed player
  records move them server-side.

## Design decisions (stage A, the shared-battle contract)

- **A-1 — Party = a social group of PLAYERS (not `G.party`).** World-side
  runtime state (`world.party`, like the roster/directive broker: never
  snapshotted). Up to **4 members** (`MAX_PARTY_MEMBERS`). Any member may
  invite; the invitee joins the inviter's party. Leader = the founding
  inviter; succession = earliest joiner; a party of 1 dissolves. Invites are
  **`choices` directives** ("NAME wants to team up! Join their party?") — zero
  new wire machinery, C3.4 escape (disconnect/timeout ⇒ declined) for free.
  Party verbs ride the intent channel (§C5 precedent): `partyInvite {target}`,
  `partyLeave {}`.
- **A-2 — Party follows the leader through transfers.** When the leader's
  transfer completes (`transferPlayer`), partied members' entities warp to the
  arrival tile (name tags disambiguate the pile, the D-B5 precedent). A
  client whose OWN delta state lands on a new map loads that map (the
  `writeLocalPlayer` mapId seam). Members may still walk away afterwards —
  free roam holds; proximity gates battle join.
- **A-3 — Auto-join by proximity, fixed at battle start.** When a partied
  player triggers a battle, party members with an entity on the same map
  within **8 tiles** (Chebyshev, `BATTLE_JOIN_RADIUS`) auto-join (being
  partied IS the consent — no prompt; the roadmap says auto-join).
  Participants are fixed at start; no mid-battle join (the branch answer).
- **A-4 — Battler split: `max(1, floor(8 / participants))` each,
  trigger-first.** Total battlers ≤ 8 (`MAX_BATTLE_BATTLERS`): 2 players → 4
  each, 3 → 2 each, 4 → 2 each. Each participant contributes the FRONT of
  their own party. The loadout arrives via a **`battleJoin` directive** the
  client answers automatically (no UI; 5 s tick-timeout ⇒ they sit this one
  out).
- **A-5 — Per-round command collection via `battleCmd` directives.** Each
  round, remote participants get ONE `battleCmd` directive carrying a compact
  view (their battlers + usable skills, allies, enemies) and reply with one
  command per battler (attack/skill/item/guard/escape). The **local
  (authority) player keeps the exact solo command UI** — `battleCmd` is only
  ever emitted to REMOTE participants, which is the presence-gating applied
  to UI. **AFK timeout: 30 s** (`BATTLE_CMD_TIMEOUT_TICKS`, world ticks — the
  tick pump runs during battle) ⇒ the C3.4 escape value = all-guard, so one
  AFK friend can't freeze the fight.
- **A-6 — Escape is collective.** Any participant's successful escape command
  ends the battle for everyone ("the party slips away") — RM's escape was
  always a party action, and it spares the authority-is-a-player paradox of a
  fled host headlessly hosting a fight it left. The roll is today's formula
  with the merged battler pool (same single draw; solo pool unchanged).
  Individual withdrawal exists only for disconnects
  (`withdrawParticipant`: battlers leave the fight, no rewards).
- **A-7 — Co-op defeat never game-overs.** Shared-battle defeat revives every
  participant's battlers at 1 HP; the result still reports `"lose"` (authors'
  lose-branches run) but the game-over flow is suppressed at both callsites
  (`Battle.lastShared`) — a friend's world must not end because a fight went
  badly. Solo defeat is byte-identical to today. Victory with downed members
  leaves them downed (classic); downed participants draw no rewards (the
  living-members EXP rule generalized per participant).
- **A-8 — Per-participant rewards, conservation-ordered.** On victory the
  authority's OWN reward block runs FIRST and byte-identically to solo (same
  draws, same order); then, presence-gated, each remote participant's draws
  run in join order (their own `rollDrops` per defeated enemy — everyone gets
  their own loot; full EXP and gold to each participant, co-op never punishes
  playing together). Results reach each participant as a `battle` **end
  event**; the client applies them to its own `G` (exp/level-ups/loot/gold/hp
  writeback — no client-side draws).
- **A-9 — Battle events ride the delta channel.** The world queues per-player
  battle events (`start`/`log`/`end` in stage A; stage B adds granular
  HUD events) into a per-world outbox; the room host drains it into
  `delta.changes.battle` per player — additive opaque-`JsonValue` content,
  the D-B1/D-A5-2 precedent, no new server message type. Same for
  `delta.changes.party` (the party table, sent when membership changes).
- **A-10 — Participants are blocked players.** A shared battle
  `beginBlocking`s exactly its participants (the MP3 participants-only pause
  generalized): their move intents are ignored (`applyRemoteIntent` gains a
  `blocking.has(pid)` gate — inert pre-MP6 since remote pids never entered
  the set), released at battle end. Non-participants keep playing — subject
  to D-6-2 below.

## Deviations / discoveries (stage A)

- **D-6-2 (local-authority pause).** In MP4-local co-op, while the HOST is in
  a battle the map scene's `update()` early-returns (scene !== "map"), so
  NON-participants also freeze — exactly as they do today when the host opens
  a menu or reads a message. This is the authority-is-a-player reality of the
  local transport, not a new regression; MP8's headless per-zone runtime
  removes it. Logged so the gate inherits it explicitly.
- **D-6-3 (no protocol version bump).** MP6 adds intent kinds
  (`partyInvite`/`partyLeave`) and directive kinds (`battleJoin`/`battleCmd`)
  — additive union arms within protocol v1, the exact MP2·B
  (useItem/equip/formation) and MP3·B (selectItem/scrollText) precedent; no
  deployed relay exists to skew against. Battle/party delta content rides the
  opaque `JsonValue` channels (D-B1/D-A5-2 precedent).
- **D-6-4 (disconnect-mid-battle: machinery now, live wiring at MP8).**
  `withdrawParticipant` (battlers leave, pendings auto-resolve, no rewards,
  battle continues; ALL gone ⇒ abort-as-escape) is implemented and
  unit-tested, but the BroadcastChannel transport has no disconnect signal
  (D-B2) and the MP5 server doesn't run battles (D-5-0) — so in MP6-local a
  vanished participant is handled by the AFK timeout (all-guard) until MP8's
  server battles wire the real detach. The semantics are the deliverable.
- **D-6-5 (relay rooms: party intents dropped).** The MP5 server's
  `translateIntent` handles move/face only; the new party intents decode
  (fuzz-safe) and are silently dropped — parties and battles reach relay
  rooms with MP8·A's per-zone runtime (D-6-0). The client's "Play Together"
  relay flow is unchanged this phase.

---

## Stage A — Party system + shared-battle core (Fable, landed 2026-07-19)

### What landed

**Sim core (headless, lint-walled):**

- **`src/shared/sim/party.ts`** (NEW) — the player-party system: `PartyState`
  on the world (runtime-only, like roster/directives), `requestPartyInvite`
  (authoritative validation → a `choices` consent directive to the invitee,
  raced against `INVITE_TIMEOUT_TICKS`; C3.4 escape = declined), `leaveParty`
  (leader succession = earliest joiner; a party of one dissolves),
  `battleParticipantsFor` (same map + `BATTLE_JOIN_RADIUS` 8 Chebyshev,
  trigger-first join order), `warpPartyToLeader` (A-2 transfer follow), and
  the wire table (`partyTable` / `applyPartyTable` with a local-player diff
  for client toasts / `consumePartyDirty`).
- **`src/shared/sim/coop-battle.ts`** (NEW) — shared-battle coordination:
  `openSharedBattle` (presence gate #1: partied + in-range or null; blocks
  REMOTE participants only — never a blocking bit an enclosing event owns),
  the A-4 slot split, `collectLoadouts` (battleJoin directives,
  `BATTLE_JOIN_TIMEOUT_TICKS` 5 s ⇒ sit out + unblock), `collectBattleCommands`
  (one battleCmd per participant per round, `BATTLE_CMD_TIMEOUT_TICKS` 30 s ⇒
  all-guard), `withdrawParticipant` (D-6-4), the per-player `BattleEvent`
  outbox (`queueBattleEvent`/`drainBattleOutbox`; the local player is never
  queued), `closeSharedBattle`.
- **`src/shared/sim/directives.ts`** — `emitDirectiveTimed` (tick-deadline
  emit; `emitDirective` now delegates with deadline 0 — same microtask shape)
  + `resolvePendingWithEscape`; escape values + semantic reply validation for
  the two new kinds.
- **`src/shared/net/protocol.ts`** — additive v1 arms (D-6-3): intents
  `partyInvite`/`partyLeave`; directives `battleJoin` (troopId + inviter name)
  and `battleCmd` (round view: yours/allies/enemies) with replies
  `{party: BattlerLoadout[]}` / `{cmds: BattleActionCmd[]}`; strict decoder
  arms for all of it; caps `MAX_PARTY_MEMBERS` 4, `MAX_BATTLE_BATTLERS` 8,
  `MAX_LOADOUT_BATTLERS` 4.
- **`src/shared/sim/world.ts`** — `World` gains `party` + `coopBattle`
  (runtime-only, never snapshotted).

**Engine (world authority + client halves):**

- **`src/engine/scenes/battle-coop.ts`** (NEW) — the bridge: `openCoopBattle`
  (session gate `isCoopHost()` → sim open → loadout collection → battler
  REBUILD from the shared project via `makeActor` + clamped overrides, tagged
  `coopPid`/`coopName`), `coopVictoryRewards` (per-participant `rollDrops`
  draws AFTER the classic sequence, downed/withdrawn draw nothing),
  `finishCoopBattle` (end frames with removeAtEnd states shed + battle
  close), `coopLog`; client half: `buildLoadout` (the battleJoin auto-answer)
  + `applyBattleEnd` (hp/mp/states write-back, gainExp level-ups, loot/gold/
  wallet — zero client draws).
- **`src/engine/scenes/battle.ts`** — the presence-gated seams: co-op open
  after scene/music (solo takes the ternary's null arm WITHOUT awaiting);
  `const party` = G.party by reference in solo, host-slice + rebuilt remotes
  in co-op; `livingP` and every battle-LOGIC pool read `party` (`coopGone`
  excluded); the collect loop skips remote-owned battlers → `collectCoopRound`
  builds per-participant views, asks the sim core, resolves replies
  (attack/skill/guard/escape; stale/unusable ⇒ guard) into the same command
  objects the solo UI builds; remote escape = the collective attempt (A-6),
  failed local escape voids the co-op round too; `say()` mirrors every log
  line to participants; victory block appends `coopVictoryRewards`; defeat
  block revives at 1 HP in co-op (A-7); `finally` runs `finishCoopBattle`;
  `Battle.lastShared` set per run. DOM sites (refreshParty/actorSprs/
  actorElement) stay `G.party` — the ally HUD is stage B.
- **`src/engine/interpreter/commands/combat.ts`** + the map encounter
  callsite — game-over suppressed when `Battle.lastShared` (A-7).
- **`src/engine/scenes/map.ts`** — `handlePartyIntent` (one dispatcher for
  player 0 + peers, host toasts via late-bound `fns.mpToast`);
  `applyRemoteIntent` gains the A-10 `blocking.has(pid)` gate (inert
  pre-MP6); `transferPlayer` warps the party after `syncFollowers` (A-2).
- **`src/engine/net/room-host.ts`** — snapshot carries the party table;
  `afterTick` drains the battle outbox + party-dirty into per-client
  `delta.changes` (`battle` per addressee, `party` to all).
- **`src/engine/net/room-client.ts` / `relay-client.ts`** — additive delta
  handling (`changes.party` → `applyPartyTable` + `onParty` diff;
  `changes.battle` → `onBattle`), snapshot party mirror. The relay server
  never sends these until MP8·A — wired now so the client is ready.
- **`src/engine/co-op.ts`** — `onPartyChange`/`onBattleEvent` toasts +
  `applyBattleEnd` on the end frame; `writeLocalPlayer` gains the A-2 mapId
  seam (authority moved me to another map ⇒ load it, land on the reported
  tile, guarded against re-entry); installs `fns.mpToast`.
- **`src/engine/scenes/directive-renderer.ts`** — `battleJoin` auto-answers
  with `buildLoadout()` (no UI — partied is the consent); `battleCmd` answers
  all-guard until stage B's real command UI.
- **`src/engine/boot.ts`** — `RPGATLAS_MP` gains `partyInvite`/`partyLeave`/
  `partyState`/`armEncounter` (dev + e2e surface).

**Tests (+26 vitest → 1135):**

- `tests-unit/sim-party.test.ts` (+11): solo-inert, clientless auto-decline,
  accept/decline/cancel/timeout, validations (self/ghost/partied/double/full),
  leadership succession + dissolve, proximity + order, leader warp, wire
  table round-trip + diff.
- `tests-unit/coop-battle.test.ts` (+9): presence gates, A-4 split,
  remote-only blocking + release, loadout collect with sit-out deadline,
  command round with AFK all-guard, trim + foreign-reply drop, withdrawal,
  outbox addressing/drain.
- `tests-unit/coop-session.test.ts` (+3): the wire paths end-to-end over the
  REAL BroadcastChannel bus — invite→choices→accept→party table on the
  delta with the joined diff; battleJoin round-trip seating the loadout;
  battle events reaching only their addressee.
- `tests-unit/net-protocol.test.ts` (+3 tests): every new union arm
  round-tripped + strictness rejects.

### Draw-conservation audit trail (stage A)

Every new roll is behind `coop` (battle scene) or a party/roster gate (sim):

1. `openSharedBattle` requires a party with a proximate member — a solo world
   has neither, so `coop` is null and `party === G.party` by reference.
2. The only NEW draw sites: co-op TP init for remote battlers (the `party`
   loop tail), agility-sort comparisons over the longer merged list, enemy
   AI/targeting pools widened by remote battlers, and per-participant
   `rollDrops` in `coopVictoryRewards` — all appended AFTER the authority's
   classic sequence (A-8) or inert when `party === G.party`.
3. Proof: node determinism hash 46633057 green · vitest battle suites green ·
   Playwright 126/126 with `git diff -- "*.png"` EMPTY (zero golden bytes).

### Stage A gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest (test:unit) | **1135** (77 files; +26 over beacon-5's 1109) |
| vitest (test:net) | **7** (unchanged — no real-socket surface touched) |
| node --test | **46** (determinism hash 46633057 green) |
| Playwright | **126/126** — `git diff -- "*.png"` empty (goldens byte-identical); perf 250.54/300 (beacon-5 242.58 → +3.3%, within ±10%) |
| tsc / eslint | **0 / 0** — sim wall holds (party.ts + coop-battle.ts import only shared modules) |
| cargo | untouched by MP6·A (no Rust change; the phase gate re-runs) |
| versions / FV / cache-busts | 1.2.0 · 2 · none (no `?v=` file; new player strings are inline/toast English per D-C5-2 → MP7) |

### Additional deviations discovered while building

- **D-6-6 (co-op battles are turn-based in stage A).** A shared battle forces
  the classic turn loop even when the project selects ATB/CTB. The timed
  schedulers' per-actor command UI and `sleep(30)` idle poll are solo
  presentation pacing (the MP0·C §C4 ruling); their world-side redesign
  properly belongs with headless server battles (MP8), not with a phase whose
  authority still runs the DOM scene (D-6-0). Stage B may extend co-op to
  ATB/CTB if the matrix demands it; otherwise this stands as the boundary.
- **D-6-7 (remote `item` commands ride stage B).** The battleCmd reply shape
  carries `item`, but stage A resolves it to guard: spending another player's
  client-side inventory needs the participant-inventory flow that belongs to
  stage B's breadth (skills/items/states across participants).
- **D-6-8 (co-op EXP is the raw troop total).** Remote participants receive
  the authority-computed `exp` without the per-actor MZ `expRate` trait scale
  (their client applies `gainExp` directly). Stage B's trait breadth can
  refine; natively the rate is 1 everywhere, so this is exact for Atlas-native
  projects.

*(Stage B log lands below when Opus finishes.)*
