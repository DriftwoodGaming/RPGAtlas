/* RPGAtlas — tests-unit/tile-flags.test.ts
   Phase 8 Stage E: the pure tile-transform-flag helpers. Proves round-trip
   encode/decode, that the low-28-bit id mask never leaks a flag into an id, and
   — the risk item Fable signs off — that an autotile reserved id stays detected
   as an autotile whether or not transform bits ride along on the value.
   GPL-3.0-or-later. */

import { describe, expect, it } from "vitest";
import {
  TILE_FLAG_H, TILE_FLAG_V, TILE_FLAG_R, TILE_FLAG_MASK, TILE_ID_MASK,
  tileId, tileFlags, hasFlags, withFlags, setFlags,
  toggleH, toggleV, rotateCW, flagTransform,
} from "../src/shared/tile-flags";
import { AUTOTILE_BASE, isAutotileId, groupIdOf } from "../src/shared/autotile-registry";

const NO = { h: false, v: false, r: false };

describe("tile-flags: bit layout", () => {
  it("puts the three flags at bits 28/29/30", () => {
    expect(TILE_FLAG_H).toBe(1 << 28);
    expect(TILE_FLAG_V).toBe(1 << 29);
    expect(TILE_FLAG_R).toBe(1 << 30);
    expect(TILE_FLAG_MASK).toBe((1 << 28) | (1 << 29) | (1 << 30));
    expect(TILE_ID_MASK).toBe((1 << 28) - 1);
  });

  it("keeps AUTOTILE_BASE well below the flag bits", () => {
    // The whole scheme depends on this: an autotile reserved id fits in the id
    // space, so masking flags off never touches it.
    expect(AUTOTILE_BASE).toBeLessThan(TILE_FLAG_H);
  });
});

describe("tile-flags: decode / round-trip", () => {
  it("a plain id with no flags decodes to itself", () => {
    for (const id of [0, 1, 7, 42, 268435455 /* TILE_ID_MASK */]) {
      expect(tileId(id)).toBe(id);
      expect(tileFlags(id)).toEqual(NO);
      expect(hasFlags(id)).toBe(false);
    }
  });

  it("withFlags then decode round-trips id and flags", () => {
    const combos = [
      { h: false, v: false, r: false },
      { h: true, v: false, r: false },
      { h: false, v: true, r: false },
      { h: false, v: false, r: true },
      { h: true, v: true, r: false },
      { h: true, v: false, r: true },
      { h: false, v: true, r: true },
      { h: true, v: true, r: true },
    ];
    for (const id of [1, 5, 99, 100000]) {
      for (const f of combos) {
        const raw = withFlags(id, f);
        expect(tileId(raw)).toBe(id);
        expect(tileFlags(raw)).toEqual(f);
        expect(hasFlags(raw)).toBe(f.h || f.v || f.r);
      }
    }
  });

  it("withFlags masks its id argument so a stray high bit can't smear", () => {
    // Passing an already-flagged value as the id must not double up.
    const raw = withFlags(withFlags(5, { h: true }), { v: true });
    expect(tileId(raw)).toBe(5);
    expect(tileFlags(raw)).toEqual({ h: false, v: true, r: false });
  });

  it("setFlags replaces the transform bits, keeps the id", () => {
    const raw = withFlags(12, { h: true, r: true });
    const re = setFlags(raw, { h: false, v: true, r: false });
    expect(tileId(re)).toBe(12);
    expect(tileFlags(re)).toEqual({ h: false, v: true, r: false });
  });
});

describe("tile-flags: autotile-adjacent fixture (id checks stay flag-safe)", () => {
  it("an autotile id is detected with OR without transform bits riding along", () => {
    const groupId = 3;
    const autoRaw = AUTOTILE_BASE + groupId;
    expect(isAutotileId(autoRaw)).toBe(true);
    expect(groupIdOf(tileId(autoRaw))).toBe(groupId);

    // A plain tile that happens to sit next to the autotile in a layer, carrying
    // flags, must NOT be mistaken for an autotile, and the masked plain id must
    // survive intact.
    const plainRaw = withFlags(42, { h: true, v: true, r: true });
    expect(isAutotileId(tileId(plainRaw))).toBe(false);
    expect(tileId(plainRaw)).toBe(42);

    // And the raw autotile id, even if some caller left transform bits on it,
    // still masks back to the group.
    const flaggedAuto = withFlags(AUTOTILE_BASE + groupId, { r: true });
    expect(isAutotileId(tileId(flaggedAuto))).toBe(true);
    expect(groupIdOf(tileId(flaggedAuto))).toBe(groupId);
  });

  it("neighbour equality over a layer array is by masked id", () => {
    // Simulate a 3-cell strip: [flaggedGrass, plainGrass, water]. The autotile
    // "same group?" predicate compares MASKED ids, so a flipped grass tile is
    // still the same terrain as its unflipped neighbour.
    const grass = 10;
    const strip = [withFlags(grass, { h: true }), grass, 11];
    const sameAsGrass = (raw: number) => tileId(raw) === grass;
    expect(sameAsGrass(strip[0])).toBe(true);
    expect(sameAsGrass(strip[1])).toBe(true);
    expect(sameAsGrass(strip[2])).toBe(false);
  });
});

describe("tile-flags: interactive toggles compose like Tiled", () => {
  it("four clockwise rotations return to identity for every start flip", () => {
    const starts = [
      { h: false, v: false, r: false },
      { h: true, v: false, r: false },
      { h: false, v: true, r: false },
      { h: true, v: true, r: false },
    ];
    for (const start of starts) {
      let f = start;
      for (let i = 0; i < 4; i++) f = rotateCW(f);
      expect(f).toEqual(start);
    }
  });

  it("toggling H twice is a no-op; toggling V twice is a no-op", () => {
    expect(toggleH(toggleH(NO))).toEqual(NO);
    expect(toggleV(toggleV(NO))).toEqual(NO);
  });
});

describe("tile-flags: flagTransform geometry", () => {
  const size = 48;
  // Apply the returned affine to a source point (sx, sy) in the unit cell and
  // report where it lands (screen coords within the cell).
  const apply = (
    m: [number, number, number, number, number, number],
    sx: number, sy: number,
  ) => ({
    x: m[0] * sx + m[2] * sy + m[4],
    y: m[1] * sx + m[3] * sy + m[5],
  });
  const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

  it("identity maps corners to themselves", () => {
    const m = flagTransform(NO, size);
    let p = apply(m, 0, 0); near(p.x, 0); near(p.y, 0);
    p = apply(m, size, size); near(p.x, size); near(p.y, size);
  });

  it("horizontal flip mirrors x, keeps y", () => {
    const m = flagTransform({ h: true, v: false, r: false }, size);
    let p = apply(m, 0, 0); near(p.x, size); near(p.y, 0);
    p = apply(m, size, size); near(p.x, 0); near(p.y, size);
  });

  it("vertical flip mirrors y, keeps x", () => {
    const m = flagTransform({ h: false, v: true, r: false }, size);
    let p = apply(m, 0, 0); near(p.x, 0); near(p.y, size);
    p = apply(m, size, size); near(p.x, size); near(p.y, 0);
  });

  it("90° clockwise rotation sends top-left to top-right", () => {
    const m = flagTransform({ h: false, v: false, r: true }, size);
    const tl = apply(m, 0, 0);
    near(tl.x, size); near(tl.y, 0);
    const tr = apply(m, size, 0);
    near(tr.x, size); near(tr.y, size);
  });
});
