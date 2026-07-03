# Phase 5 Spec — Gameplay Systems

**Status:** COMPLETE (Stages A–D, 2026-07-02). Stage log below, newest first.

Stage D COMPLETE (2026-07-02): player-facing systems — phase exit.
**HUD** `src/engine/hud.ts` (one per-rendered-frame `updateHud()` from
render-glue's top — before the title early-return so it hides off-map):
corner **minimap** (`system.minimap`, per-map `map.minimap === false`
opt-out; lowerBuf downscaled once per map object + live dots: events faint
blue, parked vehicles bright blue, player gold-on-dark) and the **quest
tracker** (first 3 active visible quests via `Quests.objectiveDisplay`,
rebuilt only when a cheap signature changes, `.flash` on updates). New
**"hud" input action** (RA.INPUT_ACTIONS + defaults KeyM / pad select —
tests/input.test.js pin updated; mergeInputBindings backfills old projects),
toggled in map update, persisted `playerOptions.hudHidden`. **Options ▸
Fullscreen** row (web Fullscreen API, catch()ed). **Day/night gameplay**:
`timeBandOf(hour)` (morning 5–10 / day 10–17 / evening 17–21 / night 21–5)
in map-runtime; `EventPage.cond.timeBand` gates pages (pageActive) with a
band-change edge in map.update() calling refreshAllPages; `Condition
kind:"time"` `{from,to}` wrap-around clock window (if-command + graphs);
`encounters.byTime.night` pool (region pool still wins). Editor: System-tab
minimap checkbox, Map Properties night-pool rows + "Show on the minimap",
event-editor Time-of-day page condition (badge counts it), if-form Time of
Day kind + summary. Verified live (screenshot: minimap with building/road/
pond pixels + gold player and blue boat dots, tracker "Market Introduction ▸
Report to the merchant"; M toggles off/on; noon → "Default page", 23:00 →
night page "The shop is CLOSED" flipping live via the band edge; zero
console errors) + new player e2e (minimap size, tracker text after
startQuest, M toggle). `data.js?v=27`, `play.css?v=22`,
`patch-notes.js?v=16` (+shim), patch note, wiki (The-Database system rows,
Events page conditions + if-cond). Full gate green — see acceptance run in
the merge commit: tsc, eslint, node --test (16), vitest (146), Playwright
**34/34** (goldens byte-stable).

**Phase deviations from the plan (accumulated):** ATB ships wait-flavor only
(`atbWait` reserved); troop pages are command-list-only (graphs stay
page-local to events); the in-game **rebinding screen already existed**
(Phase 1 options menu) so Stage D added fullscreen + the hud action instead
of rebuilding it; enemy rows deferred (party-only rows); flipbook sheets
beyond "icons"/URLs wait for Phase 6 importers as planned.

Stage C COMPLETE (2026-07-02): movement & world. **A\*** `src/shared/
pathfind.ts` (pure; injected passability oracle, binary heap, FIFO tie-break
→ deterministic, node budget, `near` best-effort mode; emits route-native
step strings; 9-test vitest suite). **Touch-to-move**: canvas pointerdown →
`handleMapTap` (map.ts) — stage-rect → camera-inverse → tile; A\* (near,
budget 800) → `setRoute` with `route.touch` (any directional press cancels;
a blocked step cancels instead of skipping); tapping an action event's tile
walks adjacent, faces, triggers. **Followers** (`system.followers`):
G.followers records from party[1..] + a breadcrumb trail unshifted in
`startMove` (player only) — follower i heads for crumb i, ghost-through, one
lazy party-size resync per tick; snapped by transfers/new game/load;
rendered via render-glue drawables (HD sprite ids fol_N/veh_T — the old
`"ev_"+d.ev.id` would crash on them). **Vehicles** (`system.vehicles` +
3 new procedural object charsets boat/ship/airship APPENDED to assets.js
OBJECTS — append-only keeps charsetIndex stable): board = action key facing
(or standing on), swaps the player charset/kind ("object" bobs), terrain
fork `playerStepPassable` (boat = bare shallow water, ship = any bare water,
airship = anywhere; decor blocks hulls), disembark ahead (airship: on the
spot) onto land-passable; positions live in `G.vehicles` + `G.vehicle`
(NEW save-payload fields, absent-tolerated), music optional ("none" =
keep). **Jump/ledge**: `startJump/updateJumpMotion` (arc through ry so both
renderers + depth sort see it), route step "jump" (2→1→0 fallback), ledge =
`passOv 3` (blocked for walking incl. NPCs; player walking in auto-jumps
over when the far tile is clear; pass-mode click cycle now auto→block→pass→
ledge with a ⌒ glyph — tests/editor-playtest-sync source-pin updated for
the third overlay mode). **Regions**: `map.regions` painted in a new
editor **Region mode** (toolbar/Mode menu/Tab-cycle; digits + -/= set id
0–63, right-click picks, fill/pen/erase; hued overlay with ids; resize +
random-map generators keep the array), `encounters.byRegion` pools (Map
Properties rows; roll swaps pool when the player's tile region has one),
`Condition kind:"region"` (if-command + graphs; evaluated inline in interp
via ctx.map). Verified live on the dev server (screenshot: pond + boat
object + follower trailing; click-to-move 4 tiles exact; near-mode walk to
pond edge; board→sprite swap→water-clamped sail→disembark; ledge hop both
ways; region tiles rolled the Bat pool while default tiles rolled slimes;
zero console errors) + new region-paint editor e2e. `assets.js?v=14`,
`patch-notes.js?v=15` (+shim), patch note, wiki (Maps-and-Tiles: passability
ledges + movement upgrades + regions; Events: jump step + region cond;
The-Database: system rows). Full gate green: tsc, eslint, node --test (16,
one source-pin updated), vitest (**146**), Playwright **33/33** (goldens
byte-stable — vehicle charsets append-only, sample project untouched).

Stage B COMPLETE (2026-07-02): battle v2. The per-command resolution body of
the Phase 1 round loop was extracted VERBATIM into `resolveAction(c)`
(anchor-scripted move: outer continue/break → return; the round loop calls
it — turn mode is behavior-frozen, existing tests untouched). New pure module
`src/engine/scenes/battle-logic.ts` (rows, condition-weighted AI, troop-page
conditions/spans, ATB/CTB scheduling — rng/state injected, 17-test vitest
suite). **Modes** (`system.battleSystem`, System-tab select): turn (default,
frozen) · **atb** — per-battler gauges fill with `atbRate(agi)·8` per 30 ms
tick to ATB_FULL=6000 (≈¾ s per refill), wait-flavor (fill pauses during
command input; `atbWait` reserved), gauges rendered on party rows + under
enemies (recreated after every refreshParty — it rebuilds rows) · **ctb** —
`ctbForecast` (pure, deterministic, lower-index tie-break) drives one act at
a time + an 8-chip turn-order strip (`.ctb-order`, `.now` highlight).
Both timed modes: guard persists until the battler's next act; a "turn" =
one act per living battler (tickStates + turnNumber at the boundary).
**Troop battle events**: `troop.pages[] {cond{turn a+b·x, enemyHpBelow
{index,pct}, actorHpBelow{actorId,pct}, switchId}, span battle|turn|moment
(moment = edge-triggered), commands}` checked at battle start, after every
action, and at turn boundaries; fire = `new Interp(null).runList` while the
loop pauses (battle.ts now imports Interp — safe, no cycle). Empty/zeroed
cond never fires (editor backfills zeroed blocks). Troops tab: page strip +
cond form + the shared cmdListWidget (graphs NOT on troop pages — command
lists only). **Enemy AI**: `EnemyAction.cond {always|turn a+b·x|hpBelow|
hpAbove|random|stateSelf}` filters rows before the existing weighted roll
(absent = always, empty ⇒ basic attack); per-row cond editor in the Enemies
tab. **Rows**: `actor.row`/party-record `row` (makeActor defaults "front"),
back row = physical dealt & taken ×0.75 (`applyRowScale` no-ops at scale 1 —
pre-Phase-5 damage byte-identical), enemy targeting weights front 3:1
(uniform when all-front), ▽ marker in party rows, **Formation** pause-menu
entry (index 4; Journal…To-Title shifted +1). **skill.commonEventId** runs
after party skill resolution (offense + heal paths). Verified live on the
dev server (ATB: gauges fill/pause, full battle to win; CTB: strip + troop
page fired turn-1 text mid-battle; turn mode + Formation toggle regression)
and by 2 new Playwright specs driving REAL battles per mode (Enter-spam on
.cmdwin/.targetwin; 90 s timeout). `editor.css?v=47`, `play.css?v=21`
(covers Stage A's missed bump too), `patch-notes.js?v=14` (+shim), patch
note, wiki (Battles-and-States: three systems, Formation, troop events, AI
conds). Full gate green: tsc, eslint, node --test (16), vitest (**137**),
Playwright **32/32** (goldens byte-stable). Deviation noted: ATB ships
wait-flavor only (`atbWait` schema field reserved; active-fill deferred).

Stage A COMPLETE (2026-07-02): the animation engine + timeline editor.
Schema: `AnimItem`/`BattleAnimation`, `Project.animations`, `Skill.animationId/
hits`, `Weapon.animationId`, `CmdPlayAnim` in the union; **FORMAT_VERSION 2**
(`RA._migrateV1toV2`: all Phase 5 backfills land at once — animations,
battleSystem/atbWait, followers, minimap, vehicles, per-map `regions`,
per-troop `pages` — idempotent, inert defaults; `newProject`/`newMap` mirror
them, and the sample ships 3 showcase animations wired to Fireball/Heal/
Power Strike). Runtime: `src/shared/battle-fx.ts` (moved verbatim from the
engine + two additive extensions: `fxPoint` accepts plain `{x,y}` points and
the pool is exposed via `spawn`/`release`; the engine path re-exports),
`src/shared/anim-player.ts` (flat-timeline player, injectable clock/scheduler
→ node-testable; ring/rain/spiral emitters, target/screen flashes,
projectiles, icon/sheet flipbooks over the shared pool; multi-target
fan-out), `src/engine/anim-glue.ts` (map fx layer under the uiLayer +
render-glue camera math at fire time; stage-local points so CSS scale never
enters), `playAnim` handler in presentation.ts (services.playMapAnimation;
no-op off-map). Battle wiring: skill/weapon `animationId` plays the timeline
INSTEAD of castFx/travel/burst+Sfx (absent = legacy verbatim — turn-based
behavior frozen); `skill.hits` multi-hit loop; enemy skill animations too.
Editor: Database ▸ Animations tab (list scaffold + timeline strip with
draggable chips + item table + per-type forms + preview arena running the
REAL player), Battle-animation pickers on Skills/Weapons, Play Animation
CMD_DEF (auto-appears in list + graph pickers). Tests: 16-test vitest suite
(durations, anchors, fire order, fan-out, pool emitters, flipbook stepping,
completion timing) + editor e2e (samples listed, preview plays to completion,
new animation + item persists, skill picker wired). Verified live in a real
battle (dev server: startBattle → Fireball round: fx-anim-bolt projectile,
screen flash, shake, burst all sampled live; damage applied; win; zero
console errors) and in the editor preview arena. `editor.css?v=46`,
`data.js?v=26`, `patch-notes.js?v=13` (+shim), patch-note entry,
wiki (The-Database ▸ Animations, Events command table). Full gate green:
tsc, eslint, node --test (16), vitest (120), Playwright **30/30** (all 11
renderer goldens byte-stable).

**Branch:** `phase-5-gameplay` (off `main` after the Phase 4 merge)
**Architect & implementation:** Claude Fable 5 (roadmap assignment: "animation data
model, battle-mode architecture"; per the standing choreography note Sonnet is
excluded and all implementation runs at the Fable/Opus tier).

## Objective

Ship the roadmap's Phase 5: the gameplay systems that turn the engine from
"walks and talks" into a full JRPG toolkit —

1. **Animation engine + editor** — keyframed, data-driven skill/battle
   animations with a timeline editor, reusing the battle-fx particle pool.
2. **Battle options** — ATB/CTB battle modes beside the default turn-based
   loop, troop battle events (turn/HP-threshold pages), condition-weighted
   enemy AI, formations/row.
3. **Movement & world** — A* pathfinding (touch-to-move + smarter routes),
   party followers, vehicles (boat/ship/airship), jump/ledge movement,
   region tags driving encounters.
4. **Player-facing systems** — minimap, options-menu upgrade (rebinding,
   volume sliders, fullscreen), full gamepad menu coverage, day/night
   gameplay hooks, quest-tracker HUD polish.

Everything is **additive and save-compatible**: new schema fields are optional
or migration-backfilled, projects without them behave byte-identically to
Phase 4, and the renderer goldens must not change (no renderer code is
touched by this phase except where explicitly listed).

## Non-goals (whole phase)

- No renderer work. Battle stays the DOM scene; map rendering paths are
  unchanged (the minimap reads the existing prerender buffers; region paint
  is an editor overlay).
- No asset pipeline. Flipbook frames beyond what procedural assets provide
  wait for Phase 6 importers; the animation model carries an optional sheet
  slot so Phase 6 plugs in without a schema change.
- No full RPG-Maker action-sequence language. "Action sequences" ship as:
  per-skill animation + hit count + an optional battle common event (which
  can be authored as an Atlas Graph via a graph-authored map event calling
  it, and runs through the ordinary interpreter mid-battle). A battler
  choreography DSL is explicitly deferred.
- Turn-based battle behavior is FROZEN: with `battleSystem` absent or
  `"turn"`, the Phase 1 battle loop runs exactly as today (existing tests
  pin it).
- No netplay, no save-format version bump (additive fields only; saves
  tolerate absent fields both directions within FORMAT_VERSION 1→2 rules
  below).

---

## Current-state facts that constrain the design

1. **Battle is a self-contained async DOM scene** (`src/engine/scenes/battle.ts`):
   one `battleLoop` collects party commands, appends enemy actions, sorts by
   agility, resolves sequentially with `await say(...)` pacing. Its FX layer
   (`battle-fx.ts`) exposes `burst/floatText/pulse/travel/castFx` over a fixed
   84-node particle pool — exactly the primitive set the animation player
   needs; the animation engine wraps these, it does not replace them.
2. **The interpreter is context-free enough for battle events**: `new
   Interp(null)` already runs common events with no event runtime (the map
   scene does this); command handlers reach the engine through injected
   services. Battle events run command lists through the same path while the
   battle loop is paused between actions.
3. **`enemyAction()` is already a weighted pick** over `enemy.actions[]` —
   condition-weighting extends the row shape (`cond?`) and the filter step,
   with absent-cond rows behaving exactly as today.
4. **Movement is tile-locked with a per-entity route queue**
   (`map-runtime.ts`: `startMove/updateEntityMotion/setRoute/updateRoute`,
   steps are strings like `"up"`, `"wait15"`). A* emits exactly these step
   strings, so pathfinding plugs into the existing route machinery; the
   passability oracle is `tilePassable(x,y)` + `blockingEventAt(x,y)`.
5. **`G.player` is a plain entity record** made by `initPlayer`; followers
   are more entity records driven after the player in `update()`;
   `refreshPlayerCharset()` is the hook that keeps the lead actor's charset
   on the player — followers generalize it to party index i.
6. **Migration is versioned** (`RA.FORMAT_VERSION = 1`, ordered
   `RA.migrations`). Phase 5 adds **v2** with backfills for the new
   system/DB fields; the forward-compat guard already protects newer saves.
7. **Schema guard is warn-and-pass-through** (`src/shared/schema.ts`) — new
   collections get types + (where iterated hot) a validateProject warning,
   never a rejection.
8. **Input is action-based** (`js/runtime/input.js` via `createInputSystem`;
   per-action binding arrays in `system.input`, per-player overrides in
   playerOptions). Menu nav routes through `UIStack.top.onKey` — gamepad
   coverage is an audit of onKey handlers, not new plumbing.
9. **`G.timeOfDay` exists** (Phase 2 Stage D drives HD-2D lighting from it);
   Phase 5 only adds *gameplay* reads (conditions), no new clock.
10. **Gates:** `tsc --noEmit`, eslint, `node --test tests/`, `vitest run`,
    full Playwright suite; renderer goldens byte-identical. `css/editor.css?v`
    and `patch-notes.js?v` bumps (+ `shims.d.ts`) + patch-note entry per
    AGENTS.md; `assets.js?v` if touched.

---

## Design

### Stage A — Animation engine + timeline editor

**Data model** (`proj.animations: BattleAnimation[]`, new top-level
collection; `src/shared/schema.ts` + v2 migration backfills `[]`):

```ts
interface AnimItem {
  at: number;                     // start tick (60/s) on the timeline
  type: "particles" | "flash" | "shake" | "sound" | "projectile" | "flipbook";
  // particles: burst via the battle-fx pool
  kind?: string;                  // palette key (hit/fire/ice/heal/…) — or:
  color?: string;                 // explicit color override
  count?: number; radius?: number; size?: number; duration?: number;
  shape?: "burst" | "ring" | "rain" | "spiral";  // emitter pattern
  // flash: screen or target flash
  flashTarget?: "screen" | "target";
  opacity?: number;               // 0..1
  // shake: screen shake
  power?: number; speed?: number;
  // sound: procedural SE
  se?: string;
  // projectile: source → target bolt (only meaningful with a source anchor)
  trail?: boolean;
  // flipbook: sheet cells over the target (sheet = assets key or data URL;
  // Phase 6 importers will populate these — optional slot, not dead weight:
  // icon-strip flipbooks work today via sheet="icons")
  sheet?: string; cols?: number; rows?: number; from?: number; to?: number;
  fps?: number; scale?: number;
}
interface BattleAnimation {
  id: number; name: string;
  target: "target" | "source" | "screen";  // default anchor for items
  items: AnimItem[];
}
```

Design keystones:

- **The timeline is flat** — items fire at `at` ticks; there is no keyframe
  interpolation v1 (each item's own duration/easing covers motion). This
  keeps the editor honest (a sortable track table + scrubber) and the player
  trivial (a tick cursor firing due items).
- **The player wraps battle-fx** (`src/engine/anim-player.ts`):
  `playAnimation(anim, { source, targets, fx, screen })` — `fx` is the
  createBattleFx bundle (battle passes its own; the map scene builds one over
  a map overlay layer). Multi-target: target-anchored items replay per
  target. Returns a promise resolving when the last item ends; the battle
  awaits it exactly where it awaits `travel()` today.
- **Skill wiring:** `skill.animationId?: number` (+ `skill.hits?: number`,
  default 1). In battle, a skill with `animationId` plays it instead of the
  legacy `castFx/travel/burst` triple; **absent = legacy path, verbatim** —
  the sample game only opts in where we author it, so existing behavior is
  pinned. `weapon.animationId?` covers normal attacks the same way. Hits >1
  repeat damage application with per-hit floats.
- **Event command:** `CmdPlayAnim { t:"playAnim", animationId, target:
  "player"|"this"|"screen", wait? }` (registry + CMD_DEFS + all walkers are
  already loop-aware; playAnim has no nested lists). On the map it anchors to
  the entity's screen position via a map fx layer.
- **Editor:** Database ▸ Animations tab (left rail entry): list +
  name/target, an item table (add/dup/delete/reorder by `at`), per-type param
  forms, a **timeline strip** (items as chips on a tick ruler, drag to
  retime), and a **live preview** box (a fake battler card + the real
  anim-player + battle-fx CSS) with Play/loop. Skill/weapon forms gain an
  Animation picker; Enemy form keeps using skill animations.

### Stage B — Battle v2 (ATB/CTB, battle events, AI, rows)

- **`system.battleSystem: "turn" | "atb" | "ctb"`** (v2 migration backfills
  `"turn"`). `battle.ts` splits its loop by mode:
  - **turn** — the existing loop, character-for-character untouched.
  - **atb** — every battler gets a gauge filling per tick at
    `rate ∝ (agi + 20)`; at full, party members enqueue for command input
    (battle keeps flowing for others — "active" — but input pauses gauge
    fill in "wait" flavor; `system.atbWait?: boolean`, default true, the
    honest v1). Enemies act immediately at full. Gauges render as thin bars
    in the party rows and under enemy names.
  - **ctb** — discrete: next actor = smallest `wait = 10000 / (agi + 20)`
    accumulator; a **turn-order strip** (next 8 portraits) renders at the
    top. One actor acts per step; no simultaneous input.
  - All three share the same resolution core (extracted from the current
    loop body: `resolveAction(c)`) so damage math, states, FX, and battle
    events behave identically across modes. tickStates runs per-"round":
    turn = existing spot; atb/ctb = every N acts where N = living battlers.
- **Troop battle events:** `troop.pages?: TroopPage[]`:

  ```ts
  interface TroopPageCond {
    turn?: { a: number; b: number };      // fires on turn a + b·x (b=0: once)
    enemyHpBelow?: { index: number; pct: number };
    actorHpBelow?: { actorId: number; pct: number };
    switchId?: number;
  }
  interface TroopPage { cond: TroopPageCond; span: "battle"|"turn"|"moment";
                        commands: AnyCommand[]; }
  ```

  Checked between actions and at round boundaries; a firing page runs
  `new Interp(null).runList(page.commands)` while the loop pauses (`text`
  routes to the battle log/message layer — the msg system already overlays
  any scene). `span` gates re-firing (battle = once, turn = once per turn,
  moment = every re-check while true). Editor: Troops tab gains a pages
  strip + condition form + the standard command-list editor (all Phase 3/4
  machinery reused; graphs work on troop pages too since they edit the same
  `commands` through the same widget — graph stays page-local).
- **Enemy AI:** `EnemyAction` gains
  `cond?: { kind: "always"|"turn"|"hpBelow"|"hpAbove"|"random"|"stateSelf";
  a?: number; b?: number; pct?: number; stateId?: number }`.
  Selection = filter rows whose cond holds, then the existing weighted roll
  over the survivors (empty ⇒ attack). Absent cond = always, so existing
  data picks identically.
- **Formations/row:** party members gain `row: "front"|"back"` (persisted in
  save `G.party` records; default front; `actor.row?` authors the start).
  Back row: physical damage dealt and received ×0.75, and enemies weight
  front-row targets 3:1. A **Formation** entry in the pause menu toggles
  rows; the battle party rows show a `▲/▽` row marker. Enemies: troops keep
  their flat list (enemy rows deferred).
- **Skill battle common event:** `skill.commonEventId?: number` — runs after
  the skill resolves (the "action sequence" escape hatch; graph-authorable).

### Stage C — Movement & world

- **A\*** (`src/shared/pathfind.ts`, pure):
  `findPath(passable(x,y), from, to, { maxNodes = 600, near = false })` →
  `"up"/"down"/…` step strings (route-machinery native). 4-dir, Manhattan
  heuristic, binary-heap open set, deterministic tie-break (stable order),
  `near` accepts the best-effort closest tile when the goal is blocked.
  Vitest suite: corridors, blocked goal, budget bail, determinism.
- **Touch-to-move:** click/tap on the map canvas (player control active) →
  screen→tile via the camera transform → A* over
  `tilePassable && !blockingEventAt` → `setRoute(player, steps)`; any
  directional input or route obstruction cancels. Clicking an
  action-triggered event's tile walks adjacent then triggers it.
- **Followers:** `system.followers?: boolean` (v2 backfill `false`).
  `G.followers` = entity records for party[1..], charset-synced by the
  generalized `refreshPartyCharsets()`. Movement = **breadcrumb chain**: the
  player logs each departed tile+dir; follower i steps toward crumb i.
  Through: followers never block anything and pass through everything
  (RPG-Maker semantics); transfers snap the chain onto the player.
- **Vehicles:** `system.vehicles?: { boat?: VehicleDef; ship?: VehicleDef;
  airship?: VehicleDef }` where `VehicleDef = { charset: string;
  mapId: number; x: number; y: number; music?: string }` (v2 backfills the
  object with nulls = vehicle unused). Runtime `G.vehicles` tracks live
  positions + `G.vehicle` (riding: type or null; persisted in saves).
  Rules: **board** = action key facing the vehicle's tile (airship: over the
  player, lands/lifts anywhere passable-for-airship); **terrain** = boat
  moves on shallow-water tiles, ship on shallow+deep water, airship over
  anything (tile kind via the tileset's `tileProps`/`Assets.tiles[id].kind`
  water classes); **disembark** = action key onto an adjacent land-passable
  tile (airship: land on spot if ground passable). Riding hides followers,
  swaps the charset, plays `music`, and disables encounters (airship) or
  uses water encounters as-is (boat/ship). Map scene passability forks on
  `G.vehicle` in one place (`playerPassable(nx,ny)` beside `tilePassable`).
- **Jump/ledge:** route step `"jump"` (2-tile hop in facing dir with an arc
  tween, blocked→1-tile, both-blocked→in-place hop) + **ledge passability
  override** `passOv = 3` (paintable in the existing 0/1/2 pass tool):
  walking into a ledge tile auto-jumps the player over it iff the landing
  tile (2 ahead) is passable — one-way cliffs exactly like the classic
  ledge tiles.
- **Regions:** `map.regions?: number[]` (v2 backfills zeros, length-guarded
  like shadows/passOv). Editor: a **Regions paint mode** beside the pass
  tool — translucent numbered color cells (deterministic 32-color palette),
  paint/erase ids 1–63. Uses shipped this stage:
  - **Region encounters:** `map.encounters.byRegion?: Record<number,
    number[]>` — when the player's tile has region r and `byRegion[r]`
    exists, that troop list replaces `encounters.troops` for the roll
    (rate unchanged; region with no list = default list; region id 0 =
    default).
  - **Region events**: `Condition` gains `kind:"region"` (id) so events/
    graphs can branch on the player's region.

### Stage D — Player-facing systems

- **Minimap:** `system.minimap?: boolean` (backfill `false`) +
  `map.minimap?: boolean` per-map override. A corner canvas: the
  lowerBuf downscaled once per map load + live dots (player, followers
  omitted, events with pages priority "same" as faint dots, vehicles);
  toggled by a new `minimap` input action (default KeyM / pad Back).
- **Options menu v2** (`menus.ts` options section): volume sliders
  (master/BGM/SE via the existing setOptAudio), text speed + dash mode
  (existing), **fullscreen toggle** (Tauri window API when present, else
  the Fullscreen API), and **Controls…** — an in-game rebinding screen
  (per-action rows, press-to-bind capture for keyboard and gamepad, reset
  row/all; writes playerOptions overrides, never project defaults —
  exactly the split player-options.ts already stores).
- **Gamepad audit:** every UIStack screen's `onKey` handles
  up/down/left/right/ok/cancel (+ pagePrev/pageNext where lists paginate);
  the rebinding capture listens to raw pad buttons; the new
  minimap/formation entries get glyph hints via `\input[…]`.
- **Day/night gameplay hooks:** `Condition` gains `kind:"time"`
  (`{ from, to }` hours, wrap-around ok) for `if`/graphs; event **page**
  conditions gain `timeBand?: "morning"|"day"|"evening"|"night"` (refreshes
  with the clock via the existing refreshAllPages cadence — a shop's
  "closed" page is just a night page); `map.encounters.byTime?:
  { night?: number[] }` swaps the troop list at night (21:00–5:00).
- **Quest tracker polish:** the HUD tracker gets objective count pips,
  a "new/updated" flash, and gamepad-visible toggle hint; no data changes.

---

## Migration (FORMAT_VERSION 1 → 2)

One new step `{ version: 2 }`: backfill `p.animations = []`,
`system.battleSystem = "turn"`, `system.atbWait = true`,
`system.followers = false`, `system.minimap = false`,
`system.vehicles = {}`; per map: `regions` zero-array (length-guarded);
`troop.pages = []`; per skill/weapon: leave `animationId` absent (absent =
legacy FX); actors: leave `row` absent (= front). All additive — a v1
project loads, plays, and re-saves identically except for the stamped
version and backfilled empties (round-trip test updated accordingly).

## Stage plan

- **A — Animation engine + editor:** schema + migration v2 (animations
  only), anim-player, battle wiring (skill/weapon animationId + hits),
  playAnim command (registry/CMD_DEFS/summaries), Animations DB tab with
  timeline + preview, sample-game showcase animations, vitest
  (timeline scheduling, multi-target fan-out) + e2e (tab CRUD + preview),
  patch notes + wiki.
- **B — Battle v2:** battleSystem modes (shared resolution core), troop
  pages (+ editor), enemy AI conds (+ editor), rows + Formation menu,
  skill.commonEventId; battle tests extended per mode; patch notes + wiki.
- **C — Movement & world:** pathfind.ts + tests, touch-to-move, followers,
  vehicles, jump/ledge, regions layer + paint mode + region encounters +
  region condition; e2e for paint mode; patch notes + wiki.
- **D — Player-facing:** minimap, options v2 + rebinding screen, gamepad
  audit, time conditions/pages/encounters, quest HUD polish; patch notes +
  wiki; phase exit checklist.

Each stage lands green (full gate), is committed on `phase-5-gameplay`,
pushed, and merged to `main` per the standing workflow.

### Acceptance criteria (phase exit)

1. A skill with an authored animation plays it identically in battle and
   via playAnim on the map; skills without one keep byte-identical legacy
   FX. Animations round-trip the DB tab and export.
2. The sample game runs to a victory in all three battle modes; turn mode
   is behavior-identical to Phase 4 (existing battle tests unchanged and
   green). Troop pages fire per cond/span; conditioned enemy actions pick
   only when valid; back row applies its modifiers.
3. Touch-to-move routes around obstacles; followers trail through a
   transfer; a boat/ship/airship tour of the sample map works (board, ride
   water/air, disembark); ledge tiles jump one-way; region-painted
   encounter zones roll their own troop lists.
4. Minimap toggles and tracks the player; every menu is fully playable on
   gamepad including rebinding; a night-gated shop page flips with the
   clock; v1 projects load with zero behavior change (round-trip test).
5. Full gate green; renderer goldens byte-identical; patch notes + wiki
   updated; `editor.css?v` / `patch-notes.js?v` (+ shims) bumped.
