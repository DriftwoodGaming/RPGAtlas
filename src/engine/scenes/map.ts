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

import { RA } from "../../shared/deps.js";
import { rnd, sleep, sysSe } from "../util.js";
import { ctx, fns } from "../state/engine-context.js";
import { G } from "../state/game-state.js";
import { wantsDash } from "../state/player-options.js";
import { UIStack } from "../ui-stack.js";
import { Interp } from "../interpreter/interp.js";
import { Plugins } from "../plugin-runtime.js";
import { fadeTo } from "../message.js";
import { render } from "../render-glue.js";
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
  updateMapCombat,
  combatChaseDir,
  combatStaggered,
  startPlayerAttack,
} from "./map-runtime.js";

let frameWaiters: any[] = [];
export function frameWait(): Promise<void> {
  return new Promise((r) => frameWaiters.push(r));
}
// Tick-accurate timers: counted in update(), so event waits/tweens advance by ticks even
// when several ticks run in one rendered frame. (frameWait above is per-rendered-frame.)
let tickTimers: any[] = [];
export function waitFrames(n: any): Promise<void> {
  return new Promise((resolve) => tickTimers.push({ left: Math.max(1, n | 0), resolve }));
}
export function tickTween(n: any, step: any): Promise<void> {
  const total = Math.max(1, n | 0);
  return new Promise((resolve) => tickTimers.push({ left: total, total, step, resolve }));
}
function pumpTickTimers(): void {
  if (!tickTimers.length) return;
  const timers = tickTimers; tickTimers = [];
  const done = [];
  for (const tm of timers) {
    tm.left--;
    if (tm.step) tm.step((tm.total - tm.left) / tm.total);
    if (tm.left <= 0) done.push(tm); else tickTimers.push(tm);
  }
  done.forEach((tm) => tm.resolve());
}

export async function runEventBlocking(rt: any): Promise<void> {
  if (ctx.blockingRun) return;
  ctx.blockingRun = true;
  rt.locked = true;
  const prevDir = rt.dir;
  if (rt.kind === "human" && rt.page.trigger === "action") {
    rt.dir = dirTo(rt.x, rt.y, G.player.x, G.player.y);
  }
  try {
    await new Interp(rt).runList(rt.page.commands);
  } finally {
    rt.locked = false;
    if (rt.kind === "human")
      rt.dir = prevDir === rt.dir ? rt.page.dir || 0 : rt.page.dir || 0;
    refreshAllPages();
    ctx.blockingRun = false;
  }
}

async function runCommonEventBlocking(commonEvent: any): Promise<void> {
  if (ctx.blockingRun) return;
  ctx.blockingRun = true;
  try {
    await new Interp(null).callCommonEvent(commonEvent.id);
  } finally {
    refreshAllPages();
    ctx.blockingRun = false;
  }
}

export function updateCommonEvents(): void {
  const commonEvents = ctx.proj.commonEvents || [];
  if (!ctx.blockingRun) {
    const autorun = commonEvents.find((commonEvent: any) =>
      commonEvent.trigger === "auto" &&
      commonEvent.commands.length &&
      RA.commonEventEnabled(commonEvent, G.switches));
    if (autorun) runCommonEventBlocking(autorun);
  }
  for (const commonEvent of commonEvents) {
    if (
      commonEvent.trigger !== "parallel" ||
      !commonEvent.commands.length ||
      !RA.commonEventEnabled(commonEvent, G.switches) ||
      ctx.commonParallels.get(commonEvent.id)
    ) continue;
    ctx.commonParallels.set(commonEvent.id, true);
    new Interp(null).callCommonEvent(commonEvent.id).finally(async () => {
      await sleep(50);
      ctx.commonParallels.set(commonEvent.id, false);
    });
  }
}

export async function transferPlayer(mapId: any, x: any, y: any, dir: any): Promise<void> {
  const tr = Plugins.transition;
  if (tr && tr.out) await tr.out();
  else await fadeTo(1, 250);
  await loadMap(mapId);
  const p = G.player;
  p.x = p.tx = x; p.y = p.ty = y; p.rx = x; p.ry = y; p.prx = x; p.pry = y; p.moving = false;
  if (dir != null) p.dir = dir;
  await render();
  if (tr && tr.in) await tr.in();
  else await fadeTo(0, 250);
}

// ============================ map scene update ============================
function activePlayerControl(): boolean {
  return ctx.scene === "map" && !UIStack.length && !ctx.blockingRun && !ctx.menuOpen;
}

export function update(): void {
  ctx.globalT++;
  if (ctx.shakeTimer > 0) ctx.shakeTimer--;
  if (ctx.flashTimer > 0) ctx.flashTimer--;
  const waiters = frameWaiters;
  frameWaiters = [];
  waiters.forEach((r) => r());
  pumpTickTimers(); // advance tick-accurate event timers (wait / camera-zoom)
  // Rebuild this frame's input edge set before any early-return, so title/pause
  // menus see a clean edge set every tick and nothing stays latched across them.
  ctx.Input.poll();
  if (ctx.scene === "map") Plugins.fire("update");
  if (ctx.scene !== "map" || ctx.menuOpen) {
    return;
  }

  const p = G.player;
  // Dash "Toggle" mode: flip the latch on each rising edge of the dash button (tracked every
  // tick so a tap while standing still registers). Hold/Always read live in wantsDash().
  if ((ctx.playerOptions.dashMode || "hold") === "toggle") {
    const dp = ctx.Input.pressed("dash");
    if (dp && !ctx.dashPrev) ctx.dashLatch = !ctx.dashLatch;
    ctx.dashPrev = dp;
  }
  // snapshot start-of-tick positions so render() can interpolate between ticks
  p.prx = p.rx; p.pry = p.ry;
  for (const rt of ctx.evRTs) { rt.prx = rt.rx; rt.pry = rt.ry; }
  // player motion — advance the current step, then (if it finished this tick) start the
  // next one immediately, so there's no dead frame at each tile. activePlayerControl()
  // stays false during events/battles, so chaining can't spawn a spurious move.
  if (p.moving) {
    const arrived = updateEntityMotion(p, wantsDash() ? 0.13 : 0.085);
    if (arrived) onPlayerStep();
  }
  if (!p.moving && p.route) {
    updateRoute(p);
  } else if (!p.moving && activePlayerControl()) {
    const d = ctx.Input.dir();
    if (ctx.Input.consume("attack")) {
      startPlayerAttack();
    } else if (d >= 0) {
      p.dir = d;
      const [dx, dy] = DIRD[d];
      const nx = p.x + dx,
        ny = p.y + dy;
      const blocker = blockingEventAt(nx, ny);
      if (
        blocker &&
        blocker.page.trigger === "touch" &&
        blocker.page.commands.length
      ) {
        runEventBlocking(blocker);
      } else if (tilePassable(nx, ny) && !blocker) {
        startMove(p, d);
        p.animT = p.animT || 0;
      }
    }
    if (ctx.Input.consume("ok")) checkActionTrigger();
    if (ctx.Input.consume("cancel")) fns.openMenu();
  }
  if (p.moving) p.animT = (p.animT || 0) + 0; // animT advanced in motion fn
  updateMapCombat();

  // events
  for (const rt of ctx.evRTs) {
    if (rt.erased || !rt.page) continue;
    // Same no-dead-frame pattern as the player above: a finished step chains into the next
    // route/random step this same tick instead of pausing a frame at each tile.
    if (rt.moving) {
      const arrived = updateEntityMotion(rt, rt.combat && rt.combat.knockback ? 0.18 : rt.speed);
      if (arrived && rt.combat) rt.combat.knockback = false;
    }
    if (!rt.moving && rt.route) {
      updateRoute(rt);
    } else if (!rt.moving) {
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
    // autorun / parallel
    if (
      !ctx.blockingRun &&
      rt.page.trigger === "auto" &&
      rt.page.commands.length
    ) {
      runEventBlocking(rt);
    }
    if (
      rt.page.trigger === "parallel" &&
      rt.page.commands.length &&
      !ctx.parallels.get(rt)
    ) {
      ctx.parallels.set(rt, true);
      new Interp(rt).runList(rt.page.commands).finally(async () => {
        await sleep(50);
        ctx.parallels.set(rt, false);
      });
    }
  }
  updateCommonEvents();
}

function onPlayerStep(): void {
  G.steps++;
  const p = G.player;
  // touch events on the tile we stepped onto
  if (!ctx.blockingRun) {
    const here = entityAt(p.x, p.y).find(
      (rt: any) =>
        rt.page.trigger === "touch" &&
        rt.page.commands.length &&
        (rt.page.priority !== "same" || rt.page.through),
    );
    if (here) {
      runEventBlocking(here);
      return;
    }
  }
  // random encounters
  const enc = ctx.map.encounters;
  if (enc && enc.rate > 0 && enc.troops.length && !ctx.blockingRun) {
    G.encSteps++;
    if (G.encSteps >= enc.rate * (0.7 + Math.random() * 0.6)) {
      G.encSteps = 0;
      const troopId = enc.troops[rnd(enc.troops.length)];
      sysSe("encounter");
      (async () => {
        const result = await fns.Battle.run(troopId, true);
        if (result === "lose") await fns.gameOver();
      })();
    }
  }
}

function checkActionTrigger(): void {
  const p = G.player;
  const [dx, dy] = DIRD[p.dir];
  const spots = [
    [p.x + dx, p.y + dy],
    [p.x, p.y],
  ];
  for (const [x, y] of spots) {
    const rt = entityAt(x, y).find(
      (r: any) => r.page.trigger === "action" && r.page.commands.length,
    );
    if (rt) {
      runEventBlocking(rt);
      return;
    }
  }
}
