/* RPGAtlas — tests-unit/a11y.test.ts
   Phase 7 Stage B: the pure accessibility resolvers behind the Reduced
   Motion / Text Size / Colorblind Assist options. GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  gaugePalette,
  resolveMotion,
  resolveTextScale,
  TEXT_SCALE_STEPS,
  weatherMotionScale,
} from "../src/shared/a11y";

describe("resolveMotion", () => {
  it("auto follows the system preference", () => {
    expect(resolveMotion("auto", true)).toBe(true);
    expect(resolveMotion("auto", false)).toBe(false);
  });
  it("absent/unknown preferences behave as auto", () => {
    expect(resolveMotion(undefined, true)).toBe(true);
    expect(resolveMotion(null, false)).toBe(false);
    expect(resolveMotion("bogus", true)).toBe(true);
  });
  it("on/off force regardless of the system", () => {
    expect(resolveMotion("on", false)).toBe(true);
    expect(resolveMotion("off", true)).toBe(false);
  });
});

describe("resolveTextScale", () => {
  it("passes the four option steps through", () => {
    for (const [, v] of TEXT_SCALE_STEPS) expect(resolveTextScale(v)).toBe(v);
  });
  it("falls back to 1 for unset or out-of-range values", () => {
    expect(resolveTextScale(undefined)).toBe(1);
    expect(resolveTextScale(0)).toBe(1);
    expect(resolveTextScale(9)).toBe(1);
    expect(resolveTextScale("big")).toBe(1);
  });
});

describe("gaugePalette", () => {
  it("keeps the classic palette by default", () => {
    expect(gaugePalette(false)).toEqual({ hp: "#58c46a", mp: "#5a8ad8" });
  });
  it("switches to Okabe–Ito orange/sky-blue under assist", () => {
    expect(gaugePalette(true)).toEqual({ hp: "#e69f00", mp: "#56b4e9" });
  });
});

describe("weatherMotionScale", () => {
  it("thins particles to 30% under reduced motion", () => {
    expect(weatherMotionScale(true)).toBeCloseTo(0.3);
    expect(weatherMotionScale(false)).toBe(1);
  });
});
