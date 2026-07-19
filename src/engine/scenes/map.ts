/* RPGAtlas — src/engine/scenes/map.ts
   The map scene update, extracted verbatim from the js/engine.js monolith
   (Phase 1 Stage B): the fixed-timestep update() body, frame/tick timers
   (frameWait, waitFrames, tickTween), blocking/autorun/parallel event
   scheduling for map events and common events, player transfer, step
   triggers, and random encounters. Logic unchanged; the monolith's closure
   state is read/written through the shared engine context, and the scenes
   still living in the shrinking engine.js (battle, menus, gameover) are
   reached through the fns registry. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA } from "../../shared/deps.js";
import { clamp, rnd, rndf, sysSe } from "../util.js";
import { findPath } from "../../shared/pathfind.js";
import { ctx, fns } from "../state/engine-context.js";
import { G, actorEffCarrier, param } from "../state/game-state.js";
import { defaultWorld } from "../state/default-world.js";
import { soloClient, soloHost } from "../net/solo-session.js";
import { active } from "../net/active.js";
import type { Dir, GridDir, InputIntent } from "../../shared/net/protocol.js";
import { waitTicks, tickTweenTicks, pumpTickTimers } from "../../shared/sim/timers.js";
import {
  beginBlocking,
  endBlocking,
  participantsOf,
  type InterpOrigin,
} from "../../shared/sim/directives.js";
import { preemptiveRate, surpriseRate } from "./battle-logic.js";
import { wantsDash } from "../state/player-options.js";
import { UIStack } from "../ui-stack.js";
import { Interp } from "../interpreter/interp.js";
import { Plugins } from "../plugin-runtime.js";
import { updateZonePresence, zoneEncounterPool, mapHasZones } from "./zone-runtime.js";
import { updatePresentation, tickTimer, resetScroll } from "./presentation-runtime.js";
import { fadeTo } from "../message.js";
import { render } from "../render-glue.js";
import { toggleHud } from "../hud.js";
import {
  refreshAllPages,
  loadMap,
  entityAt,
  blockingEventAt,
  tilePassable,
  canEntityPass,
  startMove,
  dirTo,
  DIRD,
  updateRoute,
  updateEntityMotion,
  diagonalStepClear,
  updateMapCombat,
  combatChaseDir,
  combatStaggered,
  startPlayerAttack,
  setRoute,
  regionAt,
  timeBandOf,
  playerStepPassable,
  developerThroughActive,
  tryVehicleAction,
  syncFollowers,
  updateFollowers,
  startJump,
  updateJumpMotion,
  ledgeAt,
  tickMapAnim,
} from "./map-runtime.js";
import { counterAt, damageFloorAt } from "./tile-behavior.js";
import { autosaveNow } from "../state/save.js";

let frameWaiters: any[] = [];
export function frameWait(): Promise<void> {
  return new Promise((r) => frameWaiters.push(r));
}
// Project Beacon MP1·B: the day/night edge detector and the tick-accurate
// event timers are world state (MP0·B audit) — they now live on the world
// instance (defaultWorld.lastTimeBand / defaultWorld.tickTimers), reached here
// through the compat shim just like G. frameWaiters stays module-level (it is
// per-RENDERED-frame render pacing — client state, not world state).
//
// MP3·A: the timer FUNCTIONS moved into the sim (src/shared/sim/timers.ts) so
// a headless server-side interpreter can wait by world ticks; these exports
// bind them to the default world, so every engine caller is byte-identical.
// Tick-accurate timers: counted in update(), so event waits/tweens advance by
// ticks even when several ticks run in one rendered frame.
export function waitFrames(n: any): Promise<void> {
  return waitTicks(defaultWorld, n);
}
export function tickTween(n: any, step: any): Promise<void> {
  return tickTweenTicks(defaultWorld, n, step);
}

// Interpreter execution contexts (Beacon MP3·A, MP0·C §C6): action/touch/tap
// triggers run as the player; autorun, parallel, and timer-driven runs are the
// world's. Solo: both resolve to the one default player — participantsOf
// keeps the blocking set and directive targeting byte-identical to the old
// boolean flag while giving MP4 the per-player structure the branch decision
// (participants-only pause, Driftwood 2026-07-19) needs.
const PLAYER_CTX: InterpOrigin = { playerId: 0 };
const WORLD_CTX: InterpOrigin = { playerId: null };

export async function runEventBlocking(rt: any, origin: InterpOrigin = PLAYER_CTX): Promise<void> {
  if (ctx.blockingRun) return;
  const participants = participantsOf(defaultWorld, origin);
  beginBlocking(defaultWorld, participants);
  rt.locked = true;
  if (rt.kind === "human" && rt.page.trigger === "action") {
    rt.dir = dirTo(rt.x, rt.y, G.player.x, G.player.y);
  }
  // If the commands turn the NPC (a "turn_*" route step), that facing sticks
  // after the event; otherwise snap back to the page's authored facing.
  const facedDir = rt.dir;
  try {
    await new Interp(rt, undefined, undefined, origin).runList(rt.page.commands);
  } finally {
    rt.locked = false;
    if (rt.kind === "human" && rt.dir === facedDir) rt.dir = rt.page.dir || 0;
    refreshAllPages();
    endBlocking(defaultWorld, participants);
  }
}

async function runCommonEventBlocking(commonEvent: any, origin: InterpOrigin = PLAYER_CTX): Promise<void> {
  if (ctx.blockingRun) return;
  const participants = participantsOf(defaultWorld, origin);
  beginBlocking(defaultWorld, participants);
  try {
    await new Interp(null, undefined, undefined, origin).callCommonEvent(commonEvent.id);
  } finally {
    refreshAllPages();
    endBlocking(defaultWorld, participants);
  }
}

/** HUD custom-menu seam: run an authored common event under the same blocking
 * guard and page-refresh lifecycle as autorun and map-triggered events. */
export async function runHudCommonEvent(commonEventId: any): Promise<void> {
  const commonEvent = RA.byId(ctx.proj.commonEvents || [], Number(commonEventId));
  if (!commonEvent || !commonEvent.commands || !commonEvent.commands.length) return;
  await runCommonEventBlocking(commonEvent, PLAYER_CTX); // player-initiated (HUD button)
}
fns.runHudCommonEvent = runHudCommonEvent;

export function updateCommonEvents(): void {
  const commonEvents = ctx.proj.commonEvents || [];
  if (!ctx.blockingRun) {
    const autorun = commonEvents.find((commonEvent: any) =>
      commonEvent.trigger === "auto" &&
      commonEvent.commands.length &&
      RA.commonEventEnabled(commonEvent, G.switches));
    if (autorun) runCommonEventBlocking(autorun, WORLD_CTX);
  }
  for (const commonEvent of commonEvents) {
    if (
      commonEvent.trigger !== "parallel" ||
      !commonEvent.commands.length ||
      !RA.commonEventEnabled(commonEvent, G.switches) ||
      ctx.commonParallels.get(commonEvent.id)
    ) continue;
    ctx.commonParallels.set(commonEvent.id, true);
    new Interp(null, undefined, undefined, WORLD_CTX).callCommonEvent(commonEvent.id).finally(async () => {
      // MP3·A: the re-arm beat is world scheduling, so it counts world ticks
      // (3 ≈ the old 50 ms at 60 Hz) — a headless server reschedules
      // deterministically by tick, never by wall clock.
      await waitFrames(3);
      ctx.commonParallels.set(commonEvent.id, false);
    });
  }
}

export async function transferPlayer(mapId: any, x: any, y: any, dir: any): Promise<void> {
  const tr = Plugins.transition;
  if (tr && tr.out) await tr.out();
  else await fadeTo(1, 250);
  resetScroll(); // a map scroll offset is per-map (Project Compass M2·A)
  await loadMap(mapId);
  const p = G.player;
  p.x = p.tx = x; p.y = p.ty = y; p.rx = x; p.ry = y; p.prx = x; p.pry = y; p.moving = false;
  p.route = null;
  if (dir != null) p.dir = dir;
  syncFollowers(true); // pile the chain onto the arrival tile
  await render();
  if (tr && tr.in) await tr.in();
  else await fadeTo(0, 250);
  // Autosave (post-1.1): a completed transfer autosaves like MZ. No-op
  // unless system.autosave is on (and never while saves are event-locked).
  autosaveNow();
}

// ============================ map scene update ============================
function activePlayerControl(): boolean {
  return ctx.scene === "map" && !UIStack.length && !ctx.blockingRun && !ctx.menuOpen;
}

export function update(): void {
  ctx.globalT++;
  // Animated terrain (Phase 8 Stage C) flows even while a menu/message is up, so
  // it ticks before the scene early-returns. Driven by the engine tick counter
  // (deterministic under the golden clock). No-op unless the map has animated
  // terrain painted on it.
  if (ctx.scene === "map") tickMapAnim(ctx.globalT);
  if (ctx.shakeTimer > 0) ctx.shakeTimer--;
  if (ctx.flashTimer > 0) ctx.flashTimer--;
  const waiters = frameWaiters;
  frameWaiters = [];
  waiters.forEach((r) => r());
  pumpTickTimers(defaultWorld); // advance tick-accurate event timers (wait / camera-zoom)
  // Rebuild this frame's input edge set before any early-return, so title/pause
  // menus see a clean edge set every tick and nothing stays latched across them.
  ctx.Input.poll();
  if (ctx.scene === "map") Plugins.fire("update");
  if (ctx.scene !== "map" || ctx.menuOpen) {
    return;
  }

  const p = G.player;
  // Presentation layer (Project Compass M2·A): advance picture/tint/scroll
  // tweens and the count-down timer. Placed after the menu early-return, so it
  // ticks during events but pauses while a menu is open (RM timer semantics).
  updatePresentation();
  const timerExpiry = tickTimer();
  if (timerExpiry && !ctx.blockingRun) {
    // fire-and-forget, like a parallel (world context — the clock triggered it)
    new Interp(null, undefined, undefined, WORLD_CTX).callCommonEvent(timerExpiry);
  }
  // Dash "Toggle" mode: flip the latch on each rising edge of the dash button (tracked every
  // tick so a tap while standing still registers). Hold/Always read live in wantsDash().
  if ((ctx.playerOptions.dashMode || "hold") === "toggle") {
    const dp = ctx.Input.pressed("dash");
    if (dp && !ctx.dashPrev) ctx.dashLatch = !ctx.dashLatch;
    ctx.dashPrev = dp;
  }
  // HUD toggle (Phase 5): works any time the map has control focus
  if (!UIStack.length && !ctx.menuOpen && ctx.Input.consume("hud")) toggleHud();
  // Day/night gameplay (Phase 5): pages with a timeBand condition flip when
  // the clock crosses a band boundary (shops close at night, etc.)
  const band = timeBandOf(G.timeOfDay);
  if (band !== defaultWorld.lastTimeBand) {
    defaultWorld.lastTimeBand = band;
    if (!ctx.blockingRun) refreshAllPages();
  }
  // snapshot start-of-tick positions so render() can interpolate between ticks
  p.prx = p.rx; p.pry = p.ry;
  for (const rt of ctx.evRTs) { rt.prx = rt.rx; rt.pry = rt.ry; }
  // MP4·B (host): remote players are world entities the host advances — snapshot
  // their previous-tick coords too. Empty roster (solo) → no-op → byte-identical.
  if (defaultWorld.roster.players.size)
    for (const rp of defaultWorld.roster.players.values()) { rp.prx = rp.rx; rp.pry = rp.ry; }
  // player motion — advance the current step, then (if it finished this tick) start the
  // next one immediately, so there's no dead frame at each tile. activePlayerControl()
  // stays false during events/battles, so chaining can't spawn a spurious move.
  const playerSpeed = wantsDash() ? 0.13 : 0.085;
  if (p.jumping) {
    if (updateJumpMotion(p)) onPlayerStep(); // landed: triggers/encounters fire
  } else if (p.moving) {
    const arrived = updateEntityMotion(p, playerSpeed);
    if (arrived) onPlayerStep();
  }
  // touch-to-move routes yield to the player: any directional press cancels
  if (p.route && p.route.touch && ctx.Input.dir() >= 0) p.route = null;
  if (!p.moving && !p.jumping && p.route) {
    updateRoute(p);
  } else if (!p.moving && !p.jumping && activePlayerControl()) {
    // Project Beacon MP2·B: player map-control input rides the protocol. The
    // CLIENT reads the device and emits move/attack/act intents; they cross the
    // in-process LoopbackTransport to the WORLD host, which hands them back for
    // the world to apply (applyPlayerIntent). In loopback capture and apply are
    // one tick, so this is byte-identical to the old direct reads — but the data
    // genuinely flows as `ClientInput` frames over a real Transport, the seam
    // MP4/MP5 need. The dir peek and the consume order (attack, then ok, then
    // cancel) are preserved exactly. `cancel` opens the pause menu — a client
    // concern, not a world write, so it never rides the intent channel (the
    // world-mutating menu VERBS are the §C5 additive intents).
    const d = ctx.Input.dir(!!ctx.proj.system.eightDirectionMovement);
    const attack = ctx.Input.consume("attack");
    const ok = ctx.Input.consume("ok");
    const cancel = ctx.Input.consume("cancel");
    // client → transport (attack XOR move, matching the old if/else-if priority)
    if (attack) soloClient.sendInput({ k: "attack" });
    else if (d >= 0)
      soloClient.sendInput({ k: "move", dir: CARDINAL_OF[d], dir8: d as GridDir, run: wantsDash() });
    if (ok) soloClient.sendInput({ k: "act" });
    // world host: drain the tick's intents and apply them in send order. Player
    // 0 is the local player (applyPlayerIntent, unchanged); MP4·B remote peers
    // (playerId > 0) move their own roster entity. Solo drains only player-0
    // intents, so this dispatch is byte-identical there.
    for (const pending of soloHost.drainIntents()) {
      if (pending.playerId === 0) applyPlayerIntent(pending.intent);
      else applyRemoteIntent(pending.playerId, pending.intent);
    }
    // Client prediction seam (MP4): with real latency the local player predicts
    // the step here and reconciles on the server's delta.ack — zero-latency
    // loopback needs none, so the seam is marked and empty.
    if (cancel) fns.openMenu();
  }
  if (p.moving) p.animT = (p.animT || 0) + 0; // animT advanced in motion fn
  updateFollowers(playerSpeed);
  updateMapCombat();
  // MP4·B (host): advance remote players' in-progress steps. No-op in solo.
  if (defaultWorld.roster.players.size) advanceRemotePlayers();

  // events
  for (const rt of ctx.evRTs) {
    if (rt.erased || !rt.page) continue;
    // Same no-dead-frame pattern as the player above: a finished step chains into the next
    // route/random step this same tick instead of pausing a frame at each tile.
    if (rt.jumping) {
      updateJumpMotion(rt); // route "jump" steps: NPC hops advance like the player's
    } else if (rt.moving) {
      const arrived = updateEntityMotion(rt, rt.combat && rt.combat.knockback ? 0.18 : rt.speed);
      if (arrived && rt.combat) rt.combat.knockback = false;
    }
    if (!rt.moving && !rt.jumping && rt.route) {
      updateRoute(rt);
    } else if (!rt.moving && !rt.jumping) {
      const chaseDir = combatChaseDir(rt);
      if (chaseDir >= 0) {
        startMove(rt, chaseDir);
        rt.moveT = 20 + rnd(40);
      } else if (rt.page.moveType === "random" && !rt.locked && !ctx.blockingRun && !combatStaggered(rt)) {
        if (--rt.moveT <= 0) {
          rt.moveT = 40 + rnd(100);
          const d = rnd(4);
          if (rnd(4) === 0) rt.dir = d;
          else if (canEntityPass(rt, rt.x + DIRD[d][0], rt.y + DIRD[d][1]))
            startMove(rt, d);
        }
      }
    }
    // autorun / parallel (world contexts — the scheduler triggered them, not
    // a player; solo still resolves their participants to the one player)
    if (
      !ctx.blockingRun &&
      rt.page.trigger === "auto" &&
      rt.page.commands.length
    ) {
      runEventBlocking(rt, WORLD_CTX);
    }
    if (
      rt.page.trigger === "parallel" &&
      rt.page.commands.length &&
      !ctx.parallels.get(rt)
    ) {
      ctx.parallels.set(rt, true);
      new Interp(rt, undefined, undefined, WORLD_CTX).runList(rt.page.commands).finally(async () => {
        // MP3·A: world-tick re-arm beat (3 ≈ the old 50 ms) — see the common-
        // parallel note above.
        await waitFrames(3);
        ctx.parallels.set(rt, false);
      });
    }
  }
  updateCommonEvents();
}

// Project Beacon MP2·B: the cardinal projection of a numeric grid direction —
// the network-facing `move.dir`. The authoritative direction is the numeric
// `dir8` (see protocol GridDir); a diagonal projects to its vertical component
// (RM movement priority). Index = grid dir id (DIRD keys 0..7).
const CARDINAL_OF: Dir[] = ["down", "left", "right", "up", "down", "down", "up", "up"];
const NUM_OF_CARDINAL: Record<Dir, GridDir> = { down: 0, left: 1, right: 2, up: 3 };

/** Apply one player input intent to the world (server-authoritative). This is
 *  the world side of the map-control seam: the exact movement/attack/interact
 *  decisions that update() used to make inline from ctx.Input, now driven by the
 *  intent the client sent over the loopback transport — byte-identical, because
 *  the intent carries the same direction (dir8) the device produced this tick.
 *  The §C5 menu-verb intents (useItem/equip/formation) are defined on the wire
 *  but not emitted by the loopback capture yet, so they are ignored here. */
function applyPlayerIntent(intent: InputIntent): void {
  const p = G.player;
  if (intent.k === "attack") {
    if (!G.vehicle) startPlayerAttack();
    return;
  }
  if (intent.k === "move") {
    // dir8 is authoritative (loopback always sets it); fall back to the cardinal
    // for a future 4-direction network peer that omits it.
    const d = intent.dir8 != null ? intent.dir8 : NUM_OF_CARDINAL[intent.dir];
    p.dir = d;
    const [dx, dy] = DIRD[d];
    const nx = p.x + dx,
      ny = p.y + dy;
    const cornerClear = diagonalStepClear(p.x, p.y, d, playerStepPassable);
    const developerThrough = developerThroughActive();
    if (cornerClear) {
      if (developerThrough || G.vehicle) {
        // vehicle terrain rules; no touch triggers from the deck
        if (playerStepPassable(nx, ny)) {
          startMove(p, d);
          p.animT = p.animT || 0;
        }
      } else if (
        (dx === 0 || dy === 0) &&
        ledgeAt(nx, ny) &&
        tilePassable(p.x + dx * 2, p.y + dy * 2) &&
        !blockingEventAt(p.x + dx * 2, p.y + dy * 2)
      ) {
        startJump(p, d, 2); // one-way ledge hop (cardinal only)
      } else {
        const blocker = blockingEventAt(nx, ny);
        if (
          blocker &&
          blocker.page.trigger === "touch" &&
          blocker.page.commands.length
        ) {
          runEventBlocking(blocker, PLAYER_CTX); // the walking player triggered it
        } else if (tilePassable(nx, ny) && !blocker) {
          startMove(p, d);
          p.animT = p.animT || 0;
        }
      }
    }
    return;
  }
  if (intent.k === "act") {
    if (!tryVehicleAction()) checkActionTrigger();
  }
}

/** MP4·B (host): apply one remote player's input to THEIR roster entity. MP4
 *  supports movement + facing; a remote's attack/act (which would trigger the
 *  host's events) is a later slice — it rides the participants-only structure. */
function applyRemoteIntent(pid: number, intent: InputIntent): void {
  const e = defaultWorld.roster.players.get(pid) as any;
  if (!e) return;
  if (intent.k === "face") {
    e.dir = NUM_OF_CARDINAL[intent.dir];
    return;
  }
  if (intent.k !== "move") return; // attack/act by peers: later slice
  if (e.moving || e.jumping) return;
  const d = intent.dir8 != null ? intent.dir8 : NUM_OF_CARDINAL[intent.dir];
  e.dir = d;
  const [dx, dy] = DIRD[d];
  const nx = e.x + dx, ny = e.y + dy;
  // Collision only against the host's currently-loaded map (same-map co-op). A
  // peer on another map free-roams (D-0: headless per-zone collision is MP8).
  if (e.mapId === G.mapId) {
    if (!diagonalStepClear(e.x, e.y, d, tilePassable)) return;
    if (!tilePassable(nx, ny) || blockingEventAt(nx, ny)) return;
    if (G.player && G.player.x === nx && G.player.y === ny) return; // don't stack on the host
  }
  startMove(e, d);
}

/** MP4·B (host): advance every remote player's in-progress step one tick. */
function advanceRemotePlayers(): void {
  for (const e of defaultWorld.roster.players.values()) {
    if ((e as any).moving) updateEntityMotion(e, 0.085);
  }
}

/** MP4·B (client): the thin per-tick step a JOINED tab runs instead of the
 *  authoritative update(). It captures local input and sends it to the host as
 *  intents (the host is the one authority, D1); the host's deltas drive every
 *  position, so nothing is simulated here. Animated terrain still advances off
 *  the host-synced world clock for parity. The loop calls this in client mode
 *  only — solo/host never reach it, so update() is untouched. */
export function clientTick(): void {
  if (ctx.scene === "map") tickMapAnim(ctx.globalT);
  ctx.Input.poll();
  const client = active.client;
  if (!client || ctx.scene !== "map" || ctx.menuOpen) return;
  const d = ctx.Input.dir(!!ctx.proj.system.eightDirectionMovement);
  const attack = ctx.Input.consume("attack");
  const ok = ctx.Input.consume("ok");
  const cancel = ctx.Input.consume("cancel");
  if (attack) client.sendInput({ k: "attack" });
  else if (d >= 0) client.sendInput({ k: "move", dir: CARDINAL_OF[d], dir8: d as GridDir, run: wantsDash() });
  if (ok) client.sendInput({ k: "act" });
  if (cancel) fns.openMenu();
}

function onPlayerStep(): void {
  G.steps++;
  // Walk-off states (Project Compass M3·B, MZ stepsToRemove): each party step
  // ticks a counter on states that cure by walking; at zero the state falls
  // off. States without the field (all Atlas-native ones) are never touched.
  for (const a of G.party) {
    if (!a.states || !a.states.length) continue;
    for (const st of a.states.slice()) {
      const id = st && st.id != null ? st.id : st;
      const d = RA.byId(ctx.proj.states || [], id);
      if (!d || !d.stepsToRemove) continue;
      if (typeof st === "number") continue; // legacy entry; battle normalizes
      st.steps = (st.steps == null ? d.stepsToRemove : st.steps) - 1;
      if (st.steps <= 0) a.states.splice(a.states.indexOf(st), 1);
    }
  }
  const p = G.player;
  // Damage floors + the 20-step map regen tick (Project Compass M4·A). Both
  // presence-gated: no damage tiles painted ⇒ damageFloorAt exits on the mask;
  // the regen tick runs only under mzBattleFlow (imported projects). A party
  // wipe here game-overs and ends the step.
  if (applyStepTileEffects()) return;
  // touch events on the tile we stepped onto (not from a vehicle's deck)
  if (!ctx.blockingRun && !G.vehicle) {
    const here = entityAt(p.x, p.y).find(
      (rt: any) =>
        rt.page.trigger === "touch" &&
        rt.page.commands.length &&
        (rt.page.priority !== "same" || rt.page.through),
    );
    if (here) {
      runEventBlocking(here, PLAYER_CTX); // stepped onto it
      return;
    }
  }
  // Gameplay zones (Phase 8): sound/weather presence (level-triggered) and an
  // edge-triggered transfer zone, checked only on tile-enter and only when the
  // map has zones. A transfer zone routes through the ordinary transfer path
  // (same as the transfer event command) and ends the step.
  if (mapHasZones() && !ctx.blockingRun && !G.vehicle) {
    const tr = updateZonePresence(ctx.map, p.x, p.y);
    if (tr) {
      transferPlayer(tr.mapId, tr.x, tr.y, tr.dir);
      return;
    }
  }
  // random encounters (airships fly above them; regions can swap the pool).
  // Change Encounter Access (M2·C) suppresses the roll while disabled.
  // M3·C party abilities (trait 64): an Encounter-None party never rolls;
  // Encounter-Half advances the counter at half speed. Presence-gated —
  // parties without the traits keep the exact classic flow and draws.
  const partyAbility = (key: string) =>
    G.party.some(
      (a: any) => RA.traitsOf(actorEffCarrier(a), "special", key).length > 0,
    );
  const enc = ctx.map.encounters;
  // M4·A: a map whose encounters are ALL region-scoped has an empty default
  // list — byRegion pools alone keep the roll alive (native maps without
  // byRegion keep the exact classic gate and draw stream).
  const hasRegionPools = !!(enc && enc.byRegion &&
    Object.values(enc.byRegion).some((list: any) => Array.isArray(list) && list.length));
  if (enc && enc.rate > 0 && (enc.troops.length || hasRegionPools) && !ctx.blockingRun && !G.encounterDisabled && G.vehicle !== "airship" && !partyAbility("encounterNone")) {
    G.encSteps += partyAbility("encounterHalf") ? 0.5 : 1;
    const forced = consumeForcedEncounter();
    if (forced || G.encSteps >= enc.rate * (0.7 + rndf() * 0.6)) {
      G.encSteps = 0;
      let pool = enc.troops;
      // night pool first, then a region pool overrides (more specific wins)
      if (timeBandOf(G.timeOfDay) === "night" && enc.byTime && Array.isArray(enc.byTime.night) && enc.byTime.night.length) {
        pool = enc.byTime.night;
      }
      const region = regionAt(p.x, p.y);
      const regionPool = region && enc.byRegion ? enc.byRegion[region] : null;
      if (Array.isArray(regionPool) && regionPool.length) pool = regionPool;
      // Encounter zones (Phase 8) are the strongest tier of the byRegion family:
      // standing inside one replaces the pool for the roll. Absent ⇒ unchanged.
      pool = zoneEncounterPool(ctx.map, p.x, p.y, pool);
      // M4·A: outside every region pool on a byRegion-only map the resolved
      // pool can be empty — the counter reset, no battle (MZ behaves the same).
      if (!pool.length) return;
      const troopId = pool[rnd(pool.length)];
      sysSe("encounter");
      // M3·C: first-strike/surprise rolls — mzBattleFlow projects only, and
      // only for RANDOM encounters (event battles never roll, like MZ). Two
      // draws, exactly MZ's onEncounter (surprise rolls even after a hit).
      let opts: any;
      if (ctx.proj.system.mzBattleFlow) {
        const troopRec = RA.byId(ctx.proj.troops, troopId);
        const members = (troopRec ? troopRec.enemies : [])
          .map((eid: any) => RA.byId(ctx.proj.enemies, eid))
          .filter(Boolean);
        const pAgi =
          G.party.reduce((s: any, a: any) => s + param(a, "agi"), 0) /
          Math.max(1, G.party.length);
        const tAgi =
          members.reduce((s: any, e: any) => s + (Number(e.stats.agi) || 0), 0) /
          Math.max(1, members.length);
        const preemptive =
          rndf() < preemptiveRate(pAgi, tAgi, partyAbility("raisePreemptive"));
        const surprise =
          rndf() < surpriseRate(pAgi, tAgi, partyAbility("cancelSurprise")) &&
          !preemptive;
        opts = { preemptive, surprise };
      }
      (async () => {
        const result = await fns.Battle.run(troopId, true, opts);
        if (result === "lose") await fns.gameOver();
        // Autosave (post-1.1): a survived random battle autosaves like MZ.
        else autosaveNow();
      })();
    }
  }
}

// ---- step tile effects (Project Compass M4·A) ----
// Damage floors (MZ: 10 × the actor's floorDamage sp-param per step; HP floors
// at 1 unless System optFloorDeath) and, under mzBattleFlow only, MZ's
// turnEndOnMap: every 20 party steps hp/mp regen traits apply on the map (slip
// damage floors at 1 HP unless optSlipDeath). Returns true when the party
// wiped (game over started — stop processing the step).
function applyStepTileEffects(): boolean {
  const p = G.player;
  const sys = ctx.proj.system;
  let hurt = false;
  if (!G.vehicle && damageFloorAt(p.x, p.y)) {
    for (const a of G.party) {
      if (a.hp <= 0) continue;
      const dmg = Math.floor(10 * RA.traitRate(actorEffCarrier(a), "special", "floorDamage", 1));
      if (dmg <= 0) continue;
      // MZ maxFloorDamage: lethal only when optFloorDeath is on.
      const cap = sys.optFloorDeath ? a.hp : Math.max(a.hp - 1, 0);
      const taken = Math.min(dmg, cap);
      if (taken > 0) { a.hp -= taken; hurt = true; }
    }
  }
  if (sys.mzBattleFlow && G.steps % 20 === 0) {
    for (const a of G.party) {
      if (a.hp <= 0) continue;
      const carrier = actorEffCarrier(a);
      const hr = RA.traitSum(carrier, "special", "hpRegen", 0);
      if (hr) {
        const mhp = param(a, "mhp");
        const amt = Math.max(1, Math.floor((mhp * Math.abs(hr)) / 100));
        if (hr > 0) {
          a.hp = Math.min(mhp, a.hp + amt);
        } else {
          // MZ maxSlipDamage: lethal only when optSlipDeath is on.
          const cap = sys.optSlipDeath ? a.hp : Math.max(a.hp - 1, 0);
          const taken = Math.min(amt, cap);
          if (taken > 0) { a.hp -= taken; hurt = true; }
        }
      }
      const mr = RA.traitSum(carrier, "special", "mpRegen", 0);
      if (mr) {
        const mmp = param(a, "mmp");
        a.mp = clamp((a.mp || 0) + Math.floor((mmp * mr) / 100), 0, mmp);
      }
    }
  }
  if (!hurt) return false;
  // MZ performMapDamage: a short red screen flash.
  ctx.flashColor = "#ff0000";
  ctx.flashOpacity = 0.35;
  ctx.flashTimer = 10;
  ctx.flashDuration = 10;
  if (G.party.every((a: any) => a.hp <= 0)) {
    (async () => { await fns.gameOver(); })();
    return true;
  }
  return false;
}

// "Test Encounter in This Area" (Phase 8): the editor writes a one-shot flag to
// the playtest handoff; boot arms it, and the NEXT step inside an encounter
// zone forces the roll immediately (so the tester doesn't have to wander for the
// rate to trigger). One-shot: consumed on the first eligible step.
// Project Beacon MP1·B: the forced-encounter latch is world state (MP0·B
// audit) — it lives on the world instance, reached through the shim.
export function armForcedEncounter(): void {
  defaultWorld.forcedEncounterArmed = true;
}
function consumeForcedEncounter(): boolean {
  if (!defaultWorld.forcedEncounterArmed) return false;
  defaultWorld.forcedEncounterArmed = false;
  return true;
}

// ---- touch/click-to-move (Phase 5 Stage C) ----
// A tap on the map canvas paths the player there (A* around obstacles,
// best-effort when the exact tile is blocked). Tapping an action event's
// tile walks adjacent, faces it, and triggers it.
export function handleMapTap(clientX: number, clientY: number): void {
  const p = G.player;
  if (ctx.scene !== "map" || !p || UIStack.length || ctx.blockingRun || ctx.menuOpen) return;
  if (G.vehicle || p.jumping) return;
  const TILE = Assets.TILE;
  const rect = ctx.stage.getBoundingClientRect();
  const scale = rect.width / ctx.SCREEN_W || 1;
  const sx = (clientX - rect.left) / scale;
  const sy = (clientY - rect.top) / scale;
  const viewW = ctx.SCREEN_W / ctx.cameraZoom;
  const viewH = ctx.SCREEN_H / ctx.cameraZoom;
  const camX = clamp(p.rx * TILE + TILE / 2 - viewW / 2, 0, Math.max(0, ctx.map.width * TILE - viewW));
  const camY = clamp(p.ry * TILE + TILE / 2 - viewH / 2, 0, Math.max(0, ctx.map.height * TILE - viewH));
  const tx = Math.floor((sx / ctx.cameraZoom + camX) / TILE);
  const ty = Math.floor((sy / ctx.cameraZoom + camY) / TILE);
  if (tx < 0 || ty < 0 || tx >= ctx.map.width || ty >= ctx.map.height) return;
  const passable = (x: number, y: number) => tilePassable(x, y) && !blockingEventAt(x, y);
  const target = entityAt(tx, ty).find(
    (rt: any) => rt.page.trigger === "action" && rt.page.commands.length,
  );
  const triggerIfAdjacent = () => {
    if (!target || target.erased || !target.page) return;
    if (Math.abs(p.x - tx) + Math.abs(p.y - ty) === 1) {
      p.dir = dirTo(p.x, p.y, tx, ty);
      runEventBlocking(target, PLAYER_CTX); // tapped it
    }
  };
  const path = findPath(passable, p.x, p.y, tx, ty, { near: true, maxNodes: 800 });
  if (!path || !path.length) {
    triggerIfAdjacent(); // already next to it (or nothing to do)
    return;
  }
  setRoute(p, path, target ? triggerIfAdjacent : null);
  (p.route as any).touch = true;
}

function checkActionTrigger(): void {
  const p = G.player;
  const [dx, dy] = DIRD[p.dir];
  const spots = [
    [p.x + dx, p.y + dy],
    [p.x, p.y],
  ];
  // Counter tiles (Project Compass M4·A): facing one lets the action key reach
  // the event one tile beyond it (MZ talk-over-counter). counterAt gates on
  // the map's presence mask — counter-free maps skip the extra probe.
  if (counterAt(p.x + dx, p.y + dy)) spots.push([p.x + dx * 2, p.y + dy * 2]);
  for (const [x, y] of spots) {
    const rt = entityAt(x, y).find(
      (r: any) => r.page.trigger === "action" && r.page.commands.length,
    );
    if (rt) {
      runEventBlocking(rt, PLAYER_CTX); // action button
      return;
    }
  }
}
