/* RPGAtlas — src/shared/a11y.ts
   Pure accessibility resolvers (Phase 7 Stage B): window-free so vitest can
   pin the behavior. player-options.ts wraps these with the live engine
   context and the prefers-reduced-motion media query.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

/** Reduced-motion preference: "auto" follows the OS/browser setting,
 *  "on"/"off" force it. Unknown/absent values behave as "auto". */
export function resolveMotion(pref: unknown, systemReduced: boolean): boolean {
  if (pref === "on") return true;
  if (pref === "off") return false;
  return systemReduced;
}

/** The Text Size option's four steps. */
export const TEXT_SCALE_STEPS: ReadonlyArray<readonly [string, number]> = [
  ["Small", 0.85],
  ["Normal", 1],
  ["Large", 1.15],
  ["Huge", 1.3],
];

/** Clamp a stored text-scale value to something sane; anything unset or
 *  out of range renders at 1 (author-designed size). */
export function resolveTextScale(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0.5 && n <= 2 ? n : 1;
}

/** Gauge fill palette. The assist palette is Okabe–Ito orange/sky-blue —
 *  distinguishable under the common color-vision deficiencies AND by
 *  luminance; the default keeps the classic green/blue. Damage/heal popups
 *  already carry explicit −/+ signs, so color is never the only channel. */
export function gaugePalette(colorAssist: boolean): { hp: string; mp: string } {
  return colorAssist
    ? { hp: "#e69f00", mp: "#56b4e9" }
    : { hp: "#58c46a", mp: "#5a8ad8" };
}

/** Weather particle density factor under reduced motion (full ambience is
 *  motion by definition; a sparse drizzle keeps the scene readable). */
export function weatherMotionScale(reduced: boolean): number {
  return reduced ? 0.3 : 1;
}
