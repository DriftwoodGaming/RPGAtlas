/* RPGAtlas — src/engine/hud.ts
   On-map HUD (Phase 5 Stage D): the corner minimap and the quest tracker.

   - Minimap (system.minimap, per-map override map.minimap === false): the
     map prerender (lowerBuf) downscaled once per map load, with live dots
     for events (faint), parked vehicles (blue), and the player (gold).
   - Quest tracker: the first three active visible quests with objective
     progress, rebuilt only when a cheap signature changes and flashed on
     updates so progress is glanceable without opening the Journal.
   - The whole HUD toggles with the "hud" input action (default M / Select),
     persisted per player (playerOptions.hudHidden).

   updateHud() runs once per rendered frame from render-glue (map scene
   only); everything here is presentation over existing state.
   GPL-3.0-or-later (see LICENSE). */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets } from "../shared/deps.js";
import { el, esc } from "./util.js";
import { ctx } from "./state/engine-context.js";
import { G, Quests } from "./state/game-state.js";
import { saveOptions } from "./state/player-options.js";
import { vehicleDrawables } from "./scenes/map-runtime.js";

let root: any = null;
let mini: any = null;
let baseCanvas: any = null;
let dotsCanvas: any = null;
let builtForMap: any = null;
let tracker: any = null;
let lastSig: string | null = null;
let flashTimer: any = null;

const MINI_MAX = 160; // longest minimap edge in px

export function toggleHud(): void {
  ctx.playerOptions.hudHidden = !ctx.playerOptions.hudHidden;
  saveOptions();
}

function minimapEnabled(): boolean {
  if (!ctx.proj.system.minimap) return false;
  return !ctx.map || ctx.map.minimap !== false;
}

function ensureDom(): void {
  if (root && root.isConnected) return;
  root = el("div", "hud-root");
  mini = el("div", "minimap");
  baseCanvas = document.createElement("canvas");
  dotsCanvas = document.createElement("canvas");
  mini.appendChild(baseCanvas);
  mini.appendChild(dotsCanvas);
  tracker = el("div", "quest-hud");
  root.appendChild(mini);
  root.appendChild(tracker);
  ctx.stage.insertBefore(root, ctx.fader); // under the fade, over the map
  builtForMap = null;
  lastSig = null;
}

function rebuildBase(): void {
  const m = ctx.map;
  const TILE = Assets.TILE;
  const scale = Math.min(MINI_MAX / (m.width * TILE), MINI_MAX / (m.height * TILE));
  const w = Math.max(1, Math.round(m.width * TILE * scale));
  const h = Math.max(1, Math.round(m.height * TILE * scale));
  baseCanvas.width = w;
  baseCanvas.height = h;
  dotsCanvas.width = w;
  dotsCanvas.height = h;
  const g = baseCanvas.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.drawImage(ctx.lowerBuf, 0, 0, w, h);
  builtForMap = m;
}

function drawDots(): void {
  const m = ctx.map;
  const px = dotsCanvas.width / m.width; // px per tile
  const g = dotsCanvas.getContext("2d");
  g.clearRect(0, 0, dotsCanvas.width, dotsCanvas.height);
  const dot = (rx: any, ry: any, size: any, color: any) => {
    g.fillStyle = color;
    const s = Math.max(2, px * size);
    g.fillRect(rx * px + (px - s) / 2, ry * px + (px - s) / 2, s, s);
  };
  for (const rt of ctx.evRTs) {
    if (rt.erased || !rt.page || rt.charsetIdx < 0) continue;
    dot(rt.rx, rt.ry, 0.5, "rgba(150,200,255,0.7)");
  }
  for (const v of vehicleDrawables()) dot(v.rx, v.ry, 0.7, "rgba(120,220,255,0.95)");
  const p = G.player;
  dot(p.rx, p.ry, 0.95, "#101018");
  dot(p.rx, p.ry, 0.7, "#ffd86a");
}

function questSignature(active: any[]): string {
  return JSON.stringify(
    active.map((q: any) => [
      q.id,
      Quests.objectiveDisplay(q.id).map((o: any) => o.current + "/" + o.total + (o.done ? "!" : "")),
    ]),
  );
}

function rebuildTracker(active: any[]): void {
  tracker.innerHTML = "";
  for (const q of active) {
    const box = el("div", "qh-quest");
    box.appendChild(el("div", "qh-name", esc(q.name)));
    for (const o of Quests.objectiveDisplay(q.id)) {
      box.appendChild(
        el(
          "div",
          "qh-obj" + (o.done ? " done" : ""),
          (o.done ? "✓ " : "▸ ") + esc(o.text) + (o.total > 1 ? " <span class='qh-count'>" + o.current + "/" + o.total + "</span>" : ""),
        ),
      );
    }
    tracker.appendChild(box);
  }
  tracker.style.display = active.length ? "" : "none";
}

/** Per-rendered-frame HUD refresh (render-glue calls this on the map scene). */
export function updateHud(): void {
  if (ctx.scene !== "map" || !ctx.map || !G.player) {
    if (root) root.style.display = "none";
    return;
  }
  ensureDom();
  const hidden = !!ctx.playerOptions.hudHidden;
  root.style.display = hidden ? "none" : "";
  if (hidden) return;

  const showMini = minimapEnabled() && ctx.lowerBuf;
  mini.style.display = showMini ? "" : "none";
  if (showMini) {
    if (builtForMap !== ctx.map) rebuildBase();
    drawDots();
  }

  const active = (ctx.proj.quests || [])
    .filter((q: any) => q.visible !== false && Quests.status(q.id) === "active")
    .slice(0, 3);
  const sig = questSignature(active);
  if (sig !== lastSig) {
    const isUpdate = lastSig !== null && active.length > 0;
    lastSig = sig;
    rebuildTracker(active);
    if (isUpdate) {
      tracker.classList.remove("flash");
      void tracker.offsetWidth;
      tracker.classList.add("flash");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => tracker.classList.remove("flash"), 900);
    }
  }
}
