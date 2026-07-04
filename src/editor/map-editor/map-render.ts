/* RPGAtlas — src/editor/map-editor/map-render.ts
   Map canvas rendering, palette rendering, overlays, normRect.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1);
   Phase 8 Stage A split the body into renderMapView(g, map, view) — the
   shared render core both the classic Map panel and the Advanced Map Editor
   drive — with renderMap() left as the thin wrapper binding the shared
   editor state S. Behavior-frozen: same draw calls in the same order.
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, TILE, LAYER_ORDER, editorState as S, curMap } from "../editor-state";
import { drawLayerCell } from "../../shared/autotile-draw";
import { isAutotileId } from "../../shared/autotile-registry";

  // ============================ map rendering ============================
  /** Everything renderMapView reads besides the map itself: the classic
   *  editor binds these to S (viewFromS); the Advanced panel binds its own
   *  advState. Fields mirror the S fields the monolith body read. */
  export interface MapView {
    zoom: number;
    mode: string;              // map | event | pass | start | height | region
    layer: string;             // auto | ground | decor | decor2 | over
    tool: string;
    selection: any;            // {x1,y1,x2,y2} | null
    hoverCell: any;
    hoverQuad: number;
    rectStart: any;
    painting: boolean;
    pasteMode: null | "tiles" | "event";
    clipTiles: any;
    selectedEvent: any;
    /** start-marker source (S.proj.system in the classic editor). */
    system: { startMapId: number; startX: number; startY: number };
  }
  function viewFromS(): MapView {
    return {
      zoom: S.zoom, mode: S.mode, layer: S.layer, tool: S.tool,
      selection: S.selection, hoverCell: S.hoverCell, hoverQuad: S.hoverQuad,
      rectStart: S.rectStart, painting: S.painting, pasteMode: S.pasteMode,
      clipTiles: S.clipTiles, selectedEvent: S.selectedEvent,
      system: S.proj.system,
    };
  }
  function layerAlpha(v: MapView, li: any) {
    if (v.mode !== "map") return li === 3 ? 0.8 : 1;
    if (v.layer === "auto") return li === 3 ? 0.85 : 1;
    const a = LAYER_ORDER.indexOf(v.layer);
    return li > a ? 0.45 : 1;
  }
  function effectivePassOn(m: any, x: any, y: any) {
    const i = y * m.width + x;
    const ov = m.passOv[i];
    if (ov === 1) return true;
    if (ov === 2) return false;
    for (const ln of ["decor2", "decor"]) {
      const t = m.layers[ln][i];
      if (t) return Assets.tiles[t] ? Assets.tiles[t].pass : false;
    }
    const t = m.layers.ground[i];
    return t && Assets.tiles[t] ? Assets.tiles[t].pass : false;
  }
  export function effectivePass(x: any, y: any) {
    return effectivePassOn(curMap(), x, y);
  }
  function drawShadows(g: any, m: any) {
    const H = TILE / 2;
    g.fillStyle = "rgba(10,10,26,0.35)";
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const mask = m.shadows[y * m.width + x];
        if (!mask) continue;
        if (mask & 1) g.fillRect(x * TILE, y * TILE, H, H);
        if (mask & 2) g.fillRect(x * TILE + H, y * TILE, H, H);
        if (mask & 4) g.fillRect(x * TILE, y * TILE + H, H, H);
        if (mask & 8) g.fillRect(x * TILE + H, y * TILE + H, H, H);
      }
    }
  }
  function drawPassOverlay(g: any, m: any, v: MapView) {
    g.lineWidth = 3.5 / Math.max(v.zoom, 0.4);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const ov = m.passOv[y * m.width + x];
        const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2, r = TILE * 0.24;
        if (ov) { // yellow corner badge marks an override
          g.fillStyle = "#ffd86a";
          g.beginPath(); g.moveTo(x * TILE, y * TILE); g.lineTo(x * TILE + 13, y * TILE); g.lineTo(x * TILE, y * TILE + 13); g.fill();
        }
        if (ov === 3) { // ledge: jumped over, never stood on
          g.strokeStyle = "#7ac8ff";
          g.beginPath();
          g.arc(cx, cy + r * 0.5, r, Math.PI, 0);
          g.stroke();
          g.beginPath();
          g.moveTo(cx + r, cy + r * 0.5); g.lineTo(cx + r * 0.55, cy + r * 0.15);
          g.moveTo(cx + r, cy + r * 0.5); g.lineTo(cx + r * 1.35, cy + r * 0.1);
          g.stroke();
        } else if (effectivePassOn(m, x, y)) {
          g.strokeStyle = ov ? "#ffd86a" : "rgba(140,235,160,0.9)";
          g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
        } else {
          g.strokeStyle = ov ? "#ffd86a" : "rgba(255,110,110,0.9)";
          g.beginPath();
          g.moveTo(cx - r, cy - r); g.lineTo(cx + r, cy + r);
          g.moveTo(cx + r, cy - r); g.lineTo(cx - r, cy + r);
          g.stroke();
        }
      }
    }
  }
  function drawHeightOverlay(g: any, m: any) {
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 18px monospace";
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const hv = (m.heights && m.heights[y * m.width + x]) || 0;
        if (!hv) continue;
        g.fillStyle = "rgba(110,160,255," + Math.min(0.16 + hv * 0.09, 0.55) + ")";
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
        g.fillStyle = "#eaf2ff";
        g.fillText(String(hv), x * TILE + TILE / 2, y * TILE + TILE / 2 + 1);
      }
    }
  }
  // Region overlay (Phase 5): each id gets a stable hue; a ledge-style badge
  // shows the passOv=3 ledges too since region planning often pairs with them.
  export function regionColor(id: any, alpha: any) {
    return "hsla(" + ((id * 47) % 360) + ", 75%, 55%, " + alpha + ")";
  }
  function drawRegionOverlay(g: any, m: any) {
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 16px monospace";
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const rv = (m.regions && m.regions[y * m.width + x]) || 0;
        if (!rv) continue;
        g.fillStyle = regionColor(rv, 0.34);
        g.fillRect(x * TILE, y * TILE, TILE, TILE);
        g.fillStyle = "#f4f7ff";
        g.fillText(String(rv), x * TILE + TILE / 2, y * TILE + TILE / 2 + 1);
      }
    }
  }
  /** The shared render core (Phase 8 Stage A): draw `m` onto `g`'s canvas
   *  under view-state `v`. The canvas is resized to fit the map at v.zoom. */
  export function renderMapView(g: any, m: any, v: MapView) {
    if (!m) return;
    g.canvas.width = Math.max(1, Math.round(m.width * TILE * v.zoom));
    g.canvas.height = Math.max(1, Math.round(m.height * TILE * v.zoom));
    g.setTransform(v.zoom, 0, 0, v.zoom, 0, 0);
    g.imageSmoothingEnabled = v.zoom >= 1;
    g.fillStyle = "#15151d";
    g.fillRect(0, 0, m.width * TILE, m.height * TILE);
    // tile layers (layers above the active one are dimmed while drawing)
    for (let li = 0; li < LAYER_ORDER.length; li++) {
      const arr = m.layers[LAYER_ORDER[li]];
      g.globalAlpha = layerAlpha(v, li);
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          drawLayerCell(g, arr, m.width, m.height, x, y, x * TILE, y * TILE, TILE, Assets.drawTile);
        }
      }
      if (li === 2) { // shadows sit under the overhead layer, as in-game
        g.globalAlpha = 1;
        drawShadows(g, m);
      }
    }
    g.globalAlpha = 1;
    // grid
    g.strokeStyle = "rgba(255,255,255,0.09)";
    g.lineWidth = 1 / v.zoom;
    g.beginPath();
    for (let x = 0; x <= m.width; x++) { g.moveTo(x * TILE, 0); g.lineTo(x * TILE, m.height * TILE); }
    for (let y = 0; y <= m.height; y++) { g.moveTo(0, y * TILE); g.lineTo(m.width * TILE, y * TILE); }
    g.stroke();
    if (v.mode === "pass") drawPassOverlay(g, m, v);
    if (v.mode === "height") drawHeightOverlay(g, m);
    if (v.mode === "region") drawRegionOverlay(g, m);
    // Event pins stay visible while painting so placed events do not appear to
    // vanish when leaving Event mode. Passability/Height keep their overlays clean.
    if (v.mode !== "pass" && v.mode !== "height" && v.mode !== "region") {
      const interactiveEvents = v.mode === "event" || v.mode === "start";
      for (const ev of m.events) {
        g.fillStyle = interactiveEvents
          ? (ev === v.selectedEvent ? "rgba(120,200,255,0.35)" : "rgba(255,255,255,0.14)")
          : "rgba(120,200,255,0.10)";
        g.fillRect(ev.x * TILE + 2, ev.y * TILE + 2, TILE - 4, TILE - 4);
        g.strokeStyle = interactiveEvents
          ? (ev === v.selectedEvent ? "#7ac8ff" : "rgba(255,255,255,0.6)")
          : "rgba(122,200,255,0.45)";
        g.lineWidth = 2 / v.zoom;
        g.strokeRect(ev.x * TILE + 2, ev.y * TILE + 2, TILE - 4, TILE - 4);
        const pg = ev.pages[0];
        if (pg && pg.charset) {
          const ci = Assets.charsetIndex(pg.charset);
          if (ci >= 0) {
            if (!interactiveEvents) g.globalAlpha = 0.55;
            Assets.drawChar(g, ci, pg.dir || 0, 1, ev.x * TILE, ev.y * TILE - 6);
            g.globalAlpha = 1;
          }
        }
      }
    }
    // start marker
    if (v.system.startMapId === m.id) {
      g.fillStyle = "rgba(110,230,140,0.8)";
      g.fillRect(v.system.startX * TILE + 8, v.system.startY * TILE + 8, TILE - 16, TILE - 16);
      g.fillStyle = "#0c2c14";
      g.font = "bold 22px monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("S", v.system.startX * TILE + TILE / 2, v.system.startY * TILE + TILE / 2 + 1);
    }
    // selection marquee
    if (v.mode === "map" && v.selection) {
      const w = (v.selection.x2 - v.selection.x1 + 1) * TILE, h2 = (v.selection.y2 - v.selection.y1 + 1) * TILE;
      g.fillStyle = "rgba(255,216,106,0.12)";
      g.fillRect(v.selection.x1 * TILE, v.selection.y1 * TILE, w, h2);
      g.strokeStyle = "#ffd86a"; g.lineWidth = 2 / v.zoom;
      g.setLineDash([10, 6]);
      g.strokeRect(v.selection.x1 * TILE, v.selection.y1 * TILE, w, h2);
      g.setLineDash([]);
    }
    // paste preview
    if (v.pasteMode === "tiles" && v.clipTiles && v.hoverCell && v.mode === "map") {
      g.globalAlpha = 0.6;
      for (let dy = 0; dy < v.clipTiles.h; dy++) {
        for (let dx = 0; dx < v.clipTiles.w; dx++) {
          for (const ln of LAYER_ORDER) {
            drawLayerCell(g, v.clipTiles.layers[ln], v.clipTiles.w, v.clipTiles.h, dx, dy,
              (v.hoverCell.x + dx) * TILE, (v.hoverCell.y + dy) * TILE, TILE, Assets.drawTile);
          }
        }
      }
      g.globalAlpha = 1;
      g.strokeStyle = "#ffd86a"; g.lineWidth = 2 / v.zoom;
      g.strokeRect(v.hoverCell.x * TILE, v.hoverCell.y * TILE, v.clipTiles.w * TILE, v.clipTiles.h * TILE);
    }
    if (v.pasteMode === "event" && v.hoverCell && v.mode === "event") {
      g.strokeStyle = "#ffd86a"; g.lineWidth = 2 / v.zoom;
      g.strokeRect(v.hoverCell.x * TILE + 2, v.hoverCell.y * TILE + 2, TILE - 4, TILE - 4);
    }
    // hover / drag previews
    if (v.hoverCell && !v.pasteMode) {
      if ((v.tool === "rect" || v.tool === "circle") && v.rectStart && v.painting && (v.mode === "map" || v.mode === "height")) {
        const r2 = normRect(v.rectStart, v.hoverCell);
        g.strokeStyle = "#ffd86a";
        g.lineWidth = 2 / v.zoom;
        if (v.tool === "rect") {
          g.strokeRect(r2.x1 * TILE, r2.y1 * TILE, (r2.x2 - r2.x1 + 1) * TILE, (r2.y2 - r2.y1 + 1) * TILE);
        } else {
          g.beginPath();
          g.ellipse((r2.x1 + r2.x2 + 1) / 2 * TILE, (r2.y1 + r2.y2 + 1) / 2 * TILE,
            (r2.x2 - r2.x1 + 1) / 2 * TILE, (r2.y2 - r2.y1 + 1) / 2 * TILE, 0, 0, 7);
          g.stroke();
        }
      } else if (v.tool === "shadow" && v.mode === "map" && v.hoverQuad) {
        const H = TILE / 2;
        const qx = (v.hoverQuad === 2 || v.hoverQuad === 8) ? 1 : 0;
        const qy = v.hoverQuad >= 4 ? 1 : 0;
        g.fillStyle = "rgba(255,216,106,0.35)";
        g.fillRect(v.hoverCell.x * TILE + qx * H, v.hoverCell.y * TILE + qy * H, H, H);
        g.strokeStyle = "#ffffff"; g.lineWidth = 2 / v.zoom;
        g.strokeRect(v.hoverCell.x * TILE + 1, v.hoverCell.y * TILE + 1, TILE - 2, TILE - 2);
      } else {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 2 / v.zoom;
        g.strokeRect(v.hoverCell.x * TILE + 1, v.hoverCell.y * TILE + 1, TILE - 2, TILE - 2);
      }
    }
  }
  export function renderMap() {
    const m = curMap();
    if (!m) return;
    renderMapView(S.mapCtx, m, viewFromS());
  }

  // ============================ palette ============================
  export function renderPalette() {
    const src = Assets.tilesetCanvas();
    S.palCanvas.width = src.width; S.palCanvas.height = src.height;
    const g = S.palCanvas.getContext("2d");
    g.drawImage(src, 0, 0);
    // An autotile group is selected outside the tile grid (its swatch lives in
    // the autotile strip), so the grid highlight is suppressed for it.
    if (isAutotileId(S.selectedTile)) return;
    const sx = (S.selectedTile % Assets.PALETTE_COLS) * TILE;
    const sy = Math.floor(S.selectedTile / Assets.PALETTE_COLS) * TILE;
    g.strokeStyle = "#ffd86a"; g.lineWidth = 3;
    g.strokeRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
  }
  export function normRect(a: any, b: any) {
    return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
  }
