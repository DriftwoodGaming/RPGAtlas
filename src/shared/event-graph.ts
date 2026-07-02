/* RPGAtlas — src/shared/event-graph.ts
   Atlas Graph pure core (Phase 4 Stage A): the node-graph IR helpers, the
   deterministic graph → command-list compiler, the command-list → graph
   decompiler ("convert page to graph"), and validation.

   The design keystone is the After port: if/choices/loop nodes carry one
   extra exec output meaning "what runs after the branch completes", which
   maps 1:1 onto "the commands following the branch command in its parent
   list". Compilation is therefore structured (no join-detection heuristics)
   and decompile(commands) → compile is an identity round-trip, proven in
   tests-unit/event-graph.test.ts.

   Merges (two ports targeting one node) compile by tail duplication — the
   shared tail is emitted once per path. A per-path visit stack rejects true
   cycles ("use a Loop node") and an output-size guard rejects pathological
   diamond stacks; both surface as validation errors and compileGraph then
   returns commands: [] (callers keep the last good compile).

   Pure: no DOM, no editor imports. Copyright (C) 2026 RPGAtlas contributors —
   GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AnyCommand, EventGraph, GraphNode } from "./schema";

export interface GraphIssue {
  level: "error" | "warning";
  msg: string;
  nodeId?: number;
}

export interface CompileResult {
  commands: AnyCommand[];
  issues: GraphIssue[];
}

/** Hard ceiling on compiled output size: merges duplicate tails, so a stack
 *  of diamonds could explode exponentially — this converts that into a
 *  validation error instead of a hung editor. */
export const COMPILE_LIMIT = 4096;

const clone = (v: any) => JSON.parse(JSON.stringify(v));

// ============================ ports ============================

/** Labels of a node's exec output ports, in `out`-array order. */
export function outPortLabels(n: GraphNode): string[] {
  if (n.kind === "comment") return [];
  if (n.kind === "reroute") return ["Next"];
  const c: any = n.cmd || {};
  if (c.t === "if") return ["Then", "Else", "After"];
  if (c.t === "choices") {
    const opts = (c.options || []).map((o: any, i: number) => String(o || "Choice " + (i + 1)));
    return opts.concat(["After"]);
  }
  if (c.t === "loop") return ["Body", "After"];
  return ["Next"];
}

/** Resize n.out to match its port labels (after editing a Choices node's
 *  options, for example), preserving surviving connections. */
export function normalizeOut(n: GraphNode): void {
  const want = outPortLabels(n).length;
  if (!Array.isArray(n.out)) n.out = [];
  while (n.out.length < want) n.out.push(null);
  n.out.length = want;
}

// ============================ graph edits (pure) ============================

export function emptyGraph(): EventGraph {
  return { nodes: [], entry: null, nextId: 1 };
}

/** Create + insert a node. `cmd` null makes a comment/reroute via `kind`. */
export function addNode(
  g: EventGraph, cmd: AnyCommand | null, x: number, y: number,
  kind?: "cmd" | "comment" | "reroute",
): GraphNode {
  const n: GraphNode = { id: g.nextId++, x, y, out: [] };
  if (kind && kind !== "cmd") n.kind = kind;
  if (cmd) n.cmd = cmd;
  if (n.kind === "comment") n.text = "";
  normalizeOut(n);
  g.nodes.push(n);
  return n;
}

export function getNode(g: EventGraph, id: number | null): GraphNode | undefined {
  return id == null ? undefined : g.nodes.find((n) => n.id === id);
}

/** Wire fromId's port `port` at toId (or null to disconnect). Wiring into a
 *  comment is refused (comments are never executed). */
export function connect(g: EventGraph, fromId: number, port: number, toId: number | null): boolean {
  const from = getNode(g, fromId);
  if (!from || port < 0 || port >= outPortLabels(from).length) return false;
  if (toId != null) {
    const to = getNode(g, toId);
    if (!to || to.kind === "comment") return false;
  }
  normalizeOut(from);
  from.out[port] = toId;
  return true;
}

/** Remove a node. Single-output nodes heal the flow: every reference to the
 *  deleted node is retargeted to its own single continuation; branch nodes
 *  (if/choices/loop) sever their references instead. */
export function deleteNode(g: EventGraph, id: number): void {
  const n = getNode(g, id);
  if (!n) return;
  const labels = outPortLabels(n);
  const heal: number | null = labels.length === 1 ? (n.out[0] ?? null) : null;
  const retarget = (v: number | null) => (v === id ? (heal === id ? null : heal) : v);
  g.entry = retarget(g.entry);
  for (const m of g.nodes) m.out = m.out.map(retarget);
  g.nodes = g.nodes.filter((m) => m.id !== id);
}

// ============================ compile ============================

class CompileAbort extends Error {}

/** Compile a graph into an event-command list. Deterministic: the walk
 *  follows entry → Next/After chains, branch ports fill the branch command's
 *  own nested arrays. On error (cycle/overflow) returns commands: [] with
 *  the error in issues — callers keep their last good compile. */
export function compileGraph(g: EventGraph): CompileResult {
  const issues: GraphIssue[] = [];
  const byId = new Map<number, GraphNode>();
  for (const n of g.nodes) byId.set(n.id, n);
  let emitted = 0;
  const path = new Set<number>(); // cmd nodes on the current DFS stack

  // Follow a port target through reroute dots to the next real command node.
  function resolve(id: number | null | undefined, hops = 0): GraphNode | null {
    if (id == null) return null;
    const n = byId.get(id);
    if (!n) {
      issues.push({ level: "warning", msg: "A connection points at a deleted node", nodeId: id });
      return null;
    }
    if (n.kind === "comment") return null; // never wired in the UI; ignore defensively
    if (n.kind === "reroute") {
      if (hops > g.nodes.length) {
        issues.push({ level: "error", msg: "Reroute dots form a cycle", nodeId: n.id });
        throw new CompileAbort();
      }
      return resolve(n.out[0], hops + 1);
    }
    return n;
  }

  function compileChain(startId: number | null | undefined): AnyCommand[] {
    const out: AnyCommand[] = [];
    const added: number[] = [];
    let node = resolve(startId);
    while (node) {
      const cur = node; // stable binding for the closures below
      if (path.has(cur.id)) {
        issues.push({ level: "error", msg: "Cycle detected — repeat flow with a Loop node instead", nodeId: cur.id });
        throw new CompileAbort();
      }
      if (++emitted > COMPILE_LIMIT) {
        issues.push({ level: "error", msg: "Compiled output exceeds " + COMPILE_LIMIT + " commands (merge fan-out?)", nodeId: cur.id });
        throw new CompileAbort();
      }
      path.add(cur.id);
      added.push(cur.id);
      const c: any = clone(cur.cmd || { t: "script", code: "" });
      let next: number | null | undefined;
      if (c.t === "if") {
        c.then = compileChain(cur.out[0]);
        c.else = compileChain(cur.out[1]);
        next = cur.out[2];
      } else if (c.t === "choices") {
        c.branches = (c.options || []).map((_o: any, i: number) => compileChain(cur.out[i]));
        next = cur.out[(c.options || []).length];
      } else if (c.t === "loop") {
        c.body = compileChain(cur.out[0]);
        next = cur.out[1];
      } else {
        next = cur.out[0];
      }
      out.push(c);
      node = resolve(next);
    }
    for (const id of added) path.delete(id); // pop this chain off the DFS stack
    return out;
  }

  try {
    const commands = compileChain(g.entry);
    return { commands, issues };
  } catch (e) {
    if (e instanceof CompileAbort) return { commands: [], issues };
    throw e;
  }
}

// ============================ validate ============================

/** Compile issues + graph-only lint: no-entry, unreachable nodes, stray
 *  Break Loop nodes outside any Body chain (checked structurally is compile
 *  territory; here we flag the cheap graph-shape problems). */
export function validateGraph(g: EventGraph): GraphIssue[] {
  const { issues } = compileGraph(g);
  const cmdNodes = g.nodes.filter((n) => !n.kind || n.kind === "cmd");
  if (g.entry == null && cmdNodes.length) {
    issues.push({ level: "error", msg: "Nothing is connected to Start — the page runs no commands" });
  }
  // Reachability over raw edges (independent of compile aborts).
  const reach = new Set<number>();
  const stack: (number | null)[] = [g.entry];
  while (stack.length) {
    const id = stack.pop();
    if (id == null || reach.has(id)) continue;
    const n = g.nodes.find((m) => m.id === id);
    if (!n) continue;
    reach.add(id);
    for (const o of n.out) stack.push(o);
  }
  for (const n of g.nodes) {
    if (n.kind === "comment") continue;
    if (!reach.has(n.id)) {
      issues.push({ level: "warning", msg: "Unreachable node (not connected to Start)", nodeId: n.id });
    }
  }
  return issues;
}

// ============================ decompile ============================

// Auto-layout grid (stage px). Chains flow right; branches stack downward.
export const GRID_X = 260;
export const GRID_Y = 120;
export const GRID_MARGIN = 40;

interface Block { first: number | null; rows: number; cols: number; }

/** Convert a classic command list into a graph ("convert page to graph").
 *  Tree-shaped by construction, positioned on a deterministic grid, and
 *  lossless: compileGraph(decompileCommands(cmds)).commands deep-equals cmds. */
export function decompileCommands(commands: AnyCommand[]): EventGraph {
  const g = emptyGraph();

  function build(list: AnyCommand[], col: number, row: number): Block {
    let first: number | null = null;
    let prev: GraphNode | null = null;
    let prevPort = 0;
    let rows = 0;
    let c0 = col;
    for (const src of list || []) {
      const c: any = clone(src);
      let sub: { branches: AnyCommand[][]; ports: number } | null = null;
      if (c.t === "if") { sub = { branches: [c.then || [], c.else || []], ports: 2 }; c.then = []; c.else = []; }
      else if (c.t === "choices") { sub = { branches: c.branches || [], ports: (c.options || []).length }; c.branches = (c.options || []).map(() => []); }
      else if (c.t === "loop") { sub = { branches: [c.body || []], ports: 1 }; c.body = []; }
      const n = addNode(g, c, GRID_MARGIN + c0 * GRID_X, GRID_MARGIN + row * GRID_Y);
      if (prev) prev.out[prevPort] = n.id;
      else first = n.id;
      let cols = 1;
      let myRows = 1;
      if (sub) {
        let bRow = row + 1; // branches start one row below their branch node
        for (let i = 0; i < sub.ports; i++) {
          const b = build(sub.branches[i] || [], c0 + 1, bRow);
          n.out[i] = b.first;
          bRow += Math.max(b.rows, 1);
          cols = Math.max(cols, 1 + b.cols);
        }
        myRows = 1 + (bRow - (row + 1));
        prevPort = sub.ports; // the After port
      } else {
        prevPort = 0;
      }
      prev = n;
      c0 += cols;
      rows = Math.max(rows, myRows);
    }
    return { first, rows, cols: c0 - col };
  }

  const top = build(commands || [], 0, 0);
  g.entry = top.first;
  return g;
}
