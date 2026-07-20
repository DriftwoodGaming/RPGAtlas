/* RPGAtlas — src/shared/sim/world.ts
   Project Beacon MP1·A: the instancing seam of the headless world core. A
   World is ONE running game simulation — everything the MP0·B singleton
   audit classed "world": the game state (the engine's `G`), the world slice
   of the old engine context (live map ref, event runtimes, interpreter
   scheduling maps, the tick clock, cameraZoom) and the gameplay RNG stream.
   `createWorld()` returns a fresh, fully isolated instance: a Beacon server
   hosts many per process; the solo engine binds its historical module-level
   names to ONE default instance through the compat shim
   (src/engine/state/default-world.ts + engine-context.ts + util.ts), so
   every existing import keeps working byte-identically.

   Headless by law: nothing under src/shared/sim/ may import DOM globals,
   deps.ts, audio, or engine modules (MP1·C erects the lint wall; until then
   this header is the contract). Stage B migrates the world *systems*
   (game-state helpers, movement/collision, tile behavior, encounters,
   quests, inventory/wallet, and the scene-module world state the audit
   lists) onto this instance; stage A ships only the seam on purpose.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { mulberry32 } from "../rng.js";
import { createCoopBattleState, type CoopBattleState } from "./coop-battle.js";
import { createDirectiveState, type DirectiveState } from "./directives.js";
import { createPartyState, type PartyState } from "./party.js";
import { createRosterState, type RosterState } from "./players.js";

/** One world's live game state — the exact object the engine has always
 *  called `G` (moved here verbatim from src/engine/state/game-state.ts).
 *  Field families added later at runtime (vehicles, bgs/savedBgm/jingles,
 *  menuDisabled…, windowTone) stay dynamic, as before. */
export function createInitialGameState(): any {
  return {
    switches: {},
    vars: {},
    selfSw: {},
    quests: {},
    party: [],
    inv: { item: {}, weapon: {}, armor: {} },
    gold: 0,
    // Extra-currency balances keyed by system.types.currencyTypes id (ids ≥ 2
    // only — id 1, the classic gold, stays in G.gold so every legacy reader
    // keeps working). Saves round-trip it; old saves load as {}.
    wallet: {},
    mapId: 0,
    steps: 0,
    encSteps: 0,
    // In-game clock (hours 0–24) for the HD-2D day/night cycle. Lives in game
    // state so saves round-trip it; maps can pin it (hd2d.timeOfDay) and
    // scripts drive it (game.setTimeOfDay) — nothing advances it implicitly.
    timeOfDay: 12,
    player: null,
  };
}

export interface WorldOptions {
  /** Seed the world's gameplay RNG stream (null/undefined = Math.random,
   *  the solo-player default — behavior identical to the unseeded engine). */
  seed?: number | null;
}

/** One instanced, headless game simulation. Stage B widens this with the
 *  remaining world rows of the MP0·B audit (quest runtime, tickTimers,
 *  lastTimeBand, forcedEncounterArmed, zone-runtime's world part, the
 *  presentation-runtime per-player sextet). */
export interface World {
  /** The live project (config nature — immutable during play; many worlds
   *  may share one project object on a server). */
  proj: any;
  /** The game state: switches/vars/selfSw, quests, party, inventory, gold +
   *  wallet, mapId/steps/encSteps, timeOfDay, player. The engine's `G`. */
  g: any;
  /** The live map record (ctx.map): one per occupied map is the MP8 zone
   *  unit; solo play holds the single current map here. */
  map: any;
  /** Event runtime states (ctx.evRTs): positions, move routes, active page. */
  evRTs: any[];
  /** Players currently paused by a blocking (action/touch/autorun)
   *  interpreter — MP3's participants-only pause (branch decision, Driftwood
   *  2026-07-19): an event pauses exactly its participants; other players on
   *  a shared map keep playing and see its world effects. Solo: the one
   *  default player, so the engine's aggregate view (the ctx.blockingRun shim
   *  accessor, "anyone blocked?") behaves exactly as the old boolean. MP4
   *  keys participants off real map rosters. */
  blocking: Set<number>;
  /** Presentation-directive broker (MP3): pending modal directives awaiting
   *  player replies + the outbound send the host installs. Runtime-only —
   *  never snapshotted (C3.4 auto-resolve covers disconnects). */
  directives: DirectiveState;
  /** Multi-player roster (MP4): the OTHER players sharing this world + which
   *  one is the local viewer. EMPTY in solo (nothing joins), so every remote-
   *  player code path is inert and the goldens stay byte-identical. Runtime-
   *  only — never snapshotted (a room rebuilds it from presence + snapshot). */
  roster: RosterState;
  /** Player-party system (MP6·A): social groups of players — invites,
   *  leadership, the battle auto-join query. EMPTY in solo (nobody to invite)
   *  so the whole co-op battle surface stays unreachable. Runtime-only. */
  party: PartyState;
  /** Shared-battle coordination (MP6·A): the active co-op battle + the
   *  per-player battle-event outbox the room host drains. Null/empty in solo
   *  (presence gate #1: no party ⇒ no shared battle). Runtime-only. */
  coopBattle: CoopBattleState;
  /** Parallel-interpreter scheduling: event runtime -> running flag. */
  parallels: Map<any, any>;
  /** Common-event parallel scheduling: common event id -> running flag. */
  commonParallels: Map<any, any>;
  /** THE world clock (ctx.globalT): 60 Hz fixed-step tick count — the number
   *  every future snapshot/delta/presence message carries. */
  tick: number;
  /** Camera zoom — per-player world state (MP0·C nature 2): event-driven AND
   *  saved. Kept in the world block at MP1; MP4 keys it per player. */
  cameraZoom: number;

  // ---- MP1·B world rows (the remaining MP0·B audit rows, migrated per the
  // stage-A pattern: the state lives here; the engine's owning modules bind
  // their historical module-level names to defaultWorld through the shim). ----

  /** The quest runtime (js/quests.js instance): closes over `g`, so it is one
   *  per world. Created by game-state.ts initQuestRuntime(); null until then.
   *  Its members (Quests, questState, objectiveDone, evaluateQuestFailures,
   *  noteBattleFailure, onEnemyKilled) are the game-state live exports. */
  questRuntime: any;
  /** Tick-accurate event wait/tween timers (scenes/map.ts): pumped once per
   *  world tick in update(). `waitFrames(n)` = n world ticks. */
  tickTimers: any[];
  /** Day/night page-refresh edge detector (scenes/map.ts): the last time band
   *  crossed, derived from g.timeOfDay. */
  lastTimeBand: string;
  /** Forced-encounter one-shot latch (scenes/map.ts): the editor's "Test
   *  Encounter in This Area" arms it; the next eligible step consumes it. */
  forcedEncounterArmed: boolean;
  /** Gameplay-zone runtime state for the current map (scenes/zone-runtime.ts):
   *  the baked collision/nav overlay, zone-presence set, and weather/sound
   *  bookkeeping. Instanced per world; resetZoneState re-bakes it per map.
   *  Shape kept in sync with zone-runtime.ts emptyState(). */
  zone: any;
  /** On-screen presentation state (scenes/presentation-runtime.ts) — the
   *  per-player sextet the audit lists (MP0·C nature 2: event-driven AND
   *  save-serialized): pictures, screen tint (+ its tween), the count-down
   *  timer, and the map scroll offset (+ its tween). Client renders them. */
  pictures: any;
  tint: any;
  tintTween: any;
  timer: any;
  scroll: any;
  scrollTween: any;

  /** The seed the RNG stream currently runs under (>>> 0 normalized), or
   *  null when unseeded (Math.random). Read-only outside; set via seedRnd. */
  rngSeed: number | null;
  /** Swap the world's random source: a number seeds a deterministic
   *  mulberry32 stream; null/undefined restores unseeded Math.random. */
  seedRnd(seed: number | null | undefined): void;
  /** Uniform integer in [0, n) from the world's stream (the engine's rnd). */
  rnd(n: number): number;
  /** Uniform float in [0, 1) from the world's stream (the engine's rndf). */
  rndf(): number;
}

/** Create a fresh, isolated world simulation. Initial values are exactly the
 *  solo engine's boot-time initializers (engine-context.ts + game-state.ts
 *  before MP1), which is what keeps the compat shim byte-identical. */
export function createWorld(proj: any = null, opts: WorldOptions = {}): World {
  // The stream lives in this closure; seedRnd swaps it exactly as the old
  // module-level `random` in util.ts did (NaN seeds coerce via >>> 0 to 0,
  // preserving the ?rngseed=garbage behavior).
  let random: () => number = Math.random;
  const world: World = {
    proj,
    g: createInitialGameState(),
    map: null,
    evRTs: [],
    blocking: new Set(),
    directives: createDirectiveState(),
    roster: createRosterState(),
    party: createPartyState(),
    coopBattle: createCoopBattleState(),
    parallels: new Map(),
    commonParallels: new Map(),
    tick: 0,
    cameraZoom: 1,
    // MP1·B rows — initializers copied verbatim from the owning engine modules
    // (game-state.ts quest exports start unset; scenes/map.ts timers/latches;
    // scenes/zone-runtime.ts emptyState(); scenes/presentation-runtime.ts).
    questRuntime: null,
    tickTimers: [],
    lastTimeBand: "",
    forcedEncounterArmed: false,
    zone: {
      map: null,
      hasZones: false,
      passGrid: null,
      inside: new Set(),
      weatherApplied: null,
      weatherBaseline: null,
      soundActive: false,
    },
    pictures: new Map(),
    tint: [0, 0, 0, 0],
    tintTween: null,
    timer: { running: false, frames: 0, common: 0 },
    scroll: { x: 0, y: 0 },
    scrollTween: null,
    rngSeed: null,
    seedRnd(seed: number | null | undefined): void {
      if (seed == null) {
        world.rngSeed = null;
        random = Math.random;
      } else {
        world.rngSeed = seed >>> 0;
        random = mulberry32(seed >>> 0);
      }
    },
    rnd(n: number): number {
      return Math.floor(random() * n);
    },
    rndf(): number {
      return random();
    },
  };
  if (opts.seed != null) world.seedRnd(opts.seed);
  return world;
}
