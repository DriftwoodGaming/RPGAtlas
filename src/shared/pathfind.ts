/* RPGAtlas — src/shared/pathfind.ts
   Pure A* pathfinding (Phase 5 Stage C). 4-directional over an injected
   passability oracle, Manhattan heuristic, binary-heap open set, and a node
   budget so a fully-walled goal can't stall a frame. Returns the engine's
   route-native step strings ("up"/"down"/"left"/"right"), so results feed
   setRoute() directly. Deterministic: ties expand in push order and
   neighbours are probed in a fixed order, so the same grid always yields
   the same path. GPL-3.0-or-later (see LICENSE). */

export type PassableFn = (x: number, y: number) => boolean;

export interface PathOptions {
  /** Search budget: maximum nodes expanded (default 600). */
  maxNodes?: number;
  /** Accept the reachable tile closest to the goal when the goal itself
   *  can't be reached (touch-to-move semantics). Default false. */
  near?: boolean;
}

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  order: number; // FIFO tie-break for equal f — determinism
  parent: Node | null;
}

/** Neighbour probe order: down, left, right, up (engine dir order 0..3). */
const DIRS: Array<{ dx: number; dy: number; step: string }> = [
  { dx: 0, dy: 1, step: "down" },
  { dx: -1, dy: 0, step: "left" },
  { dx: 1, dy: 0, step: "right" },
  { dx: 0, dy: -1, step: "up" },
];

class Heap {
  items: Node[] = [];
  push(n: Node): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop(): Node | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  get size(): number {
    return this.items.length;
  }
}
function less(a: Node, b: Node): boolean {
  return a.f < b.f || (a.f === b.f && a.order < b.order);
}

/** A* from (fromX,fromY) to (toX,toY). Returns route steps, [] when already
 *  there, or null when unreachable within the budget (with `near`, a path to
 *  the closest reachable tile instead — null only if no progress at all is
 *  possible). The start tile is never tested against `passable` (the mover
 *  is standing on it); the goal tile IS (unless `near`). */
export function findPath(
  passable: PassableFn,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  opts: PathOptions = {},
): string[] | null {
  const maxNodes = Math.max(16, opts.maxNodes || 600);
  if (fromX === toX && fromY === toY) return [];
  const hDist = (x: number, y: number) => Math.abs(x - toX) + Math.abs(y - toY);
  const key = (x: number, y: number) => x + "," + y;

  const open = new Heap();
  const best = new Map<string, number>();
  let order = 0;
  const start: Node = { x: fromX, y: fromY, g: 0, f: hDist(fromX, fromY), order: order++, parent: null };
  open.push(start);
  best.set(key(fromX, fromY), 0);

  let closest: Node = start;
  let closestH = hDist(fromX, fromY);
  let expanded = 0;

  while (open.size && expanded < maxNodes) {
    const cur = open.pop()!;
    if (cur.g > (best.get(key(cur.x, cur.y)) ?? Infinity)) continue; // stale
    expanded++;
    const h = hDist(cur.x, cur.y);
    if (h === 0) return rebuild(cur);
    if (h < closestH) {
      closestH = h;
      closest = cur;
    }
    for (const d of DIRS) {
      const nx = cur.x + d.dx, ny = cur.y + d.dy;
      // every stepped-onto tile must be passable, the goal included — in
      // `near` mode a blocked goal is simply never reached and the caller
      // gets the path to the closest reachable tile instead
      if (!passable(nx, ny)) continue;
      const g = cur.g + 1;
      const k = key(nx, ny);
      if (g >= (best.get(k) ?? Infinity)) continue;
      best.set(k, g);
      open.push({ x: nx, y: ny, g, f: g + hDist(nx, ny), order: order++, parent: cur });
    }
  }
  if (opts.near && closest !== start) return rebuild(closest);
  return null;
}

function rebuild(node: Node): string[] {
  const steps: string[] = [];
  let cur: Node | null = node;
  while (cur && cur.parent) {
    const p: Node = cur.parent;
    if (cur.y > p.y) steps.push("down");
    else if (cur.x < p.x) steps.push("left");
    else if (cur.x > p.x) steps.push("right");
    else steps.push("up");
    cur = p;
  }
  return steps.reverse();
}
