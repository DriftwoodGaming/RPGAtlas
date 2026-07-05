/* RPGAtlas — src/engine/scenes/presentation-runtime.ts
   Project Compass M2·A: the on-screen presentation runtime — pictures, screen
   tint, the count-down timer, map scroll, balloon icons, and scrolling text.

   These are the RPG Maker MZ/MV presentation features (event codes 231–235,
   223/221/222, 124, 204, 213, 105) reborn as first-class Atlas engine features.
   All the mutable screen state lives here as module singletons, following the
   codebase's established "advance a mutable scalar in update()" pattern (the
   shake/flash timers on the engine context): tweens store a target + a frame
   countdown, and updatePresentation()/tickTimer() — called once per map tick
   from scenes/map.ts — advance them deterministically. drawPresentation() paints
   everything onto the shared 2D canvas (ctx.g2d) after the map composites, so it
   shows on #gamecanvas in BOTH the HD-2D (WebGL) and Canvas-2D paths, exactly
   like the existing screen flash.

   Pictures, the screen tint, and the timer are persistent state that rides
   save/load (serializePresentation/restorePresentation). The scroll offset and
   balloons are transient (reset on map load / not saved), matching RM.

   No DOM at module scope and no render/map imports → no cycles. GPL-3.0-or-later. */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets } from "../../shared/deps.js";
import { assetUrlSync, isAssetKey } from "../../shared/asset-library.js";
import { el } from "../util.js";
import { pushUI, removeUI } from "../ui-stack.js";
import { ctx } from "../state/engine-context.js";
import { G } from "../state/game-state.js";

// ---------------------------------------------------------------------------
// Types + module state
// ---------------------------------------------------------------------------
type Tone = [number, number, number, number]; // [red, green, blue, gray]

interface Tween<T> { from: T; to: T; left: number; total: number; }

interface Picture {
  id: number;
  name: string;
  img: HTMLImageElement | null;
  origin: number; // 0 upper-left, 1 center
  x: number; y: number;
  sx: number; sy: number; // scale (1 = 100%)
  opacity: number; // 0..255
  blend: number; // 0 normal · 1 add · 2 multiply · 3 screen
  angle: number; // degrees
  angVel: number; // degrees per tick
  tone: Tone;
  move: (Tween<{ x: number; y: number; sx: number; sy: number; opacity: number }> & { origin: number; blend: number }) | null;
  toneTween: Tween<Tone> | null;
  // Lazily-built tinted copy of the image (only while a non-zero tone is set).
  _tc?: HTMLCanvasElement | null;
  _tcSig?: string;
}

interface TimerState { running: boolean; frames: number; common: number; }

const NORMAL_TONE: Tone = [0, 0, 0, 0];

const pictures = new Map<number, Picture>();
let tint: Tone = [...NORMAL_TONE] as Tone;
let tintTween: Tween<Tone> | null = null;
let timer: TimerState = { running: false, frames: 0, common: 0 };
const scroll = { x: 0, y: 0 }; // camera offset in tiles
let scrollTween: (Tween<{ x: number; y: number }>) | null = null;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const num = (v: any): number => (typeof v === "number" ? v : Number(v) || 0);
// Smoothstep, matching the cameraZoom tween's easing.
const ease = (t: number): number => t * t * (3 - 2 * t);
const toneEq = (a: Tone, b: Tone): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

// ---------------------------------------------------------------------------
// Picture image resolution + loading
// ---------------------------------------------------------------------------
/** An "asset:*" key resolves through the shared library / embedded assets; any
 *  other string is used verbatim as an image URL or data-URL. Null when an
 *  asset key has no materialized blob (imported RM picture art that hasn't been
 *  re-added yet) — the picture then simply draws nothing, exactly like RM. */
export function resolvePictureSrc(name: string): string | null {
  if (!name) return null;
  if (isAssetKey(name)) return assetUrlSync(name);
  return name;
}

function loadPictureImage(pic: Picture): void {
  const src = resolvePictureSrc(pic.name);
  if (!src || typeof Image === "undefined") { pic.img = null; return; }
  const img = new Image();
  img.onload = () => { if (pictures.get(pic.id) === pic) pic.img = img; };
  img.onerror = () => { /* missing art → draws nothing, never a crash */ };
  img.src = src;
}

// ---------------------------------------------------------------------------
// Picture operations (231–235)
// ---------------------------------------------------------------------------
export function showPicture(c: any): void {
  const id = num(c.id) || 1;
  const pic: Picture = {
    id,
    name: String(c.name || ""),
    img: null,
    origin: num(c.origin),
    x: num(c.x), y: num(c.y),
    sx: (c.scaleX == null ? 100 : num(c.scaleX)) / 100,
    sy: (c.scaleY == null ? 100 : num(c.scaleY)) / 100,
    opacity: c.opacity == null ? 255 : clamp(num(c.opacity), 0, 255),
    blend: num(c.blend),
    angle: 0,
    angVel: 0,
    tone: [...NORMAL_TONE] as Tone,
    move: null,
    toneTween: null,
  };
  pictures.set(id, pic);
  loadPictureImage(pic);
}

export function movePicture(c: any): void {
  const pic = pictures.get(num(c.id));
  if (!pic) return;
  const to = {
    x: num(c.x), y: num(c.y),
    sx: (c.scaleX == null ? pic.sx * 100 : num(c.scaleX)) / 100,
    sy: (c.scaleY == null ? pic.sy * 100 : num(c.scaleY)) / 100,
    opacity: c.opacity == null ? pic.opacity : clamp(num(c.opacity), 0, 255),
  };
  const frames = Math.max(0, Math.floor(num(c.frames)));
  const origin = c.origin == null ? pic.origin : num(c.origin);
  const blend = c.blend == null ? pic.blend : num(c.blend);
  if (!frames) {
    pic.x = to.x; pic.y = to.y; pic.sx = to.sx; pic.sy = to.sy; pic.opacity = to.opacity;
    pic.origin = origin; pic.blend = blend; pic.move = null;
    return;
  }
  pic.origin = origin; pic.blend = blend; // origin/blend snap immediately (as in RM)
  pic.move = { from: { x: pic.x, y: pic.y, sx: pic.sx, sy: pic.sy, opacity: pic.opacity }, to, left: frames, total: frames, origin, blend };
}

export function rotatePicture(c: any): void {
  const pic = pictures.get(num(c.id));
  if (pic) pic.angVel = num(c.speed);
}

export function tintPicture(c: any): void {
  const pic = pictures.get(num(c.id));
  if (!pic) return;
  const target = normTone(c.tone);
  const frames = Math.max(0, Math.floor(num(c.frames)));
  if (!frames) { pic.tone = target; pic.toneTween = null; return; }
  pic.toneTween = { from: [...pic.tone] as Tone, to: target, left: frames, total: frames };
}

export function erasePicture(c: any): void {
  pictures.delete(num(c.id));
}

/** True while a picture is still tweening a move or a tint (drives `wait`). */
export function pictureBusy(id: number): boolean {
  const pic = pictures.get(num(id));
  return !!pic && (!!pic.move || !!pic.toneTween);
}

// ---------------------------------------------------------------------------
// Screen tint (223 / 221 / 222)
// ---------------------------------------------------------------------------
function normTone(t: any): Tone {
  const a = Array.isArray(t) ? t : [0, 0, 0, 0];
  return [
    clamp(num(a[0]), -255, 255),
    clamp(num(a[1]), -255, 255),
    clamp(num(a[2]), -255, 255),
    clamp(num(a[3]), 0, 255),
  ];
}

export function tintScreen(c: any): void {
  const target = normTone(c.tone);
  const frames = Math.max(0, Math.floor(num(c.frames)));
  if (!frames) { tint = target; tintTween = null; return; }
  tintTween = { from: [...tint] as Tone, to: target, left: frames, total: frames };
}

/** True while the screen tint is still tweening (drives `wait`). */
export function tintBusy(): boolean { return !!tintTween; }

// ---------------------------------------------------------------------------
// Count-down timer (124)
// ---------------------------------------------------------------------------
export function startTimer(seconds: number, common?: number): void {
  timer = { running: true, frames: Math.max(0, Math.round(seconds * 60)), common: num(common) };
}
export function stopTimer(): void { timer.running = false; }

/** Advance the timer one tick. Returns the expiry common-event id when the
 *  timer JUST reached 0 this tick (so scenes/map.ts can fire it), else 0. */
export function tickTimer(): number {
  if (!timer.running || timer.frames <= 0) return 0;
  timer.frames--;
  if (timer.frames <= 0) {
    timer.running = false;
    return timer.common || 0;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Map scroll (204)
// ---------------------------------------------------------------------------
const SCROLL_DELTA: Record<string, [number, number]> = {
  up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0],
};
export function scrollMap(c: any): void {
  const [dx, dy] = SCROLL_DELTA[String(c.dir)] || [0, 0];
  const distance = Math.max(0, num(c.distance));
  const speed = clamp(num(c.speed) || 4, 1, 6);
  // RM: distance-per-frame = 2^speed / 256 tiles → total frames for `distance`.
  const frames = Math.max(1, Math.round((distance * 256) / Math.pow(2, speed)));
  const to = { x: scroll.x + dx * distance, y: scroll.y + dy * distance };
  scrollTween = { from: { x: scroll.x, y: scroll.y }, to, left: frames, total: frames };
}
export function scrollBusy(): boolean { return !!scrollTween; }
/** Camera offset in pixels (added to the follow-camera before edge-clamping). */
export function scrollOffsetPx(): { x: number; y: number } {
  const TILE = Assets.TILE;
  return { x: scroll.x * TILE, y: scroll.y * TILE };
}
/** Clear the transient scroll offset (called on map transfer). */
export function resetScroll(): void { scroll.x = scroll.y = 0; scrollTween = null; }

// ---------------------------------------------------------------------------
// Balloon icons (213) — transient state parked on the target entity runtime
// ---------------------------------------------------------------------------
const BALLOON_FRAMES = 64; // total on-screen ticks (~1.1s)
const BALLOON_GLYPH: Record<number, string> = {
  1: "!", 2: "?", 3: "♪", 4: "♥", 5: "✹", 6: "✧",
  7: "≈", 8: "…", 9: "☼", 10: "z",
};
/** entity is G.player or an event runtime (has rx/ry). */
export function showBalloon(entity: any, balloonId: number): void {
  if (!entity) return;
  entity.balloon = { id: clamp(num(balloonId) || 1, 1, 15), start: ctx.globalT, dur: BALLOON_FRAMES };
}

// ---------------------------------------------------------------------------
// Scrolling text (105) — a self-animating UI overlay
// ---------------------------------------------------------------------------
/** Full-screen scrolling text. Resolves when the text has scrolled off the top
 *  or the player skips with OK/Cancel. Uses the passed frameWait (services.
 *  frameWait) as its tick source so the module stays render/loop-cycle-free. */
export async function showScrollText(
  text: string,
  speed: number,
  noFast: boolean,
  frameWait: () => Promise<void>,
): Promise<void> {
  if (typeof document === "undefined" || !ctx.uiLayer) return;
  const win = el("div", "scrolltextwin");
  const inner = el("div", "scrolltext-inner");
  inner.textContent = String(text || "");
  win.appendChild(inner);
  const state = { fast: false, done: false };
  const ui = {
    el: win,
    onKey(k: string) {
      if (k === "ok") state.fast = true;
      else if (k === "cancel") state.done = true;
    },
  };
  ctx.uiLayer.appendChild(win);
  pushUI(ui);
  try {
    // Content starts just below the screen and scrolls up until fully gone.
    const h = ctx.SCREEN_H || 624;
    const contentH = inner.offsetHeight || 0;
    let y = h;
    const end = -contentH - 8;
    const base = clamp(num(speed) || 2, 1, 8);
    while (y > end && !state.done) {
      const perTick = base * (state.fast && !noFast ? 3 : 1);
      if (!noFast) state.fast = false; // re-armed each tick while OK is held
      y -= perTick;
      inner.style.transform = "translateY(" + Math.round(y) + "px)";
      await frameWait();
    }
  } finally {
    removeUI(ui);
  }
}

// ---------------------------------------------------------------------------
// Per-tick advance (called from scenes/map.ts update)
// ---------------------------------------------------------------------------
function stepTween<T extends Record<string, number>>(tw: Tween<T>, apply: (v: T) => void): boolean {
  tw.left--;
  const t = ease((tw.total - tw.left) / tw.total);
  const cur: any = {};
  for (const k of Object.keys(tw.from)) cur[k] = (tw.from as any)[k] + ((tw.to as any)[k] - (tw.from as any)[k]) * t;
  apply(cur as T);
  return tw.left <= 0;
}

export function updatePresentation(): void {
  // pictures: move + tone tweens, continuous rotation
  for (const pic of pictures.values()) {
    if (pic.angVel) pic.angle = (pic.angle + pic.angVel) % 360;
    if (pic.move) {
      const done = stepTween(pic.move, (v) => { pic.x = v.x; pic.y = v.y; pic.sx = v.sx; pic.sy = v.sy; pic.opacity = v.opacity; });
      if (done) { pic.origin = pic.move.origin; pic.blend = pic.move.blend; pic.move = null; }
    }
    if (pic.toneTween) {
      const tw = pic.toneTween;
      tw.left--;
      const t = ease((tw.total - tw.left) / tw.total);
      pic.tone = tw.from.map((f, i) => Math.round(f + (tw.to[i] - f) * t)) as Tone;
      if (tw.left <= 0) { pic.tone = tw.to; pic.toneTween = null; }
    }
  }
  // screen tint tween
  if (tintTween) {
    const tw = tintTween;
    tw.left--;
    const t = ease((tw.total - tw.left) / tw.total);
    tint = tw.from.map((f, i) => Math.round(f + (tw.to[i] - f) * t)) as Tone;
    if (tw.left <= 0) { tint = tw.to; tintTween = null; }
  }
  // map scroll tween
  if (scrollTween) {
    const done = stepTween(scrollTween, (v) => { scroll.x = v.x; scroll.y = v.y; });
    if (done) { scroll.x = scrollTween.to.x; scroll.y = scrollTween.to.y; scrollTween = null; }
  }
}

// ---------------------------------------------------------------------------
// Rendering (called from render-glue after the map composites)
// ---------------------------------------------------------------------------
const BLEND_OP = ["source-over", "lighter", "multiply", "screen"];

function darken(v: number): number { return 255 + Math.min(0, v); }
function bright(v: number): number { return Math.max(0, v); }

/** Two-pass tone overlay approximating RM's screen tone: a multiply pass
 *  darkens, a lighter pass brightens; `gray` desaturates via a light grey
 *  overlay. `reduce` halves it (photosensitivity) only for the whole-screen
 *  tint, not pictures. */
function paintTone(g: any, tone: Tone, w: number, h: number): void {
  const [r, gr, b, gray] = tone;
  g.save();
  g.globalCompositeOperation = "multiply";
  g.fillStyle = "rgb(" + darken(r) + "," + darken(gr) + "," + darken(b) + ")";
  g.fillRect(0, 0, w, h);
  if (r > 0 || gr > 0 || b > 0) {
    g.globalCompositeOperation = "lighter";
    g.fillStyle = "rgb(" + bright(r) + "," + bright(gr) + "," + bright(b) + ")";
    g.fillRect(0, 0, w, h);
  }
  if (gray > 0) {
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = Math.min(1, gray / 255) * 0.5;
    g.fillStyle = "#808080";
    g.fillRect(0, 0, w, h);
  }
  g.restore();
}

/** Build (and cache) a tinted copy of a picture image using the tone passes,
 *  masked back to the image's own alpha so transparent regions stay clear. */
function tintedPictureCanvas(pic: Picture): HTMLCanvasElement | null {
  const img = pic.img;
  if (!img || typeof document === "undefined") return null;
  const sig = pic.tone.join(",") + "@" + (img.naturalWidth || 0) + "x" + (img.naturalHeight || 0);
  if (pic._tc && pic._tcSig === sig) return pic._tc;
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d");
  if (!g) return null;
  g.drawImage(img, 0, 0);
  paintTone(g, pic.tone, w, h);
  g.globalCompositeOperation = "destination-in"; // clip the tone back to the image silhouette
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "source-over";
  pic._tc = cv; pic._tcSig = sig;
  return cv;
}

function drawPictures(g: any): void {
  const ids = [...pictures.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const pic = pictures.get(id)!;
    if (!pic.img || pic.opacity <= 0) continue;
    const iw = pic.img.naturalWidth || pic.img.width;
    const ih = pic.img.naturalHeight || pic.img.height;
    const toneActive = !toneEq(pic.tone, NORMAL_TONE);
    const src = toneActive ? tintedPictureCanvas(pic) || pic.img : pic.img;
    if (toneEq(pic.tone, NORMAL_TONE) && pic._tc) { pic._tc = null; pic._tcSig = undefined; }
    g.save();
    g.globalAlpha = clamp(pic.opacity / 255, 0, 1);
    g.globalCompositeOperation = BLEND_OP[pic.blend] || "source-over";
    g.translate(pic.x, pic.y);
    if (pic.angle) g.rotate((pic.angle * Math.PI) / 180);
    g.scale(pic.sx, pic.sy);
    if (pic.origin === 1) g.drawImage(src, -iw / 2, -ih / 2);
    else g.drawImage(src, 0, 0);
    g.restore();
  }
}

function drawBalloon(g: any, entity: any, camX: number, camY: number, TILE: number): void {
  const bl = entity && entity.balloon;
  if (!bl) return;
  const age = ctx.globalT - bl.start;
  if (age < 0 || age >= bl.dur) { entity.balloon = null; return; }
  const glyph = BALLOON_GLYPH[bl.id] || "!";
  // A little pop-in / bob, from the sprite's head.
  const pop = Math.min(1, age / 6);
  const bob = Math.sin(age * 0.25) * 2;
  const cx = Math.round((entity.rx + 0.5) * TILE - camX);
  const cy = Math.round(entity.ry * TILE - camY - 10 - bob - (1 - pop) * 6);
  const rw = 22, rh = 20;
  g.save();
  g.globalAlpha = pop;
  g.fillStyle = "#ffffff";
  g.strokeStyle = "#333333";
  g.lineWidth = 1.5;
  g.beginPath();
  const x = cx - rw / 2, y = cy - rh;
  g.moveTo(x + 5, y);
  g.arcTo(x + rw, y, x + rw, y + rh, 6);
  g.arcTo(x + rw, y + rh, x, y + rh, 6);
  g.lineTo(cx + 3, y + rh); g.lineTo(cx, y + rh + 5); g.lineTo(cx - 3, y + rh); // tail
  g.arcTo(x, y + rh, x, y, 6);
  g.arcTo(x, y, x + rw, y, 6);
  g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = "#222222";
  g.font = "bold 14px 'Segoe UI', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(glyph, cx, y + rh / 2);
  g.restore();
}

function drawTimer(g: any, w: number): void {
  if (!timer.running && timer.frames <= 0) return;
  const sec = Math.ceil(timer.frames / 60);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const label = mm + ":" + (ss < 10 ? "0" + ss : ss);
  g.save();
  g.font = "bold 22px 'Segoe UI', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const bw = 84, bh = 30, bx = w / 2 - bw / 2, by = 8;
  g.globalAlpha = 0.8;
  g.fillStyle = "#101018";
  g.fillRect(bx, by, bw, bh);
  g.globalAlpha = 1;
  g.strokeStyle = "#ffd86a";
  g.lineWidth = 1.5;
  g.strokeRect(bx, by, bw, bh);
  g.fillStyle = "#ffe8a8";
  g.fillText(label, w / 2, by + bh / 2 + 1);
  g.restore();
}

/** Paint the whole presentation layer onto ctx.g2d (map scene only). Order:
 *  pictures → screen tint → balloons → timer HUD. Called after the map
 *  composites and before the screen flash in render-glue. */
export function drawPresentation(g: any, camX: number, camY: number, TILE: number): void {
  if (pictures.size) drawPictures(g);
  if (!toneEq(tint, NORMAL_TONE)) paintTone(g, tint, ctx.SCREEN_W, ctx.SCREEN_H);
  // balloons (player + visible events)
  drawBalloon(g, G.player, camX, camY, TILE);
  for (const rt of ctx.evRTs || []) if (rt && rt.balloon && !rt.erased) drawBalloon(g, rt, camX, camY, TILE);
  drawTimer(g, ctx.SCREEN_W);
}

// ---------------------------------------------------------------------------
// Reset + save/load
// ---------------------------------------------------------------------------
/** Full reset (new game). */
export function resetPresentation(): void {
  pictures.clear();
  tint = [...NORMAL_TONE] as Tone;
  tintTween = null;
  timer = { running: false, frames: 0, common: 0 };
  resetScroll();
}

/** Serialize the persistent screen state for a save slot (scroll + balloons
 *  are transient and deliberately omitted). */
export function serializePresentation(): any {
  return {
    pictures: [...pictures.values()].map((p) => ({
      id: p.id, name: p.name, origin: p.origin, x: p.x, y: p.y,
      sx: p.sx, sy: p.sy, opacity: p.opacity, blend: p.blend,
      angle: p.angle, angVel: p.angVel, tone: [...p.tone],
    })),
    tint: [...tint],
    timer: { running: timer.running, frames: timer.frames, common: timer.common },
  };
}

/** Restore persistent screen state from a save slot (missing = fresh). */
export function restorePresentation(d: any): void {
  resetPresentation();
  if (!d) return;
  for (const s of (d.pictures || [])) {
    const pic: Picture = {
      id: num(s.id) || 1, name: String(s.name || ""), img: null,
      origin: num(s.origin), x: num(s.x), y: num(s.y),
      sx: s.sx == null ? 1 : num(s.sx), sy: s.sy == null ? 1 : num(s.sy),
      opacity: s.opacity == null ? 255 : clamp(num(s.opacity), 0, 255),
      blend: num(s.blend), angle: num(s.angle), angVel: num(s.angVel),
      tone: normTone(s.tone), move: null, toneTween: null,
    };
    pictures.set(pic.id, pic);
    loadPictureImage(pic);
  }
  if (Array.isArray(d.tint)) tint = normTone(d.tint);
  if (d.timer) timer = { running: !!d.timer.running, frames: Math.max(0, num(d.timer.frames)), common: num(d.timer.common) };
}

// Test-only inspection (vitest) — reading module state without a DOM.
export const __test = {
  pictures: () => pictures,
  tint: () => tint,
  timer: () => timer,
  scroll: () => scroll,
};
