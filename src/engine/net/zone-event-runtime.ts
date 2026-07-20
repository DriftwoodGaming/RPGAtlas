/* RPGAtlas — src/engine/net/zone-event-runtime.ts
   Project Beacon MP8·B (item 1, deviation D-8-0): the per-zone ENGINE event
   runtime. A world zone (server/src/core/zone.ts) runs the PLAYER layer (grid
   movement, AOI, broadcast) headlessly; this driver adds the ENGINE layer —
   NPC/event motion, page resolution, autorun/parallel triggers, action/touch
   interaction, and the REAL interpreter registry — bound to the zone's world.

   Why one zone per process/worker (docs/mp-8-spec.md §A2): the engine's
   module-level `G`/`ctx` bind to ONE `defaultWorld` through the MP1 compat
   shim. So a zone that runs engine events adopts `defaultWorld` as its world;
   the interpreter's every read (`ctx.map`, `ctx.proj`, `G.switches`) then
   operates on THIS zone. That is why the seam ships per-worker and why the
   directory's in-process default cannot host more than one engine zone (the
   worker adapter — zone-worker.ts — is the multi-zone answer).

   Why a NEW driver and not scenes/map.ts + scenes/map-runtime.ts: those are
   render/audio-coupled (they prerender canvases, drive the Renderer, play
   Music) and cannot be bundled headless. This module re-implements the PURE
   event logic those files carry (page resolution, entity motion, the update
   scheduler) against the headless sim (collision.ts for passability, timers.ts
   for waits, directives.ts for the presentation port) — the same faithful-port
   pattern collision.ts used for `tilePassable`. The interpreter registry itself
   (interp.ts + commands/*) IS headless-bundleable and is reused verbatim
   (tests/mp-commands.test.js proves it).

   World effects reach the rest of the world through the zone outbox: world
   switch/var/timeOfDay writes fan out via `sharedSet` (persisted in the
   WorldSnapshot), per-player switch writes via `recordPatch` (persisted in the
   PlayerRecord data bag), transfers via `transferOut`, and modal commands
   (Show Message/Choices/…) through the already-wired directive broker
   (world.directives.send → the zone outbox). Self-switches are zone-local and
   ride the ZoneSnapshot.

   Solo / friend rooms are byte-identical: this runs ONLY in a world zone that
   was handed a runtime factory; nothing here is reachable from single-player or
   the MP5 room path. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

// FIRST import — stands up window.RPGAtlasDeps before deps.ts (pulled in below
// via game-state → interp) evaluates. ESM guarantees this side-effect module
// runs before the engine imports that read the shim.
import "./headless-env.js";

import { defaultWorld } from "../state/default-world.js";
import { ctx } from "../state/engine-context.js";
import {
  G,
  param,
  addInv,
  makeActor,
  expForLevel,
  gainExp,
  sanitizeEquipment,
  invCount,
} from "../state/game-state.js";
import { compareVariable, clamp } from "../util.js";
import { Interp, initInterpServices } from "../interpreter/interp.js";
import { registerBuiltinCommands } from "../interpreter/commands/index.js";
import { scriptApi } from "../script-api.js";
import {
  createPresentationPort,
  participantsOf,
  beginBlocking,
  endBlocking,
  type InterpOrigin,
} from "../../shared/sim/directives.js";
import { pumpTickTimers, waitTicks, tickTweenTicks } from "../../shared/sim/timers.js";
import { DIR_OFFSET, isPassable, type MapCollision } from "../../shared/sim/collision.js";
import type { JsonValue, PlayerId } from "../../shared/net/protocol.js";
import type { World } from "../../shared/sim/world.js";
import type {
  ZoneRuntime,
  ZoneRuntimeContext,
  EventNetState,
} from "../../shared/net/zone-runtime.js";

/* ── interpreter execution contexts (map.ts PLAYER_CTX / WORLD_CTX) ──────── */
const WORLD_CTX: InterpOrigin = { playerId: null };

/* ── page resolution (headless port of scenes/map-runtime.ts) ───────────── */

/** morning 5–10, day 10–17, evening 17–21, night 21–5 (map-runtime timeBandOf). */
function timeBandOf(hour: any): string {
  const h2 = (((Number(hour) || 0) % 24) + 24) % 24;
  if (h2 >= 5 && h2 < 10) return "morning";
  if (h2 >= 10 && h2 < 17) return "day";
  if (h2 >= 17 && h2 < 21) return "evening";
  return "night";
}

/** Is this page's condition set satisfied by the current world state? Faithful
 *  to map-runtime `pageActive` for the SERVER-evaluable conditions (switch /
 *  time band / variable / self-switch). Quest + objective conditions are read
 *  best-effort from `G.quests` and default to inactive when the quest runtime
 *  has no record (the safe direction — a quest-gated page stays closed until
 *  the quest state proves otherwise; server quest runtime is a later slice). */
function pageActive(mapId: number, evId: any, page: any): boolean {
  const c = page.cond || {};
  if (c.switchId && !G.switches[c.switchId]) return false;
  if (c.timeBand && timeBandOf(G.timeOfDay) !== c.timeBand) return false;
  if (c.varId && !compareVariable(G.vars[c.varId] || 0, c.varVal, c.cmp || ">=")) return false;
  if (c.selfSw && !G.selfSw[mapId + ":" + evId + ":" + c.selfSw]) return false;
  if (c.questId) {
    const q = G.quests && G.quests[c.questId];
    if (!q || q.status !== (c.questStatus || "active")) return false;
  }
  if (c.objectiveQuestId) {
    const q = G.quests && G.quests[c.objectiveQuestId];
    const objs = q && q.objectives;
    const done = !!(objs && objs[Number(c.objectiveIndex) || 0] && objs[Number(c.objectiveIndex) || 0].done);
    if ((c.objectiveStatus || "completed") === "completed" ? !done : done) return false;
  }
  return true;
}

/** Build one event runtime state — the headless subset of map-runtime.makeEvRT
 *  (no charset index / light / on-map combat: the server needs event LOGIC, not
 *  its sprite). */
function makeEvRT(world: World, mapId: number, evData: any): any {
  const rt: any = {
    ev: evData,
    x: evData.x, y: evData.y,
    rx: evData.x, ry: evData.y,
    prx: evData.x, pry: evData.y,
    dir: 0, animT: 0, moving: false, tx: evData.x, ty: evData.y,
    page: null, pageIndex: -1, erased: false, locked: false,
    moveT: 30 + world.rnd(90), route: null, speed: 0.05,
  };
  refreshPage(mapId, rt);
  return rt;
}

/** Re-resolve one event's active page (highest-index active page wins). */
function refreshPage(mapId: number, rt: any): void {
  let pi = -1;
  for (let i = rt.ev.pages.length - 1; i >= 0; i--) {
    if (pageActive(mapId, rt.ev.id, rt.ev.pages[i])) {
      pi = i;
      break;
    }
  }
  if (pi === rt.pageIndex) return;
  rt.pageIndex = pi;
  rt.page = pi >= 0 ? rt.ev.pages[pi] : null;
  if (rt.page) rt.dir = rt.page.dir || 0;
}

/* ── the runtime ─────────────────────────────────────────────────────────── */

// One process/worker binds one engine runtime to defaultWorld. Guard against a
// second live binding (the in-process directory must shard engine zones onto
// workers — §A2); stop() clears it, so sequential creation (tests) is fine.
let liveBinding = false;
let servicesInstalled = false;

/** The engine-runtime factory: conforms to ZoneRuntimeFactory (server-side,
 *  DOM-free interface), so the zone injects it without importing the engine. */
export function createZoneEventRuntime(rtx: ZoneRuntimeContext): ZoneRuntime {
  const world = rtx.world;
  if (world !== (defaultWorld as unknown as World)) {
    // The zone MUST have been built with `world: defaultWorld` — the interpreter
    // reads through the compat shim, which only ever points at defaultWorld.
    throw new Error("zone-event-runtime: zone world must be defaultWorld (§A2 one-zone-per-process)");
  }
  if (liveBinding) {
    throw new Error("zone-event-runtime: an engine runtime is already bound in this process (shard onto a worker)");
  }
  liveBinding = true;

  const mapId = rtx.mapId;
  const collision: MapCollision = rtx.collision;
  const outbox = rtx.outbox;
  const parallels = world.parallels;
  const commonParallels = world.commonParallels;

  // World-effect propagation shadows (§A5): interpreter command handlers write
  // g.switches/g.vars/g.pSwitches/g.timeOfDay DIRECTLY (the audited commands are
  // reused unchanged); the runtime diffs against these shadows once per tick and
  // fans the changes out through the outbox. Seeded at start() from the world's
  // (already-replayed) shared state, so a value the directory pushed in is never
  // echoed back as if the runtime authored it.
  const shSwitch = new Map<string, boolean>();
  const shVar = new Map<string, number>();
  let shTime = 0;
  const shPSwitch = new Map<string, boolean>(); // key = pid + ":" + id

  /* ── entity queries + motion (headless port of map-runtime) ────────────── */

  function tilePassable(x: number, y: number): boolean {
    return isPassable(collision, x, y);
  }
  function entityAt(x: number, y: number, exclude?: any): any[] {
    return world.evRTs.filter(
      (rt: any) => rt !== exclude && !rt.erased && rt.page && rt.x === x && rt.y === y,
    );
  }
  function blockingEventAt(x: number, y: number): any {
    return entityAt(x, y).find((rt: any) => rt.page.priority === "same" && !rt.page.through);
  }
  /** A player standing on (or stepping onto) a tile blocks an NPC's step. */
  function playerBlocks(x: number, y: number): boolean {
    for (const p of world.roster.players.values()) {
      const px = p.moving ? p.tx : p.x;
      const py = p.moving ? p.ty : p.y;
      if (px === x && py === y) return true;
    }
    return false;
  }
  function canEntityPass(rt: any, nx: number, ny: number): boolean {
    if (rt.page && rt.page.through) return true;
    if (!tilePassable(nx, ny)) return false;
    if (blockingEventAt(nx, ny)) return false;
    if (playerBlocks(nx, ny) && (!rt.page || rt.page.priority === "same")) return false;
    return true;
  }
  function dirTo(fx: number, fy: number, tx: number, ty: number): number {
    const dx = tx - fx, dy = ty - fy;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 2 : 1;
    return dy > 0 ? 0 : 3;
  }
  function startMove(ent: any, dir: number): void {
    ent.dir = dir;
    const [dx, dy] = DIR_OFFSET[dir] || [0, 0];
    ent.tx = ent.x + dx;
    ent.ty = ent.y + dy;
    ent.moving = true;
  }
  /** Advance an in-progress step (map-runtime.updateEntityMotion). */
  function updateEntityMotion(ent: any, speed: number): boolean {
    if (!ent.moving) return false;
    const sx = Math.sign(ent.tx - ent.rx), sy = Math.sign(ent.ty - ent.ry);
    ent.rx += sx * speed;
    ent.ry += sy * speed;
    if (
      (sx !== 0 && Math.sign(ent.tx - ent.rx) !== sx) ||
      (sy !== 0 && Math.sign(ent.ty - ent.ry) !== sy) ||
      (sx === 0 && sy === 0)
    ) {
      ent.rx = ent.tx; ent.ry = ent.ty; ent.x = ent.tx; ent.y = ent.ty;
      ent.moving = false;
      return true;
    }
    ent.animT++;
    return false;
  }
  function setRoute(ent: any, steps: any, onDone: any): void {
    ent.route = { steps, idx: 0, wait: 0, onDone };
  }
  /** Advance an authored move route one tick (map-runtime.updateRoute — the
   *  NPC-relevant steps; player-targeted routes are the deferred slice D-8-6). */
  function updateRoute(ent: any): void {
    const r = ent.route;
    if (!r || ent.moving) return;
    if (r.wait > 0) { r.wait--; return; }
    if (r.idx >= r.steps.length) {
      ent.route = null;
      if (r.onDone) r.onDone();
      return;
    }
    const s = r.steps[r.idx++];
    const dirs: any = { up: 3, down: 0, left: 1, right: 2 };
    if (s in dirs) {
      const d = dirs[s];
      ent.dir = d;
      const [dx, dy] = DIR_OFFSET[d];
      if (canEntityPass(ent, ent.x + dx, ent.y + dy)) startMove(ent, d);
      else if (r.touch) ent.route = null;
    } else if (s === "forward") {
      const cardinal = ["down", "left", "right", "up"][ent.dir];
      if (cardinal) r.steps.splice(r.idx, 0, cardinal);
    } else if (typeof s === "string" && s.startsWith("turn_")) {
      ent.dir = dirs[s.slice(5)];
    } else if (s === "wait15") {
      r.wait = 15;
    } else if (s === "wait60") {
      r.wait = 60;
    }
  }

  function refreshAllPages(): void {
    for (const rt of world.evRTs) if (!rt.erased) refreshPage(mapId, rt);
  }

  /* ── blocking interpreter runs (map.ts runEventBlocking / common events) ── */

  async function runEventBlocking(rt: any, origin: InterpOrigin, faceTo?: { x: number; y: number }): Promise<void> {
    if (ctx.blockingRun) return;
    const participants = participantsOf(world, origin);
    beginBlocking(world, participants);
    rt.locked = true;
    if (origin.playerId != null && faceTo) rt.dir = dirTo(rt.x, rt.y, faceTo.x, faceTo.y);
    const facedDir = rt.dir;
    try {
      await new Interp(rt, undefined, undefined, origin).runList(rt.page.commands);
    } finally {
      rt.locked = false;
      if (rt.dir === facedDir) rt.dir = (rt.page && rt.page.dir) || 0;
      refreshAllPages();
      endBlocking(world, participants);
    }
  }

  async function runCommonEventBlocking(commonEvent: any, origin: InterpOrigin): Promise<void> {
    if (ctx.blockingRun) return;
    const participants = participantsOf(world, origin);
    beginBlocking(world, participants);
    try {
      await new Interp(null, undefined, undefined, origin).callCommonEvent(commonEvent.id);
    } finally {
      refreshAllPages();
      endBlocking(world, participants);
    }
  }

  function updateCommonEvents(): void {
    const proj = world.proj as any;
    const commonEvents = (proj && proj.commonEvents) || [];
    if (!ctx.blockingRun) {
      const autorun = commonEvents.find(
        (ce: any) => ce.trigger === "auto" && ce.commands.length && commonEventEnabled(ce),
      );
      if (autorun) void runCommonEventBlocking(autorun, WORLD_CTX);
    }
    for (const ce of commonEvents) {
      if (
        ce.trigger !== "parallel" ||
        !ce.commands.length ||
        !commonEventEnabled(ce) ||
        commonParallels.get(ce.id)
      ) continue;
      commonParallels.set(ce.id, true);
      void new Interp(null, undefined, undefined, WORLD_CTX)
        .callCommonEvent(ce.id)
        .finally(async () => {
          await waitTicks(world, 3);
          commonParallels.set(ce.id, false);
        });
    }
  }
  function commonEventEnabled(ce: any): boolean {
    return !ce.switchId || !!G.switches[ce.switchId];
  }

  /* ── world-effect diffing (→ outbox: sharedSet / recordPatch) ──────────── */

  function seedShadows(): void {
    shSwitch.clear();
    for (const k of Object.keys(G.switches)) shSwitch.set(k, !!G.switches[k]);
    shVar.clear();
    for (const k of Object.keys(G.vars)) shVar.set(k, Number(G.vars[k]) || 0);
    shTime = Number(G.timeOfDay) || 0;
    shPSwitch.clear();
    for (const pid of Object.keys(G.pSwitches || {})) {
      const bucket = G.pSwitches[pid] || {};
      for (const id of Object.keys(bucket)) shPSwitch.set(pid + ":" + id, !!bucket[id]);
    }
  }
  /** Emit outbox writes for every world-shared / per-player change since the
   *  last diff, then re-baseline the shadows. Runs once per tick. */
  function diffAndPropagate(): void {
    // world switches
    for (const k of Object.keys(G.switches)) {
      const v = !!G.switches[k];
      if (shSwitch.get(k) !== v) {
        shSwitch.set(k, v);
        outbox.sharedSet("switch:" + k, v);
      }
    }
    // world variables (only numeric cells fan out — the applyShared contract)
    for (const k of Object.keys(G.vars)) {
      const v = Number(G.vars[k]) || 0;
      if (shVar.get(k) !== v) {
        shVar.set(k, v);
        outbox.sharedSet("var:" + k, v);
      }
    }
    // time of day
    const t = Number(G.timeOfDay) || 0;
    if (t !== shTime) {
      shTime = t;
      outbox.sharedSet("timeOfDay", t);
    }
    // per-player switches → the origin player's durable record data bag
    const ps = G.pSwitches || {};
    for (const pid of Object.keys(ps)) {
      const bucket = ps[pid] || {};
      for (const id of Object.keys(bucket)) {
        const key = pid + ":" + id;
        const v = !!bucket[id];
        if (shPSwitch.get(key) !== v) {
          shPSwitch.set(key, v);
          const numPid = Number(pid);
          if (Number.isFinite(numPid)) {
            outbox.recordPatch(numPid as PlayerId, { ["pSwitch:" + id]: v });
          }
        }
      }
    }
  }

  /* ── the injected service surface (headless EngineServices) ─────────────── */

  const presentation = createPresentationPort(world);
  const noop = (): void => {};
  const asyncNoop = async (): Promise<void> => {};
  const questsStub: any = {
    start: noop, complete: () => null, fail: noop, status: () => "inactive",
    advanceObjective: noop, setObjective: noop,
  };
  const audioStub: any = { playMe: noop, bgmPosition: () => 0, stopSe: noop, applyAmbience: noop };

  if (!servicesInstalled) {
    servicesInstalled = true;
    registerBuiltinCommands();
  }
  // (Re)install the service surface each factory call — one runtime is live at a
  // time (guarded above), so the singleton EngineServices always points at the
  // current zone's world-backed services.
  const EngineServices: any = {
    ctx,
    presentation,
    // state ops
    refreshAllPages,
    evaluateQuestFailures: noop,
    addInv, makeActor, param, expForLevel, gainExp, sanitizeEquipment,
    clamp, rnd: (n: number) => world.rnd(n),
    getProj: () => world.proj,
    ownsItem: (kind: string, id: number) => invCount(kind, id) > 0,
    // routing / world (the seam wiring of D-8-0)
    transferPlayer: async (toMapId: number, x?: number, y?: number, dir?: number) => {
      const pid = currentActorPid;
      if (pid != null) outbox.transferOut(pid as PlayerId, toMapId, x ?? -1, y ?? -1, dir ?? -1);
    },
    setRoute,
    // waits / tweens (world-tick clock)
    waitFrames: (n: any) => waitTicks(world, n),
    frameWait: () => waitTicks(world, 1),
    tickTween: (n: any, step: any) => tickTweenTicks(world, n, step),
    // multiplayer conditions
    mpOnline: () => true,
    mpPlayerCount: () => world.roster.players.size + 1,
    mpAllOnMap: (m: number) => {
      for (const p of world.roster.players.values()) if (p.mapId !== m) return false;
      return true;
    },
    // scripting (headless script-api)
    scriptApi,
    Quests: questsStub,
    // headless no-ops: a server renders nothing, plays no audio, runs no
    // battles/shops/menus this slice (deviation D-8-6). Present so the audited
    // command handlers never throw on a missing service.
    showMessage: asyncNoop,
    applyWindowTone: noop, locationInfo: () => 0,
    vehicleState: () => null, tryVehicleAction: noop, setMapParallax: noop,
    refreshPlayerCharset: noop, syncFollowers: noop,
    saveLoadMenu: asyncNoop, gameOver: asyncNoop, toTitle: asyncNoop, autosaveNow: noop,
    Battle: { run: async () => "win", lastShared: false }, Shop: { open: asyncNoop },
    playMapAnimation: noop, AudioDeck: audioStub, Sfx: audioStub, Music: audioStub,
    wireShopGoods: () => [], applyShopTranscript: noop,
    get battleAddEnemyTp() { return undefined; },
    get battleEnemyOps() { return undefined; },
  };
  initInterpServices(EngineServices);

  /** During a player-origin blocking run, which player the run acts for (so
   *  transfer resolves to that player). Null for world runs (autorun/parallel);
   *  a world-context transfer has no single subject and is a no-op this slice. */
  let currentActorPid: PlayerId | null = null;

  /* ── ZoneRuntime surface (called by the zone) ──────────────────────────── */

  return {
    start(): void {
      ctx.scene = "map";
      world.proj = world.proj || rtx.world.proj;
      world.g.mapId = mapId;
      const proj = world.proj as any;
      const map = proj && proj.maps ? proj.maps.find((m: any) => Number(m.id) === mapId) : null;
      world.map = map || null;
      // Maps can pin the day/night clock on entry (map-runtime.loadMap).
      if (map && map.hd2d && map.hd2d.timeOfDay != null && map.hd2d.timeOfDay !== "") {
        world.g.timeOfDay = clamp(Number(map.hd2d.timeOfDay) || 0, 0, 24);
      }
      world.evRTs = map && Array.isArray(map.events) ? map.events.map((e: any) => makeEvRT(world, mapId, e)) : [];
      world.lastTimeBand = timeBandOf(world.g.timeOfDay);
      parallels.clear();
      commonParallels.clear();
      seedShadows();
    },

    tick(): void {
      // The zone already advanced world.tick and moved players this tick; the
      // runtime advances the engine layer, then propagates world effects.
      for (const rt of world.evRTs) { rt.prx = rt.rx; rt.pry = rt.ry; }
      pumpTickTimers(world);
      // day/night page refresh (map.ts update())
      const band = timeBandOf(G.timeOfDay);
      if (band !== world.lastTimeBand) {
        world.lastTimeBand = band;
        if (!ctx.blockingRun) refreshAllPages();
      }
      for (const rt of world.evRTs) {
        if (rt.erased || !rt.page) continue;
        if (rt.moving) updateEntityMotion(rt, rt.speed);
        if (!rt.moving && rt.route) {
          updateRoute(rt);
        } else if (!rt.moving) {
          if (rt.page.moveType === "random" && !rt.locked && !ctx.blockingRun) {
            if (--rt.moveT <= 0) {
              rt.moveT = 40 + world.rnd(100);
              const d = world.rnd(4);
              if (world.rnd(4) === 0) rt.dir = d;
              else if (canEntityPass(rt, rt.x + DIR_OFFSET[d][0], rt.y + DIR_OFFSET[d][1])) startMove(rt, d);
            }
          }
        }
        // autorun / parallel (world contexts — the scheduler triggered them)
        if (!ctx.blockingRun && rt.page.trigger === "auto" && rt.page.commands.length) {
          void runEventBlocking(rt, WORLD_CTX);
        }
        if (rt.page.trigger === "parallel" && rt.page.commands.length && !parallels.get(rt)) {
          parallels.set(rt, true);
          void new Interp(rt, undefined, undefined, WORLD_CTX)
            .runList(rt.page.commands)
            .finally(async () => {
              await waitTicks(world, 3);
              parallels.set(rt, false);
            });
        }
      }
      updateCommonEvents();
      diffAndPropagate();
    },

    onAct(pid: PlayerId, x: number, y: number, dir: number): void {
      if (ctx.blockingRun) return;
      const [dx, dy] = DIR_OFFSET[dir] || [0, 0];
      const spots: Array<[number, number]> = [[x + dx, y + dy], [x, y]];
      for (const [sx, sy] of spots) {
        const rt = entityAt(sx, sy).find(
          (r: any) => r.page.trigger === "action" && r.page.commands.length,
        );
        if (rt) {
          currentActorPid = pid;
          void runEventBlocking(rt, { playerId: pid }, { x, y }).finally(() => {
            currentActorPid = null;
          });
          return;
        }
      }
    },

    onArrive(pid: PlayerId, x: number, y: number): void {
      if (ctx.blockingRun) return;
      const rt = entityAt(x, y).find(
        (r: any) =>
          r.page.trigger === "touch" &&
          r.page.commands.length &&
          (r.page.priority !== "same" || r.page.through),
      );
      if (rt) {
        currentActorPid = pid;
        void runEventBlocking(rt, { playerId: pid }, { x, y }).finally(() => {
          currentActorPid = null;
        });
      }
    },

    eventStates(): EventNetState[] {
      const out: EventNetState[] = [];
      for (const rt of world.evRTs) {
        if (!rt.page || rt.erased) continue;
        out.push({
          id: rt.ev.id, x: rt.x, y: rt.y, rx: rt.rx, ry: rt.ry,
          dir: rt.dir, moving: rt.moving, page: rt.pageIndex,
        });
      }
      return out;
    },

    snapshotData(): Record<string, JsonValue> {
      const events: JsonValue[] = [];
      for (const rt of world.evRTs) {
        events.push({ id: rt.ev.id, x: rt.x, y: rt.y, dir: rt.dir, page: rt.pageIndex, erased: rt.erased });
      }
      return { events };
    },

    restoreData(data: Record<string, JsonValue>): void {
      const events = data && (data.events as any[]);
      if (!Array.isArray(events)) return;
      const byId = new Map<number, any>();
      for (const rt of world.evRTs) byId.set(rt.ev.id, rt);
      for (const e of events) {
        const rt = byId.get(e.id);
        if (!rt) continue;
        rt.x = rt.tx = e.x; rt.y = rt.ty = e.y;
        rt.rx = rt.prx = e.x; rt.ry = rt.pry = e.y;
        rt.dir = e.dir;
        rt.erased = !!e.erased;
      }
    },

    noteExternalShared(key: string, value: JsonValue): void {
      // The directory applied a world-shared write (fan-out from another zone);
      // re-baseline the shadow so diffAndPropagate does not echo it back out.
      if (key === "timeOfDay") {
        if (typeof value === "number") shTime = value;
      } else if (key.startsWith("switch:")) {
        shSwitch.set(key.slice(7), !!value);
      } else if (key.startsWith("var:")) {
        if (typeof value === "number") shVar.set(key.slice(4), value);
      }
    },

    stop(): void {
      parallels.clear();
      commonParallels.clear();
      world.evRTs = [];
      liveBinding = false;
    },
  };
}
