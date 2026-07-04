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
import { layerView, shadowIndex, entryArray, BLEND_COMPOSITE } from "../../shared/layer-view";
import { drawEntryTiles } from "../../shared/layer-composite";

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
    /** Advanced editor: id of the layer being edited (dims layers above it).
     *  Absent in the classic editor, which dims by the `layer` role instead. */
    activeLayerId?: number;
    /** Advanced editor Objects mode (Phase 8 Stage D): when set, gameplay
     *  zones are drawn as a translucent overlay on top of the tile render,
     *  with the selected zone highlighted and the in-progress draft shown.
     *  Absent in every other view ⇒ no zone overlay drawn. */
    zoneOverlay?: {
      zones: import("../../shared/schema").MapZone[];
      selectedId: number | null;
      /** an in-progress shape being drawn (rect drag / poly points / point). */
      draft?: import("../../shared/schema").ZoneShape | null;
    };
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
  // Composite a generalized (map.layersAdv) stack onto the 2D editor canvas,
  // honoring per-layer visibility / opacity / blend / tint and interleaving
  // shadows at their classic position (just under the first overhead layer).
  // The active layer is dimmed-above like the classic editor: the Advanced
  // editor passes v.activeLayerId; the Standard editor falls back to its
  // role-based v.layer selection so a layersAdv map still dims sensibly there.
  function drawAdvLayers(g: any, m: any, v: MapView) {
    const entries = layerView(m);
    const shIdx = shadowIndex(entries);
    let activeIdx = -1;
    if (v.activeLayerId != null) activeIdx = entries.findIndex((e) => e.id === v.activeLayerId);
    else if (v.layer && v.layer !== "auto") activeIdx = entries.findIndex((e) => e.role === v.layer);
    for (let li = 0; li < entries.length; li++) {
      if (li === shIdx) { g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; drawShadows(g, m); }
      const e = entries[li];
      if (!e.visible) continue;
      const arr = entryArray(m, e);
      if (!arr) continue;
      let alpha = e.opacity;
      if (v.mode === "map") {
        if (activeIdx >= 0 && li > activeIdx) alpha *= 0.45;
        else if (activeIdx < 0 && e.slot === "above") alpha *= 0.85; // auto: overhead dimmed
      } else if (e.slot === "above") {
        alpha *= 0.8; // non-map overlays keep the overhead readable
      }
      g.globalAlpha = alpha;
      g.globalCompositeOperation = BLEND_COMPOSITE[e.blend];
      drawEntryTiles(g, arr, m, Assets.drawTile, TILE, e.tint);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    if (shIdx >= entries.length) drawShadows(g, m);
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
  // Gameplay-zone overlay (Phase 8 Stage D). Each kind gets a stable hue so
  // authors can eyeball what a zone does; the selected zone is drawn brighter
  // with a handle at each vertex; the in-progress draft is dashed.
  const ZONE_COLORS: Record<string, string> = {
    encounter: "#ff6a8a", transfer: "#7ac8ff", sound: "#8affc8", weather: "#c9a2ff",
    spawn: "#ffd86a", collision: "#ff5555", nav: "#55dd88", custom: "#c0c0c0",
  };
  function zoneColor(kind: string) { return ZONE_COLORS[kind] || "#c0c0c0"; }
  function shapePath(g: any, shape: any) {
    g.beginPath();
    if (shape.type === "rect") {
      g.rect(shape.x * TILE, shape.y * TILE, shape.w * TILE, shape.h * TILE);
    } else if (shape.type === "ellipse") {
      g.ellipse(shape.cx * TILE, shape.cy * TILE, shape.rx * TILE, shape.ry * TILE, 0, 0, 7);
    } else if (shape.type === "point") {
      g.rect(shape.x * TILE, shape.y * TILE, TILE, TILE);
    } else if (shape.type === "poly") {
      const pts = shape.pts || [];
      if (!pts.length) return;
      g.moveTo(pts[0].x * TILE, pts[0].y * TILE);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x * TILE, pts[i].y * TILE);
      g.closePath();
    }
  }
  function shapeVertices(shape: any): { x: number; y: number }[] {
    if (shape.type === "rect") return [{ x: shape.x, y: shape.y }, { x: shape.x + shape.w, y: shape.y }, { x: shape.x + shape.w, y: shape.y + shape.h }, { x: shape.x, y: shape.y + shape.h }];
    if (shape.type === "ellipse") return [{ x: shape.cx, y: shape.cy }];
    if (shape.type === "point") return [{ x: shape.x, y: shape.y }];
    if (shape.type === "poly") return shape.pts || [];
    return [];
  }
  function drawOneZone(g: any, z: any, v: MapView, selected: boolean) {
    const col = zoneColor(z.kind);
    g.fillStyle = col;
    g.globalAlpha = selected ? 0.30 : 0.16;
    shapePath(g, z.shape); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = col;
    g.lineWidth = (selected ? 2.5 : 1.5) / v.zoom;
    if (!selected) g.setLineDash([6 / v.zoom, 4 / v.zoom]);
    shapePath(g, z.shape); g.stroke();
    g.setLineDash([]);
    // label (kind + name) at the shape's top-left-ish anchor
    const anchor = shapeVertices(z.shape)[0] || { x: 0, y: 0 };
    g.fillStyle = col;
    g.font = "600 12px monospace";
    g.textAlign = "left"; g.textBaseline = "top";
    const label = z.name ? z.kind + ": " + z.name : z.kind;
    g.fillText(label, anchor.x * TILE + 3, anchor.y * TILE + 2);
    if (selected) {
      // vertex handles for editing
      g.fillStyle = "#ffffff";
      g.strokeStyle = col; g.lineWidth = 1.5 / v.zoom;
      for (const pt of shapeVertices(z.shape)) {
        const hx = pt.x * TILE, hy = pt.y * TILE, r = 4 / v.zoom;
        g.beginPath(); g.rect(hx - r, hy - r, r * 2, r * 2); g.fill(); g.stroke();
      }
    }
  }
  function drawZonesOverlay(g: any, v: MapView) {
    const ov = v.zoneOverlay;
    if (!ov) return;
    for (const z of ov.zones) {
      if (!z.shape) continue;
      drawOneZone(g, z, v, z.id === ov.selectedId);
    }
    if (ov.draft) {
      g.strokeStyle = "#ffffff"; g.lineWidth = 2 / v.zoom;
      g.setLineDash([8 / v.zoom, 5 / v.zoom]);
      shapePath(g, ov.draft); g.stroke();
      g.setLineDash([]);
      if (ov.draft.type === "poly") {
        g.fillStyle = "#ffffff";
        for (const pt of (ov.draft.pts || [])) {
          g.beginPath(); g.arc(pt.x * TILE, pt.y * TILE, 3 / v.zoom, 0, 7); g.fill();
        }
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
    // tile layers (layers above the active one are dimmed while drawing).
    // Classic maps (no layersAdv) run the verbatim four-array loop — this is
    // the byte-identical path every existing golden protects. A map with a
    // generalized stack composites the flattened layer-view instead.
    if (!m.layersAdv) {
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
    } else {
      drawAdvLayers(g, m, v);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
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
    // Objects mode (Phase 8 Stage D): gameplay zones over everything else.
    drawZonesOverlay(g, v);
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
