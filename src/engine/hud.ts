/* RPGAtlas — authored on-map HUD runtime.
   Visual UI/HUD Designer widgets are screen-relative and data-driven. Legacy
   projects fall back to the classic minimap + three-quest layout. The whole
   layer still uses the named "hud" action and the player's persisted toggle.
   GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA } from "../shared/deps.js";
import { el, esc, clamp } from "./util.js";
import { ctx, fns } from "./state/engine-context.js";
import { G, Quests, param } from "./state/game-state.js";
import { saveOptions } from "./state/player-options.js";
import { vehicleDrawables } from "./scenes/map-runtime.js";

interface WidgetNode {
  widget: any;
  el: any;
  baseCanvas?: any;
  dotsCanvas?: any;
  builtForMap?: any;
  lastSig?: string | null;
  flashTimer?: any;
  fill?: any;
  value?: any;
}

let root: any = null;
let layoutSignature = "";
let nodes: WidgetNode[] = [];
let designSource: any = null;
let cachedDesign: any = null;

export function toggleHud(): void {
  ctx.playerOptions.hudHidden = !ctx.playerOptions.hudHidden;
  saveOptions();
}

function design(): any {
  const source = ctx.proj.system.hudDesign;
  if (source !== designSource || !cachedDesign) {
    designSource = source;
    cachedDesign = RA.normalizeHudDesign(source);
  }
  return cachedDesign;
}

function minimapEnabled(): boolean {
  if (!ctx.proj.system.minimap) return false;
  return !ctx.map || ctx.map.minimap !== false;
}

function applyRect(node: any, widget: any): void {
  node.style.left = widget.x + "%";
  node.style.top = widget.y + "%";
  node.style.width = widget.w + "%";
  node.style.height = widget.h + "%";
}

function menuAction(item: any): void {
  if (ctx.blockingRun || ctx.menuOpen) return;
  if (item.action === "commonEvent" && item.commonEventId) {
    if (fns.runHudCommonEvent) void fns.runHudCommonEvent(item.commonEventId);
  } else if (fns.openMenu) {
    void fns.openMenu();
  }
}

function buildNode(widget: any): WidgetNode {
  if (widget.type === "minimap") {
    const mini = el("div", "hud-widget minimap");
    const baseCanvas = document.createElement("canvas");
    const dotsCanvas = document.createElement("canvas");
    mini.appendChild(baseCanvas); mini.appendChild(dotsCanvas);
    return { widget, el: mini, baseCanvas, dotsCanvas, builtForMap: null };
  }
  if (widget.type === "quests") return { widget, el: el("div", "hud-widget quest-hud"), lastSig: null };
  if (widget.type === "gauge") {
    const box = el("div", "hud-widget hud-gauge");
    box.appendChild(el("div", "hud-widget-title", esc(widget.label || "Gauge")));
    const value = el("div", "hud-gauge-value");
    const track = el("div", "hud-gauge-track");
    const fill = el("div", "hud-gauge-fill");
    fill.style.background = widget.color || "#6aa6ff";
    track.appendChild(fill); box.appendChild(value); box.appendChild(track);
    return { widget, el: box, fill, value };
  }
  if (widget.type === "menu") {
    const box = el("div", "hud-widget hud-menu");
    if (widget.label) box.appendChild(el("div", "hud-widget-title", esc(widget.label)));
    for (const item of widget.menuItems || []) {
      const button = el("button", "hud-menu-command", esc(item.label));
      button.setAttribute("type", "button");
      button.addEventListener("click", (event: any) => { event.preventDefault(); event.stopPropagation(); menuAction(item); });
      box.appendChild(button);
    }
    return { widget, el: box };
  }
  const box = el("div", "hud-widget hud-text");
  return { widget, el: box };
}

function rebuildDom(hud: any): void {
  if (root) root.remove();
  root = el("div", "hud-root");
  root.style.setProperty("--hud-panel", hud.theme.panel);
  root.style.setProperty("--hud-border", hud.theme.border);
  root.style.setProperty("--hud-text", hud.theme.text);
  root.style.setProperty("--hud-accent", hud.theme.accent);
  root.style.setProperty("--hud-muted", hud.theme.muted);
  nodes = [];
  for (const widget of hud.widgets) {
    const node = buildNode(widget);
    applyRect(node.el, widget);
    root.appendChild(node.el);
    nodes.push(node);
  }
  ctx.stage.insertBefore(root, ctx.fader);
}

function ensureDom(): any {
  const hud = design();
  const sig = JSON.stringify(hud);
  if (!root || !root.isConnected || sig !== layoutSignature) {
    layoutSignature = sig;
    rebuildDom(hud);
  }
  return hud;
}

function rebuildBase(node: WidgetNode): void {
  const m = ctx.map;
  const TILE = Assets.TILE;
  const maxW = Math.max(32, node.el.clientWidth || 160);
  const maxH = Math.max(32, node.el.clientHeight || 160);
  const scale = Math.min(maxW / (m.width * TILE), maxH / (m.height * TILE));
  const w = Math.max(1, Math.round(m.width * TILE * scale));
  const h = Math.max(1, Math.round(m.height * TILE * scale));
  node.baseCanvas.width = w; node.baseCanvas.height = h;
  node.dotsCanvas.width = w; node.dotsCanvas.height = h;
  const g = node.baseCanvas.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.drawImage(ctx.lowerBuf, 0, 0, w, h);
  node.builtForMap = m;
}

function drawDots(node: WidgetNode): void {
  const m = ctx.map;
  const px = node.dotsCanvas.width / m.width;
  const py = node.dotsCanvas.height / m.height;
  const g = node.dotsCanvas.getContext("2d");
  g.clearRect(0, 0, node.dotsCanvas.width, node.dotsCanvas.height);
  const dot = (rx: any, ry: any, size: any, color: any) => {
    g.fillStyle = color;
    const sx = Math.max(2, px * size), sy = Math.max(2, py * size);
    g.fillRect(rx * px + (px - sx) / 2, ry * py + (py - sy) / 2, sx, sy);
  };
  for (const rt of ctx.evRTs) {
    if (rt.erased || !rt.page || rt.charsetIdx < 0) continue;
    dot(rt.rx, rt.ry, 0.5, "rgba(150,200,255,0.7)");
  }
  for (const vehicle of vehicleDrawables()) dot(vehicle.rx, vehicle.ry, 0.7, "rgba(120,220,255,0.95)");
  const player = G.player;
  dot(player.rx, player.ry, 0.95, "#101018"); dot(player.rx, player.ry, 0.7, "#ffd86a");
}

function questSignature(active: any[]): string {
  return JSON.stringify(active.map((quest: any) => [
    quest.id,
    Quests.objectiveDisplay(quest.id).map((objective: any) => objective.current + "/" + objective.total + (objective.done ? "!" : "")),
  ]));
}

function rebuildTracker(node: WidgetNode, active: any[]): void {
  node.el.innerHTML = "";
  if (node.widget.label) node.el.appendChild(el("div", "hud-widget-title", esc(node.widget.label)));
  for (const quest of active) {
    const box = el("div", "qh-quest");
    box.appendChild(el("div", "qh-name", esc(quest.name)));
    for (const objective of Quests.objectiveDisplay(quest.id)) {
      box.appendChild(el("div", "qh-obj" + (objective.done ? " done" : ""),
        (objective.done ? "✓ " : "▸ ") + esc(objective.text) + (objective.total > 1 ? " <span class='qh-count'>" + objective.current + "/" + objective.total + "</span>" : "")));
    }
    node.el.appendChild(box);
  }
  node.el.style.display = active.length ? "" : "none";
}

function boundValue(widget: any): { text: string; current: number; max: number } {
  const actor = G.party && G.party[0];
  const kind = widget.binding || "none";
  let value: any = widget.text || "";
  let max = Math.max(1, Number(widget.max) || 100);
  if (kind === "variable") value = Number(G.vars[widget.bindingId] || 0);
  else if (kind === "switch") value = G.switches[widget.bindingId] ? "ON" : "OFF";
  else if (kind === "gold") value = Number(G.gold || 0);
  else if (kind === "actorHp") { value = actor ? Number(actor.hp || 0) : 0; max = actor ? param(actor, "mhp") : 1; }
  else if (kind === "actorMp") { value = actor ? Number(actor.mp || 0) : 0; max = actor ? param(actor, "mmp") : 1; }
  else if (kind === "actorTp") { value = actor ? Number(actor.tp || 0) : 0; max = 100; }
  else if (kind === "actorLevel") { value = actor ? Number(actor.level || 1) : 0; max = Math.max(max, value); }
  else if (kind === "steps") value = Number(G.steps || 0);
  else if (kind === "mapName") value = ctx.map ? String(ctx.map.name || "") : "";
  const numeric = typeof value === "number" ? value : Number(value);
  return { text: String(value), current: Number.isFinite(numeric) ? numeric : 0, max };
}

function updateDataWidget(node: WidgetNode): void {
  const widget = node.widget;
  const value = boundValue(widget);
  if (widget.type === "gauge") {
    node.value.textContent = value.text + " / " + value.max;
    node.fill.style.width = clamp((value.current / Math.max(1, value.max)) * 100, 0, 100) + "%";
  } else if (widget.type === "text") {
    const prefix = widget.label || widget.text || "";
    node.el.textContent = prefix + (widget.binding && widget.binding !== "none" ? (prefix ? ": " : "") + value.text : "");
  }
}

/** Per-rendered-frame HUD refresh (render-glue calls this on the map scene). */
export function updateHud(): void {
  if (ctx.scene !== "map" || !ctx.map || !G.player) {
    if (root) root.style.display = "none";
    return;
  }
  const hud = ensureDom();
  const hidden = !!ctx.playerOptions.hudHidden || !hud.enabled;
  root.style.display = hidden ? "none" : "";
  if (hidden) return;

  for (const node of nodes) {
    const widget = node.widget;
    node.el.style.display = widget.visible === false ? "none" : "";
    if (widget.visible === false) continue;
    if (widget.type === "minimap") {
      const show = minimapEnabled() && ctx.lowerBuf;
      node.el.style.display = show ? "" : "none";
      if (show) { if (node.builtForMap !== ctx.map) rebuildBase(node); drawDots(node); }
    } else if (widget.type === "quests") {
      const active = (ctx.proj.quests || [])
        .filter((quest: any) => quest.visible !== false && Quests.status(quest.id) === "active")
        .slice(0, widget.questLimit || 3);
      const sig = questSignature(active);
      if (sig !== node.lastSig) {
        const isUpdate = node.lastSig != null && active.length > 0;
        node.lastSig = sig; rebuildTracker(node, active);
        if (isUpdate) {
          node.el.classList.remove("flash"); void node.el.offsetWidth; node.el.classList.add("flash");
          clearTimeout(node.flashTimer); node.flashTimer = setTimeout(() => node.el.classList.remove("flash"), 900);
        }
      }
    } else if (widget.type === "text" || widget.type === "gauge") updateDataWidget(node);
  }
}
