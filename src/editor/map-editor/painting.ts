/* RPGAtlas — src/editor/map-editor/painting.ts
   Painting tools, layer resolution, event-mode canvas actions & handlers.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1):
   logic unchanged, closure vars routed through editor-state.ts; setMode and
   refreshToolbar are imported directly from workspace.ts (one-way edge —
   workspace does not import painting.ts).
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, DataDefaults, RA, TILE, editorState as S, curMap } from "../editor-state";
import { showPopupMenu } from "../modals";
import { touch } from "../persistence";
import { renderMap, renderPalette, normRect } from "./map-render";
import { pushUndo } from "./history";
import { stampPaste, cancelPaste, copySelection } from "./clipboard";
import { setStatus, flashStatus } from "./status";
import { quickTransfer, quickSign, quickChest } from "../event-editor/quick-events";
import { openEventEditor } from "../event-editor/event-editor";
import { setMode, refreshToolbar } from "../workspace";
import { isAutotileId } from "../../shared/autotile-registry";
import { tileId } from "../../shared/tile-flags";

  // ============================ painting ============================
  export function cellFromMouse(e: any) {
    const r = S.mapCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / (TILE * S.zoom));
    const y = Math.floor((e.clientY - r.top) / (TILE * S.zoom));
    const m = curMap();
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return null;
    return { x, y };
  }
  export function quadFromMouse(e: any) {
    const r = S.mapCanvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / (TILE * S.zoom), fy = (e.clientY - r.top) / (TILE * S.zoom);
    const qx = (fx - Math.floor(fx)) >= 0.5 ? 1 : 0;
    const qy = (fy - Math.floor(fy)) >= 0.5 ? 1 : 0;
    return 1 << (qy * 2 + qx);
  }
  // ---- layer resolution ----
  export function setCell(x: any, y: any, t: any, ln: any) {
    const m = curMap();
    m.layers[ln][y * m.width + x] = t;
  }
  export function getCell(x: any, y: any, ln: any) {
    const m = curMap();
    return m.layers[ln][y * m.width + x];
  }
  export function topLayerAt(x: any, y: any) {
    const m = curMap(), i = y * m.width + x;
    for (const ln of ["over", "decor2", "decor"]) if (m.layers[ln][i]) return ln;
    return "ground";
  }
  // Auto layer: terrain tiles go to ground; decorations stack onto decor, then decor 2.
  export function resolvePaintLayer(t: any, x: any, y: any) {
    if (S.layer !== "auto") return S.layer;
    // Autotile groups are whole-cell terrain → ground layer under Auto.
    if (isAutotileId(t)) return "ground";
    const def = Assets.tiles[t];
    if (!def || def.terrain) return "ground";
    const m = curMap(), i = y * m.width + x;
    if (!m.layers.decor[i] || m.layers.decor[i] === t) return "decor";
    return "decor2";
  }
  export function floodFill(x: any, y: any, t: any, ln: any) {
    const m = curMap();
    const arr = m.layers[ln];
    const target = arr[y * m.width + x];
    if (target === t) return;
    const stack: any[] = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= m.width || cy >= m.height) continue;
      const i = cy * m.width + cx;
      if (arr[i] !== target) continue;
      arr[i] = t;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  // Iterate the current brush footprint (odd square centered on the cell),
  // clipped to the map. Brush size only affects the freehand pen/eraser.
  function forBrush(cell: any, fn: (x: number, y: number) => void) {
    const m = curMap(), r = Math.floor(Math.max(1, S.brushSize) / 2);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cell.x + dx, y = cell.y + dy;
        if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
        fn(x, y);
      }
    }
  }
  export function paintAt(cell: any) {
    if (S.tool === "pen") {
      forBrush(cell, (x, y) => setCell(x, y, S.selectedTile, resolvePaintLayer(S.selectedTile, x, y)));
    } else if (S.tool === "erase") {
      forBrush(cell, (x, y) => setCell(x, y, 0, S.layer === "auto" ? topLayerAt(x, y) : S.layer));
    } else if (S.tool === "fill") {
      const def = Assets.tiles[S.selectedTile];
      const ln = S.layer === "auto" ? (def && def.terrain ? "ground" : "decor") : S.layer;
      floodFill(cell.x, cell.y, S.selectedTile, ln);
    }
    touch(); renderMap();
  }
  export function paintShadow(cell: any, bit: any, add: any) {
    const m = curMap(), i = cell.y * m.width + cell.x;
    m.shadows[i] = add ? (m.shadows[i] | bit) : (m.shadows[i] & ~bit);
    touch(); renderMap();
  }
  export function paintPass(cell: any, val: any) {
    const m = curMap();
    m.passOv[cell.y * m.width + cell.x] = val;
    touch(); renderMap();
  }
  // HD-2D elevation layer (projects from before the heights layer existed may
  // lack the array until their next load runs the migration)
  export function heightsOf(m: any) {
    const n = m.width * m.height;
    if (!m.heights || m.heights.length !== n) m.heights = new Array(n).fill(0);
    return m.heights;
  }
  export function paintHeight(cell: any, val: any) {
    const m = curMap();
    heightsOf(m)[cell.y * m.width + cell.x] = val;
    touch(); renderMap();
  }
  export function floodFillHeight(x: any, y: any, val: any) {
    const m = curMap(), arr = heightsOf(m);
    const target = arr[y * m.width + x] || 0;
    if (target === val) return;
    const stack: any[] = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= m.width || cy >= m.height) continue;
      const i = cy * m.width + cx;
      if ((arr[i] || 0) !== target) continue;
      arr[i] = val;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  // Region tag layer (Phase 5): 0 = none, 1–63; painted like heights.
  export function regionsOf(m: any) {
    const n = m.width * m.height;
    if (!m.regions || m.regions.length !== n) m.regions = new Array(n).fill(0);
    return m.regions;
  }
  export function paintRegion(cell: any, val: any) {
    const m = curMap();
    regionsOf(m)[cell.y * m.width + cell.x] = val;
    touch(); renderMap();
  }
  export function floodFillRegion(x: any, y: any, val: any) {
    const m = curMap(), arr = regionsOf(m);
    const target = arr[y * m.width + x] || 0;
    if (target === val) return;
    const stack: any[] = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= m.width || cy >= m.height) continue;
      const i = cy * m.width + cx;
      if ((arr[i] || 0) !== target) continue;
      arr[i] = val;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }
  export function eventAt(x: any, y: any) { return curMap().events.find((e: any) => e.x === x && e.y === y) || null; }
  // Shared event-mode actions, reused by the canvas (double-click / right-click menu), keyboard, and
  // start-mode paths so they stay in lockstep. Undo is handled inside each as appropriate — callers
  // (e.g. the context menu) must not add their own pushUndo().
  export function newEventAt(cell: any) {
    const existing = eventAt(cell.x, cell.y);
    if (existing) {
      // Existing event → edit in place; commits on OK, unchanged behavior.
      S.selectedEvent = existing;
      renderMap(); refreshToolbar();
      openEventEditor(existing);
      return existing;
    }
    // Brand-new event: build it detached and only insert into the map when the editor is confirmed
    // (via the onCommitNew hook). Cancelling the first edit leaves nothing behind — same as the
    // quick-event builders. The editor edits a clone, so the detached object is untouched until OK.
    const ev = DataDefaults.newEvent(RA.nextId(curMap().events), cell.x, cell.y);
    openEventEditor(ev, () => {
      curMap().events.push(ev);
      S.selectedEvent = ev;
      refreshToolbar();
    });
    return ev;
  }
  export function setStartHere(cell: any) {
    S.proj.system.startMapId = S.curMapId;
    S.proj.system.startX = cell.x; S.proj.system.startY = cell.y;
    touch(); renderMap();
    flashStatus("Start position set");
  }
  export function deleteSelectedEvent() {
    if (!S.selectedEvent) return;
    pushUndo("Delete event");
    const m = curMap();
    m.events = m.events.filter((x: any) => x !== S.selectedEvent);
    S.selectedEvent = null;
    touch(); renderMap(); refreshToolbar();
  }

  // Right-click in Event mode: select what's under the cursor, then show a context-sensitive menu.
  export function openCanvasMenu(e: any) {
    const cell = cellFromMouse(e);
    if (!cell) return;
    S.selectedEvent = eventAt(cell.x, cell.y);
    renderMap(); refreshToolbar();
    const ev = S.selectedEvent;
    if (ev) {
      showPopupMenu(e.clientX, e.clientY, [
        { label: "Edit Event", onClick: () => openEventEditor(ev) },
        { label: "Cut", key: "Ctrl+X", onClick: () => copySelection(true) },
        { label: "Copy", key: "Ctrl+C", onClick: () => copySelection(false) },
        { label: "Delete", onClick: () => deleteSelectedEvent() },
        "separator",
        { label: "Set Start Position Here", onClick: () => setStartHere(cell) },
      ]);
    } else {
      showPopupMenu(e.clientX, e.clientY, [
        { label: "New Event", onClick: () => newEventAt(cell) },
        { label: "New Quick Event", submenu: [
          { label: "Transfer", onClick: () => quickTransfer(cell) },
          { label: "Sign", onClick: () => quickSign(cell) },
          { label: "Chest", onClick: () => quickChest(cell) },
        ] },
        { label: "Paste Event", key: "Ctrl+V", enabled: !!S.clipEvent,
          onClick: () => { S.pasteMode = "event"; stampPaste(cell); } },
        "separator",
        { label: "Set Start Position Here", onClick: () => setStartHere(cell) },
      ]);
    }
  }
  export function onCanvasDown(e: any) {
    const cell = cellFromMouse(e);
    if (!cell) return;
    if (S.pasteMode) {
      if (e.button === 0) stampPaste(cell);
      else if (e.button === 2) { S.suppressNextCtxMenu = true; cancelPaste(); }
      return;
    }
    if (e.button === 2) {
      if (S.mode === "map" && S.tool === "shadow") { // right button erases shadows
        S.painting = true; S.shadowSet = false;
        pushUndo("Shadow edit");
        paintShadow(cell, quadFromMouse(e), false);
        return;
      }
      if (S.mode === "height") { // eyedropper: pick up the elevation under the cursor
        S.heightVal = heightsOf(curMap())[cell.y * curMap().width + cell.x] || 0;
        setStatus();
        return;
      }
      if (S.mode === "region") { // eyedropper: pick up the region id
        S.regionVal = regionsOf(curMap())[cell.y * curMap().width + cell.x] || 0;
        setStatus();
        return;
      }
      if (S.mode === "map") { // eyedropper from the topmost visible tile
        const ln = S.layer === "auto" ? topLayerAt(cell.x, cell.y) : S.layer;
        // Mask Stage-E flags: the palette selection is always a clean id (the
        // Advanced brush carries transform flags separately).
        const t = tileId(getCell(cell.x, cell.y, ln) || getCell(cell.x, cell.y, "ground"));
        if (t > 0) { S.selectedTile = t; renderPalette(); setStatus(); }
      }
      return;
    }
    if (e.button !== 0) return;
    if (S.mode === "start") {
      setStartHere(cell);
      setMode("event");
      return;
    }
    if (S.mode === "pass") {
      pushUndo("Passability edit");
      const m = curMap();
      const cur = m.passOv[cell.y * m.width + cell.x] || 0;
      // auto → force block → force pass → ledge (jump over) → auto
      S.passVal = cur === 0 ? 2 : cur === 2 ? 1 : cur === 1 ? 3 : 0;
      S.painting = true;
      paintPass(cell, S.passVal);
      return;
    }
    if (S.mode === "height") {
      pushUndo("Height edit");
      S.painting = true;
      if (S.tool === "rect" || S.tool === "circle") { S.rectStart = cell; renderMap(); }
      else if (S.tool === "fill") { floodFillHeight(cell.x, cell.y, S.heightVal); touch(); renderMap(); }
      else paintHeight(cell, S.tool === "erase" ? 0 : S.heightVal);
      return;
    }
    if (S.mode === "region") {
      pushUndo("Region edit");
      S.painting = true;
      if (S.tool === "fill") { floodFillRegion(cell.x, cell.y, S.regionVal); touch(); renderMap(); }
      else paintRegion(cell, S.tool === "erase" ? 0 : S.regionVal);
      return;
    }
    if (S.mode === "event") {
      S.selectedEvent = eventAt(cell.x, cell.y);
      S.dragEvent = S.selectedEvent;
      S.dragPushed = false;
      renderMap(); refreshToolbar();
      return;
    }
    // map mode
    if (e.shiftKey) { // marquee selection
      S.selecting = true;
      S.selAnchor = cell;
      S.selection = normRect(cell, cell);
      renderMap(); refreshToolbar();
      return;
    }
    S.painting = true;
    pushUndo("Paint");
    if (S.tool === "rect" || S.tool === "circle") { S.rectStart = cell; renderMap(); }
    else if (S.tool === "shadow") { S.shadowSet = true; paintShadow(cell, quadFromMouse(e), true); }
    else paintAt(cell);
  }
  export function onCanvasMove(e: any) {
    const cell = cellFromMouse(e);
    const q = cell && S.tool === "shadow" && S.mode === "map" ? quadFromMouse(e) : 0;
    const changed = !cell || !S.hoverCell || cell.x !== S.hoverCell.x || cell.y !== S.hoverCell.y || q !== S.hoverQuad;
    S.hoverCell = cell; S.hoverQuad = q;
    if (!cell) { if (changed) renderMap(); return; }
    if (S.selecting) {
      S.selection = normRect(S.selAnchor, cell);
      renderMap();
    } else if (S.mode === "map" && S.painting && (S.tool === "pen" || S.tool === "erase")) {
      paintAt(cell);
    } else if (S.mode === "map" && S.painting && S.tool === "shadow") {
      paintShadow(cell, q, S.shadowSet);
    } else if (S.mode === "pass" && S.painting) {
      paintPass(cell, S.passVal);
    } else if (S.mode === "height" && S.painting && S.tool !== "rect" && S.tool !== "circle" && S.tool !== "fill") {
      paintHeight(cell, S.tool === "erase" ? 0 : S.heightVal);
    } else if (S.mode === "region" && S.painting && S.tool !== "fill") {
      paintRegion(cell, S.tool === "erase" ? 0 : S.regionVal);
    } else if (S.mode === "event" && S.dragEvent && (S.dragEvent.x !== cell.x || S.dragEvent.y !== cell.y)) {
      if (!eventAt(cell.x, cell.y)) {
        if (!S.dragPushed) { S.dragPushed = true; pushUndo("Move event"); S.dragEvent = curMap().events.find((ev: any) => ev.id === S.dragEvent.id); S.selectedEvent = S.dragEvent; }
        S.dragEvent.x = cell.x; S.dragEvent.y = cell.y;
        touch();
      }
      renderMap();
    } else if (changed) {
      renderMap();
    }
    setStatus();
  }
  export function onCanvasUp() {
    if (S.selecting) {
      S.selecting = false; S.selAnchor = null;
      refreshToolbar(); renderMap();
    }
    if ((S.mode === "map" || S.mode === "height") && S.painting && (S.tool === "rect" || S.tool === "circle") && S.rectStart && S.hoverCell) {
      const m = curMap();
      const r = normRect(S.rectStart, S.hoverCell);
      const cx = (r.x1 + r.x2 + 1) / 2, cy = (r.y1 + r.y2 + 1) / 2;
      const rx = (r.x2 - r.x1 + 1) / 2, ry = (r.y2 - r.y1 + 1) / 2;
      for (let y = r.y1; y <= r.y2; y++) {
        for (let x = r.x1; x <= r.x2; x++) {
          if (S.tool === "circle") {
            const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
            if (nx * nx + ny * ny > 1) continue;
          }
          if (S.mode === "height") heightsOf(m)[y * m.width + x] = S.heightVal;
          else setCell(x, y, S.selectedTile, resolvePaintLayer(S.selectedTile, x, y));
        }
      }
      touch();
    }
    S.painting = false; S.rectStart = null; S.dragEvent = null; S.dragPushed = false;
    renderMap();
  }
  export function onCanvasDbl(e: any) {
    if (S.mode !== "event") return;
    const cell = cellFromMouse(e);
    if (!cell) return;
    newEventAt(cell);
  }
