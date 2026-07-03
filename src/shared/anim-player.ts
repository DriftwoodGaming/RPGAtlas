/* RPGAtlas — src/shared/anim-player.ts
   The battle-animation player (Phase 5 Stage A). Plays a BattleAnimation —
   a flat timeline of timed effect items — over the battle-fx primitive
   bundle. Design keystones (docs/phase-5-spec.md):

   - The timeline is FLAT: items fire once when the tick cursor reaches their
     `at` (ticks, 60/s); each item's own duration/easing covers motion. No
     keyframe interpolation in v1.
   - The player WRAPS battle-fx, it does not replace it: bursts delegate to
     fx.burst; the extra emitters (ring/rain/spiral, flashes, projectiles,
     flipbooks) draw from the same fixed particle pool via fx.spawn/release.
   - Everything environmental is injected (fx bundle, sound/shake callbacks,
     clock, scheduler), so the scheduler core runs under plain node in tests
     and the same module serves the battle scene, the map's playAnim command,
     and the editor's live preview.
   - Target-anchored items replay per target (multi-target fan-out); `source`
     anchors on the acting battler; `screen` anchors at the window center
     (battle-fx's null-target convention).

   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AnimItem, BattleAnimation } from "./schema";

export interface AnimEnv {
  /** The createBattleFx bundle the effects draw through. */
  fx: any;
  /** Acting battler: a DOM element or a win-relative {x,y} point. */
  source?: any;
  /** Targets: DOM elements or win-relative {x,y} points. */
  targets?: any[];
  /** Explicit screen-center anchor point. Absent = battle-fx's null-target
   *  convention (the window's visual center) — the map glue passes one
   *  because its coordinates are stage-local, not rect-derived. */
  screen?: any;
  onSound?: (se: string) => void;
  /** Same units as the `shake` event command (power 1-9, speed 1-9, frames). */
  onShake?: (power: number, speed: number, duration: number) => void;
  /** Canvas factory for flipbook items with sheet === "icons". */
  drawIcon?: (index: number) => any;
  /** Resolve a non-"icons" flipbook sheet reference to a drawable URL —
   *  Phase 6 asset keys ("asset:characters/…") resolve through the library;
   *  plain URLs pass through unchanged. Absent/null result = use as-is. */
  resolveSheet?: (sheet: string) => string | null | undefined;
  /** Millisecond clock (tests inject a manual one). Default performance.now. */
  now?: () => number;
  /** Frame scheduler (tests drive manually). Default requestAnimationFrame. */
  schedule?: (cb: () => void) => void;
}

const TICKS_PER_SEC = 60;

/** Effect length of one item, in ticks (0 = instantaneous). */
export function itemDurationTicks(item: AnimItem): number {
  switch (item.type) {
    case "sound":
      return 0;
    case "shake":
      return Math.max(0, Number(item.duration) || 20);
    case "flipbook": {
      const frames = Math.max(1, (Number(item.to) || 0) - (Number(item.from) || 0) + 1);
      const fps = Math.max(1, Number(item.fps) || 10);
      return Math.ceil((frames / fps) * TICKS_PER_SEC);
    }
    case "flash":
      return msToTicks(item.duration, 300);
    case "projectile":
      return msToTicks(item.duration, 330);
    default: // particles
      return msToTicks(item.duration, 470);
  }
}
function msToTicks(ms: any, def: number): number {
  return Math.ceil((Math.max(1, Number(ms) || def) / 1000) * TICKS_PER_SEC);
}

/** Total timeline length in ticks: the latest item end. */
export function animDurationTicks(anim: BattleAnimation): number {
  let end = 0;
  for (const item of anim.items || []) {
    end = Math.max(end, (Number(item.at) || 0) + itemDurationTicks(item));
  }
  return end;
}

/** The anchor points one item fires at (null = battle-fx screen center). */
export function anchorPoints(anim: BattleAnimation, item: AnimItem, env: AnimEnv): any[] {
  const anchor = item.anchor || anim.target || "target";
  if (anchor === "screen") return [env.screen == null ? null : env.screen];
  if (anchor === "source") return [env.source == null ? null : env.source];
  const targets = env.targets && env.targets.length ? env.targets : [null];
  return targets;
}

// ---- extra emitters over the shared pool ----

function releaseWhenDone(fx: any, p: any, anim: any): void {
  anim.finished.then(() => fx.release(p)).catch(() => fx.release(p));
}

function emitShaped(fx: any, pt: any, item: AnimItem): void {
  const point = fx.fxPoint(pt);
  const count = Math.max(1, Number(item.count) || 12);
  const radius = Number(item.radius) || 42;
  const baseSize = Number(item.size) || 7;
  const duration = Math.max(1, Number(item.duration) || 470);
  const color = item.color || "";
  const palette: string[] = color ? [color] : ["#ffffff", "#ffe9a8", "#9adcff"];
  for (let i = 0; i < count; i++) {
    const p = fx.spawn("fx-" + (item.kind || "anim"));
    const size = baseSize * (0.65 + Math.random() * 0.7);
    const frac = i / count;
    p.style.width = size + "px";
    p.style.height = size + "px";
    p.style.background = color || palette[i % palette.length];
    p.style.boxShadow = "0 0 " + Math.ceil(size * 1.8) + "px currentColor";
    let frames: any[];
    if (item.shape === "ring") {
      // an even circle expanding from 40% radius to full, fading out
      const angle = frac * Math.PI * 2;
      const sx = Math.cos(angle) * radius * 0.4, sy = Math.sin(angle) * radius * 0.4;
      const ex = Math.cos(angle) * radius, ey = Math.sin(angle) * radius;
      p.style.left = point.x + sx + "px";
      p.style.top = point.y + sy + "px";
      frames = [
        { opacity: 0, transform: "translate(-50%,-50%) scale(.4)" },
        { opacity: 1, offset: 0.2 },
        { opacity: 0, transform: "translate(calc(-50% + " + (ex - sx) + "px),calc(-50% + " + (ey - sy) + "px)) scale(.2)" },
      ];
    } else if (item.shape === "rain") {
      // drops falling from above the point into its area
      const dx = (Math.random() - 0.5) * radius * 2;
      p.style.left = point.x + dx + "px";
      p.style.top = point.y - radius - 26 + "px";
      frames = [
        { opacity: 0, transform: "translate(-50%,-50%) scale(.8)" },
        { opacity: 1, offset: 0.15 },
        { opacity: 0.9, transform: "translate(-50%,calc(-50% + " + (radius + 26) + "px)) scale(.5)", offset: 0.9 },
        { opacity: 0, transform: "translate(-50%,calc(-50% + " + (radius + 30) + "px)) scale(.2)" },
      ];
    } else {
      // spiral: rise while orbiting the anchor
      const turns = 1.25;
      const angle = frac * Math.PI * 2;
      const sx = Math.cos(angle) * radius * 0.6, sy = Math.sin(angle) * radius * 0.3;
      const ea = angle + turns * Math.PI;
      const ex = Math.cos(ea) * radius * 0.25, ey = Math.sin(ea) * radius * 0.12 - radius * 0.9;
      p.style.left = point.x + sx + "px";
      p.style.top = point.y + sy + "px";
      frames = [
        { opacity: 0, transform: "translate(-50%,-50%) scale(.4)" },
        { opacity: 1, offset: 0.25 },
        { opacity: 0, transform: "translate(calc(-50% + " + (ex - sx) + "px),calc(-50% + " + (ey - sy) + "px)) scale(.15)" },
      ];
    }
    releaseWhenDone(
      fx, p,
      p.animate(frames, {
        duration,
        delay: item.shape === "rain" ? frac * duration * 0.5 : (i % 5) * 16,
        easing: "cubic-bezier(.3,.6,.4,1)",
        fill: "backwards",
      }),
    );
  }
}

function emitFlash(fx: any, pt: any, item: AnimItem, screen: boolean): void {
  const duration = Math.max(1, Number(item.duration) || 300);
  const opacity = Math.min(1, Math.max(0.02, Number(item.opacity) || 0.6));
  const p = fx.spawn("fx-anim-flash");
  p.style.background = item.color || "#ffffff";
  if (screen) {
    p.style.left = "0";
    p.style.top = "0";
    p.style.width = "100%";
    p.style.height = "100%";
    p.style.borderRadius = "0";
    p.style.transform = "none";
  } else {
    const point = fx.fxPoint(pt);
    const size = (Number(item.radius) || 46) * 2;
    p.style.left = point.x + "px";
    p.style.top = point.y + "px";
    p.style.width = size + "px";
    p.style.height = size + "px";
    p.style.borderRadius = "50%";
    p.style.boxShadow = "0 0 " + Math.ceil(size * 0.6) + "px currentColor";
    p.style.transform = "translate(-50%,-50%)";
  }
  releaseWhenDone(
    fx, p,
    p.animate(
      [{ opacity: 0 }, { opacity, offset: 0.25 }, { opacity: 0 }],
      { duration, easing: "ease-out" },
    ),
  );
}

function emitProjectile(fx: any, from: any, to: any, item: AnimItem): void {
  const fromPt = fx.fxPoint(from), toPt = fx.fxPoint(to);
  const size = Number(item.size) || 10;
  const p = fx.spawn("fx-projectile fx-anim-bolt");
  p.style.left = fromPt.x + "px";
  p.style.top = fromPt.y + "px";
  p.style.width = size + "px";
  p.style.height = size + "px";
  p.style.background = item.color || "#ffffff";
  if (item.trail !== false) {
    p.style.boxShadow = "0 0 " + size * 2 + "px currentColor, 0 0 " + size * 4 + "px currentColor";
  }
  const dx = toPt.x - fromPt.x, dy = toPt.y - fromPt.y;
  releaseWhenDone(
    fx, p,
    p.animate(
      [
        { opacity: 0, transform: "translate(-50%,-50%) scale(.4)" },
        { opacity: 1, offset: 0.12 },
        { opacity: 1, transform: "translate(calc(-50% + " + dx + "px),calc(-50% + " + dy + "px)) scale(1.3)", offset: 0.88 },
        { opacity: 0, transform: "translate(calc(-50% + " + dx + "px),calc(-50% + " + dy + "px)) scale(2)" },
      ],
      { duration: Math.max(1, Number(item.duration) || 330), easing: "cubic-bezier(.2,.7,.3,1)" },
    ),
  );
}

// ---- flipbooks (frame-stepped in the player's own tick loop) ----

interface FlipbookRT {
  item: AnimItem;
  el: any;
  startTick: number;
  lastFrame: number;
  done: boolean;
}

function startFlipbook(fx: any, pt: any, item: AnimItem, tick: number, env?: AnimEnv): FlipbookRT {
  const point = fx.fxPoint(pt);
  const scale = Number(item.scale) || 1;
  const cell = Math.round(48 * scale);
  const el = fx.spawn("fx-anim-flipbook");
  el.style.left = point.x + "px";
  el.style.top = point.y + "px";
  el.style.width = cell + "px";
  el.style.height = cell + "px";
  el.style.transform = "translate(-50%,-50%)";
  el.style.background = "transparent";
  let sheet = String(item.sheet || "icons");
  if (sheet !== "icons" && env && env.resolveSheet) sheet = env.resolveSheet(sheet) || sheet;
  if (sheet !== "icons") {
    const cols = Math.max(1, Number(item.cols) || 1);
    const rows = Math.max(1, Number(item.rows) || 1);
    el.style.backgroundImage = "url(" + JSON.stringify(sheet) + ")";
    el.style.backgroundSize = cols * 100 + "% " + rows * 100 + "%";
    el.style.imageRendering = "pixelated";
  }
  return { item, el, startTick: tick, lastFrame: -1, done: false };
}

function updateFlipbook(fx: any, flip: FlipbookRT, tick: number, env: AnimEnv): void {
  if (flip.done) return;
  const item = flip.item;
  const from = Number(item.from) || 0;
  const to = Math.max(from, Number(item.to) || 0);
  const fps = Math.max(1, Number(item.fps) || 10);
  const frame = Math.floor(((tick - flip.startTick) / TICKS_PER_SEC) * fps);
  if (from + frame > to) {
    flip.done = true;
    fx.release(flip.el);
    return;
  }
  if (frame === flip.lastFrame) return;
  flip.lastFrame = frame;
  const idx = from + frame;
  if (String(item.sheet || "icons") === "icons") {
    flip.el.textContent = "";
    const canvas = env.drawIcon && env.drawIcon(idx);
    if (canvas) {
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      flip.el.appendChild(canvas);
    }
  } else {
    const cols = Math.max(1, Number(item.cols) || 1);
    const rows = Math.max(1, Number(item.rows) || 1);
    const col = idx % cols, rowI = Math.floor(idx / cols) % rows;
    flip.el.style.backgroundPosition =
      (cols === 1 ? 0 : (col / (cols - 1)) * 100) + "% " +
      (rows === 1 ? 0 : (rowI / (rows - 1)) * 100) + "%";
  }
}

// ---- the player ----

function fireItem(anim: BattleAnimation, item: AnimItem, env: AnimEnv, live: FlipbookRT[], tick: number): void {
  const fx = env.fx;
  switch (item.type) {
    case "sound":
      if (env.onSound && item.se) env.onSound(item.se);
      return;
    case "shake":
      if (env.onShake) {
        env.onShake(Number(item.power) || 5, Number(item.speed) || 5, Math.max(1, Number(item.duration) || 20));
      }
      return;
    case "flash": {
      const screen = (item.anchor || anim.target) === "screen";
      if (screen) emitFlash(fx, null, item, true);
      else for (const pt of anchorPoints(anim, item, env)) emitFlash(fx, pt, item, false);
      return;
    }
    case "projectile": {
      const from = env.source == null ? null : env.source;
      const targets = env.targets && env.targets.length ? env.targets : [null];
      for (const t of targets) emitProjectile(fx, from, t, item);
      return;
    }
    case "flipbook":
      for (const pt of anchorPoints(anim, item, env)) live.push(startFlipbook(fx, pt, item, tick, env));
      return;
    default: // particles
      for (const pt of anchorPoints(anim, item, env)) {
        if (item.shape && item.shape !== "burst") {
          emitShaped(fx, pt, item);
        } else {
          fx.burst(pt, item.kind || "", {
            color: item.color || null,
            count: item.count,
            radius: item.radius,
            size: item.size,
            duration: item.duration,
          });
        }
      }
      return;
  }
}

/** Play `anim` to completion (resolves when the last item's effect ends).
 *  The scheduler core is injectable; by default it runs on rAF with the
 *  wall clock at 60 ticks/s. */
export function playAnimation(anim: BattleAnimation, env: AnimEnv): Promise<void> {
  const items = (anim && Array.isArray(anim.items) ? anim.items : [])
    .slice()
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  if (!items.length) return Promise.resolve();
  const now = env.now || (() => performance.now());
  const schedule = env.schedule || ((cb: () => void) => requestAnimationFrame(cb));
  const totalTicks = animDurationTicks(anim);
  const start = now();
  const live: FlipbookRT[] = [];
  let fired = 0;
  return new Promise((resolve) => {
    function step(): void {
      const tick = ((now() - start) / 1000) * TICKS_PER_SEC;
      while (fired < items.length && (Number(items[fired].at) || 0) <= tick) {
        fireItem(anim, items[fired], env, live, tick);
        fired++;
      }
      for (const flip of live) updateFlipbook(env.fx, flip, tick, env);
      for (let i = live.length - 1; i >= 0; i--) if (live[i].done) live.splice(i, 1);
      if (fired >= items.length && tick >= totalTicks && !live.length) {
        resolve();
        return;
      }
      schedule(step);
    }
    step();
  });
}
