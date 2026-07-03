/* RPGAtlas — src/editor/dock/dock.ts
   The dockable-workspace DOM engine (Phase 3 Stage B).

   Renders a DockLayout (src/editor/dock/layout.ts) into #dock-root: split nodes
   become flex rows/columns with draggable resizers, tabs nodes become tabbed
   regions, and detached panels become floating windows. Panel *content* is
   owned elsewhere (built-ins are the existing editor DOM relocated from
   #panel-store; later stages register lazy mounts) — this engine only moves
   those elements between region bodies and the parking store, so their event
   listeners and canvas bitmaps survive every re-layout.

   Structural editing lives in layout.ts and is pure; this file is the
   imperative shell: drag/drop, resize, float geometry, focus, persistence,
   and the public commands panels.ts binds into the command registry.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { $, h } from "../dom";
import { editorI18n } from "../editor-state";
import {
  defaultLayout, validateLayout, collectPanels, hasPanel,
  dockTab, dockSplit, dockFloatTab, floatPanel, showPanel, closePanel,
  type DockLayout, type TabsNode, type FloatWin, type DropSide,
} from "./layout";

export interface DockPanelDef {
  id: string;
  title: string;
  el?: HTMLElement;             // pre-existing content (built-ins)
  mount?: () => HTMLElement;    // lazy content factory (later stages)
  closable?: boolean;          // may be closed/floated out (default true; map is false)
}

const LS_CUR = "rpgatlas_dock_v1";
const LS_NAMED = "rpgatlas_dock_named_v1";

const defs = new Map<string, DockPanelDef>();
const resolved = new Map<string, HTMLElement>();
let layout: DockLayout = defaultLayout();
let host: HTMLElement | null = null;
let store: HTMLElement | null = null;
let focused: string | null = null;
let floatSeq = 1;
let onChange: (() => void) | null = null;

export function registerDockPanel(def: DockPanelDef) { defs.set(def.id, def); }
export function setDockChangeHook(fn: () => void) { onChange = fn; }
function knownPanels() { return [...defs.keys()]; }

function panelEl(id: string): HTMLElement | null {
  if (resolved.has(id)) return resolved.get(id)!;
  const def = defs.get(id);
  if (!def) return null;
  const el = def.el ?? (def.mount ? def.mount() : null);
  if (!el) return null;
  resolved.set(id, el);
  return el;
}
// Tab captions are chrome — localized like menu labels (Phase 7 Stage C).
function panelTitle(id: string) { return editorI18n.t(defs.get(id)?.title ?? id); }
function isClosable(id: string) { return defs.get(id)?.closable !== false; }

// ---- persistence ----
function persist() {
  try { localStorage.setItem(LS_CUR, JSON.stringify(layout)); } catch { /* quota/denied */ }
  if (onChange) onChange();
}
function readNamed(): Record<string, DockLayout> {
  try { return JSON.parse(localStorage.getItem(LS_NAMED) || "{}") || {}; } catch { return {}; }
}
function writeNamed(m: Record<string, DockLayout>) {
  try { localStorage.setItem(LS_NAMED, JSON.stringify(m)); } catch { /* ignore */ }
}

// ---- init ----
export function initDock(hostEl: HTMLElement) {
  host = hostEl;
  store = $("panel-store");
  const raw = (() => { try { return JSON.parse(localStorage.getItem(LS_CUR) || "null"); } catch { return null; } })();
  layout = validateLayout(raw, knownPanels()) || defaultLayout();
  if (!hasPanel(layout, "map")) showPanel(layout, "map"); // map view can never be lost
  render();
}

// ---- scroll preservation across re-parenting ----
const scrollMemo = new Map<string, [number, number]>();
function saveScroll() {
  for (const [id, el] of resolved) {
    const sc = el.matches("#mapscroll,[data-scroll]") ? el : el.querySelector("#mapscroll,[data-scroll]") as HTMLElement | null;
    if (sc) scrollMemo.set(id, [sc.scrollLeft, sc.scrollTop]);
  }
}
function restoreScroll() {
  for (const [id, el] of resolved) {
    const m = scrollMemo.get(id);
    if (!m) continue;
    const sc = el.matches("#mapscroll,[data-scroll]") ? el : el.querySelector("#mapscroll,[data-scroll]") as HTMLElement | null;
    if (sc) { sc.scrollLeft = m[0]; sc.scrollTop = m[1]; }
  }
}

// ---- render ----
let regionMap: { el: HTMLElement; node: TabsNode }[] = [];
let floatMap: { el: HTMLElement; win: FloatWin }[] = [];

function render() {
  if (!host || !store) return;
  saveScroll();
  regionMap = []; floatMap = [];
  // Park every content element so each has exactly one home after mount.
  for (const el of resolved.values()) store.appendChild(el);
  host.innerHTML = "";
  host.appendChild(buildNode(layout.root, 1));
  for (const win of layout.floats) host.appendChild(buildFloat(win));
  // Mount active panels into their regions.
  for (const { el, node } of regionMap) mountInto(el.querySelector(".dock-body") as HTMLElement, node.active);
  for (const { el, win } of floatMap) mountInto(el.querySelector(".dock-body") as HTMLElement, win.active);
  restoreScroll();
  applyFocus();
}
function mountInto(body: HTMLElement, id: string) {
  const el = panelEl(id);
  if (el) body.appendChild(el);
}

function buildNode(node: any, grow: number): HTMLElement {
  if (node.type === "tabs") return buildRegion(node, grow);
  const box = h("div", { class: "dock-split " + node.dir });
  box.style.flexGrow = String(grow);
  node.children.forEach((child: any, i: number) => {
    box.appendChild(buildNode(child, node.sizes[i] ?? 1));
    if (i < node.children.length - 1) box.appendChild(buildResizer(node, i, box));
  });
  return box;
}

function buildRegion(node: TabsNode, grow: number): HTMLElement {
  const region = h("div", { class: "dock-region" });
  region.style.flexGrow = String(grow);
  const bar = h("div", { class: "dock-tabbar" });
  for (const id of node.panels) {
    const tab = h("div", { class: "dock-tab" + (id === node.active ? " sel" : "") },
      h("span", { class: "dock-tab-label" }, panelTitle(id)));
    if (isClosable(id)) {
      tab.appendChild(h("span", {
        class: "dock-tab-x", title: "Close panel",
        onmousedown(e: MouseEvent) { e.stopPropagation(); e.preventDefault(); closePanelById(id); },
      }, "✕"));
    }
    tab.addEventListener("mousedown", (e: MouseEvent) => onTabDown(e, id, node));
    bar.appendChild(tab);
  }
  region.appendChild(bar);
  region.appendChild(h("div", { class: "dock-body" }));
  region.addEventListener("mousedown", () => setFocus(node.active), true);
  regionMap.push({ el: region, node });
  return region;
}

function buildResizer(split: any, index: number, box: HTMLElement): HTMLElement {
  const rez = h("div", { class: "dock-resizer " + split.dir });
  rez.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const horiz = split.dir === "row";
    const kids = [...box.children].filter((c) => !c.classList.contains("dock-resizer")) as HTMLElement[];
    const a = kids[index], b = kids[index + 1];
    const total = horiz ? box.clientWidth : box.clientHeight;
    const start = horiz ? e.clientX : e.clientY;
    const s0 = split.sizes[index], s1 = split.sizes[index + 1];
    const sum = s0 + s1;
    const totalW = split.sizes.reduce((x: number, y: number) => x + y, 0);
    const move = (ev: MouseEvent) => {
      const d = (horiz ? ev.clientX : ev.clientY) - start;
      // px delta → weight delta: pixelsPerWeight = total / totalW.
      const wd = total ? (d * totalW) / total : 0;
      let n0 = s0 + wd;
      const min = sum * 0.08;
      n0 = Math.max(min, Math.min(sum - min, n0));
      const n1 = sum - n0;
      split.sizes[index] = n0; split.sizes[index + 1] = n1;
      a.style.flexGrow = String(n0); b.style.flexGrow = String(n1);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("dock-resizing");
      persist();
    };
    document.body.classList.add("dock-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  return rez;
}

function buildFloat(win: FloatWin): HTMLElement {
  const el = h("div", { class: "dock-float" });
  Object.assign(el.style, { left: win.x + "px", top: win.y + "px", width: win.w + "px", height: win.h + "px" });
  const bar = h("div", { class: "dock-tabbar dock-float-bar" });
  for (const id of win.panels) {
    const tab = h("div", { class: "dock-tab" + (id === win.active ? " sel" : "") },
      h("span", { class: "dock-tab-label" }, panelTitle(id)),
      h("span", { class: "dock-tab-x", title: "Close panel",
        onmousedown(e: MouseEvent) { e.stopPropagation(); e.preventDefault(); closePanelById(id); } }, "✕"));
    tab.addEventListener("mousedown", (e: MouseEvent) => onTabDown(e, id, null, win));
    bar.appendChild(tab);
  }
  // Dragging empty bar space moves the window.
  bar.addEventListener("mousedown", (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".dock-tab")) return;
    e.preventDefault();
    const ox = e.clientX - win.x, oy = e.clientY - win.y;
    const move = (ev: MouseEvent) => {
      win.x = Math.max(0, ev.clientX - ox); win.y = Math.max(0, ev.clientY - oy);
      el.style.left = win.x + "px"; el.style.top = win.y + "px";
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); persist(); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  });
  el.appendChild(bar);
  el.appendChild(h("div", { class: "dock-body" }));
  const grip = h("div", { class: "dock-float-resize", title: "Resize" });
  grip.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, w0 = win.w, h0 = win.h;
    const move = (ev: MouseEvent) => {
      win.w = Math.max(220, w0 + ev.clientX - sx); win.h = Math.max(140, h0 + ev.clientY - sy);
      el.style.width = win.w + "px"; el.style.height = win.h + "px";
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); persist(); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  });
  el.appendChild(grip);
  el.addEventListener("mousedown", () => setFocus(win.active), true);
  floatMap.push({ el, win });
  return el;
}

// ---- drag a tab to re-dock / float ----
function onTabDown(e: MouseEvent, id: string, srcTabs: TabsNode | null, srcFloat?: FloatWin) {
  if (e.button !== 0) return;
  // Plain click (no drag) just activates the tab.
  const startX = e.clientX, startY = e.clientY;
  let dragging = false;
  let ghost: HTMLElement | null = null;
  let hi: HTMLElement | null = null;
  let drop: { kind: "tabs" | "split" | "float" | "detach"; node?: TabsNode; win?: FloatWin; side?: DropSide } = { kind: "detach" };

  const begin = () => {
    dragging = true;
    ghost = h("div", { class: "dock-drag-ghost" }, panelTitle(id));
    hi = h("div", { class: "dock-drop-hi" });
    document.body.appendChild(ghost!);
    document.body.appendChild(hi!);
    document.body.classList.add("dock-dragging");
  };
  const move = (ev: MouseEvent) => {
    if (!dragging) {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 5) return;
      begin();
    }
    ghost!.style.left = ev.clientX + 12 + "px";
    ghost!.style.top = ev.clientY + 12 + "px";
    drop = resolveDrop(ev.clientX, ev.clientY);
    paintHighlight(hi!, drop);
  };
  const up = (ev: MouseEvent) => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    if (!dragging) { activateTab(id, srcTabs, srcFloat); return; }
    ghost?.remove(); hi?.remove();
    document.body.classList.remove("dock-dragging");
    applyDrop(id, drop, ev.clientX, ev.clientY);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function activateTab(id: string, srcTabs: TabsNode | null, srcFloat?: FloatWin) {
  if (srcTabs) srcTabs.active = id;
  else if (srcFloat) srcFloat.active = id;
  setFocus(id);
  persist();
  render();
}

function regionAt(x: number, y: number): { node: TabsNode; el: HTMLElement } | null {
  for (const r of regionMap) {
    const b = r.el.getBoundingClientRect();
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return { node: r.node, el: r.el };
  }
  return null;
}
function floatAt(x: number, y: number): { win: FloatWin; el: HTMLElement } | null {
  for (const f of floatMap) {
    const b = f.el.getBoundingClientRect();
    if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return { win: f.win, el: f.el };
  }
  return null;
}
function resolveDrop(x: number, y: number): { kind: "tabs" | "split" | "float" | "detach"; node?: TabsNode; win?: FloatWin; side?: DropSide } {
  const f = floatAt(x, y);
  if (f) return { kind: "tabs", win: f.win }; // dropping on a float adds a tab there
  const r = regionAt(x, y);
  if (!r) return { kind: "detach" };
  const b = r.el.getBoundingClientRect();
  const side = zoneAt(b, x, y);
  return side === "center" ? { kind: "tabs", node: r.node } : { kind: "split", node: r.node, side };
}
function zoneAt(b: DOMRect, x: number, y: number): DropSide {
  const fx = (x - b.left) / b.width, fy = (y - b.top) / b.height;
  const dists: [DropSide, number][] = [["W", fx], ["E", 1 - fx], ["N", fy], ["S", 1 - fy]];
  dists.sort((a, c) => a[1] - c[1]);
  return dists[0][1] < 0.22 ? dists[0][0] : "center";
}
function paintHighlight(hi: HTMLElement, drop: any) {
  let rect: DOMRect | null = null;
  if (drop.kind === "tabs" && drop.win) rect = floatMap.find((f) => f.win === drop.win)!.el.getBoundingClientRect();
  else if (drop.node) rect = regionMap.find((r) => r.node === drop.node)!.el.getBoundingClientRect();
  if (!rect) { hi.style.display = "none"; return; }
  hi.style.display = "block";
  let l = rect.left, t = rect.top, w = rect.width, hh = rect.height;
  if (drop.kind === "split") {
    if (drop.side === "W") w = rect.width / 2;
    else if (drop.side === "E") { l = rect.left + rect.width / 2; w = rect.width / 2; }
    else if (drop.side === "N") hh = rect.height / 2;
    else if (drop.side === "S") { t = rect.top + rect.height / 2; hh = rect.height / 2; }
  }
  Object.assign(hi.style, { left: l + "px", top: t + "px", width: w + "px", height: hh + "px" });
}
function applyDrop(id: string, drop: any, x: number, y: number) {
  if (drop.kind === "detach") {
    const b = host!.getBoundingClientRect();
    floatPanel(layout, id, { x: Math.max(0, x - 60), y: Math.max(b.top, y - 12), w: 440, h: 320 }, "fl" + floatSeq++);
  } else if (drop.kind === "split") {
    dockSplit(layout, drop.node, id, drop.side);
  } else if (drop.win) {
    dockFloatTab(layout, drop.win.id, id);
  } else if (drop.node) {
    dockTab(layout, drop.node, id);
  }
  setFocus(id);
  persist();
  render();
}

// ---- focus ----
function setFocus(id: string) {
  if (focused === id) return;
  focused = id;
  applyFocus();
  if (onChange) onChange();
}
function applyFocus() {
  for (const { el, node } of regionMap) el.classList.toggle("focused", node.active === focused);
  for (const { el, win } of floatMap) el.classList.toggle("focused", win.active === focused);
}
export function getFocusedPanel() { return focused; }
export function focusNextPanel() {
  const vis = collectPanels(layout);
  if (!vis.length) return;
  const i = focused ? vis.indexOf(focused) : -1;
  focusPanel(vis[(i + 1) % vis.length]);
}

// ---- public panel commands (bound to the registry by panels.ts) ----
export function focusPanel(id: string) {
  showPanel(layout, id);
  setFocus(id);
  persist();
  render();
}
export function togglePanel(id: string) {
  if (hasPanel(layout, id)) closePanelById(id);
  else focusPanel(id);
}
export function isPanelVisible(id: string) { return hasPanel(layout, id); }
function closePanelById(id: string) {
  if (!isClosable(id)) return;
  closePanel(layout, id);
  if (focused === id) focused = null;
  persist();
  render();
}

export function resetLayout() {
  layout = defaultLayout();
  focused = null;
  persist();
  render();
}
export function saveNamedLayout(name: string) {
  const m = readNamed();
  m[name] = JSON.parse(JSON.stringify(layout));
  writeNamed(m);
}
export function listNamedLayouts() { return Object.keys(readNamed()).sort(); }
export function loadNamedLayout(name: string) {
  const m = readNamed();
  const l = validateLayout(m[name], knownPanels());
  if (!l) return;
  layout = l;
  if (!hasPanel(layout, "map")) showPanel(layout, "map");
  focused = null;
  persist();
  render();
}
export function deleteNamedLayout(name: string) {
  const m = readNamed();
  delete m[name];
  writeNamed(m);
}
