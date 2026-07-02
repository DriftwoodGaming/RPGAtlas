/* RPGAtlas — src/editor/dock/layout.ts
   Pure layout tree for the dockable workspace (Phase 3 Stage B).

   The workspace is a tree: interior nodes are `split`s (a row or column of
   children with fractional sizes), leaves are `tabs` groups (an ordered list of
   panel ids with one active). Detached panels live in `floats` — simple
   single-region windows (a tabs strip + x/y/w/h), not part of the split tree.

   Everything here is pure structure + tree edits: no DOM, no persistence, no
   imports. dock.ts renders these trees and calls these edits on drag/drop;
   panels.ts seeds the default. The edit functions mutate IN PLACE on purpose —
   a docking gesture is "remove the dragged panel, then re-insert it at the drop
   target", and the drop-target node reference must survive the removal, so
   removal splices arrays rather than rebuilding nodes. Structural cleanup
   (dropping empty tabs, collapsing single-child splits, flattening nested
   same-direction splits) is deferred to normalize(), run once after each edit.
   Unit-tested in tests-unit/editor-dock-layout.test.ts via summarize().
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */ // validateLayout parses untrusted JSON

export interface TabsNode { type: "tabs"; panels: string[]; active: string; }
export interface SplitNode { type: "split"; dir: "row" | "col"; children: DockNode[]; sizes: number[]; }
export type DockNode = TabsNode | SplitNode;
export interface FloatWin {
  id: string; panels: string[]; active: string;
  x: number; y: number; w: number; h: number;
}
export interface DockLayout { root: DockNode; floats: FloatWin[]; }
export type DropSide = "N" | "S" | "E" | "W" | "center";

// ---- constructors ----
export function tabs(panels: string[], active?: string): TabsNode {
  return { type: "tabs", panels: panels.slice(), active: active ?? panels[0] };
}
export function split(dir: "row" | "col", children: DockNode[], sizes?: number[]): SplitNode {
  return { type: "split", dir, children, sizes: sizes ?? children.map(() => 1) };
}

/** The stock layout: a left column (Maps over Tiles) beside the map view. */
export function defaultLayout(): DockLayout {
  return {
    root: split("row", [
      split("col", [tabs(["maps"]), tabs(["tiles"])], [1, 1.5]),
      tabs(["map"]),
    ], [0.26, 0.74]),
    floats: [],
  };
}

// ---- queries ----
export function collectPanels(layout: DockLayout): string[] {
  const out: string[] = [];
  const walk = (n: DockNode) => {
    if (n.type === "tabs") out.push(...n.panels);
    else n.children.forEach(walk);
  };
  walk(layout.root);
  for (const f of layout.floats) out.push(...f.panels);
  return out;
}
export function hasPanel(layout: DockLayout, id: string): boolean {
  return collectPanels(layout).indexOf(id) >= 0;
}
/** The tabs group directly containing `id`, or null. */
export function findTabsWith(node: DockNode, id: string): TabsNode | null {
  if (node.type === "tabs") return node.panels.indexOf(id) >= 0 ? node : null;
  for (const c of node.children) { const r = findTabsWith(c, id); if (r) return r; }
  return null;
}
/** Left-most tabs leaf — the fallback "primary" region. */
export function firstTabs(node: DockNode): TabsNode {
  return node.type === "tabs" ? node : firstTabs(node.children[0]);
}

// ---- structural cleanup ----
/** Drop empty tabs, collapse single-child splits, flatten same-dir nesting,
 *  repair active tabs. Returns the cleaned node, or null if it became empty. */
export function normalize(n: DockNode): DockNode | null {
  if (n.type === "tabs") {
    if (!n.panels.length) return null;
    if (n.panels.indexOf(n.active) < 0) n.active = n.panels[0];
    return n;
  }
  const kids: DockNode[] = [];
  const sizes: number[] = [];
  n.children.forEach((c, i) => {
    const r = normalize(c);
    if (r) { kids.push(r); sizes.push(n.sizes[i] ?? 1); }
  });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  // Flatten a child split of the same direction into this one, scaling its
  // sizes by the child's own weight so proportions are preserved.
  const fk: DockNode[] = [];
  const fs: number[] = [];
  kids.forEach((c, i) => {
    if (c.type === "split" && c.dir === n.dir) {
      const tot = c.sizes.reduce((a, b) => a + b, 0) || 1;
      c.children.forEach((gc, j) => { fk.push(gc); fs.push(sizes[i] * (c.sizes[j] / tot)); });
    } else { fk.push(c); fs.push(sizes[i]); }
  });
  n.children = fk; n.sizes = fs;
  return n;
}

// ---- edits (mutate in place; call normalizeLayout after) ----
function pruneRemove(n: DockNode, id: string): DockNode | null {
  if (n.type === "tabs") {
    const i = n.panels.indexOf(id);
    if (i < 0) return n;
    n.panels.splice(i, 1);
    if (!n.panels.length) return null;
    if (n.active === id) n.active = n.panels[0];
    return n;
  }
  for (let i = n.children.length - 1; i >= 0; i--) {
    if (pruneRemove(n.children[i], id) === null) { n.children.splice(i, 1); n.sizes.splice(i, 1); }
  }
  return n.children.length ? n : null;
}
function removeEverywhere(layout: DockLayout, id: string) {
  layout.root = pruneRemove(layout.root, id) ?? tabs([]);
  for (let i = layout.floats.length - 1; i >= 0; i--) {
    const f = layout.floats[i];
    const j = f.panels.indexOf(id);
    if (j < 0) continue;
    f.panels.splice(j, 1);
    if (!f.panels.length) layout.floats.splice(i, 1);
    else if (f.active === id) f.active = f.panels[0];
  }
}
function replaceNode(root: DockNode, target: DockNode, repl: DockNode): DockNode {
  if (root === target) return repl;
  if (root.type === "split") root.children = root.children.map((c) => replaceNode(c, target, repl));
  return root;
}
export function normalizeLayout(layout: DockLayout): DockLayout {
  layout.root = normalize(layout.root) ?? tabs([]);
  return layout;
}

/** Dock `id` beside `target` (a tabs node in the main tree), splitting on `side`. */
export function dockSplit(layout: DockLayout, target: TabsNode, id: string, side: Exclude<DropSide, "center">) {
  removeEverywhere(layout, id);
  const leaf = tabs([id]);
  const dir = side === "E" || side === "W" ? "row" : "col";
  const before = side === "N" || side === "W";
  const repl = split(dir, before ? [leaf, target] : [target, leaf], [1, 1]);
  layout.root = replaceNode(layout.root, target, repl);
  normalizeLayout(layout);
}
/** Add `id` as a tab in `target` (main-tree tabs) and make it active. */
export function dockTab(layout: DockLayout, target: TabsNode, id: string) {
  removeEverywhere(layout, id);
  if (target.panels.indexOf(id) < 0) target.panels.push(id);
  target.active = id;
  normalizeLayout(layout);
}
/** Add `id` as a tab of an existing floating window. */
export function dockFloatTab(layout: DockLayout, floatId: string, id: string) {
  const f = layout.floats.find((w) => w.id === floatId);
  if (!f) return;
  removeEverywhere(layout, id);
  const again = layout.floats.find((w) => w.id === floatId); // removeEverywhere may have dropped it
  const win = again ?? (layout.floats.push(f), f);
  if (win.panels.indexOf(id) < 0) win.panels.push(id);
  win.active = id;
  normalizeLayout(layout);
}
/** Detach `id` into a new floating window at the given box. */
export function floatPanel(layout: DockLayout, id: string, box: { x: number; y: number; w: number; h: number }, nid: string) {
  removeEverywhere(layout, id);
  layout.floats.push({ id: nid, panels: [id], active: id, x: box.x, y: box.y, w: box.w, h: box.h });
  normalizeLayout(layout);
}
/** Ensure `id` is visible: no-op if present, else add as a tab beside `map`
 *  (or the first region) and activate it. Returns true if it added the panel. */
export function showPanel(layout: DockLayout, id: string): boolean {
  if (hasPanel(layout, id)) {
    const t = findTabsWith(layout.root, id);
    if (t) t.active = id;
    else { const f = layout.floats.find((w) => w.panels.indexOf(id) >= 0); if (f) f.active = id; }
    return false;
  }
  const target = findTabsWith(layout.root, "map") ?? firstTabs(layout.root);
  target.panels.push(id);
  target.active = id;
  return true;
}
export function closePanel(layout: DockLayout, id: string) {
  removeEverywhere(layout, id);
  normalizeLayout(layout);
}

// ---- (de)serialization ----
function num(v: unknown, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
/** Parse persisted/foreign layout data, keeping only `known` panels (each at
 *  most once) and repairing structure. Returns null when nothing usable
 *  survives, so the caller can fall back to the default. */
export function validateLayout(raw: unknown, known: string[]): DockLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const seen = new Set<string>();
  const keep = (arr: unknown): string[] =>
    (Array.isArray(arr) ? arr : []).filter((p): p is string =>
      typeof p === "string" && known.indexOf(p) >= 0 && !seen.has(p)).map((p) => (seen.add(p), p));
  const clean = (n: any): DockNode | null => {
    if (!n || typeof n !== "object") return null;
    if (n.type === "tabs") {
      const panels = keep(n.panels);
      if (!panels.length) return null;
      return { type: "tabs", panels, active: panels.indexOf(n.active) >= 0 ? n.active : panels[0] };
    }
    if (n.type === "split" && (n.dir === "row" || n.dir === "col")) {
      const kids: DockNode[] = [];
      const sizes: number[] = [];
      (Array.isArray(n.children) ? n.children : []).forEach((c: any, i: number) => {
        const r = clean(c);
        if (r) { kids.push(r); sizes.push(num(Array.isArray(n.sizes) ? n.sizes[i] : 1, 1)); }
      });
      return kids.length ? { type: "split", dir: n.dir, children: kids, sizes } : null;
    }
    return null;
  };
  const rawObj = raw as any;
  const rootClean = clean(rawObj.root);
  const root = rootClean ? normalize(rootClean) : null;
  if (!root) return null;
  const floats: FloatWin[] = [];
  if (Array.isArray(rawObj.floats)) rawObj.floats.forEach((f: any, i: number) => {
    const panels = keep(f && f.panels);
    if (!panels.length) return;
    floats.push({
      id: typeof f.id === "string" ? f.id : "fl" + i,
      panels, active: panels.indexOf(f.active) >= 0 ? f.active : panels[0],
      x: num(f.x, 80), y: num(f.y, 80), w: num(f.w, 440), h: num(f.h, 320),
    });
  });
  return { root, floats };
}

/** Compact structural rendering for tests/debugging: `row[tabs(a,b*)|tabs(c*)]`.
 *  Active panel in each tabs group is starred. Floats appended as `+float(...)`. */
export function summarize(layout: DockLayout | DockNode): string {
  const node = (n: DockNode): string =>
    n.type === "tabs"
      ? "tabs(" + n.panels.map((p) => (p === n.active ? p + "*" : p)).join(",") + ")"
      : n.dir + "[" + n.children.map(node).join("|") + "]";
  if ("type" in layout) return node(layout);
  let s = node(layout.root);
  for (const f of layout.floats) s += "+float(" + f.panels.map((p) => (p === f.active ? p + "*" : p)).join(",") + ")";
  return s;
}
