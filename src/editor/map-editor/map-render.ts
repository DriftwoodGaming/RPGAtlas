/* RPGAtlas — src/editor/map-editor/map-render.ts
   Map canvas rendering, palette rendering, overlays, normRect.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1):
   logic unchanged, closure vars routed through editor-state.ts; calls into
   not-yet-extracted sections go through editorHooks.
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, TILE, LAYER_ORDER, editorState as S, curMap } from "../editor-state";

  // ============================ map rendering ============================
  function layerAlpha(li: any) {
    if (S.mode !== "map") return li === 3 ? 0.8 : 1;
    if (S.layer === "auto") return li === 3 ? 0.85 : 1;
    const a = LAYER_ORDER.indexOf(S.layer);
    return li > a ? 0.45 : 1;
  }
  export function effectivePass(x: any, y: any) {
    const m = curMap(), i = y * m.width + x;
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
  function drawPassOverlay(g: any, m: any) {
    g.lineWidth = 3.5 / Math.max(S.zoom, 0.4);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const ov = m.passOv[y * m.width + x];
        const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2, r = TILE * 0.24;
        if (ov) { // yellow corner badge marks an override
          g.fillStyle = "#ffd86a";
          g.beginPath(); g.moveTo(x * TILE, y * TILE); g.lineTo(x * TILE + 13, y * TILE); g.lineTo(x * TILE, y * TILE + 13); g.fill();
        }
        if (effectivePass(x, y)) {
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
  export function renderMap() {
    const m = curMap();
    if (!m) return;
    S.mapCanvas.width = Math.max(1, Math.round(m.width * TILE * S.zoom));
    S.mapCanvas.height = Math.max(1, Math.round(m.height * TILE * S.zoom));
    const g = S.mapCtx;
    g.setTransform(S.zoom, 0, 0, S.zoom, 0, 0);
    g.imageSmoothingEnabled = S.zoom >= 1;
    g.fillStyle = "#15151d";
    g.fillRect(0, 0, m.width * TILE, m.height * TILE);
    // tile layers (layers above the active one are dimmed while drawing)
    for (let li = 0; li < LAYER_ORDER.length; li++) {
      const arr = m.layers[LAYER_ORDER[li]];
      g.globalAlpha = layerAlpha(li);
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          Assets.drawTile(g, arr[y * m.width + x], x * TILE, y * TILE);
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
    g.lineWidth = 1 / S.zoom;
    g.beginPath();
    for (let x = 0; x <= m.width; x++) { g.moveTo(x * TILE, 0); g.lineTo(x * TILE, m.height * TILE); }
    for (let y = 0; y <= m.height; y++) { g.moveTo(0, y * TILE); g.lineTo(m.width * TILE, y * TILE); }
    g.stroke();
    if (S.mode === "pass") drawPassOverlay(g, m);
    if (S.mode === "height") drawHeightOverlay(g, m);
    // Event pins stay visible while painting so placed events do not appear to
    // vanish when leaving Event mode. Passability/Height keep their overlays clean.
    if (S.mode !== "pass" && S.mode !== "height") {
      const interactiveEvents = S.mode === "event" || S.mode === "start";
      for (const ev of m.events) {
        g.fillStyle = interactiveEvents
          ? (ev === S.selectedEvent ? "rgba(120,200,255,0.35)" : "rgba(255,255,255,0.14)")
          : "rgba(120,200,255,0.10)";
        g.fillRect(ev.x * TILE + 2, ev.y * TILE + 2, TILE - 4, TILE - 4);
        g.strokeStyle = interactiveEvents
          ? (ev === S.selectedEvent ? "#7ac8ff" : "rgba(255,255,255,0.6)")
          : "rgba(122,200,255,0.45)";
        g.lineWidth = 2 / S.zoom;
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
    if (S.proj.system.startMapId === m.id) {
      g.fillStyle = "rgba(110,230,140,0.8)";
      g.fillRect(S.proj.system.startX * TILE + 8, S.proj.system.startY * TILE + 8, TILE - 16, TILE - 16);
      g.fillStyle = "#0c2c14";
      g.font = "bold 22px monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("S", S.proj.system.startX * TILE + TILE / 2, S.proj.system.startY * TILE + TILE / 2 + 1);
    }
    // selection marquee
    if (S.mode === "map" && S.selection) {
      const w = (S.selection.x2 - S.selection.x1 + 1) * TILE, h2 = (S.selection.y2 - S.selection.y1 + 1) * TILE;
      g.fillStyle = "rgba(255,216,106,0.12)";
      g.fillRect(S.selection.x1 * TILE, S.selection.y1 * TILE, w, h2);
      g.strokeStyle = "#ffd86a"; g.lineWidth = 2 / S.zoom;
      g.setLineDash([10, 6]);
      g.strokeRect(S.selection.x1 * TILE, S.selection.y1 * TILE, w, h2);
      g.setLineDash([]);
    }
    // paste preview
    if (S.pasteMode === "tiles" && S.clipTiles && S.hoverCell && S.mode === "map") {
      g.globalAlpha = 0.6;
      for (let dy = 0; dy < S.clipTiles.h; dy++) {
        for (let dx = 0; dx < S.clipTiles.w; dx++) {
          const si = dy * S.clipTiles.w + dx;
          for (const ln of LAYER_ORDER) Assets.drawTile(g, S.clipTiles.layers[ln][si], (S.hoverCell.x + dx) * TILE, (S.hoverCell.y + dy) * TILE);
        }
      }
      g.globalAlpha = 1;
      g.strokeStyle = "#ffd86a"; g.lineWidth = 2 / S.zoom;
      g.strokeRect(S.hoverCell.x * TILE, S.hoverCell.y * TILE, S.clipTiles.w * TILE, S.clipTiles.h * TILE);
    }
    if (S.pasteMode === "event" && S.hoverCell && S.mode === "event") {
      g.strokeStyle = "#ffd86a"; g.lineWidth = 2 / S.zoom;
      g.strokeRect(S.hoverCell.x * TILE + 2, S.hoverCell.y * TILE + 2, TILE - 4, TILE - 4);
    }
    // hover / drag previews
    if (S.hoverCell && !S.pasteMode) {
      if ((S.tool === "rect" || S.tool === "circle") && S.rectStart && S.painting && (S.mode === "map" || S.mode === "height")) {
        const r2 = normRect(S.rectStart, S.hoverCell);
        g.strokeStyle = "#ffd86a";
        g.lineWidth = 2 / S.zoom;
        if (S.tool === "rect") {
          g.strokeRect(r2.x1 * TILE, r2.y1 * TILE, (r2.x2 - r2.x1 + 1) * TILE, (r2.y2 - r2.y1 + 1) * TILE);
        } else {
          g.beginPath();
          g.ellipse((r2.x1 + r2.x2 + 1) / 2 * TILE, (r2.y1 + r2.y2 + 1) / 2 * TILE,
            (r2.x2 - r2.x1 + 1) / 2 * TILE, (r2.y2 - r2.y1 + 1) / 2 * TILE, 0, 0, 7);
          g.stroke();
        }
      } else if (S.tool === "shadow" && S.mode === "map" && S.hoverQuad) {
        const H = TILE / 2;
        const qx = (S.hoverQuad === 2 || S.hoverQuad === 8) ? 1 : 0;
        const qy = S.hoverQuad >= 4 ? 1 : 0;
        g.fillStyle = "rgba(255,216,106,0.35)";
        g.fillRect(S.hoverCell.x * TILE + qx * H, S.hoverCell.y * TILE + qy * H, H, H);
        g.strokeStyle = "#ffffff"; g.lineWidth = 2 / S.zoom;
        g.strokeRect(S.hoverCell.x * TILE + 1, S.hoverCell.y * TILE + 1, TILE - 2, TILE - 2);
      } else {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 2 / S.zoom;
        g.strokeRect(S.hoverCell.x * TILE + 1, S.hoverCell.y * TILE + 1, TILE - 2, TILE - 2);
      }
    }
  }

  // ============================ palette ============================
  export function renderPalette() {
    const src = Assets.tilesetCanvas();
    S.palCanvas.width = src.width; S.palCanvas.height = src.height;
    const g = S.palCanvas.getContext("2d");
    g.drawImage(src, 0, 0);
    const sx = (S.selectedTile % Assets.PALETTE_COLS) * TILE;
    const sy = Math.floor(S.selectedTile / Assets.PALETTE_COLS) * TILE;
    g.strokeStyle = "#ffd86a"; g.lineWidth = 3;
    g.strokeRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
  }
  export function normRect(a: any, b: any) {
    return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
  }
