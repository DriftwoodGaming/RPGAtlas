/* RPGAtlas — src/shared/rng.ts
   mulberry32, the project's one seedable PRNG. Extracted from automap.ts
   (Phase 8 Stage F) so the engine's gameplay random source (src/engine/util.ts
   rnd/rndf) and the visual-automap evaluator share the same generator: tiny,
   fast, well distributed, and — the point — deterministic from its seed on
   every machine, which is what makes seeded golden e2e runs and playtest
   bug-repro reproducible. Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */

/** mulberry32 — a tiny, fast, well-distributed 32-bit PRNG. Returns a function
 *  yielding uniform floats in [0,1); the same seed always yields the same
 *  sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
