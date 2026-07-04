/* RPGAtlas — src/shared/tile-flags.ts
   Tile transform flags (Phase 8 Stage E): pack a horizontal-flip / vertical-flip
   / 90°-clockwise-rotation bit onto a plain tile id, so a single stored number
   still describes the whole cell — same discipline as the autotile reserved-id
   scheme. The flag bits live at 28/29/30, far above every real tile index AND
   above AUTOTILE_BASE (1,000,000 < 1<<28 = 268,435,456), so a stored value is
   decoded raw → { id, flags } once, centrally, in drawLayerCell. Every existing
   `id >= AUTOTILE_BASE` / id equality check masks the low 28 bits first (see the
   Stage E flag-bit audit in docs/phase-8-spec.md) so those checks stay correct.

   Flags apply to PLAIN tiles only in v1: autotile groups already resolve their
   own shape from the neighbourhood, so a group's reserved id is never
   transformed (the brush drops flags when an autotile is selected). A plain tile
   with NO flag bits set decodes to exactly its own id — so a map that never used
   a transform is byte-identical to a pre-Stage-E map (goldens gate this).

   Pure & unit-tested (tests-unit/tile-flags.test.ts): round-trip encode/decode,
   mask correctness, and an autotile-adjacent fixture proving id checks are
   flag-safe. Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later. */

export const TILE_FLAG_H = 1 << 28; // horizontal flip
export const TILE_FLAG_V = 1 << 29; // vertical flip
export const TILE_FLAG_R = 1 << 30; // 90° clockwise rotation
/** All three transform bits. */
export const TILE_FLAG_MASK = TILE_FLAG_H | TILE_FLAG_V | TILE_FLAG_R;
/** The id occupies the low 28 bits; everything above is transform flags. */
export const TILE_ID_MASK = (1 << 28) - 1;

export interface TileFlags {
  h: boolean;
  v: boolean;
  r: boolean;
}

/** The bare tile id with the transform flags stripped. Safe on any stored value
 *  — a plain id, an autotile reserved id, or a flag-bearing id. Use this before
 *  ANY id comparison (autotile detection, palette highlight, tile-def lookup). */
export function tileId(raw: number): number {
  return (raw | 0) & TILE_ID_MASK;
}

/** Decode the three transform flags carried by a stored value. */
export function tileFlags(raw: number): TileFlags {
  const v = raw | 0;
  return {
    h: (v & TILE_FLAG_H) !== 0,
    v: (v & TILE_FLAG_V) !== 0,
    r: (v & TILE_FLAG_R) !== 0,
  };
}

/** True when any transform bit is set (a fast path so the hot draw loop can skip
 *  the transform matrix entirely for the overwhelmingly common plain cell). */
export function hasFlags(raw: number): boolean {
  return ((raw | 0) & TILE_FLAG_MASK) !== 0;
}

/** Pack an id + flags back into one stored value. `id` is masked to its low 28
 *  bits so a caller can't accidentally smear a flag into the id space. */
export function withFlags(id: number, f: Partial<TileFlags>): number {
  let v = (id | 0) & TILE_ID_MASK;
  if (f.h) v |= TILE_FLAG_H;
  if (f.v) v |= TILE_FLAG_V;
  if (f.r) v |= TILE_FLAG_R;
  return v;
}

/** Re-apply a flag set onto a (possibly already-flagged) raw value, replacing
 *  its transform bits and keeping its id. */
export function setFlags(raw: number, f: TileFlags): number {
  return withFlags(tileId(raw), f);
}

/** Toggle horizontal flip on a flag set, folding in the rotate interaction so
 *  X/Y/R compose the way a user expects (H after a rotate swaps to V, matching
 *  Tiled). Returns a NEW flag set. */
export function toggleH(f: TileFlags): TileFlags {
  // Under a 90° rotation the on-screen horizontal axis is the source vertical
  // axis, so an H press flips V instead (and vice-versa) — this keeps X/Y
  // intuitive no matter the rotation state.
  return f.r ? { ...f, v: !f.v } : { ...f, h: !f.h };
}

/** Toggle vertical flip (see toggleH for the rotate interaction). */
export function toggleV(f: TileFlags): TileFlags {
  return f.r ? { ...f, h: !f.h } : { ...f, v: !f.v };
}

/** Rotate 90° clockwise within the 8-orientation dihedral group. Each press is
 *  a single dihedral step (h,v,r) → (!v, h, !r); four presses are exactly the
 *  identity for any starting flip state (unit-tested). Toggling R every step
 *  keeps the "is this the transpose branch?" bit consistent with flagTransform. */
export function rotateCW(f: TileFlags): TileFlags {
  return { h: !f.v, v: f.h, r: !f.r };
}

/** The 2D affine transform (a,b,c,d,e,f for setTransform) that maps a TILE×TILE
 *  source rect to the on-screen cell with these flags applied, given the tile
 *  size. Rotation is 90° clockwise about the cell centre; flips mirror across
 *  the cell centre. Composed as: translate to centre, rotate, flip, translate
 *  back. Returned as a plain array so the draw helper can apply it without
 *  allocating a DOMMatrix. */
export function flagTransform(
  f: TileFlags,
  size: number,
): [number, number, number, number, number, number] {
  const hs = size / 2;
  // Start from identity centred on the cell.
  let a = 1, b = 0, c = 0, d = 1;
  // 90° clockwise rotation: (x,y) -> (-y, x) in screen space is CCW; CW is
  // (x,y) -> (y,-x). Canvas y grows downward, so a "clockwise-on-screen" turn
  // uses the matrix [0,1,-1,0].
  if (f.r) {
    // multiply current [a b c d] by rotation [0 1 -1 0]
    const na = 0 * a + 1 * c;
    const nb = 0 * b + 1 * d;
    const nc = -1 * a + 0 * c;
    const nd = -1 * b + 0 * d;
    a = na; b = nb; c = nc; d = nd;
  }
  // horizontal flip: multiply by [-1 0 0 1]
  if (f.h) { a = -a; b = -b; }
  // vertical flip: multiply by [1 0 0 -1]
  if (f.v) { c = -c; d = -d; }
  // e,f translate the centred content back to the cell's top-left.
  const e = hs - (a * hs + c * hs);
  const ff = hs - (b * hs + d * hs);
  return [a, b, c, d, e, ff];
}
