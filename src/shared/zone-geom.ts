/* RPGAtlas — src/shared/zone-geom.ts
   Pure geometry for map zones (Phase 8 Stage D). Both the editor (overlay
   drawing, hit-testing, the Objects inspectors) and the engine (encounter /
   transfer / sound / weather zone semantics, atlas.zonesAt) share this one
   implementation so the two can never disagree about what "inside" means.

   All coordinates are in TILE units, matching ZoneShape and the tile grid the
   movement loop walks. A tile (x, y) is tested at its CENTER (x + 0.5,
   y + 0.5): this makes "the player standing on tile (x, y)" a clean
   point-in-shape query and keeps a 1×1 rect zone == exactly its one tile.

   Point-in-shape is bounding-box pre-filtered (cheap reject before the real
   test); the polygon test is the standard even-odd ray-cast rule. distanceTo
   backs the sound zone's linear falloff (0 inside, growing outside). Fully
   unit-tested (tests-unit/zone-geom.test.ts) incl. degenerate shapes.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type { MapZone, ZoneShape } from "./schema";

/** An axis-aligned bounding box in tile units (x1,y1 inclusive corner). */
export interface Bbox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Precomputed bbox for a shape (tile units). Degenerate shapes (empty poly,
 *  zero radius) still produce a valid, possibly-empty box. */
export function bboxOf(shape: ZoneShape): Bbox {
  switch (shape.type) {
    case "rect":
      return { x1: shape.x, y1: shape.y, x2: shape.x + shape.w, y2: shape.y + shape.h };
    case "ellipse":
      return {
        x1: shape.cx - shape.rx,
        y1: shape.cy - shape.ry,
        x2: shape.cx + shape.rx,
        y2: shape.cy + shape.ry,
      };
    case "point":
      return { x1: shape.x, y1: shape.y, x2: shape.x + 1, y2: shape.y + 1 };
    case "poly": {
      const pts = shape.pts || [];
      if (!pts.length) return { x1: 0, y1: 0, x2: 0, y2: 0 };
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const p of pts) {
        if (p.x < x1) x1 = p.x;
        if (p.y < y1) y1 = p.y;
        if (p.x > x2) x2 = p.x;
        if (p.y > y2) y2 = p.y;
      }
      return { x1, y1, x2, y2 };
    }
  }
}

function bboxContains(b: Bbox, px: number, py: number): boolean {
  return px >= b.x1 && px <= b.x2 && py >= b.y1 && py <= b.y2;
}

/** Even-odd (ray-cast) point-in-polygon test. `pts` is a ring in tile units;
 *  the ray is cast in +x. Points exactly on an edge are treated consistently
 *  (the classic half-open comparison), which is all the tile-center query
 *  needs. */
export function pointInPoly(pts: { x: number; y: number }[], px: number, py: number): boolean {
  let inside = false;
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x, yi = pts[i].y;
    const xj = pts[j].x, yj = pts[j].y;
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Is the point (px, py) — in tile units — inside `shape`? Bbox pre-filtered.
 *  The callers query a tile center (x + 0.5, y + 0.5); see pointInZoneTile. */
export function pointInShape(shape: ZoneShape, px: number, py: number): boolean {
  // Cheap reject: outside the bounding box can never be inside.
  if (!bboxContains(bboxOf(shape), px, py)) return false;
  switch (shape.type) {
    case "rect":
      return px >= shape.x && px <= shape.x + shape.w && py >= shape.y && py <= shape.y + shape.h;
    case "ellipse": {
      if (shape.rx <= 0 || shape.ry <= 0) return false;
      const dx = (px - shape.cx) / shape.rx;
      const dy = (py - shape.cy) / shape.ry;
      return dx * dx + dy * dy <= 1;
    }
    case "point":
      // A point zone owns exactly its one tile cell.
      return px >= shape.x && px < shape.x + 1 && py >= shape.y && py < shape.y + 1;
    case "poly":
      return pointInPoly(shape.pts || [], px, py);
  }
}

/** Does the zone cover tile (tx, ty)? The tile is sampled at its center, so a
 *  1×1 rect at (tx, ty) covers exactly that tile. This is THE query the
 *  runtime and atlas.zonesAt use. */
export function pointInZoneTile(shape: ZoneShape, tx: number, ty: number): boolean {
  return pointInShape(shape, tx + 0.5, ty + 0.5);
}

/** Shortest distance (tile units) from the tile-center (tx, ty) to the shape;
 *  0 when inside. Backs the sound zone's linear falloff. Ellipse uses the
 *  bounding-box edge distance as a cheap, monotonic approximation (exact
 *  ellipse distance is not worth the cost for an audio curve). */
export function distanceToZoneTile(shape: ZoneShape, tx: number, ty: number): number {
  const px = tx + 0.5, py = ty + 0.5;
  if (pointInShape(shape, px, py)) return 0;
  if (shape.type === "poly") {
    const pts = shape.pts || [];
    if (pts.length < 2) {
      return distToBox(px, py, bboxOf(shape));
    }
    let best = Infinity;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      best = Math.min(best, distToSeg(px, py, pts[j].x, pts[j].y, pts[i].x, pts[i].y));
    }
    return best;
  }
  return distToBox(px, py, bboxOf(shape));
}

function distToBox(px: number, py: number, b: Bbox): number {
  const dx = Math.max(b.x1 - px, 0, px - b.x2);
  const dy = Math.max(b.y1 - py, 0, py - b.y2);
  return Math.sqrt(dx * dx + dy * dy);
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const cx = ax + t * vx, cy = ay + t * vy;
  const dx = px - cx, dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Every zone in `zones` that covers tile (tx, ty). Preserves array order (so
 *  callers that want precedence — e.g. "last zone wins" — get a stable list).
 *  Absent / empty list ⇒ []. This is the shared core behind atlas.zonesAt and
 *  the engine's per-kind checks. */
export function zonesAtTile(zones: MapZone[] | undefined | null, tx: number, ty: number): MapZone[] {
  if (!zones || !zones.length) return [];
  const out: MapZone[] = [];
  for (const z of zones) {
    if (z && z.shape && pointInZoneTile(z.shape, tx, ty)) out.push(z);
  }
  return out;
}
