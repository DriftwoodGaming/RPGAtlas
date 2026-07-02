/* RPGAtlas — src/editor/map-editor/hd-preview.ts
   HD-2D live preview panel (WebGL renderer driven from editor data).
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1):
   logic unchanged, closure vars routed through editor-state.ts; refreshToolbar
   is imported directly from workspace.ts (function-only cycle — workspace binds
   the HD-2D preview toggle to an action; safe).
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, TILE, curMap } from "../editor-state";
// Phase 2: the preview renders through the renderer-selection seam (three.js
// by default, ?renderer=classic fallback), same as the player.
import { Renderer as GLRender } from "../../renderer/index.js";
import { h } from "../dom";
import { effectivePass } from "./map-render";
import { flashStatus } from "./status";
import { refreshToolbar } from "../workspace";

  // ============================ HD-2D live preview ============================
  // A floating panel that renders the current map through the game's WebGL
  // HD-2D renderer using the map's own hd2d settings. It rebuilds after
  // edits (debounced — touch() marks it dirty) and re-renders every frame.
  let hdPanel: any = null, hdCanvas: any = null, hdDirty = true, hdMapId = 0, hdLastBuild = 0, hdRAF = 0;
  let hdT = 0; // preview animation tick (water waves etc.); advances per rendered frame
  let hdCamX = 0, hdCamY = 0; // camera look-at center, world px
  let hdKick: any = null;          // one-shot refresh timer (covers rAF pauses in hidden windows)
  let hdOpening = false;

  export function hdMarkDirty() {
    hdDirty = true;
    if (!hdPanel) return;
    clearTimeout(hdKick);
    hdKick = setTimeout(hdRenderOnce, 400);
  }

  function hdParseLight(name: any) { // mirrors the engine's light-event convention
    if (!/^light\b/i.test(name || "")) return null;
    const light = { color: "#ffcc88", radius: 180 };
    for (const tok of String(name).slice(5).trim().split(/\s+/)) {
      if (/^#[0-9a-fA-F]{6}$/.test(tok)) light.color = tok;
      else if (/^\d+$/.test(tok)) light.radius = Number(tok);
    }
    return light;
  }
  function hdBuildBuffers(m: any) { // same composition as the engine's prerenderMap
    const lower = document.createElement("canvas");
    lower.width = m.width * TILE; lower.height = m.height * TILE;
    const upper = document.createElement("canvas");
    upper.width = lower.width; upper.height = lower.height;
    const lg: any = lower.getContext("2d"), ug: any = upper.getContext("2d");
    lg.fillStyle = "#101018"; lg.fillRect(0, 0, lower.width, lower.height);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const i = y * m.width + x;
        Assets.drawTile(lg, m.layers.ground[i], x * TILE, y * TILE);
        Assets.drawTile(lg, m.layers.decor[i], x * TILE, y * TILE);
        Assets.drawTile(lg, m.layers.decor2[i], x * TILE, y * TILE);
        Assets.drawTile(ug, m.layers.over[i], x * TILE, y * TILE);
      }
    }
    if (m.shadows) {
      const H = TILE / 2;
      lg.fillStyle = "rgba(10,10,26,0.35)";
      for (let y = 0; y < m.height; y++) {
        for (let x = 0; x < m.width; x++) {
          const mask = m.shadows[y * m.width + x];
          if (!mask) continue;
          if (mask & 1) lg.fillRect(x * TILE, y * TILE, H, H);
          if (mask & 2) lg.fillRect(x * TILE + H, y * TILE, H, H);
          if (mask & 4) lg.fillRect(x * TILE, y * TILE + H, H, H);
          if (mask & 8) lg.fillRect(x * TILE + H, y * TILE + H, H, H);
        }
      }
    }
    return { lower, upper };
  }
  function hdRenderOnce() {
    if (!hdPanel) return;
    const m = curMap();
    if (!m) return;
    const now = performance.now();
    if ((hdDirty || hdMapId !== m.id) && now - hdLastBuild > 300) {
      if (hdMapId !== m.id) { hdCamX = m.width * TILE / 2; hdCamY = m.height * TILE / 2; }
      const b = hdBuildBuffers(m);
      GLRender.setMap(b.lower, b.upper, m);
      hdMapId = m.id; hdDirty = false; hdLastBuild = now;
    }
    const w = hdCanvas.width, hgt = hdCanvas.height;
    const camX = Math.max(0, Math.min(hdCamX - w / 2, m.width * TILE - w));
    const camY = Math.max(0, Math.min(hdCamY - hgt / 2, m.height * TILE - hgt));
    const sprites = [], lights = [];
    for (const ev of m.events) {
      const pg = ev.pages[0];
      const L = hdParseLight(ev.name);
      if (L) lights.push({ rx: ev.x, ry: ev.y, color: L.color, radius: L.radius });
      if (pg && pg.charset) {
        const ci = Assets.charsetIndex(pg.charset);
        if (ci >= 0) sprites.push({
          id: "preview_ev_" + ev.id,
          canvas: Assets.charFrameCanvas(ci, pg.dir || 0, 1),
          rx: ev.x, ry: ev.y, pr: 1,
        });
      }
    }
    const hd2d = m.hd2d || {};
    if (hd2d.lights !== false && Array.isArray(m.lights)) lights.push(...m.lights);
    if (hd2d.lights === false) lights.length = 0;
    const ambient = hd2d.ambient != null ? Number(hd2d.ambient) : 0.45;
    GLRender.renderFrame(w, hgt, camX, camY, sprites, {
      lights,
      ambient,
      tilt: hd2d.tilt != null ? Number(hd2d.tilt) : 50,
      focus: { rx: (camX + w / 2) / TILE, ry: (camY + hgt / 2) / TILE },
      tilePassable: effectivePass,
      t: hdT++,
      timeOfDay: hd2d.timeOfDay != null && hd2d.timeOfDay !== "" ? Number(hd2d.timeOfDay) : 12,
    });
  }
  function hdFrame() {
    if (!hdPanel) return;
    hdRenderOnce();
    hdRAF = requestAnimationFrame(hdFrame);
  }
  export function closeHdPreview() {
    if (!hdPanel) return;
    cancelAnimationFrame(hdRAF);
    clearTimeout(hdKick);
    window.removeEventListener("mousemove", hdPanel._move);
    window.removeEventListener("mouseup", hdPanel._up);
    hdPanel.remove();
    hdPanel = null;
    refreshToolbar();
  }
  export async function toggleHdPreview() {
    if (hdPanel) { closeHdPreview(); return; }
    if (hdOpening) return;
    hdOpening = true;
    if (!hdCanvas) {
      hdCanvas = h("canvas", {
        id: "hd-preview-canvas",
        width: 480,
        height: 360,
        style: "display:block;cursor:grab",
      });
    }
    if (typeof GLRender === "undefined" || !(await GLRender.available({ canvas: hdCanvas }))) {
      hdOpening = false;
      hdCanvas = null;
      flashStatus("HD-2D preview needs WebGL2, which is unavailable in this browser");
      return;
    }
    hdOpening = false;
    hdPanel = h("div", {
      id: "hd-preview-panel",
      style: "position:fixed;right:18px;bottom:38px;z-index:90;border:1px solid #3a3a4a;border-radius:6px;" +
        "overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.5);background:#101018",
    },
      h("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;background:#22222e;color:#cfd2e0;font:12px system-ui" },
        h("span", null, "HD-2D Preview — drag to pan"),
        h("button", { class: "mini", onclick: closeHdPreview }, "✕")),
      hdCanvas);
    let drag: any = null;
    hdCanvas.addEventListener("mousedown", (e: any) => {
      drag = { x: e.clientX, y: e.clientY };
      hdCanvas.style.cursor = "grabbing";
      e.preventDefault();
    });
    hdPanel._move = (e: any) => {
      if (!drag) return;
      hdCamX -= e.clientX - drag.x;
      hdCamY -= (e.clientY - drag.y) * 1.6; // the tilt foreshortens the z axis
      drag = { x: e.clientX, y: e.clientY };
    };
    hdPanel._up = () => { drag = null; if (hdCanvas) hdCanvas.style.cursor = "grab"; };
    window.addEventListener("mousemove", hdPanel._move);
    window.addEventListener("mouseup", hdPanel._up);
    document.body.appendChild(hdPanel);
    const m = curMap();
    hdCamX = m.width * TILE / 2; hdCamY = m.height * TILE / 2;
    hdMapId = 0; hdDirty = true; hdLastBuild = 0;
    hdFrame();
    refreshToolbar();
  }

  // New helper (only deviation from verbatim): the toolbar active-state
  // probe used to read the closure var hdPanel directly; hdPanel is
  // module-local now, so expose it behind a function.
  export function isHdPreviewOpen() { return !!hdPanel; }
