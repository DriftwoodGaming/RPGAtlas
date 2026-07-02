/* RPGAtlas — src/shared/autotile.ts
   Pure 47-blob autotile core (Phase 3 Stage D).

   RPG-Maker-style "A2" ground autotiles: a logical terrain tile expands to one
   of 47 visual shapes (48 including the fully-isolated case) chosen from the
   8-neighbour connectivity of same-group cells. The map never stores the shape
   — layers stay plain integer tile ids; the shape is resolved at DRAW TIME from
   the neighbourhood, exactly as RPG Maker does. That keeps the save format and
   the Phase 2 golden suite untouched (sample maps have no autotile groups, so
   this module is never entered for them).

   Each 48x48 output tile is assembled from four 24x24 "minitiles" (one per
   corner). For each corner we look at its two edge neighbours (horizontal H,
   vertical V) and its diagonal (D) and pick one of five minitile states. The
   per-corner source coordinates below were reverse-engineered from RPG Maker
   MV's Tilemap.FLOOR_AUTOTILE_TABLE (entry 0 = fully connected, entry 47 =
   fully isolated, single-bit-flip entries = one diagonal/edge removed) and
   cross-validated for horizontal/vertical mirror symmetry.

   The autotile source block is 4 minitile-columns wide by 6 minitile-rows tall
   (i.e. 2x3 tiles = 96x144 px at TILE=48). Coordinates here are in *minitile*
   units; a consumer multiplies by (TILE/2) to get source pixels.

   Everything is pure and import-free so it is exhaustively unit-tested over all
   256 neighbour masks (tests-unit/autotile.test.ts).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

// Neighbour mask bits. Edges N/E/S/W, diagonals NE/SE/SW/NW.
export const N = 1, E = 2, S = 4, W = 8, NE = 16, SE = 32, SW = 64, NW = 128;

/** A minitile source position, in minitile units within the 4x6 autotile block. */
export interface Mini {
  /** column, 0..3 */ cx: number;
  /** row, 0..5 */ cy: number;
}

// The five states a corner can take.
type State = "interior" | "inner" | "hedge" | "vedge" | "outer";

// Per-corner minitile coordinate for each state (cx, cy in minitile units).
// hedge = the vertical edge neighbour is open (a horizontal border strip runs
// along the exposed top/bottom); vedge = the horizontal edge neighbour is open.
type CornerTable = Record<State, [number, number]>;
const TL: CornerTable = { interior: [2, 4], inner: [2, 0], hedge: [2, 2], vedge: [0, 4], outer: [0, 0] };
const TR: CornerTable = { interior: [1, 4], inner: [3, 0], hedge: [1, 2], vedge: [3, 4], outer: [1, 0] };
const BL: CornerTable = { interior: [2, 3], inner: [2, 1], hedge: [2, 5], vedge: [0, 3], outer: [0, 1] };
const BR: CornerTable = { interior: [1, 3], inner: [3, 1], hedge: [1, 5], vedge: [3, 3], outer: [1, 1] };

function cornerState(hasH: boolean, hasV: boolean, hasD: boolean): State {
  if (hasH && hasV) return hasD ? "interior" : "inner";
  if (hasH) return "hedge";  // hasH && !hasV → vertical side exposed
  if (hasV) return "vedge";  // !hasH && hasV → horizontal side exposed
  return "outer";            // both edges exposed → convex corner
}

/**
 * Resolve the four corner minitile sources for a neighbour mask.
 * Returns [topLeft, topRight, bottomLeft, bottomRight].
 */
export function cornerSources(mask: number): [Mini, Mini, Mini, Mini] {
  const n = !!(mask & N), e = !!(mask & E), s = !!(mask & S), w = !!(mask & W);
  const ne = !!(mask & NE), se = !!(mask & SE), sw = !!(mask & SW), nw = !!(mask & NW);
  const pick = (tab: CornerTable, st: State): Mini => ({ cx: tab[st][0], cy: tab[st][1] });
  return [
    pick(TL, cornerState(w, n, nw)),
    pick(TR, cornerState(e, n, ne)),
    pick(BL, cornerState(w, s, sw)),
    pick(BR, cornerState(e, s, se)),
  ];
}

/**
 * Build an 8-neighbour mask from a "same group?" predicate. `same(dx, dy)` must
 * return true when the neighbour at (dx, dy) belongs to the same autotile group
 * (out-of-bounds cells are treated as connected by callers that want terrain to
 * blend to the map edge — that choice lives in the predicate, not here).
 */
export function neighborMask(same: (dx: number, dy: number) => boolean): number {
  let m = 0;
  if (same(0, -1)) m |= N;
  if (same(1, 0)) m |= E;
  if (same(0, 1)) m |= S;
  if (same(-1, 0)) m |= W;
  // A diagonal only contributes when BOTH of its adjacent edges connect —
  // otherwise the corner is already an edge/outer piece and the diagonal is
  // irrelevant. Masking it here keeps the 256-input space collapsing onto the
  // 47 valid blob shapes.
  if ((m & N) && (m & E) && same(1, -1)) m |= NE;
  if ((m & S) && (m & E) && same(1, 1)) m |= SE;
  if ((m & S) && (m & W) && same(-1, 1)) m |= SW;
  if ((m & N) && (m & W) && same(-1, -1)) m |= NW;
  return m;
}
