/* RPGAtlas — src/editor/map-editor/hd-viewport.ts
   Live HD-2D viewport (Phase 3 Stage C).

   The Phase 2 three.js renderer, embedded as a dockable editor panel (dock id
   "hd"). It renders the current map through the game's HD-2D pipeline using the
   map's own hd2d settings and stays live: the per-frame loop re-reads the map,
   so every Map-Properties / height / event edit shows immediately (touch() ->
   viewportDirty() rebuilds the tile prerender; lights and camera are per-frame).

   Two things make it an *editor* surface rather than a passive preview:
   - a viewport camera decoupled from the game camera — drag to pan (grab the
     ground), wheel to zoom toward the cursor, Shift/right-drag to change the
     tilt; independent of map.hd2d.tilt, which the game uses.
   - drag gizmos for point lights: handles float over each map.lights entry
     (projected with hd-camera.ts so they track the rendered position), drag to
     move, double-click empty space to add, ✕ to remove, with a live
     colour/radius inspector. This is the first editor affordance for map.lights
     (previously only light-named events fed the renderer).

   The heavy prerender + sprite/light gathering is the verbatim logic from the
   old floating hd-preview (Phase 1 move); this module supersedes it. The rAF
   loop idles cheaply whenever the panel is parked (the dock hides inactive/
   closed panels in #panel-store, so offsetParent is null) — no GPU work while
   hidden. Golden renderer specs are unaffected: this is an editor-only page.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, TILE, curMap } from "../editor-state";
import { drawLayerCell } from "../../shared/autotile-draw";
import { composeAdvBuffers } from "../../shared/layer-composite";
import { anyAutotileAnimated } from "../../shared/autotile-registry";
import { frameAt } from "../../shared/autotile-anim";
import { Renderer as GLRender } from "../../renderer/index.js";
import { h } from "../dom";
import { effectivePass } from "./map-render";
import { flashStatus } from "./status";
import { touch } from "../persistence";
import { focusPanel, isPanelVisible, getFocusedPanel, togglePanel } from "../dock/dock";
import { makeCam, projectToScreen, screenToPlane, clampTilt, clampZoom, type ViewCam } from "./hd-camera";

export const VIEWPORT_PANEL = "hd";

// ---- panel DOM ----
let root: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let overlay: HTMLElement | null = null; // holds the light-gizmo handles
let hud: HTMLElement | null = null;
let msg: HTMLElement | null = null; // WebGL-unavailable fallback

// ---- renderer / loop state ----
let rendererReady: boolean | null = null; // null = not probed, false = unavailable
let probing = false;
let raf = 0;
let dirty = true;
let builtMapId = 0;
let lastBuild = 0;
let lastAnimFrame = 0; // terrain-anim frame the buffers were last built at
let tick = 0; // preview animation clock (water waves etc.)
let kick: any = null; // one-shot re-render covering rAF pauses in hidden panels

// ---- viewport camera (decoupled from the game camera) ----
let camX = 0, camY = 0; // look-at center → world box top-left, matching renderFrame
let vpZoom = 1;
let vpTilt = 50; // degrees; seeded from the map's hd2d.tilt on map change
let camMapId = 0;

// ---- light gizmos ----
let handles: HTMLElement[] = [];
let handleToken = ""; // mapId + count — rebuild handles when it changes
let selLight = -1;
let lastCam: ViewCam | null = null;

// ============================ dirty / rebuild ============================
export function viewportDirty() {
  dirty = true;
  if (!root) return;
  clearTimeout(kick);
  kick = setTimeout(renderOnce, 400);
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
function buildBuffers(m: any, frame = 0) { // same composition as the engine's prerenderMap
  const lower = document.createElement("canvas");
  lower.width = m.width * TILE; lower.height = m.height * TILE;
  const upper = document.createElement("canvas");
  upper.width = lower.width; upper.height = lower.height;
  const lg: any = lower.getContext("2d"), ug: any = upper.getContext("2d");
  lg.fillStyle = "#101018"; lg.fillRect(0, 0, lower.width, lower.height);
  if (!m.layersAdv) {
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        drawLayerCell(lg, m.layers.ground, m.width, m.height, x, y, x * TILE, y * TILE, TILE, Assets.drawTile, frame);
        drawLayerCell(lg, m.layers.decor, m.width, m.height, x, y, x * TILE, y * TILE, TILE, Assets.drawTile, frame);
        drawLayerCell(lg, m.layers.decor2, m.width, m.height, x, y, x * TILE, y * TILE, TILE, Assets.drawTile, frame);
        drawLayerCell(ug, m.layers.over, m.width, m.height, x, y, x * TILE, y * TILE, TILE, Assets.drawTile, frame);
      }
    }
  } else {
    composeAdvBuffers(lg, ug, m, Assets.drawTile, TILE, frame);
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

// Tile-space height (floor) under a light, matching the renderer's per-tile
// elevation — used only to float the gizmo handle where the light renders.
function heightAt(m: any, rx: number, ry: number): number {
  if (!m.heights) return 0;
  const x = Math.max(0, Math.min(m.width - 1, Math.floor(rx)));
  const y = Math.max(0, Math.min(m.height - 1, Math.floor(ry)));
  return Number(m.heights[y * m.width + x]) || 0;
}

// ============================ the frame ============================
function isShowing() {
  return !!root && !!canvas && root.offsetParent !== null && root.clientWidth > 0 && root.clientHeight > 0;
}

function renderOnce() {
  if (rendererReady !== true || !canvas || !root) return;
  if (!isShowing()) return; // parked / hidden — no GPU work
  const m = curMap();
  if (!m) return;

  const w = Math.max(1, root.clientWidth), hgt = Math.max(1, root.clientHeight);
  if (m.id !== camMapId) recenterCamera(m); // fresh map → recenter + seed tilt

  const now = performance.now();
  // Animated terrain (Phase 8 Stage C): rebuild the buffers when the shared
  // preview frame (a nominal 4fps clock) advances, so water animates in the
  // live HD viewport. No animated group ⇒ animFrame stays 0 and never forces
  // a rebuild — classic behaviour untouched.
  const animOn = anyAutotileAnimated();
  const curFrame = animOn ? frameAt(now, 4, 60) : 0;
  const animAdvanced = animOn && curFrame !== lastAnimFrame;
  if ((dirty || builtMapId !== m.id || animAdvanced) && now - lastBuild > 200) {
    const b = buildBuffers(m, curFrame);
    GLRender.setMap(b.lower, b.upper, m);
    builtMapId = m.id; dirty = false; lastBuild = now; lastAnimFrame = curFrame;
  }

  const camXc = Math.max(-w, Math.min(camX, m.width * TILE));
  const camYc = Math.max(-hgt, Math.min(camY, m.height * TILE));
  camX = camXc; camY = camYc;

  // Gather sprites + event/light data exactly like the engine's frame builder.
  const sprites: any[] = [], lights: any[] = [];
  for (const ev of m.events) {
    const pg = ev.pages[0];
    const L = hdParseLight(ev.name);
    if (L) lights.push({ rx: ev.x, ry: ev.y, color: L.color, radius: L.radius });
    if (pg && pg.charset) {
      const ci = Assets.charsetIndex(pg.charset);
      if (ci >= 0) sprites.push({
        id: "hdview_ev_" + ev.id,
        canvas: Assets.charFrameCanvas(ci, pg.dir || 0, 1),
        rx: ev.x, ry: ev.y, pr: 1,
      });
    }
  }
  const hd2d = m.hd2d || {};
  const lightsOn = hd2d.lights !== false;
  if (lightsOn && Array.isArray(m.lights)) lights.push(...m.lights);
  const ambient = hd2d.ambient != null ? Number(hd2d.ambient) : 0.45;
  const tilt = clampTilt(vpTilt);
  const zoom = clampZoom(vpZoom);

  GLRender.renderFrame(w, hgt, camX, camY, sprites, {
    lights, ambient, tilt, zoom,
    focus: { rx: (camX + w / zoom / 2) / TILE, ry: (camY + hgt / zoom / 2) / TILE },
    tilePassable: effectivePass,
    t: tick++,
    timeOfDay: hd2d.timeOfDay != null && hd2d.timeOfDay !== "" ? Number(hd2d.timeOfDay) : 12,
  });

  lastCam = makeCam(camX, camY, w, hgt, zoom, tilt);
  syncGizmos(m, lightsOn);
}

function frame() {
  if (!root) return;
  if (isShowing()) renderOnce();
  raf = requestAnimationFrame(frame);
}

// ============================ camera controls ============================
function recenterCamera(m: any) {
  const w = root ? Math.max(1, root.clientWidth) : 480;
  const hgt = root ? Math.max(1, root.clientHeight) : 360;
  vpZoom = 1;
  vpTilt = clampTilt(m.hd2d && m.hd2d.tilt != null ? Number(m.hd2d.tilt) : 50);
  camX = m.width * TILE / 2 - w / 2;
  camY = m.height * TILE / 2 - hgt / 2;
  camMapId = m.id;
  selLight = -1;
  updateHud();
}
function resetView() { const m = curMap(); if (m) { camMapId = 0; recenterCamera(m); } }

function camAt() {
  const w = Math.max(1, root!.clientWidth), hgt = Math.max(1, root!.clientHeight);
  return makeCam(camX, camY, w, hgt, clampZoom(vpZoom), clampTilt(vpTilt));
}
function localXY(e: MouseEvent): [number, number] {
  const r = canvas!.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function bindCameraControls() {
  let pan: { cam0: ViewCam; anchor: { wx: number; wz: number }; camX0: number; camY0: number } | null = null;
  let tiltDrag: { y: number; tilt0: number } | null = null;

  canvas!.addEventListener("mousedown", (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".hd-light-handle")) return;
    const [sx, sy] = localXY(e);
    // Shift+left or right button → tilt (the renderer's only free camera axis:
    // fixed azimuth, variable pitch). Otherwise grab-the-ground pan.
    if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
      tiltDrag = { y: e.clientY, tilt0: vpTilt };
      canvas!.style.cursor = "ns-resize";
    } else if (e.button === 0) {
      const cam0 = camAt();
      const anchor = screenToPlane(cam0, sx, sy);
      if (anchor) { pan = { cam0, anchor, camX0: camX, camY0: camY }; canvas!.style.cursor = "grabbing"; }
      if (selLight >= 0) { selLight = -1; updateHud(); }
    }
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e: MouseEvent) => {
    if (tiltDrag) {
      vpTilt = clampTilt(tiltDrag.tilt0 - (e.clientY - tiltDrag.y) * 0.4);
      updateHud();
    } else if (pan) {
      const [sx, sy] = localXY(e);
      // Unproject against the drag-start camera and assign absolutely: the
      // ground point grabbed at mousedown stays under the cursor, 1:1.
      const here = screenToPlane(pan.cam0, sx, sy);
      if (here) {
        camX = pan.camX0 + (pan.anchor.wx - here.wx);
        camY = pan.camY0 + (pan.anchor.wz - here.wz);
      }
    }
  });
  window.addEventListener("mouseup", () => {
    if (pan || tiltDrag) canvas!.style.cursor = "grab";
    pan = null; tiltDrag = null;
  });
  canvas!.addEventListener("contextmenu", (e) => e.preventDefault());

  canvas!.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    const [sx, sy] = localXY(e);
    const before = screenToPlane(camAt(), sx, sy);
    vpZoom = clampZoom(vpZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    // Keep the world point under the cursor fixed: camX/camY translate the whole
    // camera rigidly in XZ, so one correction step lands it exactly.
    const after = screenToPlane(camAt(), sx, sy);
    if (before && after) { camX += before.wx - after.wx; camY += before.wz - after.wz; }
    updateHud();
  }, { passive: false });

  // Double-click empty space → add a point light on the ground there.
  canvas!.addEventListener("dblclick", (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".hd-light-handle")) return;
    const m = curMap();
    if (!m) return;
    const [sx, sy] = localXY(e);
    const g = screenToPlane(camAt(), sx, sy);
    if (!g) return;
    const rx = Math.max(0, Math.min(m.width - 1, g.wx / TILE - 0.5));
    const ry = Math.max(0, Math.min(m.height - 1, g.wz / TILE - 0.5));
    if (!Array.isArray(m.lights)) m.lights = [];
    m.lights.push({ rx: Math.round(rx * 2) / 2, ry: Math.round(ry * 2) / 2, color: "#ffcc88", radius: 180 });
    selLight = m.lights.length - 1;
    if (m.hd2d && m.hd2d.lights === false) flashStatus("Light added — enable “Point lights” in Map Properties to see it");
    touch(); updateHud();
  });
}

// ============================ light gizmos ============================
function syncGizmos(m: any, lightsOn: boolean) {
  if (!overlay || !lastCam) return;
  const arr: any[] = Array.isArray(m.lights) ? m.lights : [];
  const token = m.id + ":" + arr.length;
  if (token !== handleToken) rebuildHandles(m, arr);
  for (let i = 0; i < handles.length; i++) {
    const L = arr[i];
    if (!L) { handles[i].style.display = "none"; continue; }
    const world: [number, number, number] = [
      (L.rx + 0.5) * TILE, heightAt(m, L.rx, L.ry) * TILE + TILE * 0.75, (L.ry + 0.5) * TILE,
    ];
    const p = projectToScreen(lastCam, world);
    const el = handles[i];
    if (!p.visible) { el.style.display = "none"; continue; }
    el.style.display = "block";
    el.style.left = p.sx + "px";
    el.style.top = p.sy + "px";
    el.style.background = L.color || "#ffcc88";
    el.classList.toggle("sel", i === selLight);
    el.classList.toggle("dim", !lightsOn);
  }
}

function rebuildHandles(m: any, arr: any[]) {
  if (!overlay) return;
  for (const el of handles) el.remove();
  handles = [];
  handleToken = m.id + ":" + arr.length;
  if (selLight >= arr.length) selLight = -1;
  arr.forEach((_L, i) => {
    const del = h("span", {
      class: "hd-light-x", title: "Remove light",
      onmousedown(e: MouseEvent) {
        e.stopPropagation(); e.preventDefault();
        const cur = curMap();
        if (cur && Array.isArray(cur.lights)) { cur.lights.splice(i, 1); selLight = -1; touch(); updateHud(); }
      },
    }, "✕");
    const el = h("div", { class: "hd-light-handle" }, del) as HTMLElement;
    el.addEventListener("mousedown", (e: MouseEvent) => beginLightDrag(e, i));
    overlay!.appendChild(el);
    handles.push(el);
  });
  updateHud();
}

function beginLightDrag(e: MouseEvent, i: number) {
  if (e.button !== 0) return;
  e.stopPropagation(); e.preventDefault();
  const m = curMap();
  if (!m || !Array.isArray(m.lights) || !m.lights[i]) return;
  selLight = i; updateHud();
  const L = m.lights[i];
  const cam0 = camAt();
  const [sx0, sy0] = localXY(e);
  const g0 = screenToPlane(cam0, sx0, sy0);
  // grab offset in world px: pointer vs the light's ground point
  const off = g0 ? { x: g0.wx - (L.rx + 0.5) * TILE, z: g0.wz - (L.ry + 0.5) * TILE } : { x: 0, z: 0 };
  let moved = false;
  const move = (ev: MouseEvent) => {
    const r = canvas!.getBoundingClientRect();
    const g = screenToPlane(cam0, ev.clientX - r.left, ev.clientY - r.top);
    if (!g) return;
    moved = true;
    L.rx = Math.max(0, Math.min(m.width - 1, (g.wx - off.x) / TILE - 0.5));
    L.ry = Math.max(0, Math.min(m.height - 1, (g.wz - off.z) / TILE - 0.5));
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    if (moved) {
      const cur = curMap();
      if (cur && cur.lights && cur.lights[i]) {
        cur.lights[i].rx = Math.round(cur.lights[i].rx * 2) / 2;
        cur.lights[i].ry = Math.round(cur.lights[i].ry * 2) / 2;
      }
      touch();
    }
    updateHud();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

// ============================ HUD / inspector ============================
function updateHud() {
  if (!hud) return;
  hud.innerHTML = "";
  const m = curMap();
  hud.appendChild(h("div", { class: "hd-hud-row" },
    h("span", { class: "hd-hud-cam" }, "Tilt " + Math.round(clampTilt(vpTilt)) + "°  ·  Zoom " + Math.round(clampZoom(vpZoom) * 100) + "%"),
    h("button", { class: "mini", title: "Reset the viewport camera", onclick: resetView }, "Reset view")));

  if (m && selLight >= 0 && Array.isArray(m.lights) && m.lights[selLight]) {
    const L = m.lights[selLight];
    const colorIn = h("input", { type: "color", value: L.color || "#ffcc88",
      oninput(e: any) { L.color = e.target.value; touch(); } });
    const radIn = h("input", {
      type: "range", min: "40", max: "600", step: "10", value: String(L.radius || 180),
      oninput(e: any) { L.radius = Number(e.target.value); touch(); updateHud(); },
    });
    hud.appendChild(h("div", { class: "hd-hud-row hd-light-edit" },
      h("span", null, "Light " + (selLight + 1)),
      colorIn,
      radIn,
      h("span", { class: "hd-hud-rad" }, String(L.radius || 180)),
      h("button", { class: "mini danger", title: "Remove this light",
        onclick() { if (m.lights) { m.lights.splice(selLight, 1); selLight = -1; touch(); updateHud(); } } }, "Delete")));
  } else {
    hud.appendChild(h("div", { class: "hd-hud-row hd-hud-hint" },
      "Drag to pan · wheel to zoom · Shift/right-drag to tilt · double-click to add a light"));
  }
}

// ============================ mount / dock integration ============================
export function mountViewport(): HTMLElement {
  if (root) return root;
  canvas = h("canvas", { class: "hd-viewport-canvas" }) as HTMLCanvasElement;
  overlay = h("div", { class: "hd-viewport-overlay" });
  hud = h("div", { class: "hd-viewport-hud" });
  msg = h("div", { class: "hd-viewport-msg", style: "display:none" },
    "The live HD-2D viewport needs WebGL2, which is unavailable in this browser.");
  root = h("div", { class: "hd-viewport dock-panel-content" }, canvas, overlay, hud, msg) as HTMLElement;
  updateHud();
  bindCameraControls();
  void ensureRenderer();
  return root;
}

async function ensureRenderer() {
  if (rendererReady !== null || probing || !canvas) return;
  probing = true;
  try {
    const okay = typeof GLRender !== "undefined" && (await GLRender.available({ canvas }));
    rendererReady = !!okay;
  } catch {
    rendererReady = false;
  }
  probing = false;
  if (!rendererReady) {
    if (msg) msg.style.display = "";
    if (hud) hud.style.display = "none";
    return;
  }
  if (!raf) frame();
}

// ---- commands (bound by panels.ts / workspace.ts) ----
export function isViewportVisible() { return isPanelVisible(VIEWPORT_PANEL); }
export function focusViewport() { focusPanel(VIEWPORT_PANEL); }
/** F2 / toolbar: show+focus when hidden or unfocused, otherwise hide. */
export function toggleViewport() {
  if (!isPanelVisible(VIEWPORT_PANEL) || getFocusedPanel() !== VIEWPORT_PANEL) focusPanel(VIEWPORT_PANEL);
  else togglePanel(VIEWPORT_PANEL);
}
