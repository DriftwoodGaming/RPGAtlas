/* RPGAtlas — src/engine/util.ts
   Leaf utilities extracted verbatim from the js/engine.js monolith (Phase 1
   Stage B): DOM helper, async sleep, numeric helpers, and HTML escape. The
   system-tab sound/music key lookups (sysSe/sysBgm) read the live project, so
   they take a project provider the engine installs once at boot rather than
   reaching into the closure. Behavior unchanged. GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Sfx } from "../shared/deps.js";
import { mulberry32 } from "../shared/rng.js";

export function el(tag: string, cls?: string, html?: any): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
// ------------------------- gameplay random source ---------------------------
// Every gameplay roll (rnd/rndf below) draws from this module-level source:
// NPC random walks, encounter timing, battle variance/crits/escape/AI picks.
// Unseeded (the default players get) it IS Math.random — behavior identical to
// before this seam existed. Seeded, it becomes a mulberry32 stream
// (src/shared/rng.ts), so a run's rolls are a pure function of seed + tick
// count: pixel-comparing e2e specs seed it pre-boot (?rngseed= query param or
// window.RPGATLAS_RNG_SEED from a Playwright init script) instead of pinning
// movers, and a playtest bug can be re-rolled exactly via window.AtlasRng.
let random: () => number = Math.random;

/** Swap the gameplay random source: a number seeds a deterministic mulberry32
 *  stream; null/undefined restores unseeded Math.random. */
export function seedRnd(seed: number | null | undefined): void {
  random = seed == null ? Math.random : mulberry32(seed >>> 0);
}

// Pre-boot seeding + the runtime hook. Module scope on purpose: this module is
// imported before boot.ts runs, so the very first roll already comes from the
// seeded stream. The guards keep the module loadable outside a real page —
// vitest (no window) and the node vm sandboxes in tests/ (a bare stub window
// with no location/URLSearchParams).
if (typeof window !== "undefined") {
  const hook = (window as any).RPGATLAS_RNG_SEED;
  const q =
    typeof URLSearchParams === "function" && typeof location !== "undefined"
      ? new URLSearchParams(location.search).get("rngseed")
      : null;
  if (hook != null) seedRnd(Number(hook));
  else if (q != null && q !== "") seedRnd(Number(q));
  (window as any).AtlasRng = { seed: seedRnd, unseed: () => seedRnd(null) };
}

export function rnd(n: number): number {
  return Math.floor(random() * n);
}
/** Uniform float in [0,1) from the same (seedable) stream as rnd() — the
 *  drop-in for gameplay code that used to call Math.random() directly. */
export function rndf(): number {
  return random();
}
export function compareVariable(a: any, b: any, cmp: any): boolean {
  switch (cmp) {
    case "==": return a === b;
    case "!=": return a !== b;
    case ">": return a > b;
    case ">=": return a >= b;
    case "<": return a < b;
    case "<=": return a <= b;
    default:
      throw new Error("Invalid comparator: " + cmp);
  }
}
export function esc(s: any): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// system-tab sound/music lookups (logical key -> chosen SE / theme). The engine
// installs the project provider at boot via setSysProjectProvider().
let getSysProject: () => any = () => null;
export function setSysProjectProvider(fn: () => any): void {
  getSysProject = fn;
}
export function sysSe(key: string): void {
  const proj = getSysProject();
  const m = (proj && proj.system && proj.system.sounds) || {};
  Sfx.play(m[key] || key);
}
export function sysBgm(key: string): string {
  const proj = getSysProject();
  const m = (proj && proj.system && proj.system.music) || {};
  return m[key] || key;
}
