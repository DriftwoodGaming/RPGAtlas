/* RPGAtlas — src/shared/terrain-kinds.ts
   Per-kind terrain resolvers for the Terrain & Autotile Studio (Phase 8 Stage C).

   The Phase 3 blob47 core (autotile.ts) resolves an RPG-Maker A2 block: a whole
   48x48 output tile is assembled from four 24x24 corner minitiles chosen by the
   8-neighbour mask. Stage C generalizes that to the other RPG-Maker sheet
   arrangements plus pattern-completion, all as PURE math over a source block:

   - "blob47"  : the existing A2 47-shape corner rule (4 minitile cols x 6 rows).
   - "edge16"  : a 16-shape wang-edge fence/path set. Only N/E/S/W matter (the
                 four cardinal edges); diagonals are ignored. The 16 whole-tile
                 shapes are laid out in a 4x4 grid of full tiles, RM-A-fence order
                 (index = N|E<<1|S<<2|W<<3).
   - "corner16": a 16-shape wang-CORNER set. The four *corners* each connect or
                 not; index = TL|TR<<1|BR<<2|BL<<3 over a 4x4 grid of full tiles.
   - "a1"      : blob47 layout, animated — `anim.frames` copies of the A2 block
                 laid left-to-right; the resolver picks the frame's block, then
                 the blob47 corner rule within it.
   - "a3"      : RM "building" set. 2x2 tiles per material tile the roof/wall
                 quad; here treated as a 2x2 whole-tile "quad by corner" layout
                 (a simplified corner16 over a 2x2 source), enough for the Studio
                 to import + paint RM A3 roofs.
   - "a4"      : RM "wall" set. Top row is a blob47 wall-cap (A2 rule on the top
                 2x3 sub-block); lower rows tile vertically. Treated here as a
                 blob47 resolve over the top sub-block (the common case: solid
                 wall faces), which is what the Studio's completeness check gates.

   Everything is pure and import-light (only ./autotile) so it is exhaustively
   unit-tested (tests-unit/terrain-kinds.test.ts). The DOM/canvas assembly that
   consumes these coordinates lives in autotile-registry.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import { cornerSources, neighborMask, N, E, S, W, type Mini } from "./autotile";

export type TerrainKind = "blob47" | "edge16" | "corner16" | "a1" | "a3" | "a4";

/** A whole-tile source rectangle in *tile* units within the source block, plus
 *  an optional per-corner minitile decomposition (blob47/a1 use minitiles; the
 *  wang/quad kinds return a single whole tile). All coords are block-relative. */
export interface TileSource {
  /** Whole-tile column/row within the block, in tile units (used when `corners`
   *  is absent — a straight whole-tile blit). */
  tx: number;
  ty: number;
  /** When present, the four 24x24 corner minitiles (in minitile units) that
   *  assemble the 48x48 output — the blob47/a1 path. Order TL,TR,BL,BR. */
  corners?: [Mini, Mini, Mini, Mini];
}

/** Cardinal-only mask (N/E/S/W) from a same-group predicate. Diagonals ignored. */
export function edgeMask(same: (dx: number, dy: number) => boolean): number {
  let m = 0;
  if (same(0, -1)) m |= N;
  if (same(1, 0)) m |= E;
  if (same(0, 1)) m |= S;
  if (same(-1, 0)) m |= W;
  return m;
}

/** Corner-connectivity mask (TL/TR/BR/BL) from a same-group predicate. A corner
 *  "connects" when its two adjacent edges AND its diagonal all connect — the
 *  standard wang-corner rule. Bits: TL=1, TR=2, BR=4, BL=8. */
export function cornerMask(same: (dx: number, dy: number) => boolean): number {
  const n = same(0, -1), e = same(1, 0), s = same(0, 1), w = same(-1, 0);
  const nw = same(-1, -1), ne = same(1, -1), se = same(1, 1), sw = same(-1, 1);
  let m = 0;
  if (n && w && nw) m |= 1;  // TL
  if (n && e && ne) m |= 2;  // TR
  if (s && e && se) m |= 4;  // BR
  if (s && w && sw) m |= 8;  // BL
  return m;
}

// edge16: RM-A-style fence order. The index is the 4-bit cardinal mask
// (N=1,E=2,S=4,W=8); the 16 shapes sit in a 4x4 grid of whole tiles indexed
// row-major by that value (so shape 0 = isolated post at col0/row0, shape 15 =
// four-way cross at col3/row3). This is the arrangement the Studio writes when
// it "normalizes" an imported fence sheet.
function edge16Source(mask: number): TileSource {
  const idx = mask & 15;
  return { tx: idx % 4, ty: (idx / 4) | 0 };
}

// corner16 / a3: index is the 4-bit corner mask (TL=1,TR=2,BR=4,BL=8) over a
// 4x4 whole-tile grid.
function corner16Source(mask: number, cols = 4): TileSource {
  const idx = mask & 15;
  return { tx: idx % cols, ty: (idx / cols) | 0 };
}

/**
 * Resolve the source rectangle (and optional minitile corners) for one cell of a
 * terrain of the given kind. `same(dx,dy)` is the same-group predicate; `frame`
 * selects the animation frame (a1 only; 0 for everything else). `blockCols` is
 * how many *tile* columns wide one animation frame is in the source block
 * (blob47/a1 = 2, i.e. a 2x3 A2 tile block; the wang kinds ignore it).
 */
export function resolveTile(
  kind: TerrainKind,
  same: (dx: number, dy: number) => boolean,
  frame = 0,
  frameTileCols = 2,
): TileSource {
  switch (kind) {
    case "edge16":
      return edge16Source(edgeMask(same));
    case "corner16":
      return corner16Source(cornerMask(same), 4);
    case "a3":
      // Building roof: a 2x2 corner-quad. Reuse the corner mask but over a 2-col
      // grid; only 4 of the 16 masks are distinct roof pieces but the mapping is
      // stable and every mask lands in-bounds.
      return corner16Source(cornerMask(same) & 3, 2);
    case "a1":
    case "blob47":
    case "a4":
    default: {
      // blob47 corner rule. For a1, the frame offsets the whole block right by
      // `frame * frameTileCols` tiles; a4 uses the same rule on the top sub-block
      // (frame 0). The corner minitiles are block-relative to the frame origin.
      const corners = cornerSources(neighborMask(same));
      const colOff = kind === "a1" ? frame * frameTileCols * 2 : 0; // in minitile units
      const shifted: [Mini, Mini, Mini, Mini] = [
        { cx: corners[0].cx + colOff, cy: corners[0].cy },
        { cx: corners[1].cx + colOff, cy: corners[1].cy },
        { cx: corners[2].cx + colOff, cy: corners[2].cy },
        { cx: corners[3].cx + colOff, cy: corners[3].cy },
      ];
      return { tx: 0, ty: 0, corners: shifted };
    }
  }
}

/** How many distinct authored tiles a complete set of `kind` needs (for the
 *  Studio's completeness check). blob47/a1/a4 are assembled from minitiles, so
 *  "completeness" is really "is the A2 block fully present" — reported as the
 *  block's tile count (2x3 = 6). */
export function requiredTileCount(kind: TerrainKind): number {
  switch (kind) {
    case "edge16": return 16;
    case "corner16": return 16;
    case "a3": return 4;
    case "a4": return 6;   // A2-style block top; wall body rows are cosmetic
    case "a1":
    case "blob47":
    default: return 6;     // 2x3 A2 block
  }
}

/** The source-block dimensions, in *tiles*, one animation frame occupies for a
 *  kind. Used by the importer/auto-detector to slice a sheet and by the registry
 *  to size the assembled-cache source rects. */
export function frameTileGrid(kind: TerrainKind): { cols: number; rows: number } {
  switch (kind) {
    case "edge16": return { cols: 4, rows: 4 };
    case "corner16": return { cols: 4, rows: 4 };
    case "a3": return { cols: 2, rows: 2 };
    case "a4": return { cols: 2, rows: 3 };
    case "a1":
    case "blob47":
    default: return { cols: 2, rows: 3 };
  }
}

// Re-export neighborMask so the registry has a single terrain-resolver import
// surface (it still needs the blob path directly for the assembled-cache key).
export { neighborMask };

/** Deterministic weighted pick over `variants` (cumulative-weight selection).
 *  `r` is a stable per-cell number in [0,1) (the caller hashes the cell coords
 *  so a variant never flickers between frames). Returns the chosen index, or 0
 *  when the list is empty/degenerate. Pure — no RNG state. */
export function pickVariant(weights: number[], r: number): number {
  if (!weights.length) return 0;
  let total = 0;
  for (const w of weights) total += Math.max(0, w) || 0;
  if (total <= 0) return 0;
  let acc = 0;
  const target = Math.max(0, Math.min(1, r)) * total;
  for (let i = 0; i < weights.length; i++) {
    acc += Math.max(0, weights[i]) || 0;
    if (target < acc) return i;
  }
  return weights.length - 1;
}

/**
 * Guess a terrain kind from a source sheet's pixel dimensions (Studio Layout
 * auto-detection). Pure + heuristic: it reasons about how the width/height
 * factor into TILE-sized cells and matches the canonical RM arrangements.
 * Returns the best guess plus a short human reason. Ambiguous sheets fall back
 * to "blob47" (the A2 default) — the user can always override on the Layout step.
 */
export function detectKind(w: number, h: number, TILE: number): { kind: TerrainKind; reason: string } {
  const cols = Math.round(w / TILE);
  const rows = Math.round(h / TILE);
  // A2 blob47 block: 2 wide x 3 tall (96x144 at TILE=48).
  if (cols === 2 && rows === 3) return { kind: "blob47", reason: "2×3 block — RPG-Maker A2 terrain" };
  // A1 animation: multiple 2x3 blocks laid side by side (width a multiple of 2
  // tiles, > 2) with 3-tall height.
  if (rows === 3 && cols > 2 && cols % 2 === 0) {
    return { kind: "a1", reason: `${cols / 2}-frame animated (A1) — 2×3 blocks laid across` };
  }
  // 4x4 wang grids: edge16 vs corner16 are indistinguishable by size alone;
  // default to edge16 (fences/paths are the common 4x4 import).
  if (cols === 4 && rows === 4) return { kind: "edge16", reason: "4×4 grid — 16-shape edge (fence/path) set" };
  // A4 wall: 2 wide x 5 tall in RM (top cap block + wall body). Accept 2xN, N>3.
  if (cols === 2 && rows >= 4) return { kind: "a4", reason: "tall 2-wide sheet — A4 wall set" };
  // A3 building: 2 wide x 2 tall roof quad (or a grid of them).
  if (cols === 2 && rows === 2) return { kind: "a3", reason: "2×2 block — A3 building roof" };
  return { kind: "blob47", reason: "unrecognised size — defaulting to A2 terrain" };
}

/** A stable [0,1) hash of a cell + a salt, so weighted variants and transform
 *  completion pick the same tile every frame. Small integer hash (xorshift-ish);
 *  pure and deterministic. */
export function cellHash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}
