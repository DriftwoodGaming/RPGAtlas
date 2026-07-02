/* RPGAtlas — src/shared/world-graph.ts
   Pure world-view graph core (Phase 3 Stage E). Given the project's maps, it
   walks every event's Transfer-Player commands (recursing into if/choices
   branches, exactly like the editor's walkCommands / map-delete dangling scan)
   and aggregates them into a directed connection graph: one node per map, one
   edge per ordered (from → to) pair with a hit count. `autoLayout` assigns a
   deterministic bird's-eye grid position to every node (BFS-layered by
   connected component, ordered by id), so the World View can draw a stable map
   without any persisted position — and `retargetEdge` rewrites the transfer
   commands behind one edge when the user drags it to a new map.

   No imports: this is the unit-tested core the editor-only World View panel
   (src/editor/map-editor/world-view.ts) renders. It never mutates a map except
   through retargetEdge, and reads only the shape the schema already guarantees.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface WorldTransfer {
  fromMapId: number;
  toMapId: number;
  x: number;
  y: number;
  dir?: number;
  eventId?: number;
  eventName?: string;
}

export interface WorldNode {
  id: number;
  name: string;
  width: number;
  height: number;
}

export interface WorldEdge {
  from: number;
  to: number;
  count: number;
}

export interface WorldGraph {
  nodes: WorldNode[];
  edges: WorldEdge[];
  /** transfers that target a map id not present in `nodes` (broken links). */
  dangling: WorldTransfer[];
}

export interface Vec2 { x: number; y: number; }

// Depth-first walk of a command list, recursing into if/choices/loop branches.
// Kept local (no editor dependency) so this module stays pure & testable.
function walk(list: any, cb: (c: any) => void): void {
  for (const c of list || []) {
    cb(c);
    if (c && c.t === "if") { walk(c.then, cb); walk(c.else, cb); }
    else if (c && c.t === "choices") for (const b of c.branches || []) walk(b, cb);
    else if (c && c.t === "loop") walk(c.body, cb);
  }
}

/** Every Transfer-Player command reachable from `map`'s events, tagged with the
 *  source map id and the event it lives on. */
export function collectTransfers(map: any): WorldTransfer[] {
  const out: WorldTransfer[] = [];
  if (!map || !Array.isArray(map.events)) return out;
  for (const ev of map.events) {
    const cmds = (ev.pages || []).flatMap((pg: any) => (pg && pg.commands) || []);
    walk(cmds, (c: any) => {
      if (c && c.t === "transfer") {
        out.push({
          fromMapId: map.id,
          toMapId: Number(c.mapId),
          x: Number(c.x) || 0,
          y: Number(c.y) || 0,
          dir: c.dir,
          eventId: ev.id,
          eventName: ev.name,
        });
      }
    });
  }
  return out;
}

/** Build the directed map-connection graph. Edges aggregate transfers by the
 *  ordered (from,to) pair; self-transfers (from === to) are collected as
 *  transfers but never produce an edge (they'd just be a loop on one node).
 *  Transfers whose target map is absent land in `dangling`. */
export function buildWorldGraph(maps: any[]): WorldGraph {
  const list = Array.isArray(maps) ? maps : [];
  const nodes: WorldNode[] = list.map((m) => ({
    id: m.id, name: m.name || "", width: m.width || 0, height: m.height || 0,
  }));
  const known = new Set(nodes.map((n) => n.id));
  const edgeKey = (a: number, b: number) => a + "→" + b;
  const edgeMap = new Map<string, WorldEdge>();
  const dangling: WorldTransfer[] = [];
  for (const m of list) {
    for (const tr of collectTransfers(m)) {
      if (!known.has(tr.toMapId)) { dangling.push(tr); continue; }
      if (tr.toMapId === tr.fromMapId) continue; // self-loop: skip as an edge
      const k = edgeKey(tr.fromMapId, tr.toMapId);
      const e = edgeMap.get(k);
      if (e) e.count++;
      else edgeMap.set(k, { from: tr.fromMapId, to: tr.toMapId, count: 1 });
    }
  }
  return { nodes, edges: [...edgeMap.values()], dangling };
}

/** Deterministic bird's-eye layout: each connected component is laid out in
 *  BFS layers (column = distance from the component's lowest-id root, ordered
 *  within a layer by node id); components stack vertically. Positions are in
 *  grid cells (integer col,row). Absent nodes ⇒ empty map. */
export function autoLayout(graph: WorldGraph): Record<number, Vec2> {
  const pos: Record<number, Vec2> = {};
  const ids = graph.nodes.map((n) => n.id).sort((a, b) => a - b);
  if (!ids.length) return pos;

  // Undirected adjacency for component discovery + BFS.
  const adj = new Map<number, Set<number>>();
  for (const id of ids) adj.set(id, new Set());
  for (const e of graph.edges) {
    if (adj.has(e.from) && adj.has(e.to)) {
      adj.get(e.from)!.add(e.to);
      adj.get(e.to)!.add(e.from);
    }
  }

  const seen = new Set<number>();
  let rowBase = 0;
  for (const root of ids) {
    if (seen.has(root)) continue;
    // BFS from this component root, bucketed by depth (column).
    const depth = new Map<number, number>();
    depth.set(root, 0);
    seen.add(root);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift()!;
      const nexts = [...adj.get(cur)!].sort((a, b) => a - b);
      for (const nx of nexts) {
        if (seen.has(nx)) continue;
        seen.add(nx);
        depth.set(nx, depth.get(cur)! + 1);
        queue.push(nx);
      }
    }
    // Column buckets, each ordered by id → stable rows.
    const cols = new Map<number, number[]>();
    for (const [id, d] of depth) {
      if (!cols.has(d)) cols.set(d, []);
      cols.get(d)!.push(id);
    }
    let maxRows = 0;
    for (const [d, members] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
      members.sort((a, b) => a - b);
      members.forEach((id, r) => { pos[id] = { x: d, y: rowBase + r }; });
      maxRows = Math.max(maxRows, members.length);
    }
    rowBase += maxRows; // stack the next component below this one
  }
  return pos;
}

/** Rewrite the map behind an edge: every Transfer command in `fromMap` that
 *  targets `oldToId` is retargeted to `newToId`. Mutates `fromMap` in place and
 *  returns the number of commands changed. Used by drag-to-relink. */
export function retargetEdge(fromMap: any, oldToId: number, newToId: number): number {
  let changed = 0;
  if (!fromMap || !Array.isArray(fromMap.events)) return 0;
  for (const ev of fromMap.events) {
    const cmds = (ev.pages || []).flatMap((pg: any) => (pg && pg.commands) || []);
    walk(cmds, (c: any) => {
      if (c && c.t === "transfer" && Number(c.mapId) === oldToId) {
        c.mapId = newToId;
        changed++;
      }
    });
  }
  return changed;
}
