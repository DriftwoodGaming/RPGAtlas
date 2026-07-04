/* RPGAtlas — src/editor/advanced/adv-zone-draw.ts
   Zone drawing & editing on the Advanced Map Editor canvas (Phase 8 Stage D,
   Objects mode). Tools: rect / ellipse / poly / point draw a new zone of the
   palette's active kind; select clicks a zone to edit it and drags its
   vertices. Everything snaps to the tile grid (zones are stored in tile
   units). Each committed draw / vertex edit funnels through pushUndo()/touch()
   so Ctrl+Z works from either editor and the change autosaves.

   The listeners share the canvas with adv-paint.ts; both check advState.rail so
   only the active mode responds. Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { TILE, curMap } from "../editor-state";
import { touch } from "../persistence";
import { renderMap } from "../map-editor/map-render";
import { pushUndo } from "../map-editor/history";
import type { MapZone, ZoneShape } from "../../shared/schema";
import { advState, advHooks } from "./adv-state";
import { addZone, findZone, patchZone } from "./adv-zones";

/** Fractional tile coordinate under the mouse (for vertex snapping we round). */
function tileCoord(canvas: HTMLCanvasElement, e: MouseEvent) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / (TILE * advState.zoom);
  const y = (e.clientY - r.top) / (TILE * advState.zoom);
  return { x, y };
}
function snap(c: { x: number; y: number }) {
  return { x: Math.round(c.x), y: Math.round(c.y) };
}
function inBounds(m: any, c: { x: number; y: number }) {
  return c.x >= 0 && c.y >= 0 && c.x <= m.width && c.y <= m.height;
}

function afterZoneEdit() {
  touch();
  advHooks.render();
  renderMap();
}

/** The vertices of a zone shape, in tile units (for handle hit-testing). */
function verticesOf(shape: ZoneShape): { x: number; y: number }[] {
  if (shape.type === "rect") return [{ x: shape.x, y: shape.y }, { x: shape.x + shape.w, y: shape.y }, { x: shape.x + shape.w, y: shape.y + shape.h }, { x: shape.x, y: shape.y + shape.h }];
  if (shape.type === "ellipse") return [{ x: shape.cx, y: shape.cy }];
  if (shape.type === "point") return [{ x: shape.x, y: shape.y }];
  return shape.pts || [];
}

/** Move vertex `index` of `shape` to (nx, ny) — returns a new shape. Rect
 *  corners resize the box; ellipse center moves; poly moves that point. */
function moveVertex(shape: ZoneShape, index: number, nx: number, ny: number): ZoneShape {
  if (shape.type === "rect") {
    const corners = [{ x: shape.x, y: shape.y }, { x: shape.x + shape.w, y: shape.y }, { x: shape.x + shape.w, y: shape.y + shape.h }, { x: shape.x, y: shape.y + shape.h }];
    corners[index] = { x: nx, y: ny };
    // opposite corner stays fixed
    const opp = corners[(index + 2) % 4];
    const x1 = Math.min(nx, opp.x), y1 = Math.min(ny, opp.y);
    const x2 = Math.max(nx, opp.x), y2 = Math.max(ny, opp.y);
    return { type: "rect", x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
  }
  if (shape.type === "ellipse") {
    return { type: "ellipse", cx: nx, cy: ny, rx: shape.rx, ry: shape.ry };
  }
  if (shape.type === "point") {
    return { type: "point", x: nx, y: ny };
  }
  const pts = (shape.pts || []).slice();
  pts[index] = { x: nx, y: ny };
  return { type: "poly", pts };
}

/** Hit-test: the zone whose shape covers (fx, fy), searched top-first (last in
 *  the array is drawn on top). Uses the shared geom via a tile sample. */
function zoneAtPoint(zones: MapZone[], fx: number, fy: number): MapZone | null {
  // A simple bbox+shape test at the fractional point (not tile-center) so the
  // whole painted area is clickable.
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    if (z.shape && hitShape(z.shape, fx, fy)) return z;
  }
  return null;
}
function hitShape(shape: ZoneShape, px: number, py: number): boolean {
  if (shape.type === "rect") return px >= shape.x && px <= shape.x + shape.w && py >= shape.y && py <= shape.y + shape.h;
  if (shape.type === "ellipse") {
    if (shape.rx <= 0 || shape.ry <= 0) return false;
    const dx = (px - shape.cx) / shape.rx, dy = (py - shape.cy) / shape.ry;
    return dx * dx + dy * dy <= 1;
  }
  if (shape.type === "point") return px >= shape.x && px <= shape.x + 1 && py >= shape.y && py <= shape.y + 1;
  const pts = shape.pts || [];
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (pts[i].y > py !== pts[j].y > py && px < ((pts[j].x - pts[i].x) * (py - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}

/** Find a vertex handle near the point (within a tile-ish radius). */
function vertexNear(zone: MapZone, px: number, py: number): number {
  const verts = verticesOf(zone.shape);
  const r = 0.5;
  for (let i = 0; i < verts.length; i++) {
    if (Math.abs(verts[i].x - px) <= r && Math.abs(verts[i].y - py) <= r) return i;
  }
  return -1;
}

export function attachZoneDrawing(canvas: HTMLCanvasElement) {
  let drawStart: { x: number; y: number } | null = null;

  canvas.addEventListener("mousedown", (e: MouseEvent) => {
    if (advState.rail !== "objects" || e.button !== 0) return;
    const m = curMap();
    if (!m) return;
    const raw = tileCoord(canvas, e);
    const cell = snap(raw);
    if (!inBounds(m, cell)) return;

    if (advState.zoneTool === "select") {
      // vertex drag on the selected zone, else pick a zone under the cursor
      const sel = advState.selectedZoneId != null ? findZone(m, advState.selectedZoneId) : null;
      if (sel) {
        const vi = vertexNear(sel, raw.x, raw.y);
        if (vi >= 0) { advState.vertexDrag = { zoneId: sel.id, index: vi }; pushUndo("Edit zone"); return; }
      }
      const hit = zoneAtPoint((m.zones as MapZone[]) || [], raw.x, raw.y);
      advState.selectedZoneId = hit ? hit.id : null;
      advHooks.rebuildObjects();
      advHooks.render();
      return;
    }

    if (advState.zoneTool === "point") {
      pushUndo("Add zone");
      const z = addZone(m, advState.activeKind, { type: "point", x: cell.x, y: cell.y });
      advState.selectedZoneId = z.id;
      afterZoneEdit(); advHooks.rebuildObjects();
      return;
    }

    if (advState.zoneTool === "poly") {
      if (!advState.polyPts) advState.polyPts = [];
      advState.polyPts.push({ x: cell.x, y: cell.y });
      advState.zoneDraft = { type: "poly", pts: advState.polyPts.slice() };
      advHooks.render();
      return;
    }

    // rect / ellipse: drag out
    drawStart = cell;
    advState.zoneDraft = advState.zoneTool === "rect"
      ? { type: "rect", x: cell.x, y: cell.y, w: 0, h: 0 }
      : { type: "ellipse", cx: cell.x, cy: cell.y, rx: 0, ry: 0 };
    advHooks.render();
  });

  canvas.addEventListener("mousemove", (e: MouseEvent) => {
    if (advState.rail !== "objects") return;
    const m = curMap();
    if (!m) return;
    const raw = tileCoord(canvas, e);
    const cell = snap(raw);
    advState.hoverCell = inBounds(m, cell) ? cell : null;

    if (advState.vertexDrag) {
      const z = findZone(m, advState.vertexDrag.zoneId);
      if (z) { z.shape = moveVertex(z.shape, advState.vertexDrag.index, cell.x, cell.y); advHooks.render(); }
      return;
    }
    if (drawStart) {
      if (advState.zoneTool === "rect") {
        const x1 = Math.min(drawStart.x, cell.x), y1 = Math.min(drawStart.y, cell.y);
        advState.zoneDraft = { type: "rect", x: x1, y: y1, w: Math.abs(cell.x - drawStart.x), h: Math.abs(cell.y - drawStart.y) };
      } else {
        const cx = (drawStart.x + cell.x) / 2, cy = (drawStart.y + cell.y) / 2;
        advState.zoneDraft = { type: "ellipse", cx, cy, rx: Math.abs(cell.x - drawStart.x) / 2, ry: Math.abs(cell.y - drawStart.y) / 2 };
      }
      advHooks.render();
    } else if (advState.zoneTool === "poly" && advState.polyPts && advState.polyPts.length) {
      // rubber-band the last segment to the cursor
      advState.zoneDraft = { type: "poly", pts: [...advState.polyPts, { x: cell.x, y: cell.y }] };
      advHooks.render();
    }
  });

  const finishDrag = () => {
    if (advState.vertexDrag) {
      advState.vertexDrag = null;
      afterZoneEdit(); advHooks.rebuildObjects();
      return;
    }
    if (!drawStart) return;
    const m = curMap();
    const draft = advState.zoneDraft;
    drawStart = null;
    advState.zoneDraft = null;
    if (!m || !draft) return;
    // reject a zero-area drag (a stray click)
    if (draft.type === "rect" && (draft.w < 1 || draft.h < 1)) { advHooks.render(); return; }
    if (draft.type === "ellipse" && (draft.rx < 0.5 || draft.ry < 0.5)) { advHooks.render(); return; }
    pushUndo("Add zone");
    const z = addZone(m, advState.activeKind, draft);
    advState.selectedZoneId = z.id;
    afterZoneEdit(); advHooks.rebuildObjects();
  };
  canvas.addEventListener("mouseup", finishDrag);

  // double-click commits the in-progress polygon (needs ≥3 points)
  canvas.addEventListener("dblclick", (e: MouseEvent) => {
    if (advState.rail !== "objects" || advState.zoneTool !== "poly") return;
    const m = curMap();
    if (!m || !advState.polyPts) return;
    e.preventDefault();
    const pts = advState.polyPts;
    advState.polyPts = null;
    advState.zoneDraft = null;
    if (pts.length < 3) { advHooks.render(); return; }
    pushUndo("Add zone");
    const z = addZone(m, advState.activeKind, { type: "poly", pts });
    advState.selectedZoneId = z.id;
    afterZoneEdit(); advHooks.rebuildObjects();
  });

  canvas.addEventListener("mouseleave", () => {
    if (advState.rail !== "objects") return;
    advState.hoverCell = null;
    if (advState.vertexDrag || drawStart) finishDrag();
    else advHooks.render();
  });
}

/** Cancel any in-progress poly / draft (Esc, or a mode switch). */
export function cancelZoneDraft() {
  advState.polyPts = null;
  advState.zoneDraft = null;
  advState.vertexDrag = null;
}

/** patch helper re-exported so the inspector can nudge a shape numerically. */
export { patchZone };
