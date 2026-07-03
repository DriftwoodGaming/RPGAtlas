/* RPGAtlas — src/engine/render-glue.ts
   The per-frame render glue, extracted verbatim from the js/engine.js
   monolith (Phase 1 Stage B). This is adapter code only: it composes the
   prerendered map buffers, interpolated sprites, shake/zoom camera, combat
   overlay, screen flash, and plugin render hooks onto the game canvas — the
   renderer itself (js/renderer.js WebGL2 HD-2D path and the Canvas 2D
   fallback) is untouched and ports in Phase 2. All mutable engine state
   (canvas context, scene, map buffers, camera/shake/flash scalars, loop
   accumulator) is read through the shared engine context.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets } from "../shared/deps.js";
import { Renderer } from "../renderer/index.js";
import { clamp } from "./util.js";
import { ctx } from "./state/engine-context.js";
import { G } from "./state/game-state.js";
import { Plugins } from "./plugin-runtime.js";
import {
  drawMapCombatOverlay,
  tilePassable,
  walkFrame,
  vehicleDrawables,
} from "./scenes/map-runtime.js";
import { updateHud } from "./hud.js";
// The fixed tick length is owned by the loop (src/engine/loop.ts); render()
// only uses it to interpolate by the leftover fraction. Function-scope use
// only, so the loop↔render-glue import cycle is eval-order safe.
import { TICK_MS } from "./loop.js";

const TILE = Assets.TILE;

export async function render(): Promise<void> {
  if (!ctx.g2d) return;
  updateHud(); // minimap + quest tracker (Phase 5; hides itself off-map)
  if (ctx.scene === "title" || ctx.scene === "gameover") return; // backdrop persists
  // hdActive is cached per map-load; if the GL context is lost mid-map, fall
  // back to the Canvas 2D path for as long as the loss lasts instead of
  // freezing on the last GL frame (Renderer recovers hdActive's underlying
  // resources on webglcontextrestored, so this is just a live override).
  const hdLive = ctx.hdActive && !(typeof Renderer !== "undefined" && Renderer.isLost());
  ctx.g2d.clearRect(0, 0, ctx.SCREEN_W, ctx.SCREEN_H);
  if (!hdLive || ctx.scene !== "map") {
    ctx.g2d.fillStyle = "#101018";
    ctx.g2d.fillRect(0, 0, ctx.SCREEN_W, ctx.SCREEN_H);
  }
  if (ctx.scene !== "map" && ctx.scene !== "battle") return;
  if (!ctx.map || !G.player) return;
  const p = G.player;
  let shakeX = 0,
    shakeY = 0;
  if (ctx.shakeTimer > 0) {
    const freq = ctx.shakeSpeed * 0.5;
    const decay = ctx.shakeTimer / (ctx.shakeDuration || 30);
    const amp =
      ctx.shakePower * 2.5 * decay *
      (ctx.playerOptions.shakeScale == null ? 1 : ctx.playerOptions.shakeScale);
    shakeX = Math.sin(ctx.globalT * freq) * amp;
    shakeY = Math.cos(ctx.globalT * freq * 0.85) * amp;
  }
  // blend between the previous and current tick by the loop's leftover time, so motion is
  // smooth on any refresh rate. Identity when an entity didn't move (prx == rx).
  const alpha = clamp(ctx.loopAcc / TICK_MS, 0, 1);
  const ip = (pv: any, cv: any) => (pv == null ? cv : pv + (cv - pv) * alpha);
  const pix = ip(p.prx, p.rx), piy = ip(p.pry, p.ry);
  const viewW = ctx.SCREEN_W / ctx.cameraZoom, viewH = ctx.SCREEN_H / ctx.cameraZoom;
  const camX = clamp(pix * TILE + TILE / 2 - viewW / 2, 0, Math.max(0, ctx.map.width * TILE - viewW));
  const camY = clamp(piy * TILE + TILE / 2 - viewH / 2, 0, Math.max(0, ctx.map.height * TILE - viewH));
  const drawables = [];
  for (const rt of ctx.evRTs) {
    if (rt.erased || !rt.page || rt.charsetIdx < 0) continue;
    drawables.push(rt);
  }
  // Phase 5: parked vehicles + party followers (followers hide while riding)
  if (ctx.scene === "map") {
    for (const v of vehicleDrawables()) drawables.push(v);
    if (ctx.proj.system.followers && !G.vehicle) {
      for (const f of G.followers || []) {
        if (f.charsetIdx >= 0) drawables.push(f);
      }
    }
  }
  if (!p.transparent) drawables.push(p);
  drawables.sort((a: any, b: any) => {
    const pa = a.page ? a.page.priority : "same",
      pb = b.page ? b.page.priority : "same";
    const oa = pa === "below" ? 0 : pa === "above" ? 2 : 1;
    const ob = pb === "below" ? 0 : pb === "above" ? 2 : 1;
    if (oa !== ob) return oa - ob;
    return a.ry - b.ry;
  });
  if (hdLive) {
    const sprites = [];
    for (const d of drawables) {
      const idx = d === p ? p.charsetIdx : d.charsetIdx;
      if (idx < 0) continue;
      const pri = d.page ? d.page.priority : "same";
      sprites.push({
        id:
          d === p
            ? "player"
            : d.followerId != null
              ? "fol_" + d.followerId
              : d.vehicleId
                ? "veh_" + d.vehicleId
                : "ev_" + d.ev.id,
        canvas: Assets.charFrameCanvas(idx, d.dir, walkFrame(d)),
        rx: ip(d.prx, d.rx), ry: ip(d.pry, d.ry),
        pr: pri === "below" ? 0 : pri === "above" ? 2 : 1,
      });
    }
    const lights = [];
    const lightsEnabled = !ctx.map.hd2d || ctx.map.hd2d.lights !== false;
    if (lightsEnabled) {
      // Event lights
      for (const rt of ctx.evRTs) {
        if (rt.light && !rt.erased && rt.page) {
          lights.push({ rx: ip(rt.prx, rt.rx), ry: ip(rt.pry, rt.ry), color: rt.light.color, radius: rt.light.radius });
        }
      }
      // Map lights
      if (ctx.map.lights) {
        for (const l of ctx.map.lights) lights.push(l);
      }
    }
    const ambient =
      ctx.map.hd2d && ctx.map.hd2d.ambient != null ? Number(ctx.map.hd2d.ambient) : 0.45;
    const tilt =
      ctx.map.hd2d && ctx.map.hd2d.tilt != null ? Number(ctx.map.hd2d.tilt) : 50;
    await Renderer.renderFrame(ctx.SCREEN_W, ctx.SCREEN_H, camX, camY, sprites, {
      focus: { rx: pix, ry: piy },
      lights,
      zoom: ctx.cameraZoom,
      shakeX,
      shakeY,
      ambient,
      tilt,
      tilePassable,
      t: ctx.globalT, // renderer animations (water waves etc.) key off the engine tick
      timeOfDay: G.timeOfDay == null ? 12 : G.timeOfDay,
    });
  }

  if (!hdLive) {
    ctx.g2d.save();
    ctx.g2d.translate(Math.round(shakeX), Math.round(shakeY));
    ctx.g2d.scale(ctx.cameraZoom, ctx.cameraZoom);
    ctx.g2d.drawImage(ctx.lowerBuf, -camX, -camY);
    for (const d of drawables) {
      const idx = d === p ? p.charsetIdx : d.charsetIdx;
      Assets.drawChar(ctx.g2d, idx, d.dir, walkFrame(d), Math.round(ip(d.prx, d.rx) * TILE - camX), Math.round(ip(d.pry, d.ry) * TILE - 8 - camY));
    }
    ctx.g2d.drawImage(ctx.upperBuf, -camX, -camY);
    ctx.g2d.restore();
  }
  drawMapCombatOverlay(ctx.g2d, camX, camY, shakeX, shakeY, alpha, pix, piy);
  if (ctx.flashTimer > 0) {
    const decay = ctx.flashTimer / (ctx.flashDuration || 15);
    ctx.g2d.save();
    ctx.g2d.fillStyle = ctx.flashColor;
    ctx.g2d.globalAlpha = ctx.flashOpacity * decay;
    ctx.g2d.fillRect(0, 0, ctx.SCREEN_W, ctx.SCREEN_H);
    ctx.g2d.restore();
  }
  if (ctx.scene === "map") Plugins.fireRender(ctx.g2d, {
    w: ctx.SCREEN_W, h: ctx.SCREEN_H, t: ctx.globalT, map: ctx.map,
    camX: camX, camY: camY, cameraZoom: ctx.cameraZoom,
    playerX: pix, playerY: piy, alpha: alpha, // interpolated player pos + blend factor
  });
}
