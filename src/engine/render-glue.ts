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
import { defaultWorld } from "./state/default-world.js";
import { playersOnMap } from "../shared/sim/players.js";
import { Plugins } from "./plugin-runtime.js";
import {
  drawMapCombatOverlay,
  drawMapParallax,
  tilePassable,
  walkFrame,
  vehicleDrawables,
} from "./scenes/map-runtime.js";
import { bushAt } from "./scenes/tile-behavior.js";
import { updateHud } from "./hud.js";
import { drawPresentation, scrollOffsetPx } from "./scenes/presentation-runtime.js";
import { motionReduced } from "./state/player-options.js";
import { weatherMotionScale } from "../shared/a11y.js";
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
  // Accessibility (Phase 7): one resolve per frame — stills the camera shake
  // entirely, softens full-screen flashes, and thins weather particles.
  const reduceMotion = motionReduced();
  let shakeX = 0,
    shakeY = 0;
  if (ctx.shakeTimer > 0 && !reduceMotion) {
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
  // Map-scene camera offset from a Scroll Map command (Project Compass M2·A);
  // added to the follow-camera before edge-clamping so it can't leave the map.
  const scr = ctx.scene === "map" ? scrollOffsetPx() : { x: 0, y: 0 };
  // Looping maps (Project Compass M4·A, Canvas-2D path only): the camera stays
  // centered on the player along a looping axis — the buffers draw wrapped
  // below. Bounded maps (and the HD path) keep the exact edge clamp.
  const loopH = !hdLive && !!(ctx.map.loop && ctx.map.loop.h);
  const loopV = !hdLive && !!(ctx.map.loop && ctx.map.loop.v);
  const rawCamX = pix * TILE + TILE / 2 - viewW / 2 + scr.x;
  const rawCamY = piy * TILE + TILE / 2 - viewH / 2 + scr.y;
  const camX = loopH ? rawCamX : clamp(rawCamX, 0, Math.max(0, ctx.map.width * TILE - viewW));
  const camY = loopV ? rawCamY : clamp(rawCamY, 0, Math.max(0, ctx.map.height * TILE - viewH));
  const drawables = [];
  for (const rt of ctx.evRTs) {
    if (rt.erased || !rt.page || rt.charsetIdx < 0) continue;
    drawables.push(rt);
  }
  // Phase 5: parked vehicles + party followers (followers hide while riding)
  if (ctx.scene === "map") {
    for (const v of vehicleDrawables()) drawables.push(v);
    if (ctx.proj.system.followers && !G.vehicle && !G.followersHidden) {
      for (const f of G.followers || []) {
        if (f.charsetIdx >= 0) drawables.push(f);
      }
    }
  }
  // Project Beacon MP4·A: remote players (the OTHER people in the room, on THIS
  // map) draw through the same interpolated/depth-sorted sprite path as party
  // followers. Their charset key resolves to a spritesheet index client-side;
  // an unknown key falls back to the local player's sprite. Solo renders none
  // (empty roster → `remotePlayers` empty → byte-identical goldens).
  const remotePlayers = ctx.scene === "map" ? playersOnMap(defaultWorld, G.mapId) : EMPTY_REMOTES;
  for (const rp of remotePlayers) {
    let ci = rp.charset ? Assets.charsetIndex(rp.charset) : -1;
    if (ci < 0) ci = p.charsetIdx | 0;
    drawables.push({
      remoteId: rp.id,
      x: rp.x, y: rp.y, rx: rp.rx, ry: rp.ry, prx: rp.prx, pry: rp.pry,
      dir: rp.dir, moving: rp.moving, animT: rp.animT,
      charsetIdx: ci, kind: (Assets.charsets[ci] && Assets.charsets[ci].kind) || "human",
      page: null,
    });
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
      const frame = walkFrame(d);
      // Bush tiles (M4·A): fade the sprite's feet (best-effort in HD).
      const bushy = !d.jumping && ctx.scene === "map" && bushAt(d.x, d.y);
      sprites.push({
        id:
          d === p
            ? "player"
            : d.remoteId != null
              ? "rp_" + d.remoteId
              : d.followerId != null
                ? "fol_" + d.followerId
                : d.vehicleId
                  ? "veh_" + d.vehicleId
                  : "ev_" + d.ev.id,
        canvas: bushy
          ? bushFadedFrame(idx, d.dir, frame)
          : Assets.charFrameCanvas(idx, d.dir, frame),
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
      motionScale: weatherMotionScale(reduceMotion),
    });
  }

  if (!hdLive) {
    const g = ctx.g2d;
    g.save();
    g.translate(Math.round(shakeX), Math.round(shakeY));
    g.scale(ctx.cameraZoom, ctx.cameraZoom);
    // Parallax background (M4·A): painted under the tile buffers; the buffers
    // of a parallax map are transparent where no tile is drawn. No-op without.
    drawMapParallax(g, camX, camY, viewW, viewH, ctx.globalT);
    // Looping maps draw the buffers wrapped so the seam never shows; bounded
    // maps take the verbatim single draw (goldens gate it).
    const mpw = ctx.map.width * TILE, mph = ctx.map.height * TILE;
    const xs = loopH ? [] : [-camX];
    if (loopH) for (let x = -(((camX % mpw) + mpw) % mpw); x < viewW; x += mpw) xs.push(x);
    const ys = loopV ? [] : [-camY];
    if (loopV) for (let y = -(((camY % mph) + mph) % mph); y < viewH; y += mph) ys.push(y);
    const drawBuf = (buf: any) => { for (const by of ys) for (const bx of xs) g.drawImage(buf, bx, by); };
    // A sprite's screen alias nearest the wrapped view (plus the seam twin).
    const charXs = (sx: number) => (loopH ? [((sx % mpw) + mpw) % mpw, (((sx % mpw) + mpw) % mpw) - mpw] : [sx]);
    const charYs = (sy: number) => (loopV ? [((sy % mph) + mph) % mph, (((sy % mph) + mph) % mph) - mph] : [sy]);
    drawBuf(ctx.lowerBuf);
    for (const d of drawables) {
      const idx = d === p ? p.charsetIdx : d.charsetIdx;
      const frame = walkFrame(d);
      // Bush tiles (M4·A): the character's feet fade to half alpha (MZ bush
      // depth 12px). bushAt short-circuits on maps without bush tiles.
      const bushy = !d.jumping && ctx.scene === "map" && bushAt(d.x, d.y);
      for (const sy of charYs(Math.round(ip(d.pry, d.ry) * TILE - 8 - camY))) {
        for (const sx of charXs(Math.round(ip(d.prx, d.rx) * TILE - camX))) {
          if (bushy) drawCharBush(g, idx, d.dir, frame, sx, sy);
          else Assets.drawChar(g, idx, d.dir, frame, sx, sy);
        }
      }
    }
    drawBuf(ctx.upperBuf);
    g.restore();
  }
  drawMapCombatOverlay(ctx.g2d, camX, camY, shakeX, shakeY, alpha, pix, piy);
  // MP4·A: name tags + social bubbles float above remote players (both render
  // paths, since they paint on the 2D overlay). No-op in solo (no remotes).
  if (ctx.scene === "map" && remotePlayers.length)
    drawRemotePresence(ctx.g2d, remotePlayers, camX, camY, ctx.cameraZoom, shakeX, shakeY, alpha);
  // Presentation layer (Project Compass M2·A): pictures, screen tint, balloons,
  // timer HUD — painted onto the 2D canvas over the map (works in HD + 2D),
  // below the screen flash. Map scene only.
  if (ctx.scene === "map") drawPresentation(ctx.g2d, camX, camY, TILE);
  if (ctx.flashTimer > 0) {
    const decay = ctx.flashTimer / (ctx.flashDuration || 15);
    ctx.g2d.save();
    ctx.g2d.fillStyle = ctx.flashColor;
    // Reduced motion halves flash intensity (photosensitivity) while keeping
    // the gameplay signal visible.
    ctx.g2d.globalAlpha = ctx.flashOpacity * decay * (reduceMotion ? 0.5 : 1);
    ctx.g2d.fillRect(0, 0, ctx.SCREEN_W, ctx.SCREEN_H);
    ctx.g2d.restore();
  }
  if (ctx.scene === "map") Plugins.fireRender(ctx.g2d, {
    w: ctx.SCREEN_W, h: ctx.SCREEN_H, t: ctx.globalT, map: ctx.map,
    camX: camX, camY: camY, cameraZoom: ctx.cameraZoom,
    playerX: pix, playerY: piy, alpha: alpha, // interpolated player pos + blend factor
  });
}

// ---- remote-player presence overlay (Project Beacon MP4) ----
/** Shared empty list so the solo render path allocates nothing per frame. */
const EMPTY_REMOTES: any[] = [];

/** How long an emote / say bubble stays up (world ticks; ~2.5s at 60 Hz). */
const PRESENCE_BUBBLE_TICKS = 150;

/** Draw remote players' name tags — and their transient emote / say bubbles
 *  (MP4·C) — on the 2D overlay, in the same shake+zoom+camera space the combat
 *  overlay uses (so it works in both the HD and Canvas-2D paths). The display
 *  name is the only PERSISTENT personal fact rendered (D6); bubbles are the
 *  always-on social layer (D4). Called only when at least one remote player
 *  stands on this map — never in solo. */
function drawRemotePresence(
  g: any, remotes: any[], camX: any, camY: any, zoom: any, shakeX: any, shakeY: any, alpha: any,
): void {
  const ipc = (pv: any, cv: any) => (pv == null ? cv : pv + (cv - pv) * alpha);
  const now = ctx.globalT;
  g.save();
  g.translate(Math.round(shakeX), Math.round(shakeY));
  g.scale(zoom, zoom);
  g.translate(-camX, -camY);
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  for (const rp of remotes) {
    const cx = (ipc(rp.prx, rp.rx) + 0.5) * TILE;
    const headY = ipc(rp.pry, rp.ry) * TILE - 6; // just above the sprite's head
    // Social bubble (emote / free-text say) — the most recent, if still fresh.
    const emote = rp.emote && now - rp.emote.t < PRESENCE_BUBBLE_TICKS ? rp.emote.id : null;
    const say = rp.say && now - rp.say.t < PRESENCE_BUBBLE_TICKS ? rp.say.text : null;
    const bubble = say || emote; // free text (say) wins over an emote token
    if (bubble) drawPresenceBubble(g, cx, headY - 16, String(bubble));
    if (rp.name) {
      g.font = "700 11px " + ((ctx.proj && ctx.proj.system.fontMenu) || "sans-serif");
      const w = g.measureText(rp.name).width;
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(cx - w / 2 - 3, headY - 12, w + 6, 14);
      g.fillStyle = "#ffffff";
      g.fillText(rp.name, cx, headY - 1);
    }
  }
  g.restore();
  g.globalAlpha = 1;
}

/** A rounded speech bubble centered at (cx) with its tail bottom at (baseY). */
function drawPresenceBubble(g: any, cx: number, baseY: number, text: string): void {
  g.font = "600 12px " + ((ctx.proj && ctx.proj.system.fontMenu) || "sans-serif");
  const w = Math.min(180, g.measureText(text).width) + 14;
  const h = 18;
  const x = cx - w / 2, y = baseY - h;
  const r = 7;
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.strokeStyle = "rgba(0,0,0,0.35)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
  g.stroke();
  // little tail
  g.beginPath();
  g.moveTo(cx - 4, y + h);
  g.lineTo(cx, y + h + 5);
  g.lineTo(cx + 4, y + h);
  g.fill();
  g.fillStyle = "#101018";
  g.fillText(text, cx, y + 13);
}

// ---- bush rendering helpers (Project Compass M4·A) ----
const BUSH_DEPTH = 12; // px of the sprite's feet drawn translucent (MZ value)

/** Canvas-2D path: draw a character with its bottom band at half alpha. The
 *  frame bottom sits at py + 8 + TILE (drawChar's -8 art offset). */
function drawCharBush(g: any, idx: any, dir: any, frame: any, px: number, py: number): void {
  const bandTop = py + 8 + TILE - BUSH_DEPTH;
  g.save();
  g.beginPath();
  g.rect(px - 24, py - 64, TILE + 48, bandTop - (py - 64));
  g.clip();
  Assets.drawChar(g, idx, dir, frame, px, py);
  g.restore();
  g.save();
  g.globalAlpha = 0.5;
  g.beginPath();
  g.rect(px - 24, bandTop, TILE + 48, BUSH_DEPTH + 24);
  g.clip();
  Assets.drawChar(g, idx, dir, frame, px, py);
  g.restore();
}

/** HD path: a copy of the cached charset frame with the bottom band faded
 *  (the cache canvas itself must stay untouched). */
function bushFadedFrame(idx: any, dir: any, frame: any): any {
  const src = Assets.charFrameCanvas(idx, dir, frame);
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext("2d")!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.fillRect(0, c.height - BUSH_DEPTH, c.width, BUSH_DEPTH);
  return c;
}
