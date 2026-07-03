/* RPGAtlas — src/engine/anim-glue.ts
   Map-side battle-animation playback (Phase 5 Stage A): the `playAnim` event
   command's engine half. Lazily creates one stage-level fx layer (under the
   uiLayer, so message windows stay on top) with its own battle-fx particle
   pool, converts entities to stage-local screen points via the same camera
   math render-glue uses, and feeds src/shared/anim-player.ts. Points are
   passed as plain {x,y} (stage coordinates) rather than DOM rects so the
   stage's CSS scale never enters the math. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, Sfx } from "../shared/deps.js";
import { clamp, el } from "./util.js";
import { ctx } from "./state/engine-context.js";
import { G } from "./state/game-state.js";
import { createBattleFx } from "../shared/battle-fx.js";
import { playAnimation } from "../shared/anim-player.js";
import { resolvePlaybackSheet } from "../shared/asset-library.js";

let fxBundle: any = null;
let fxLayer: any = null;

function ensureMapFx(): any {
  if (!fxBundle || !fxLayer || !fxLayer.isConnected) {
    fxLayer = el("div", "map-fx");
    ctx.stage.insertBefore(fxLayer, ctx.uiLayer);
    fxBundle = createBattleFx(fxLayer, fxLayer);
  }
  return fxBundle;
}

/** Stage-local screen point of a map entity (player or event runtime),
 *  replicating render-glue's camera clamp at fire time. */
export function entityScreenPoint(entity: any): { x: number; y: number } {
  const TILE = Assets.TILE;
  const p = G.player;
  const viewW = ctx.SCREEN_W / ctx.cameraZoom;
  const viewH = ctx.SCREEN_H / ctx.cameraZoom;
  const camX = clamp(p.rx * TILE + TILE / 2 - viewW / 2, 0, Math.max(0, ctx.map.width * TILE - viewW));
  const camY = clamp(p.ry * TILE + TILE / 2 - viewH / 2, 0, Math.max(0, ctx.map.height * TILE - viewH));
  return {
    x: (entity.rx * TILE + TILE / 2 - camX) * ctx.cameraZoom,
    y: (entity.ry * TILE + TILE * 0.3 - camY) * ctx.cameraZoom,
  };
}

/** Play a battle animation on the map. `targetEntity` = an event runtime or
 *  the player (null + screenAnchor=false falls back to the player); resolves
 *  when the animation completes. A no-op off the map scene or when the id
 *  doesn't resolve, so stray commands can't hang an event. */
export function playMapAnimation(animationId: any, targetEntity: any, screenAnchor: boolean): Promise<void> {
  const anim = RA.byId(ctx.proj.animations || [], Number(animationId) || 0);
  if (!anim || ctx.scene !== "map" || !G.player) return Promise.resolve();
  const fx = ensureMapFx();
  const screen = { x: ctx.SCREEN_W / 2, y: ctx.SCREEN_H * 0.45 };
  const entity = screenAnchor ? null : targetEntity || G.player;
  const targets = entity ? [entityScreenPoint(entity)] : [screen];
  return playAnimation(anim, {
    fx,
    source: targets[0],
    targets,
    screen,
    onSound: (se: string) => Sfx.play(se),
    resolveSheet: resolvePlaybackSheet,
    onShake: (power: number, speed: number, duration: number) => {
      ctx.shakePower = clamp(power, 1, 9);
      ctx.shakeSpeed = clamp(speed, 1, 9);
      ctx.shakeTimer = clamp(duration, 1, 600);
      ctx.shakeDuration = ctx.shakeTimer;
    },
    drawIcon: (index: number) => {
      // copy the cached icon frame — the cache canvas itself must stay off-DOM
      const src = Assets.iconCanvas(index);
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      c.getContext("2d")!.drawImage(src, 0, 0);
      return c;
    },
  });
}
