# Phase MP6 Spec — Co-op Battles ("Project Beacon")

**Status:** ✅ **PHASE COMPLETE — Fable gate PASS 2026-07-19, tag `beacon-6`** (verdict at the bottom of this file). Stage A (Fable) + stage B (Opus) landed 2026-07-19.
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

---

## Stage B — Breadth: remote battle UI, items across the wire, ally HUD, tests, e2e (Opus, landed 2026-07-19)

Stage A left three arms stubbed for stage B: the remote `battleCmd` client
auto-guarded, `item` commands resolved to guard (D-6-7), and the host had no
view of its allies. Stage B fills all three and proves the whole loop with a
live two-context battle. Nothing here adds a wire kind — the one new
`BattleEvent` (`itemUsed`) rides the existing opaque `changes.battle` channel.

### What landed

**Remote battle command UI — `src/engine/scenes/directive-renderer.ts`:**

- `renderBattleCmd` replaces the all-guard stub: one `BattleActionCmd` per
  battler in the round view's `yours`, index-aligned, built with the engine's
  OWN `showList` list/target windows (the same UI the solo battle uses, so it
  is instantly kid-familiar). A `!canAct` battler contributes a guard
  placeholder to keep the reply aligned with `yours` (the authority re-checks
  and pushes its own "stunned"). Attack → enemy target (a lone enemy needs no
  pick, mirroring solo `pickTarget`); Skills and Items read scope / revive /
  effect from the client's OWN copy of the SHARED project (no wire round-trip,
  D-6-1); ally targeting picks among the client's own battlers by their merged
  `idx`. The top command menu is `cancellable:false` (submenus loop back on
  cancel) so the client always yields a command — a shared fight can't hang.

**Items across the wire — D-6-7 resolved (`battle.ts`, `menus.ts`,
`coop-battle.ts`):**

- `resolveCoopCmd`'s `item` arm resolves the id against the SHARED project
  (`RA.byId(proj.items,…)`), picks the ally target from the merged pool, and
  returns the same `{type:"item", item, target}` object the solo UI builds
  (invalid target / unknown id ⇒ guard, D-6-B-1).
- The battle item execution site gates BOTH the host-inventory precheck and the
  decrement on `!actor.coopPid`: a remote-owned battler spends its OWN client
  inventory, so the host's bag is never touched — `useItemOn` gained a
  `deductInv` param (default **true** = every classic caller byte-identical),
  passed `false` only for a remote battler. On a successful use the authority
  queues `{ev:"itemUsed", id}` addressed to the owner.
- `BattleEvent` gains `{ev:"itemUsed", id}` (additive JsonValue — not a wire
  change, D-6-3); the owner's client decrements its own `G.inv` on receipt.

**Remote battle overlay — `src/engine/co-op.ts`:**

- `onBattleEvent` grows from toasts-only into a live overlay: `start` opens an
  inline-styled log panel (the remote participant's window on the fight running
  on the host), `round`/`log` stream into it, `itemUsed` decrements the owner's
  bag, `end` closes it + applies the end frame + toasts the result. The
  battleCmd command windows stack above it. All inline-styled — no `editor.css`
  touch, no cache-bust.

**Ally HUD (host side) — `src/engine/scenes/battle.ts` `refreshParty`:**

- A `coop`-gated `coopAllyRowsHtml()` strip appends every remote battler after
  the host's own `G.party` rows: name + owner, HP/MP/TP bars via the existing
  `bar()` helper, state tags, and dead/withdrawn (`coopGone`) styling. EVERY
  DOM line is behind `coop`, so the append never runs in solo and the party
  markup stays byte-identical (the goldens' proof).

**Breadth tests (+10 vitest → 1145):**

- `tests-unit/battle-logic.test.ts` (+8): `weightedTargetIndex` over an
  8-battler merged pool (full coverage + the 3:1 front/back split + a
  per-battler `tgr` of 0/magnet + the all-silenced fallback), `lukEffectRate`
  across participants, `extraActionRolls` over 8 pooled Action-Times rows, and
  per-participant `rollDrops` sequences off ONE shared stream in join order
  (A-8) + a downed participant drawing nothing.
- `tests-unit/coop-battle.test.ts` (+1): an `itemUsed` event is addressed only
  to the item's owner; the local player is never queued.
- `tests-unit/coop-session.test.ts` (+1): `itemUsed` rides its owner's delta
  over the REAL BroadcastChannel bus; the other client is untouched.

**Two-context battle e2e — `tests-e2e/mp-battle.spec.mjs` (NEW):**

- Two pages of one context (shared bus): host creates a room, client joins,
  host `partyInvite`s → the client's `choices` modal → "Join!" → both party
  tables carry `[0,1]`; the host triggers the shared battle; the client's
  `battleJoin` auto-seats its party, its REAL `battleCmd` UI appears and is
  driven to victory alongside the host's classic UI; asserts the client saw the
  mirrored log lines, its end frame applied to its OWN `G` (gold += the win's
  payout), both battle overlays torn down, and zero page/console errors on
  either tab. Seeded RNG; **no golden captured**; passes **3× consecutively
  (serial, `--workers=1`)**.

### Design decisions (stage B)

- **B-1 — The client reads the shared project for scope/effect, not the wire.**
  The `battleCmd` view carries only per-round state (hp/mp/tp/states/usable
  flags); skill scope, revive-ness, and item effects come from the client's own
  copy of the project (D-6-1). The view stays compact and the protocol
  unchanged.
- **B-2 — Ally targeting is your-own-party.** `BattleActionCmd.ally` is a merged
  battler idx, and only the client's OWN battlers carry an idx in the view
  (`yours[].idx`); other participants' battlers appear name/hp-only (`allies`).
  So heals/revives/ally-items target your own heroes — kid-simple and
  idx-addressable without widening the view.
- **B-3 — The top command menu is non-cancellable.** Matching solo
  `actorCommand`: the client always returns a command per actable battler
  (submenus loop back on cancel), so a shared fight can never hang on an
  indecisive client; non-actable battlers return a guard placeholder to keep
  the reply index-aligned with `yours`.
- **B-4 — Items decrement client-side only.** The authority applies the item's
  effect from the shared project but never touches the host's inventory for a
  remote battler; the `itemUsed` event lets the owner decrement its own bag.
  The D-6-1 per-player-inventory line, made real for battle (same-machine trust
  model of MP6-local; MP8 moves it server-side).

### Deviations / discoveries (stage B)

- **D-6-B-1 (impossible item ⇒ guard, never a free turn).** A remote item
  command that resolves to an impossible target (revive on a living ally, heal
  on a fallen one, unknown id) becomes guard in `resolveCoopCmd` — the C3.2c
  posture, mirroring the solo `useItemOn` buzzer. No draw, no consumption, no
  `itemUsed`.
- **D-6-B-2 (the battle e2e triggers via the plugin battle entry, not
  arm+step).** The spec suggested arming a forced encounter and walking a step;
  the e2e instead starts the shared battle through the plugin API's battle entry
  (`window.Atlas.atlas.startBattle`), which routes through the IDENTICAL
  `Battle.run → openCoopBattle` co-op path. This keeps the two-context proof
  deterministic and free of tile-walk flake under the real (unfrozen) clock this
  BroadcastChannel transport requires; arm+step's only co-op-specific addition —
  the map-callsite game-over suppression (`!Battle.lastShared`) — is a
  defeat-path concern a victory e2e never touches. The weak encounter (troop
  900) is an additive `transformProject` fixture: in-memory only, never written
  to disk, never a golden.
- **D-6-B-3 (no cross-participant heal targeting).** A consequence of B-2: the
  view gives no idx for `allies`, so a client can't cross-heal another
  participant's hero. Cross-party support targeting rides a future view widening
  (post-2.0 if demanded); intra-party support is complete.

### Draw-conservation audit trail (stage B)

Every stage-B addition is presence-gated or default-preserving:

1. `resolveCoopCmd`'s item arm + the `itemUsed` queue run only inside
   `collectCoopRound` / behind `a.coopPid && coop` — unreachable when `coop` is
   null (a solo world has no remote-owned battlers).
2. The item execution site's new `remote` branch is `!!a.coopPid`: false for
   every solo/local actor, so the precheck, `useItemOn(…, true)`, and the
   (absent) `itemUsed` queue are byte-identical to pre-MP6.
3. `useItemOn`'s `deductInv` defaults true — every existing caller (field menu +
   local battle) is unchanged; the RNG draws inside it are untouched.
4. The ally-HUD append and the client overlay never draw RNG and never run in
   solo (coop null / client-only DOM).
5. Proof: node determinism hash **46633057** green · Playwright **127/127** with
   `git diff -- "*.png"` EMPTY (zero golden bytes) · perf 245.36/300.

### Stage B gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest (test:unit) | **1145** (77 files; +10 over stage A's 1135) — two clean passes |
| vitest (test:net) | **7** (unchanged — no real-socket surface touched) |
| node --test | **46** (determinism hash 46633057 green) |
| Playwright | **127/127** (126 prior + `mp-battle`; goldens byte-identical, `git diff -- "*.png"` empty; perf 245.36/300 vs stage A 250.54 → within ±10%); `mp-battle` **3× consecutive serial** green |
| root tsc / server tsc | **0 / 0** (server Node + CF both 0) |
| eslint | **0** — sim wall holds (the coop-battle.ts union extension imports only shared modules) |
| versions / FV / cache-busts | 1.2.0 · 2 · none (new player strings inline English per D-C5-2 → MP7; overlay + HUD inline-styled, no `?v=` file touched) |

---

## Phase gate (Fable, after B)

Template gates + battle matrix + determinism hash + two-context battle e2e 3× +
solo-battle goldens byte-identical + the draw-conservation audit. Verdict
recorded here + the roadmap status table; tag `beacon-6`.

**MP6 GATE kickoff (paste into a new Fable conversation):**
```
Project Beacon — MP6 GATE (Fable). Read docs/MULTIPLAYER_ROADMAP.md (MP6) + docs/mp-6-spec.md (all of it — design decisions A-1..A-10, deviations D-6-0..D-6-8 + D-6-B-1..B-3).
Independently re-run the template gates: npm run test:unit (expect 1145) · npm run test:net (7) · node --test tests/ (46 — the determinism hash 46633057 must hold) · cargo test (26, Rust untouched by MP6) · npx tsc --noEmit + the server typechecks (Node + CF, both 0) · npx eslint src --ext .ts (0, and prove the sim wall still FIRES on a probe import) · FULL npx playwright test (127/127; perf within ±10% of 245.36/300). Solo-battle byte-identity: `git diff beacon-5..HEAD -- "*.png"` must be EMPTY. Flake bar: tests-e2e/mp-battle.spec.mjs 3× consecutively with --workers=1.
Draw-conservation audit (THE battle contract): enumerate every rnd()/rndf() call site added since beacon-5 (`git diff beacon-5..HEAD -- src/`) and verify each is unreachable when `coop` is null — the presence gates are isCoopHost() + openSharedBattle (party + proximity) and `party === G.party` by reference in solo. Verify: the verbatim enemies statement in battle.ts (tests/battle-index.test.js) untouched; useItemOn's deductInv defaults true at every classic callsite; Battle.lastShared unreachable in solo and checked at BOTH game-over callsites (combat.ts + map.ts encounter); world.blocking gains only REMOTE pids from battles (no event-owned blocking bit cleared by battle teardown); the battleCmd/battleJoin validation layers (protocol decoder + directives.ts semantic + battle.ts live-state fallback-to-guard) each reject their layer's garbage.
Semantics review against the spec: A-6 collective escape, A-7 defeat-revive + suppressed game-over, A-8 per-participant rewards AFTER the classic sequence in join order, A-10 participants-only blocking, D-6-1 per-player parties/loadouts/end-frames. Confirm the deferrals as intended boundaries: D-6-0 (relay battles → MP8·A), D-6-5 (relay drops party intents), D-6-6 (co-op is turn-based; ATB/CTB + idle-poll redesign → MP8), D-6-8 (raw-EXP co-op), D-6-B-3 (cross-participant ally targeting → post-2.0 ledger).
Record the verdict here + the roadmap status table, tag beacon-6, push with tags, and end with the MP7 BUILD hand-off block.
```

### VERDICT — ✅ PASS (Fable gate, 2026-07-19) — tag `beacon-6`

Every gate independently re-run this conversation; every audit item verified
in code, not from the stage logs.

**Template gates (all green):**

| Gate | Result |
|---|---|
| vitest (test:unit) | **1145** (77 files) |
| vitest (test:net) | **7** (isolated serial; no real-socket surface touched by MP6) |
| node --test | **46** — determinism hash **46633057** re-computed live by sim-headless-boot; battle-index (the verbatim-enemies pin) green |
| cargo | **26** (Rust untouched by MP6, per the diff) |
| tsc | root **0** · server Node **0** · server CF **0** |
| eslint | **0** — sim wall proven to FIRE on a probe engine import into `sim/party.ts` (no-restricted-imports, exit 1; probe reverted, tree clean) |
| Playwright | **127/127** · perf **242.77/300** (stage B 245.36 → −1.1%, within ±10%) |
| Solo-battle byte-identity | `git diff beacon-5..HEAD -- "*.png"` **EMPTY** |
| Flake bar | `mp-battle.spec.mjs` **3× consecutive green, --workers=1** |
| Versions / FV / cache-busts | 1.2.0 · FORMAT_VERSION 2 · none (the whole diff is 16 src files + tests + docs — no `?v=` file touched) |

**Draw-conservation audit (THE battle contract) — CLEAN.** The complete
added draw surface since beacon-5 is three sites, each verified:

1. TP-init pool `G.party` → `party` (battle.ts): in solo `party === G.party`
   **by reference** (the ternary's null arm), so the loop, order, and draws
   are byte-identical. The only other `party`-widened readers (agility sort,
   enemy AI `partyLevel`, targeting/substitute/party-ability pools, pickAlly)
   are the same by-reference argument.
2. `coopVictoryRewards` (battle-coop.ts): per-participant `rollDrops` off the
   battle's own `rndf`, called behind `if (coop)` AFTER the authority's
   classic reward sequence (A-8 order), trigger skipped, downed/withdrawn
   participants draw nothing.
3. The item execution site: gated on `!!a.coopPid` — false for every
   solo/local actor, so precheck + `useItemOn(…, true)` + no event is the
   exact classic path.

`coop` itself requires `isCoopHost()` (host mode + live peers) AND
`openSharedBattle` (party + proximity → ≥2 participants) AND a non-empty
loadout collection with ≥1 rebuilt battler — three nested nulls between a
solo world and any MP6 branch.

**Invariants verified:** verbatim enemies statement untouched (context-only
in the diff; battle-index green) · `useItemOn` `deductInv` defaults true and
the decrement is the ONLY gated line — both classic callsites unchanged ·
`Battle.lastShared` set only under `coop`, reset per run, checked at BOTH
game-over callsites (combat.ts `!services.Battle.lastShared`, stub-safe for
node tests; map.ts encounter `!fns.Battle.lastShared`) · blocking: battles
add REMOTE pids only (trigger excluded from `remotePids`), released
per-pid on sit-out (collectLoadouts) and withdrawal (withdrawParticipant)
and collectively at close, with `finishCoopBattle` in the scene's `finally`
so an exception still releases; no event-owned bit can collide in MP6
because interpreter origins are only `{playerId: 0}` / world-context →
DEFAULT_PLAYER (verified by grep — remote event origination is MP8) ·
validation: three layers each reject their own garbage (protocol structural
`checkLoadouts`/`checkBattleCmds`/`checkDirective`/`checkIntent`, all-uint;
directives.ts semantic caps incl. `cmds.length ≤ yours.length`; battle.ts
`resolveCoopCmd` live-state fallback-to-guard, D-6-B-1's revive/living
re-check included).

**Semantics review — conforms:** A-6 (remote escape feeds ONE collective
`tryEscape` over the merged pool; failed local escape voids the co-op round
via `coopTurnLost`; failed collective escape voids all commands, enemies
act) · A-7 (1-HP revive under `coop`, result still `"lose"`, suppression at
both callsites) · A-8 (rewards after the classic sequence, `activeParticipants`
order = trigger-first join order; full EXP/gold each; end frames via
`queueBattleEvent` per addressee, local player never queued) · A-10
(participants-only; `applyRemoteIntent` blocking gate inert pre-MP6) ·
D-6-1 (loadouts from each client's own `G.party`, rebuilt from the SHARED
project via `makeActor` + clamps; end frames applied to each client's own
`G` with zero client draws; items decrement owner-side only, B-4).

**Deferrals CONFIRMED as intended boundaries:** D-6-0 (battles on the
MP4-local authority; relay battles → MP8·A — `server/` untouched by MP6),
D-6-5 (party intents decode fuzz-safely, MP5 `translateIntent` drops them),
D-6-6 (co-op forces `battleSystem = "turn"`; ATB/CTB idle-poll redesign
belongs to MP8's headless battles), D-6-8 (raw-EXP co-op; exact for
Atlas-native rate-1 projects), D-6-B-3 (allies carry no idx in the view;
cross-participant support targeting → post-2.0 ledger).

**Non-blocking forward notes (for MP8·A):**

1. `world.blocking` is a plain per-player Set, not a refcount. Safe in MP6
   (only battles ever block remote pids). When MP8 adds remote event
   ORIGINATION, an event-owned block and a battle block can land on the same
   remote pid and the first teardown clears both — refcount it or exclude
   battle/event overlap in the per-zone runtime.
2. `battleCmd`'s `ally` is any uint merged idx at the wire; the UI can only
   target your own battlers (B-2), but a hand-crafted reply could cross-heal
   another participant's (or the host's) battler. Benign — help-only, no
   draw deviation, no crash — under the MP6-local same-machine trust model;
   tighten to own-battler idx server-side when MP8 moves loadouts into
   passport-keyed player records.
3. `applyBattleEnd` writes battler frames back by loadout order = the front
   of `G.party` at end time; a client reordering its own party mid-battle
   (formation) would land hp/mp on a sibling actor of the same player.
   Same trust model; MP8's server-side loadouts key by actorId anyway.
