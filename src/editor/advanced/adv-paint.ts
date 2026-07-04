/* RPGAtlas — src/editor/advanced/adv-paint.ts
   Painting on the Advanced Map Editor canvas (Phase 8 Stage B).

   The Advanced canvas paints the *active* layer — any entry in the generalized
   stack, not just the four roles. Core layers write straight into the classic
   map.layers[role] arrays (so the Standard editor sees the same tiles); tile
   layers write into their own data array. Every stroke funnels through the
   shared pushUndo()/touch() seams, so undo and autosave behave identically to
   the Standard editor. The selected tile and brush size are shared with the
   Standard palette (S.selectedTile / S.brushSize) — one palette, both editors.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { TILE, editorState as S, curMap } from "../editor-state";
import { touch } from "../persistence";
import { renderMap, normRect } from "../map-editor/map-render";
import { pushUndo } from "../map-editor/history";
import { layerView } from "../../shared/layer-view";
import { isAutotileId } from "../../shared/autotile-registry";
import { withFlags } from "../../shared/tile-flags";
import { advState, advHooks, ensureLayersAdv, findLayer } from "./adv-state";
import { placeStampAt } from "./adv-stamps";

/** The value the active brush writes for a plain tile: the selected id with the
 *  current brush transform flags folded in. Autotile groups resolve their own
 *  shape, so their reserved id is written flag-free (v1 scope). */
function brushValue(): number {
  const id = S.selectedTile;
  if (isAutotileId(id)) return id;
  const f = advState.brushFlags;
  return (f.h || f.v || f.r) ? withFlags(id, f) : id;
}

/** The mutable tile array the active layer writes into: the role array for a
 *  core, the layer's own data for a tile layer. null when nothing paintable is
 *  active (no active layer, a locked layer, or a group). */
export function activeArray(m: any): number[] | null {
  if (advState.activeLayerId == null) return null;
  const e = layerView(m).find((x) => x.id === advState.activeLayerId);
  if (!e || e.locked) return null;
  if (e.role) return m.layers[e.role];
  const hit = findLayer(ensureLayersAdv(m), e.id);
  if (!hit) return null;
  const l = hit.list[hit.index] as any;
  return l.type === "tile" ? l.data : null;
}

function cellFromMouse(canvas: HTMLCanvasElement, e: MouseEvent) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / (TILE * advState.zoom));
  const y = Math.floor((e.clientY - r.top) / (TILE * advState.zoom));
  const m = curMap();
  if (!m || x < 0 || y < 0 || x >= m.width || y >= m.height) return null;
  return { x, y };
}

function forBrush(m: any, cell: { x: number; y: number }, fn: (x: number, y: number) => void) {
  const r = Math.floor(Math.max(1, S.brushSize) / 2);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cell.x + dx, y = cell.y + dy;
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
      fn(x, y);
    }
  }
}

function floodFill(m: any, arr: number[], x: number, y: number, t: number) {
  const target = arr[y * m.width + x];
  if (target === t) return;
  const stack: number[][] = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= m.width || cy >= m.height) continue;
    const i = cy * m.width + cx;
    if (arr[i] !== target) continue;
    arr[i] = t;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

function afterEdit() {
  touch();          // autosave + viewportDirty (live HD-2D) + advDirty (debounced)
  advHooks.render(); // immediate Advanced-canvas feedback
  renderMap();      // keep the Standard canvas in lockstep
}

function paintAt(m: any, arr: number[], cell: { x: number; y: number }) {
  if (advState.tool === "pen") {
    const v = brushValue();
    forBrush(m, cell, (x, y) => { arr[y * m.width + x] = v; });
  } else if (advState.tool === "erase") {
    forBrush(m, cell, (x, y) => { arr[y * m.width + x] = 0; });
  } else if (advState.tool === "fill") {
    // Autotile groups fill by their reserved id like any other tile; plain
    // tiles fill with the brush transform folded in.
    floodFill(m, arr, cell.x, cell.y, brushValue());
  }
}

export function attachAdvPainting(canvas: HTMLCanvasElement) {
  canvas.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button !== 0) return;
    const m = curMap();
    if (!m) return;
    const cell = cellFromMouse(canvas, e);
    if (!cell) return;
    // Stamp placement (Stage E): click stamps the armed library entry through
    // the shared paste path (own pushUndo inside placeStampAt). Random-scatter
    // mode scatters across the brush footprint with per-stamp probability.
    if (advState.placingStamp) {
      placeStampAt(m, cell);
      afterEdit();
      return;
    }
    const arr = activeArray(m);
    if (!arr) return; // no paintable active layer (group / locked / none)
    advState.painting = true;
    pushUndo("Paint");
    if (advState.tool === "rect") { advState.rectStart = cell; advHooks.render(); }
    else { paintAt(m, arr, cell); afterEdit(); }
  });
  canvas.addEventListener("mousemove", (e: MouseEvent) => {
    const m = curMap();
    if (!m) return;
    const cell = cellFromMouse(canvas, e);
    const changed = !cell || !advState.hoverCell || cell.x !== advState.hoverCell.x || cell.y !== advState.hoverCell.y;
    advState.hoverCell = cell;
    if (!cell) { if (changed) advHooks.render(); return; }
    if (advState.painting && (advState.tool === "pen" || advState.tool === "erase")) {
      const arr = activeArray(m);
      if (arr) { paintAt(m, arr, cell); afterEdit(); }
    } else if (changed) {
      advHooks.render();
    }
  });
  const finish = () => {
    const m = curMap();
    if (m && advState.painting && advState.tool === "rect" && advState.rectStart && advState.hoverCell) {
      const arr = activeArray(m);
      if (arr) {
        const r = normRect(advState.rectStart, advState.hoverCell);
        const v = brushValue();
        for (let y = r.y1; y <= r.y2; y++)
          for (let x = r.x1; x <= r.x2; x++) arr[y * m.width + x] = v;
        afterEdit();
      }
    }
    advState.painting = false;
    advState.rectStart = null;
    advHooks.render();
  };
  canvas.addEventListener("mouseup", finish);
  canvas.addEventListener("mouseleave", () => {
    advState.hoverCell = null;
    if (advState.painting) finish(); else advHooks.render();
  });
}
