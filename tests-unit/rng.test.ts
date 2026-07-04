/* RPGAtlas — tests-unit/rng.test.ts
   The shared seedable PRNG (src/shared/rng.ts): mulberry32 must be a pure
   function of its seed — that determinism is what the automap evaluator's
   "same seed ⇒ identical edits" guarantee and the engine's seeded gameplay
   RNG (src/engine/util.ts rnd/rndf, e2e golden specs, playtest bug-repro)
   are built on. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/shared/rng";

const take = (rng: () => number, n: number) => Array.from({ length: n }, () => rng());

describe("mulberry32", () => {
  it("is deterministic: the same seed yields the identical sequence", () => {
    expect(take(mulberry32(0x5eed), 64)).toEqual(take(mulberry32(0x5eed), 64));
  });

  it("distinct seeds yield distinct streams", () => {
    expect(take(mulberry32(1), 8)).not.toEqual(take(mulberry32(2), 8));
  });

  it("yields uniform floats in [0,1)", () => {
    const rng = mulberry32(123456789);
    for (const v of take(rng, 1000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("coerces the seed to uint32 (matches the engine's seed >>> 0 hook input)", () => {
    // -1 >>> 0 === 0xffffffff — the engine seeds with (seed >>> 0), so a
    // negative or float-ish query-param seed still lands on a stable stream.
    expect(take(mulberry32(-1), 8)).toEqual(take(mulberry32(0xffffffff), 8));
  });
});
