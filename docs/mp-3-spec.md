# Phase MP3 Spec — Interpreter Presentation Directives ("Project Beacon")

**Status:** stage A landed 2026-07-19 (Fable); **stage B landed 2026-07-19
(Opus)**; next: the Fable phase gate + tag `beacon-3`.
**Authored:** 2026-07-19 by Claude Fable 5 (stage A build), from the MP3 section
of `docs/MULTIPLAYER_ROADMAP.md` + `docs/mp-0-spec.md` §C3/§C4/§C6 +
`docs/mp-2-spec.md`.
**Workflow:** commit + push each stage to `main`; the frozen pixel goldens stay
**byte-identical at every stage**; log deviations here.

## Branch-point answer (asked before stage A, per the roadmap ❓)

**Shared-map cutscene pause semantics — Driftwood chose: PARTICIPANTS ONLY**
(the roadmap default, confirmed 2026-07-19). A cutscene-grade event (autorun,
screen fade, forced movement, modal message) pauses exactly the players
participating in it; everyone else on the map keeps playing and sees the
event's world effects. Solo play pauses exactly as today, no matter what.
Stage A lands the structure: `world.blocking` is a per-player **set**, every
interpreter run carries an origin, and directives target `participantsOf`
that origin — solo resolves everything to the one default player, which is
what keeps the goldens byte-identical.

## Objective

The trickiest surgery: modal event commands stop touching UI directly.
A world-side command handler asks the **presentation port**; the port emits a
protocol `directive` frame to the target player's client over the (loopback)
transport; the client renders it with the engine's existing message/ui-stack/
shop code and answers with a `reply`; the world validates the reply and
resumes the suspended interpreter. Waits are world-tick timers (they already
were — MP0 discovery B1; stage A moves the timer *functions* into the sim).

```
 handler ──ask──▶ PresentationPort ──emit──▶ {t:"directive",id,…} ──▶ Transport
    ▲                (sim/directives)                                    │ (sync in loopback)
    │ resume (validated value)                                           ▼
 deliverReply ◀── {t:"reply",id,value} ◀── directive-renderer ◀── ClientSession
 (validate: lifecycle + semantics)         (message/ui-stack/shop UI)
```

---

## Stage A — Directive engine + worked pattern (Fable, landed 2026-07-19)

### What landed

- **`src/shared/sim/directives.ts`** (NEW, headless) — the directive engine:
  - `InterpOrigin` (§C6 player/world contexts) + `participantsOf(world, origin)`
    (player context → its player; world context → the map's participants — the
    one default player until MP4 builds rosters; missing origin → solo player,
    defensively).
  - `world.blocking: Set<number>` helpers `beginBlocking`/`endBlocking`/
    `isBlocked` — the participants-only pause structure.
  - Lifecycle: `emitDirective` (per-world monotonic id; pending registered
    **before** send so a synchronous loopback reply always finds it; a world
    with **no send installed** resolves immediately with the escape value so a
    clientless/headless world can never hang), `deliverReply` (three-layer
    validation per §C3.2 — stale/duplicate/foreign ids and semantically
    invalid values are dropped **and counted**, and the pending survives a
    hostile frame), `validateReplyValue` (per-kind semantics: choice range +
    cancelable, digit bound, name length, transcript shape/cap),
    `escapeValueOf` (the §C3.4 table), `autoResolveDirectivesFor`
    (disconnect path — never called in solo).
  - `createPresentationPort(world)` — the handler-facing surface
    (`message`/`choices`/`numberInput`/`nameInput`/`shop` + the `localEcho`
    posture readthrough). Multi-target emit joins on all replies (§C3.1); the
    answering value is the origin player's.
- **`src/shared/sim/timers.ts`** (NEW) — `waitTicks`/`tickTweenTicks`/
  `pumpTickTimers`, the map scene's timer engine moved verbatim onto the world
  parameter (the LIST moved at MP1·B; now the functions are sim-owned so a
  headless server interpreter can wait). `scenes/map.ts` re-exports
  `waitFrames`/`tickTween` bound to `defaultWorld` — every engine caller
  byte-identical.
- **`src/shared/sim/world.ts`** — `blockingRun: boolean` became
  `blocking: Set<number>`; new `directives: DirectiveState` (runtime-only,
  never snapshotted). `engine-context.ts` keeps `ctx.blockingRun` as the
  **aggregate accessor** (read: "anyone blocked?"; write: bind/clear the
  default player) so every legacy reader/writer, plugins included, is
  byte-identical.
- **`src/engine/interpreter/interp.ts`** — `Interp` carries
  `origin: InterpOrigin` (4th ctor param; default = the solo player context,
  so battle common events, script API and plugin constructors keep their
  player-facing behavior unchanged).
- **`src/engine/scenes/map.ts`** — every trigger site names its context:
  action/touch/tap/HUD → `PLAYER_CTX`; autorun (map + common), parallels,
  timer-expiry → `WORLD_CTX`. `runEventBlocking`/`runCommonEventBlocking`
  take the origin and manage the blocking set via `participantsOf`. The two
  parallel re-arm beats (`sleep(50)`) became **`waitFrames(3)`** — world-side
  scheduling now counts world ticks (3 = the old 50 ms at 60 Hz), never wall
  clock. That was the last wall-clock wait in world logic (see D-A2).
- **`src/engine/net/world-host.ts`** — installs the world's outbound directive
  `send` at construction; routes inbound `reply` frames to `deliverReply`.
  Replies are deliberately **un-buffered** (unlike intents/A2): resuming a
  suspended interpreter continues an already-running async event in the same
  microtask chain — the solo engine's exact dismiss→resume timing — and
  cannot re-enter the tick.
- **`src/engine/net/client-session.ts`** — server `directive` frames dispatch
  to an injected `DirectiveRenderer` (bound by boot, like the tick fn, so
  `src/engine/net/` stays off the DOM graph) and answer with `reply`.
- **`src/engine/scenes/directive-renderer.ts`** (NEW) — the client half: one
  function renders any directive with the EXISTING UI (message system,
  ui-stack choice window, input scenes, shop scene) and returns the reply
  value. All five kinds implemented, so stage B converts handlers only.
- **`src/shared/net/protocol.ts`** — `MessageDirective` gains additive
  `background?: "window"|"dim"|"transparent"` (RM 101's third option, missed
  at MP0); `MESSAGE_POS_NAMES`/`MESSAGE_BG_NAMES` map RM's numerics ↔ the
  kid-readable wire names losslessly at both seam ends. `checkDirective`
  validates it; round-trip + rejection tests added. No version bump (additive
  optional field, per the protocol's own rule).
- **Converted handlers (the worked pattern):**
  - `text` (flow.ts) → `services.presentation.message(interp.origin, {...})` —
    raw `c.text`/`c.name`/`c.face` values pass through; numeric
    background/position normalized to wire names only when present, so the
    client's own defaults apply exactly as before.
  - `choices` (flow.ts) → `presentation.choices` → runs the picked branch.
    `richText` now runs client-side at render (same module, same tick, same
    values in loopback).
  - `shop` (combat.ts) → `presentation.shop` with `services.wireShopGoods`
    (db-priced wire goods); the reply transcript is applied via
    `services.applyShopTranscript` **only when `localEcho` is false** (A-4).
  - `wait` — handler untouched; its `services.waitFrames` now bottoms out in
    the sim timer engine. The Wait "conversion" was a move, exactly as MP0
    discovery B1 predicted.
- **`src/engine/scenes/shop.ts`** — `Shop.run` gains an optional per-line
  transcript recorder (mutations untouched — recording only, capped at
  `MAX_SHOP_TRANSACTIONS`); new `wireShopGoods` + `applyShopTranscript` (the
  WORLD-side A6/C3.2c replay: every line re-validated against authoritative
  goods/db-prices/wallet/inventory, illegal units voided; never called in
  loopback).
- **boot.ts** — `presentation: createPresentationPort(soloHost.world)` +
  `wireShopGoods`/`applyShopTranscript` join EngineServices;
  `soloClient.setDirectiveRenderer(renderDirective)` at the composition root.
  `solo-session.ts` sets `directives.localEcho = true` (the A4 posture).
- **Tests** — `tests-unit/net-directives.test.ts` (+14: lifecycle over the
  real loopback pair + WorldHost/ClientSession, id monotonicity, clientless
  escape, pending concurrency, hostile-reply matrix, escape table,
  auto-resolve, participants/blocking, port surface);
  `tests-unit/sim-timers.test.ts` (+5); net-protocol +2 (background);
  sim-world updated to the blocking-set/directive-state reality;
  `tests/interpreter.test.js` re-pinned to the port contract (text origin +
  wire-name mapping + absent-field omission, choices branch selection, shop
  localEcho fork). vitest **1037 → 1058**.

### Design decisions (stage A)

- **A-1 — Resume timing refines §C3.3 (byte-identity wins).** C3.3 said the
  interpreter "continues on the next world tick"; implemented, a validated
  reply resolves the pending promise **immediately, in the same microtask
  chain**. In loopback the whole dismiss → reply → resume path is one
  synchronous/microtask chain — the solo engine's exact timing, which is what
  keeps the goldens byte-identical (deferring to the next tick would shift
  every post-modal command by up to a frame). Server-side this is equivalent
  to "before the next tick", and D1 (server-authoritative, no lockstep) means
  no cross-client ordering constraint is lost.
- **A-2 — Pending concurrency refines §C3.5.** "One pending directive per
  player" is per-INTERPRETER (sequential by construction), not per-player: a
  parallel event can legally open a message while a blocking event's message
  is up — today's engine stacks both boxes, and byte-identity wins. Pendings
  are keyed by id; replies route by id; MP5 adds a per-player pending cap as
  a hostile-event guard.
- **A-3 — The renderer is injected, the port is a service.** Command handlers
  reach the port ONLY through `services.presentation` (the established
  services discipline — node tests stub it, no engine imports in command
  modules); the client renderer reaches `ClientSession` only through
  `setDirectiveRenderer` at boot (the setTickFn pattern), so
  `src/engine/net/` stays off the DOM graph.
- **A-4 — The shop's loopback fork is the localEcho flag, decided by the
  composition.** The shop UI legitimately mutates its local view per line
  (session display, affordability gating). In loopback the local view IS the
  world (MP2·A A4) — those lines are already the authoritative writes,
  byte-identical to 1.x, so the reply transcript must not re-apply
  (`localEcho: true`, set where the by-reference wiring is made,
  solo-session.ts). A remote session (MP4/MP5) mutates only its mirror; its
  transcript is applied world-side by `applyShopTranscript`, re-validated
  line-by-line (A6/C3.2c) — node-tested now, exercised live at MP4.
- **A-5 — RM numerics ride the wire as names.** `position`/`background` are
  0/1/2 in command data; the wire carries `"top"/"middle"/"bottom"` and
  `"window"/"dim"/"transparent"` (kid-readable open protocol), mapped
  losslessly at emit and render; absent stays absent, so the message system's
  own defaults keep applying. NaN/garbage in old command data lands on the
  same rendering it always did (bottom/window).
- **A-6 — The blocking set lands now, the roster later.** The engine's gates
  still read the aggregate (`ctx.blockingRun` accessor) because per-player
  gating of update paths is meaningless before MP4's multi-player entities;
  but the state, the helpers, and every begin/end site are already
  participant-keyed, so MP4 swaps `participantsOf`'s world-context arm for
  real map rosters and the pause semantics Driftwood picked fall out.
- **A-7 — Directive/broker state is runtime-only.** Pending directives are
  promises; they are never snapshotted (a solo save can't happen mid-modal;
  a server reconnect re-runs nothing — C3.4 auto-resolve covers the player
  side). `world.directives`/`world.blocking` stay off every future
  snapshot shape.

### Deviations / discoveries (stage A)

- **D-A1 (protocol amendment):** `MessageDirective` lacked the RM 101
  `background` option (MP0 typed `pos` only). Added additively +
  `checkDirective` + tests; no `PROTOCOL_VERSION` bump (additive optional
  field per the protocol's own evolution rule).
- **D-A2 (audit correction, small):** MP0·B's "exactly five `sleep()` sites,
  all presentation pacing" missed the two **parallel re-arm** beats in
  map.ts (`sleep(50)` after a parallel event/common event finishes) — those
  are world scheduling. Converted to `waitFrames(3)` (= 50 ms at 60 Hz);
  full Playwright confirms goldens byte-identical (steady-state timing is
  the same tick; the conversion removes a wall-clock nondeterminism source
  from the future headless server). The remaining five sites are genuinely
  presentation pacing (battle sting/ATB poll → MP6·A, transfer fade beats +
  fadeTo, message typewriter) and stay client-side.
- **D-A3 (verification):** the committed `message-parity` e2e already drives
  the converted `text` handler end-to-end in the live player (parallel event
  → message with escape codes → dismiss → input scene → follow-up message
  "Got 1") — its pass proves emit→render→reply→resume across the loopback in
  a real browser. Choices + shop were verified with a throwaway spec
  (deleted): choice window → pick branch → real shop scene opens → leave →
  follow-up message renders — interpreter resumed across every reply.
- **D-A4 (for stage B):** `selectItem` is modal but has **no directive kind**
  in protocol v1 (MP0 typed five). Stage B should add an additive
  `selectItem` directive (`{kind:"selectItem", itemType}` / reply
  `{id: number}`, 0 = canceled, world validates the id is owned & of the
  right type) following the D-A1 pattern — or document a deliberate defer.

### Stage A gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1058** (68 files; +21: net-directives 14 · sim-timers 5 · net-protocol 2) |
| node --test | **46** (interpreter suite re-pinned to the port contract) |
| cargo | **26** (Rust untouched) |
| Playwright | **123/123** (3.0m) — pixel goldens byte-identical; renderer-perf 246.29 ms/frame (budget 300; beacon-2 full-suite 246.10) |
| eslint / tsc | **0 / 0** — sim wall re-proven to FIRE on an engine-import probe (deleted) |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none needed (no `?v=` file touched) |
| i18n | no player-facing strings added (plumbing only) |

---

## Stage B — Remaining handler conversions (Opus, work order)

Convert the remaining modal/timed command handlers to the stage-A pattern —
`services.presentation` + `interp.origin`, node tests per handler, goldens
byte-identical after every commit. The audio-deck import trap stands (no
command module or converted path may import audio-deck; audio flows stay
client-side services).

1. **`inputNumber`** (flow.ts) → `presentation.numberInput(origin, {digits})`;
   store the validated reply in the variable. Renderer arm already live.
2. **`nameInput`** (flow.ts) → world-side computes the current name →
   `presentation.nameInput(origin, {maxLen, initial: current, actorId})`;
   write `member.name` from the reply (keep the "empty keeps the old name"
   behavior exactly).
3. **`selectItem`** (flow.ts) → needs the additive directive kind (D-A4), or
   a documented defer.
4. **`interp.ts` dialogue path** — `callDialogue`'s direct
   `EngineServices.showMessage`/`showList` calls become port calls with
   `this.origin` (same worked pattern; watch the speaker/portrait/voice
   argument passthrough — byte-exact values).
5. **`scrollText`** (presentation.ts) — modal scrolling text; convert if it
   awaits UI directly (else document why not).
6. **Timed presentation commands** (cameraZoom/shake/flash/tint/movePic/
   scrollMap/balloon/weather…): already tick-based via `services.waitFrames`/
   `tickTween` → no directive needed; verify none calls UI/DOM directly and
   note each in the conversion table here. Their per-player nature-2 split is
   MP4, not MP3.
7. **Out of scope:** `battle` (MP6 owns battle directives), menus/save UI
   (client flows; §C5 verbs are the MP2-defined intents), `se`/`music`/…
   (audio = client, logical state already in G).

Log every handler in a conversion table (command · directive kind · node test
· notes), stage-B gate snapshot, then end the conversation with the MP3 GATE
block from the roadmap.

### What landed (stage B, Opus, 2026-07-19)

Every remaining modal/timed command that awaited UI now goes through
`services.presentation` with `interp.origin`; the two commands that were still
UI-shaped but had no directive kind (Select Item, Show Scrolling Text) got
additive kinds following the stage-A D-A1 pattern; the timed-presentation family
was audited and confirmed directive-free by construction. No new engine
behavior — the client renders each directive with the same scene it always did,
and in loopback the whole emit→render→reply→resume chain is synchronous, so the
frozen goldens stay byte-identical.

- **`src/shared/net/protocol.ts`** — two additive `Directive` kinds +
  their replies + strict decoders:
  - `SelectItemDirective` `{kind:"selectItem", itemType?}` / reply
    `{kind:"selectItem", id}` (0 = nothing chosen / canceled). `itemType` is
    RM's category number, informational (Atlas has one item bag).
  - `ScrollTextDirective` `{kind:"scrollText", text, speed?, noFast?}` / reply
    `{kind:"scrollText", done:true}` — modal like Show Message (a completion
    ack, no value).
  - `checkDirective`/`checkReplyValue` extended; **no `PROTOCOL_VERSION` bump**
    (D-B1). Round-trip + rejection tests added.
- **`src/shared/sim/directives.ts`** — `escapeValueOf` (selectItem→id 0,
  scrollText→done), `validateReplyValue` (selectItem id bound, scrollText done),
  and `PresentationPort.selectItem`/`.scrollText` on `createPresentationPort`.
  Still headless (sim wall holds).
- **`src/engine/scenes/directive-renderer.ts`** — two new arms: `selectItem`
  calls the existing `selectItemScene()` (unchanged, one item bag), `scrollText`
  calls the existing `showScrollText(...)` driven by the same client `frameWait`
  (imported from `scenes/map.ts`, the exact source the old handler passed as
  `services.frameWait`).
- **`src/engine/interpreter/commands/flow.ts`** — `inputNumber` →
  `presentation.numberInput(origin,{digits})` (initial 0 = the renderer default,
  byte-identical to the old `numberInput(digits, 0)`); `nameInput` → world
  computes the current name and sends it as `initial`, writes `member.name` from
  the reply behind the unchanged `&& name` empty-keeps-old-name guard;
  `selectItem` → `presentation.selectItem(origin,{itemType})`, with the pick
  re-validated against authoritative inventory (`services.ownsItem`) **only when
  `!localEcho`** (loopback trusts the client's by-reference read — the shop's
  A4/localEcho fork, applied to a read instead of a write).
- **`src/engine/interpreter/commands/presentation.ts`** — `scrollText` →
  `presentation.scrollText(origin,{text,speed,noFast})`; the `showScrollText`
  import is gone (it moved to the renderer), so this command module no longer
  imports the DOM-overlay function.
- **`src/engine/interpreter/interp.ts`** — `callDialogue`'s two
  `EngineServices.showMessage` calls and its `showList` call become
  `EngineServices.presentation.message`/`.choices(this.origin, …)`, exactly like
  the `text`/`choices` command handlers. Speaker/portrait/voice pass byte-exact;
  the option strings ride the directive and `richText` runs client-side at
  render. `se` voice cues still fire through `this.exec({t:"se"})` unchanged.
- **`src/engine/boot.ts`** — the three input-scene services
  (`numberInput`/`selectItem`/`nameInput`) are retired from `EngineServices`
  (their scenes are reached only through the renderer now); new `ownsItem`
  service (`invCount(kind,id) > 0`) backs the selectItem re-validation.
- **Tests** — node `interpreter.test.js`: the M2·B input block re-pinned to the
  port (origin + digits/maxLen/initial passthrough, empty-name-keeps-old,
  selectItem remote void/keep), a new scrollText block (arg normalization +
  defaults); `dialogue-workspace.test.js`: stub swapped from
  showMessage/showList to the presentation port (drives the real converted
  `callDialogue`); vitest `net-directives` (escape table + semantic matrix +
  port surface for both kinds) and `net-protocol` (round-trips + rejections for
  both kinds). vitest stays **1058** (assertions added inside existing
  `it` blocks, no new files); node **46**.

#### Conversion table

| Command (module) | Directive kind | Node test | Notes |
|---|---|---|---|
| `inputNumber` (flow.ts) | `numberInput` (A) | interpreter.test.js + **message-parity.spec.mjs** (live) | origin + `{digits}`; initial 0 = renderer default. Driven end-to-end in the browser by the committed e2e (text → inputNumber → "Got 1"). |
| `nameInput` (flow.ts) | `nameInput` (A) | interpreter.test.js | world computes current name → `initial`; empty reply keeps old name (unchanged `&& name` guard). |
| `selectItem` (flow.ts) | **`selectItem` (NEW, D-B1)** | interpreter.test.js | `itemType` informational; world re-validates ownership via `ownsItem` when `!localEcho`; loopback keeps the raw pick. |
| dialogue lines + choices (interp.ts `callDialogue`) | `message` + `choices` (A) | dialogue-workspace.test.js (+ .spec.mjs) | speaker/portrait/voice byte-exact; option strings ride, `richText` client-side; non-cancelable → reply always a valid index. |
| `scrollText` (presentation.ts) | **`scrollText` (NEW, D-B2)** | interpreter.test.js | modal like message; completion-ack reply; same `showScrollText` overlay + client `frameWait`. |
| `cameraZoom`,`shake`,`flash` (presentation.ts) | — none | interpreter.test.js (`shake`) | mutate `services.ctx` scalars; `wait` polls `services.frameWait`/`tickTween`. No DOM. |
| `showPic`,`movePic`,`rotatePic`,`tintPic`,`erasePic`,`tint`,`timer`,`scrollMap`,`balloon` | — none | interpreter.test.js (presentation block) | world-state writes on the presentation runtime, advanced by `updatePresentation()`/`tickTimer()`; `wait` variants poll `services.frameWait`. No direct DOM. |
| `playAnim` | — none | — | timed effect via `services.playMapAnimation`/`battleEnemyOps`; awaits a frame-based `done`. No DOM. |
| `weather` | — none | — | non-modal fire-and-forget; reaches `window.Atlas.weather(…)` directly (guarded). The **only** item-6 command that touches a client global — flagged D-B3 for MP4's presentation-effect channel, not a directive. |
| `se`,`music`,`bgs`,`me`,`saveBgm`,`resumeBgm`,`stopSe`,`jingle` | — none (client audio) | interpreter.test.js | out of scope (item 7): logical state in G; audio via `services.Sfx`/`Music`/`AudioDeck`, never an `audio-deck` import. |
| `battle` | — (MP6) | — | out of scope: MP6 owns battle directives. |

### Design decisions (stage B)

- **B-1 — selectItem re-uses the shop's localEcho fork, on a read.** Select
  Item makes no world write — it returns an id the game stores in a variable.
  In loopback the client reads the world's own item bag by reference (localEcho,
  MP2·A A4), so the pick is already authoritative and the raw id stands
  (byte-identical). A remote session (MP4/MP5) reads its mirror, so the world
  re-validates the returned id against authoritative inventory (`ownsItem`) and
  voids an unowned pick to 0 — the same A6/C3.2c posture as `applyShopTranscript`,
  reduced to a clamp because there is nothing to apply. Node-tested now,
  exercised live at MP4.
- **B-2 — Scrolling Text is modal, so it is a directive, not a wait.** Its
  duration depends on the text height *and* the player's hold-OK speed-up /
  Cancel-skip, which are client-side — the world cannot count ticks for it, it
  must await the client's completion, exactly like Show Message's dismissal.
  So it becomes a directive whose reply is a completion ack, and the world-side
  handler stops importing the DOM-overlay `showScrollText` (which now lives only
  in the renderer). This is the one presentation-runtime command that built and
  awaited a DOM overlay; every other member mutates tick-advanced state.
- **B-3 — The timed presentation family needed no directives, by
  construction.** Pictures, tint, timer, map-scroll, balloons, camera zoom,
  shake and flash are all "advance a mutable scalar/tween in update()" world
  state (MP0·B nature 2) — the command handler writes the target, the client's
  per-tick `updatePresentation()`/`tickTimer()` advances it, and the `wait`
  variants poll a `busy()` predicate through `services.frameWait`. None awaits
  a modal reply and none touches the DOM in the command handler. Their
  per-player split (whose screen shakes) is MP4's nature-2 work, not MP3's.
- **B-4 — The dialogue path is the `text`/`choices` handlers, inlined.**
  `callDialogue` predates the command registry (it is an `Interp` method that
  walks a dialogue graph), but its line/choice rendering is identical to the
  `text`/`choices` commands, so it converts to the same port calls with
  `this.origin`. The dialogue's choice options are objects (`{text, nextId}`),
  so the handler passes `option.text || "Choice"` strings and lets the
  renderer's `richText` run client-side — byte-identical to the old
  `showList(map(richText(option.text || "Choice")))`.

### Deviations / discoveries (stage B)

- **D-B1 (protocol amendment — the D-A4 pickup):** `selectItem` was modal with
  no directive kind (MP0 typed five; D-A4 flagged it). Added the additive
  `selectItem` directive + reply following D-A1. **No `PROTOCOL_VERSION` bump.**
  Nuance worth the gate's eye: unlike D-A1 (an optional *field*, which an older
  decoder forward-accepts), a new directive *kind* is *rejected* by an older
  decoder. This is safe because protocol v1 has never shipped to any external
  party (multiplayer is unreleased; it first ships as the single 2.0 build,
  D7), the `hello`/`welcome` handshake guards cross-version mismatch once it
  does, and the roadmap's D-A4 note explicitly says to follow "the D-A1
  pattern" (which did not bump). If the gate prefers a bump, it is a one-line
  change — but the pre-release + single-build reasoning says v1 keeps absorbing
  additive kinds until 2.0 freezes it.
- **D-B2 (protocol amendment):** `scrollText` directive + reply added (same
  no-bump reasoning as D-B1). See B-2 for why it is a directive.
- **D-B3 (audit finding, `weather`):** the item-6 sweep confirmed every timed
  presentation command is directive-free by construction *except* that
  `weather` reaches `window.Atlas.weather(…)` directly (a guarded global, a
  no-op where the hook is absent). It is non-modal fire-and-forget, so it is
  **not** a directive candidate; but it is the one presentation command that
  still references a client global from the world-side handler. Left as-is for
  MP3 (out of the modal-conversion scope) and flagged for MP4, which needs a
  per-player presentation-effect broadcast channel (whose screen sees the
  weather) — `weather` rides that channel with the rest of the nature-2 split.
- **D-B4 (services cleanup):** the `numberInput`/`selectItem`/`nameInput`
  EngineServices entries are retired — the scenes are now reached only through
  the renderer, so keeping the direct services would be a second, unused path
  to the same UI. `ownsItem` is the one new service (backs B-1).

### Stage B gate snapshot (all green, 2026-07-19)

| Gate | Result |
|---|---|
| vitest | **1058** (68 files; net-directives + net-protocol extended in place — assertions added, no new files) |
| node --test | **46** (interpreter input block re-pinned to the port + scrollText block; dialogue-workspace stub → port) |
| cargo | **26** (Rust untouched) |
| Playwright | **123/123** (2.8m) — pixel goldens byte-identical vs beacon-2; `message-parity.spec.mjs` drives the converted `inputNumber` end-to-end in the live browser (text → Input Number scene → "Got 1", zero console errors); renderer-perf all-features 1080p 240.36 ms/frame (budget 300; beacon-2 full-suite 246.10, stage A 246.29 → within ±10%) |
| eslint / tsc | **0 / 0** |
| versions / FORMAT_VERSION / cache-busts | 1.2.0 · 2 · none needed (no `?v=` file touched — plumbing only, no player-facing strings) |
| i18n | no player-facing strings added |

---

## Phase gate (Fable, after B)

Template gates + goldens byte-identical vs `beacon-2` + all interpreter suites
green. Audit: sample 10 converted handlers vs git history for behavior drift;
verify no handler imports audio-deck or DOM; verify wall-clock sleep is gone
from world-side waits (D-A2's two conversions included). Verdict recorded here
+ roadmap status table; tag `beacon-3`.
