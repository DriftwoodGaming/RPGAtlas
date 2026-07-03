/* RPGAtlas — src/engine/perf-hud.ts
   In-player performance overlay (Phase 7 Stage A). Enabled with ?perf=1 or
   toggled with F3 at any time; shows fps, frame time (avg / p95 over a
   rolling window), the game-logic+render work time inside each frame, the
   HD-2D renderer's live GPU counters (draw calls, triangles, alive
   geometries/textures — the dispose-leak signal), and the JS heap where the
   browser exposes it (Chromium's non-standard performance.memory).

   Zero cost while hidden: the loop consults perfActive() before doing any
   timing work, and no DOM exists until the first toggle. The overlay is
   plain DOM on #stage (styled by play.css .perf-hud), so it rides every
   host — dev server, playtest window, standalone exports.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ctx } from "./state/engine-context.js";
import { Renderer } from "../renderer/index.js";

const WINDOW_FRAMES = 120; // rolling stats window (~2 s at 60 fps)
const REFRESH_MS = 250; // overlay text update cadence

let visible = false;
let box: HTMLElement | null = null;
let lastNow = 0;
let lastRefresh = 0;
const frameMs: number[] = []; // rAF-to-rAF deltas (fps / p95 source)
const workMs: number[] = []; // update+render work inside the frame
let head = 0;
let filled = 0;

/** The loop's cheap gate: true only while the overlay is shown. */
export function perfActive(): boolean {
  return visible;
}

/** One sample per rAF frame while active. `now` is the rAF timestamp;
 *  `work` is the measured update+render duration inside this frame. */
export function perfSample(now: number, work: number): void {
  if (!visible) return;
  if (lastNow > 0) {
    frameMs[head] = now - lastNow;
    workMs[head] = work;
    head = (head + 1) % WINDOW_FRAMES;
    if (filled < WINDOW_FRAMES) filled++;
  }
  lastNow = now;
  if (now - lastRefresh >= REFRESH_MS) {
    lastRefresh = now;
    refresh();
  }
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function refresh(): void {
  if (!box || filled === 0) return;
  const n = filled;
  let sum = 0;
  let workSum = 0;
  const sorted: number[] = [];
  for (let i = 0; i < n; i++) {
    sum += frameMs[i];
    workSum += workMs[i];
    sorted.push(frameMs[i]);
  }
  sorted.sort((a, b) => a - b);
  const avg = sum / n;
  const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
  const lines = [
    fmt(1000 / avg, 0) + " fps  " + fmt(avg) + " ms avg  " + fmt(p95) + " ms p95",
    "work " + fmt(workSum / n) + " ms/frame",
  ];
  const gpu = ctx.hdActive && Renderer.stats ? Renderer.stats() : null;
  if (gpu) {
    const tri =
      gpu.triangles >= 10000 ? (gpu.triangles / 1000).toFixed(1) + "k" : String(gpu.triangles);
    lines.push("draw " + gpu.calls + "  tri " + tri);
    lines.push("geo " + gpu.geometries + "  tex " + gpu.textures + "  prg " + gpu.programs);
  }
  const mem = (performance as any).memory;
  if (mem && mem.usedJSHeapSize) {
    lines.push("heap " + (mem.usedJSHeapSize / 1048576).toFixed(1) + " MB");
  }
  box.textContent = lines.join("\n");
}

function show(): void {
  if (!box) {
    box = document.createElement("div");
    box.className = "perf-hud";
    (ctx.stage || document.body).appendChild(box);
  }
  box.style.display = "block";
  box.textContent = "measuring…";
  visible = true;
  lastNow = 0;
  lastRefresh = 0;
  filled = 0;
  head = 0;
}

function hide(): void {
  visible = false;
  if (box) box.style.display = "none";
}

export function togglePerfHud(): void {
  if (visible) hide();
  else show();
}

/** Boot hook: honor ?perf=1 and bind F3 (capture phase so the game's own
 *  key handling never swallows it; F3 has no game binding). */
export function initPerfHud(): void {
  try {
    if (new URLSearchParams(window.location.search).get("perf") === "1") show();
  } catch {
    /* no location (sandboxed preview) — F3 still works */
  }
  window.addEventListener(
    "keydown",
    (e: KeyboardEvent) => {
      if (e.code === "F3") {
        e.preventDefault();
        togglePerfHud();
      }
    },
    true,
  );
}
