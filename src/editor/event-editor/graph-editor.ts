/* RPGAtlas — src/editor/event-editor/graph-editor.ts
   The Atlas Graph canvas (Phase 4 Stage B): the node-graph view of an event
   page. Pure graph semantics live in src/shared/event-graph.ts; this module
   is the DOM surface — pan/zoom stage, DOM node cards over an SVG edge
   layer (the world-view pattern), port drag-to-wire, add-node menus reusing
   pickCommand, double-click editing reusing editCommand forms, comments/
   frames, reroute dots, a minimap, and a live validation banner.

   Every structural change recompiles the graph into page.commands (the only
   thing the runtime reads). Compile errors keep the page's last good
   commands and surface in the banner instead.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { t } from "../editor-state";
import { h } from "../dom";
import { modal } from "../modals";
import { touch } from "../persistence";
import { cmdSummary, cmdDef, editCommand, pickCommand } from "./command-defs";
import {
  addNode, compileGraph, connect, deleteNode, getNode, normalizeOut,
  outPortLabels, validateGraph, type GraphIssue,
} from "../../shared/event-graph";

const SVGNS = "http://www.w3.org/2000/svg";
const NODE_W = 190;
const START_ID = -1; // the virtual Start pill (graph.entry is its one port)

export interface GraphWidget {
  el: HTMLElement;
  redraw: () => void;
}

/** Build the graph canvas for a page (page.graph must exist). `undoApi`
 *  matches the event editor's { snapshot }; `onSelect` feeds the inspector
 *  with the selected node's command (or null), like cmdListWidget does. */
export function graphEditorWidget(getPage: () => any, undoApi: any, onSelect?: any): GraphWidget {
  const g = () => getPage().graph;

  // ---- view + selection state ----
  const view = { x: 60, y: 40, z: 1 };
  let sel: { kind: "node" | "edge"; id: number; port?: number } | null = null;
  let menuEl: any = null;

  // ---- DOM scaffold ----
  const banner = h("div", { class: "graph-banner", style: "display:none" });
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "graph-edges");
  const stage = h("div", { class: "graph-stage" }, svg as any);
  const minimap = h("div", { class: "graph-minimap", title: t("Overview — click to jump") });
  const hint = h("div", { class: "graph-hint" },
    t("Drag a port to wire · right-click to add nodes · double-click to edit"));
  const viewport = h("div", { class: "graph-viewport" }, stage, minimap, hint);
  const wrap = h("div", { class: "graph-wrap", tabindex: "0" }, banner, viewport);

  const nodeEls = new Map<number, HTMLElement>();

  // ============================ coordinates ============================
  function toStage(cx: number, cy: number) {
    const r = viewport.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
  }
  function applyView() {
    stage.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.z + ")";
    drawMinimap();
  }
  function centerOn(x: number, y: number) {
    const r = viewport.getBoundingClientRect();
    view.x = r.width / 2 - x * view.z;
    view.y = r.height / 2 - y * view.z;
    applyView();
  }

  // Fit the whole graph into the viewport (used once, after first attach).
  function fitView() {
    const r = viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const nodes = g().nodes;
    let x0 = -120, y0 = 0, x1 = 260, y1 = 120; // always include the Start pill area
    for (const n of nodes) {
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + (n.w || NODE_W)); y1 = Math.max(y1, n.y + (n.h || 80));
    }
    const pad = 30;
    const z = Math.max(0.25, Math.min(1, (r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0)));
    view.z = z;
    centerOn((x0 + x1) / 2, (y0 + y1) / 2);
  }

  // Start pill position: to the left of its target, else a fixed home.
  function startPos() {
    const entry = getNode(g(), g().entry);
    return entry ? { x: entry.x - 150, y: entry.y } : { x: 40, y: 40 };
  }

  // ============================ compile / banner ============================
  let issues: GraphIssue[] = [];
  function recompile() {
    for (const n of g().nodes) if (!n.kind || n.kind === "cmd") normalizeOut(n);
    issues = validateGraph(g());
    const errors = issues.filter((i) => i.level === "error");
    if (!errors.length) {
      getPage().commands = compileGraph(g()).commands;
    }
    const first = errors[0] || issues[0];
    if (!first) { banner.style.display = "none"; }
    else {
      banner.style.display = "";
      banner.className = "graph-banner " + (errors.length ? "graph-banner-err" : "graph-banner-warn");
      banner.innerHTML = "";
      const more = issues.length > 1 ? "  (+" + (issues.length - 1) + ")" : "";
      banner.appendChild(h("span", null,
        (errors.length ? "⛔ " : "⚠ ") + first.msg + more
        + (errors.length ? " — " + t("keeping the last good compile") : "")));
      if (first.nodeId != null) {
        banner.appendChild(h("button", { class: "mini", onclick() {
          const n = getNode(g(), first.nodeId!);
          if (n) { sel = { kind: "node", id: n.id }; centerOn(n.x + NODE_W / 2, n.y + 40); render(); }
        } }, t("Show")));
      }
    }
  }

  // A structural mutation: snapshot → mutate → recompile → rerender → notify.
  function change(fn: () => void) {
    undoApi.snapshot();
    fn();
    touch();
    redraw();
  }

  // ============================ node cards ============================
  function nodeTitle(n: any): string {
    const c = n.cmd || {};
    const def = cmdDef(c.t);
    return def ? def.label : String(c.t || "?");
  }

  function buildNode(n: any): HTMLElement {
    if (n.kind === "comment") return buildComment(n);
    if (n.kind === "reroute") {
      const el = h("div", { class: "graph-reroute" + (isSel(n.id) ? " sel" : ""), "data-id": String(n.id) });
      el.appendChild(h("span", { class: "graph-port graph-port-out", "data-from": String(n.id), "data-port": "0" }));
      return el;
    }
    const ports = outPortLabels(n);
    const el = h("div", { class: "graph-node" + (isSel(n.id) ? " sel" : ""), "data-id": String(n.id) },
      h("span", { class: "graph-port graph-port-in" }),
      h("div", { class: "graph-node-title" }, nodeTitle(n)),
      h("div", { class: "graph-node-sum" }, cmdSummary(n.cmd || {})),
      h("div", { class: "graph-ports" },
        ...ports.map((label, i) => h("div", { class: "graph-port-row" },
          h("span", { class: "graph-port-label" }, label),
          h("span", { class: "graph-port graph-port-out", "data-from": String(n.id), "data-port": String(i) })))),
    );
    return el;
  }

  function buildComment(n: any): HTMLElement {
    const framed = n.w != null || n.h != null;
    const el = h("div", {
      class: "graph-comment" + (framed ? " graph-frame" : "") + (isSel(n.id) ? " sel" : ""),
      "data-id": String(n.id),
      style: framed ? "width:" + (n.w || 260) + "px;height:" + (n.h || 160) + "px" : "",
    }, h("div", { class: "graph-comment-text" }, n.text || t("Comment — double-click to edit")));
    if (framed) el.appendChild(h("span", { class: "graph-resize", "data-id": String(n.id) }));
    return el;
  }

  const isSel = (id: number) => !!sel && sel.kind === "node" && sel.id === id;

  // ============================ edges ============================
  interface Anchor { x: number; y: number; }
  function portAnchor(el: HTMLElement, dot: HTMLElement, n: { x: number; y: number }): Anchor {
    return {
      x: n.x + dot.offsetLeft + dot.offsetWidth / 2,
      y: n.y + dot.offsetTop + dot.offsetHeight / 2,
    };
  }
  function inAnchor(id: number): Anchor | null {
    const n = getNode(g(), id);
    const el = nodeEls.get(id);
    if (!n || !el) return null;
    if (n.kind === "reroute") return { x: n.x + 6, y: n.y + 6 };
    const dot = el.querySelector(".graph-port-in") as HTMLElement | null;
    return dot ? portAnchor(el, dot, n) : { x: n.x, y: n.y + 18 };
  }
  function outAnchor(fromId: number, port: number): Anchor | null {
    if (fromId === START_ID) {
      const p = startPos();
      const dot = startEl && (startEl.querySelector(".graph-port-out") as HTMLElement | null);
      return dot
        ? { x: p.x + dot.offsetLeft + dot.offsetWidth / 2, y: p.y + dot.offsetTop + dot.offsetHeight / 2 }
        : { x: p.x + 108, y: p.y + 16 };
    }
    const n = getNode(g(), fromId);
    const el = nodeEls.get(fromId);
    if (!n || !el) return null;
    if (n.kind === "reroute") return { x: n.x + 6, y: n.y + 6 };
    const dot = el.querySelector('.graph-port-out[data-port="' + port + '"]') as HTMLElement | null;
    return dot ? portAnchor(el, dot, n) : { x: n.x + NODE_W, y: n.y + 18 };
  }
  function edgePath(a: Anchor, b: Anchor): string {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return "M" + a.x + " " + a.y + " C" + (a.x + dx) + " " + a.y + ", " + (b.x - dx) + " " + b.y + ", " + b.x + " " + b.y;
  }

  let tempEdge: SVGPathElement | null = null;
  function drawEdges() {
    svg.innerHTML = "";
    const pairs: Array<{ from: number; port: number; to: number }> = [];
    if (g().entry != null) pairs.push({ from: START_ID, port: 0, to: g().entry });
    for (const n of g().nodes) {
      (n.out || []).forEach((to: number | null, port: number) => {
        if (to != null) pairs.push({ from: n.id, port, to });
      });
    }
    for (const p of pairs) {
      const a = outAnchor(p.from, p.port), b = inAnchor(p.to);
      if (!a || !b) continue;
      const d = edgePath(a, b);
      const selE = sel && sel.kind === "edge" && sel.id === p.from && sel.port === p.port;
      const line = document.createElementNS(SVGNS, "path");
      line.setAttribute("d", d);
      line.setAttribute("class", "graph-edge" + (selE ? " sel" : ""));
      const hit = document.createElementNS(SVGNS, "path");
      hit.setAttribute("d", d);
      hit.setAttribute("class", "graph-edge-hit");
      hit.addEventListener("mousedown", (e: any) => {
        e.stopPropagation();
        sel = { kind: "edge", id: p.from, port: p.port };
        render();
        wrap.focus({ preventScroll: true });
      });
      svg.appendChild(hit);
      svg.appendChild(line);
    }
    if (tempEdge) svg.appendChild(tempEdge);
  }

  // ============================ minimap ============================
  const MM_W = 148, MM_H = 92;
  function drawMinimap() {
    const nodes = g().nodes;
    minimap.innerHTML = "";
    if (!nodes.length) { minimap.style.display = "none"; return; }
    minimap.style.display = "";
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + (n.w || NODE_W)); y1 = Math.max(y1, n.y + (n.h || 60));
    }
    const pad = 60; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const s = Math.min(MM_W / (x1 - x0), MM_H / (y1 - y0));
    for (const n of nodes) {
      minimap.appendChild(h("span", {
        class: "graph-mm-node" + (n.kind === "comment" ? " mm-comment" : ""),
        style: "left:" + ((n.x - x0) * s) + "px;top:" + ((n.y - y0) * s) + "px;"
          + "width:" + Math.max(3, (n.w || NODE_W) * s) + "px;height:" + Math.max(2, (n.h || 60) * s) + "px",
      }));
    }
    const r = viewport.getBoundingClientRect();
    const vx = (-view.x / view.z - x0) * s, vy = (-view.y / view.z - y0) * s;
    minimap.appendChild(h("span", {
      class: "graph-mm-view",
      style: "left:" + vx + "px;top:" + vy + "px;width:" + (r.width / view.z * s) + "px;height:" + (r.height / view.z * s) + "px",
    }));
    minimap.onmousedown = (e: any) => {
      e.stopPropagation();
      const mr = minimap.getBoundingClientRect();
      centerOn(x0 + (e.clientX - mr.left) / s, y0 + (e.clientY - mr.top) / s);
    };
  }

  // ============================ render ============================
  let startEl: HTMLElement | null = null;
  function render() {
    // nodes
    for (const el of nodeEls.values()) el.remove();
    nodeEls.clear();
    if (startEl) startEl.remove();
    const sp = startPos();
    startEl = h("div", { class: "graph-node graph-start", style: "left:" + sp.x + "px;top:" + sp.y + "px" },
      h("span", null, "▶ " + t("Start")),
      h("span", { class: "graph-port graph-port-out", "data-from": String(START_ID), "data-port": "0" }));
    stage.appendChild(startEl);
    for (const n of g().nodes) {
      const el = buildNode(n);
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      stage.appendChild(el);
      nodeEls.set(n.id, el);
    }
    drawEdges();
    applyView();
    if (onSelect) {
      const n = sel && sel.kind === "node" ? getNode(g(), sel.id) : null;
      onSelect(n && (!n.kind || n.kind === "cmd") ? n.cmd : null);
    }
  }

  function redraw() {
    recompile();
    render();
  }

  // ============================ menus ============================
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    document.removeEventListener("mousedown", onMenuOutside, true);
  }
  function onMenuOutside(ev: any) { if (menuEl && !menuEl.contains(ev.target)) closeMenu(); }
  function openMenu(e: MouseEvent, items: Array<[string, boolean, () => void]>) {
    e.preventDefault();
    closeMenu();
    const menu = h("div", { class: "menu-drop" });
    for (const [label, on, fn] of items) {
      if (label === "-") { menu.appendChild(h("div", { class: "menu-sep" })); continue; }
      menu.appendChild(h("div", {
        class: "menu-item" + (on ? "" : " disabled"),
        onclick() { if (!on) return; closeMenu(); fn(); },
      }, h("span", { class: "mi-label" }, label)));
    }
    document.body.appendChild(menu);
    menu.style.left = Math.max(4, Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4)) + "px";
    menuEl = menu;
    document.addEventListener("mousedown", onMenuOutside, true);
  }

  function addCommandNodeAt(x: number, y: number, then?: (n: any) => void) {
    pickCommand((nc: any) => {
      change(() => {
        const n = addNode(g(), nc, Math.round(x), Math.round(y));
        if (g().entry == null) g().entry = n.id;
        sel = { kind: "node", id: n.id };
        if (then) then(n);
      });
    });
  }

  function canvasMenu(e: MouseEvent) {
    const p = toStage(e.clientX, e.clientY);
    openMenu(e, [
      [t("Add command…"), true, () => addCommandNodeAt(p.x, p.y)],
      [t("Add comment"), true, () => change(() => { addNode(g(), null, Math.round(p.x), Math.round(p.y), "comment"); })],
      [t("Add frame"), true, () => change(() => {
        const n = addNode(g(), null, Math.round(p.x), Math.round(p.y), "comment");
        n.w = 320; n.h = 200;
      })],
      [t("Add reroute dot"), true, () => change(() => { addNode(g(), null, Math.round(p.x), Math.round(p.y), "reroute"); })],
    ]);
  }

  function nodeMenu(e: MouseEvent, n: any) {
    const isCmd = !n.kind || n.kind === "cmd";
    openMenu(e, [
      [t("Edit…"), isCmd || n.kind === "comment", () => editNode(n)],
      [t("Set as Start"), isCmd, () => change(() => { g().entry = n.id; })],
      [t("Disconnect outputs"), n.out.some((o: any) => o != null), () => change(() => { n.out = n.out.map(() => null); })],
      ["-", true, () => {}],
      [t("Delete"), true, () => change(() => { deleteNode(g(), n.id); sel = null; })],
    ]);
  }

  function editNode(n: any) {
    if (n.kind === "comment") {
      const ta = h("textarea", { rows: 4 }, n.text || "");
      modal({
        title: t("Comment"),
        content: h("div", null, ta),
        buttons: [
          { label: t("OK"), primary: true, onClick(close: any) { change(() => { n.text = ta.value; }); close(); } },
          { label: t("Cancel") },
        ],
        dialogKeys: true,
      });
      return;
    }
    if (!n.cmd) return;
    editCommand(n.cmd, () => { touch(); redraw(); }, false, undoApi.snapshot);
  }

  // ============================ pointer interactions ============================
  // One document-level drag session at a time: pan, node move, frame resize,
  // or port wire. Registered on demand, removed on mouseup.
  function dragSession(onMove: (e: MouseEvent) => void, onUp: (e: MouseEvent) => void) {
    const move = (e: MouseEvent) => onMove(e);
    const up = (e: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      onUp(e);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  viewport.addEventListener("wheel", (e: any) => {
    e.preventDefault();
    const p = toStage(e.clientX, e.clientY);
    const z2 = Math.max(0.25, Math.min(2, view.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const r = viewport.getBoundingClientRect();
    view.x = e.clientX - r.left - p.x * z2;
    view.y = e.clientY - r.top - p.y * z2;
    view.z = z2;
    applyView();
  }, { passive: false });

  viewport.addEventListener("mousedown", (e: any) => {
    const target = e.target as HTMLElement;
    if (target.closest(".graph-minimap")) return;
    wrap.focus({ preventScroll: true });

    // ---- port wire drag ----
    const portDot = target.closest(".graph-port-out") as HTMLElement | null;
    if (portDot && e.button === 0) {
      e.preventDefault(); e.stopPropagation();
      const fromId = Number(portDot.getAttribute("data-from"));
      const port = Number(portDot.getAttribute("data-port"));
      const a = outAnchor(fromId, port);
      if (!a) return;
      tempEdge = document.createElementNS(SVGNS, "path");
      tempEdge.setAttribute("class", "graph-edge graph-edge-temp");
      svg.appendChild(tempEdge);
      dragSession((me) => {
        const p = toStage(me.clientX, me.clientY);
        tempEdge!.setAttribute("d", edgePath(a, p));
      }, (me) => {
        tempEdge?.remove(); tempEdge = null;
        const under = document.elementFromPoint(me.clientX, me.clientY) as HTMLElement | null;
        const targetNode = under && (under.closest(".graph-node[data-id]") || under.closest(".graph-reroute[data-id]"));
        const p = toStage(me.clientX, me.clientY);
        if (targetNode) {
          const toId = Number(targetNode.getAttribute("data-id"));
          if (fromId === START_ID) change(() => { g().entry = toId; });
          else if (toId !== fromId) change(() => { connect(g(), fromId, port, toId); });
          else drawEdges();
        } else if (under && viewport.contains(under)) {
          // dropped on empty canvas: pick a command, add it there, wire it up
          addCommandNodeAt(p.x, p.y - 16, (n) => {
            if (fromId === START_ID) g().entry = n.id;
            else connect(g(), fromId, port, n.id);
          });
        } else {
          drawEdges();
        }
      });
      return;
    }

    // ---- frame resize ----
    const grip = target.closest(".graph-resize") as HTMLElement | null;
    if (grip && e.button === 0) {
      e.preventDefault(); e.stopPropagation();
      const n: any = getNode(g(), Number(grip.getAttribute("data-id")));
      if (!n) return;
      const w0 = n.w || 260, h0 = n.h || 160, sx = e.clientX, sy = e.clientY;
      let snapped = false;
      dragSession((me) => {
        if (!snapped) { undoApi.snapshot(); snapped = true; }
        n.w = Math.max(80, Math.round(w0 + (me.clientX - sx) / view.z));
        n.h = Math.max(48, Math.round(h0 + (me.clientY - sy) / view.z));
        const el = nodeEls.get(n.id);
        if (el) { el.style.width = n.w + "px"; el.style.height = n.h + "px"; }
        drawMinimap();
      }, () => { if (snapped) touch(); });
      return;
    }

    // ---- node drag / select ----
    const card = target.closest("[data-id]") as HTMLElement | null;
    if (card && e.button === 0 && !card.classList.contains("graph-start")) {
      e.preventDefault();
      const n: any = getNode(g(), Number(card.getAttribute("data-id")));
      if (!n) return;
      sel = { kind: "node", id: n.id };
      render();
      wrap.focus({ preventScroll: true });
      const x0 = n.x, y0 = n.y, sx = e.clientX, sy = e.clientY;
      let snapped = false;
      dragSession((me) => {
        const dx = (me.clientX - sx) / view.z, dy = (me.clientY - sy) / view.z;
        if (!snapped && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) { undoApi.snapshot(); snapped = true; }
        if (!snapped) return;
        n.x = Math.round(x0 + dx); n.y = Math.round(y0 + dy);
        const el = nodeEls.get(n.id);
        if (el) { el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
        drawEdges();
        drawMinimap();
      }, () => { if (snapped) touch(); });
      return;
    }

    // ---- background: pan (left/middle) ----
    if (e.button === 0 || e.button === 1) {
      e.preventDefault();
      const vx = view.x, vy = view.y, sx = e.clientX, sy = e.clientY;
      let moved = false;
      viewport.classList.add("panning");
      dragSession((me) => {
        moved = moved || Math.abs(me.clientX - sx) > 2 || Math.abs(me.clientY - sy) > 2;
        view.x = vx + (me.clientX - sx);
        view.y = vy + (me.clientY - sy);
        applyView();
      }, () => {
        viewport.classList.remove("panning");
        if (!moved) { sel = null; render(); } // plain click clears selection
      });
    }
  });

  viewport.addEventListener("dblclick", (e: any) => {
    const target = e.target as HTMLElement;
    const card = target.closest("[data-id]") as HTMLElement | null;
    if (card) {
      const n = getNode(g(), Number(card.getAttribute("data-id")));
      if (n) editNode(n);
      return;
    }
    if (!target.closest(".graph-minimap")) {
      const p = toStage(e.clientX, e.clientY);
      addCommandNodeAt(p.x, p.y);
    }
  });

  viewport.addEventListener("contextmenu", (e: any) => {
    const target = e.target as HTMLElement;
    const card = target.closest("[data-id]") as HTMLElement | null;
    if (card) {
      const n = getNode(g(), Number(card.getAttribute("data-id")));
      if (n) { sel = { kind: "node", id: n.id }; render(); nodeMenu(e, n); }
    } else {
      canvasMenu(e);
    }
  });

  wrap.addEventListener("keydown", (e: any) => {
    if (e.code === "Delete" || e.code === "Backspace") {
      if (!sel) return;
      e.preventDefault(); e.stopPropagation();
      if (sel.kind === "node") change(() => { deleteNode(g(), sel!.id); sel = null; });
      else change(() => {
        if (sel!.id === START_ID) g().entry = null;
        else { const n = getNode(g(), sel!.id); if (n) n.out[sel!.port!] = null; }
        sel = null;
      });
    } else if (e.key === "Escape" && sel) {
      e.preventDefault(); e.stopPropagation();
      sel = null; render();
    }
  });

  redraw();
  // The caller appends wrap synchronously after this returns; fit once the
  // viewport has real dimensions.
  requestAnimationFrame(() => fitView());
  return { el: wrap, redraw };
}
