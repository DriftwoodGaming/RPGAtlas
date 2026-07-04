/* RPGAtlas — src/shared/automap.ts
   Visual automapping (Phase 8 Stage F): a PURE evaluator that turns a map + a
   list of IF/AND/THEN rules into a flat list of cell edits, plus an apply pass
   that writes those edits back into the map. Shared so the Advanced editor's
   Automap drawer and the unit tests exercise ONE implementation — no DOM, no
   editor state.

   The whole feature is editor-only: rules live on map.automapRules but the
   engine never reads them, so a map with rules exports byte-identically. The
   author presses Preview (renders the diff as an overlay) or Apply (commits the
   edits as one labelled undo entry); both call evaluateAutomap so what you
   preview is exactly what you apply.

   Determinism: probability rolls come from a seeded RNG (mulberry32) keyed per
   rule, and cells are visited row-major, so a given (map, rules, seed) always
   yields the identical edit list — the Stage F exit's "previews, applies, and
   undoes as one step" guarantee. Rules are evaluated against the ORIGINAL map
   (a later rule never reads an earlier rule's edits), so ordering is stable and
   the whole batch is one atomic diff; when two edits touch the same target cell
   the later one wins.

   Tile id note: stored tile values may carry Stage-E transform flag bits
   (28–30), so every id comparison masks with tileId() first — a flipped grass
   tile still satisfies `terrainIs grass`.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import type { AutomapRule, RulePredicate, RuleAction, Stamp, AdvLayer } from "./schema";
import { tileId } from "./tile-flags";
import { CORE_ROLES, type CoreRole } from "./layer-view";
import { mulberry32 } from "./rng";

/** The subset of a map the evaluator reads/writes (both editor GameMap and the
 *  fixture maps in the tests satisfy this). */
export interface AutomapMap {
  width: number;
  height: number;
  layers: Record<CoreRole, number[]>;
  /** generalized stack (Phase 8 Stage B); used to resolve numeric layer ids. */
  layersAdv?: AdvLayer[];
  /** region tag per tile (Phase 5); absent ⇒ all-zero. */
  regions?: number[];
  /** passability override per tile: 0=auto 1=force-pass 2=force-block. */
  passOv?: number[];
}

export interface AutomapOptions {
  /** proj.stamps — needed to expand a `placeStamp` action into tile writes. */
  stamps?: Stamp[];
  /** engine-accurate passability for the `passable` predicate. When absent the
   *  evaluator falls back to passOv only (2 ⇒ blocked, else passable) so the
   *  pure core stays testable without the tile-def table. */
  passableAt?: (x: number, y: number) => boolean;
  /** overrides each rule's own `seed` when set (the editor passes one so a
   *  re-roll shuffles every rule together). */
  seed?: number;
}

/** A single resolved cell edit. `role` (a core layer) or `layerId` (a generalized
 *  tile layer) names the target for a tile write; `region` names a region write. */
export interface AutomapEdit {
  type: "tile" | "region";
  x: number;
  y: number;
  /** tile writes: the destination layer (exactly one of role / layerId). */
  role?: CoreRole;
  layerId?: number;
  /** tile writes: the value to store. */
  tile?: number;
  /** region writes: the region tag to store. */
  region?: number;
}

// ---------------------------------------------------------------- RNG --------
// mulberry32 lives in ./rng.ts (shared with the engine's seedable rnd/rndf).

/** Stable per-rule seed: the caller's seed (or the rule's own, or a fixed
 *  default) mixed with the rule id, so distinct rules in one batch draw from
 *  independent streams while a single rule stays reproducible. */
function seedFor(rule: AutomapRule, opts: AutomapOptions): number {
  const base = opts.seed ?? rule.seed ?? 0x9e3779b9;
  return (base ^ Math.imul(rule.id | 0, 2654435761)) >>> 0;
}

// -------------------------------------------------------- layer access -------

const CORE_KEY_RE = /^core:(ground|decor|decor2|over)$/;

/** Resolve a predicate/action layer selector to a live tile array + its target
 *  descriptor. "core:ground" / a role name → the role array; a numeric id → the
 *  matching generalized layer (core ⇒ role array, tile ⇒ its own data). null if
 *  the id names nothing (e.g. a deleted layer). */
function resolveLayer(
  map: AutomapMap,
  sel: number | string,
): { arr: number[]; role?: CoreRole; layerId?: number } | null {
  if (typeof sel === "string") {
    const mm = CORE_KEY_RE.exec(sel);
    const role = (mm ? mm[1] : sel) as CoreRole;
    if ((CORE_ROLES as string[]).includes(role)) return { arr: map.layers[role], role };
    return null;
  }
  // numeric id → walk the generalized stack (groups included).
  const found = findAdvLayer(map.layersAdv, sel);
  if (!found) return null;
  if (found.type === "core") return { arr: map.layers[found.role], role: found.role };
  if (found.type === "tile") return { arr: found.data, layerId: found.id };
  return null; // a group is not a paint target
}

function findAdvLayer(layers: AdvLayer[] | undefined, id: number): AdvLayer | null {
  if (!layers) return null;
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "group") {
      const hit = findAdvLayer(l.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

// -------------------------------------------------------- predicates ---------

function regionAt(map: AutomapMap, i: number): number {
  return (map.regions && map.regions[i]) || 0;
}

/** Is any ground cell within Chebyshev `radius` (excluding the centre) equal to
 *  `terrain` (masked)? Backs `near` / `notNear`. */
function hasNearTerrain(map: AutomapMap, x: number, y: number, terrain: number, radius: number): boolean {
  const want = tileId(terrain);
  const r = Math.max(1, radius | 0);
  const ground = map.layers.ground;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      if (tileId(ground[ny * map.width + nx]) === want) return true;
    }
  }
  return false;
}

function testPredicate(map: AutomapMap, p: RulePredicate, x: number, y: number, opts: AutomapOptions): boolean {
  const i = y * map.width + x;
  switch (p.kind) {
    case "terrainIs":
      return tileId(map.layers.ground[i]) === tileId(p.terrain);
    case "tileIs": {
      const L = resolveLayer(map, p.layerId);
      if (!L) return false;
      return tileId(L.arr[i]) === tileId(p.tile);
    }
    case "near":
      return hasNearTerrain(map, x, y, p.terrain, p.radius);
    case "notNear":
      return !hasNearTerrain(map, x, y, p.terrain, p.radius);
    case "regionIs":
      return regionAt(map, i) === p.region;
    case "passable": {
      const pass = opts.passableAt
        ? opts.passableAt(x, y)
        : ((map.passOv && map.passOv[i]) || 0) !== 2;
      return pass === p.value;
    }
    default:
      return false;
  }
}

/** All predicates ANDed (an empty `if` matches every cell — an intentional
 *  "apply everywhere" escape hatch). */
function cellMatches(map: AutomapMap, rule: AutomapRule, x: number, y: number, opts: AutomapOptions): boolean {
  const preds = rule.if || [];
  for (const p of preds) if (!testPredicate(map, p, x, y, opts)) return false;
  return true;
}

// ---------------------------------------------------------- actions ----------

function prob(a: { probability?: number }): number {
  const p = a.probability;
  return typeof p === "number" ? Math.min(1, Math.max(0, p)) : 1;
}

/** Emit the edits for one matched cell. Probability rolls pull from `rng` so the
 *  whole pass is deterministic given the rule's seed. */
function actionEdits(
  map: AutomapMap,
  action: RuleAction,
  x: number,
  y: number,
  rng: () => number,
  opts: AutomapOptions,
  out: AutomapEdit[],
): void {
  switch (action.kind) {
    case "placeTile": {
      if (rng() >= prob(action)) return;
      const L = resolveLayer(map, action.layerId);
      if (!L) return;
      out.push({ type: "tile", x, y, tile: action.tile, ...(L.role ? { role: L.role } : { layerId: L.layerId }) });
      break;
    }
    case "placeStamp": {
      if (rng() >= prob(action)) return;
      const stamp = (opts.stamps || []).find((s) => s.id === action.stampId);
      if (!stamp) return;
      // Expand the stamp (core-role tile arrays) into per-cell tile writes,
      // non-empty cells only, clipped to the map — same rule as writeStampData.
      for (let dy = 0; dy < stamp.h; dy++) {
        for (let dx = 0; dx < stamp.w; dx++) {
          const tx = x + dx, ty = y + dy;
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue;
          const si = dy * stamp.w + dx;
          for (const role of CORE_ROLES) {
            const arr = stamp.layers[role];
            if (!arr) continue;
            const v = arr[si];
            if (v) out.push({ type: "tile", x: tx, y: ty, role, tile: v });
          }
        }
      }
      break;
    }
    case "setRegion":
      out.push({ type: "region", x, y, region: action.region });
      break;
  }
}

// --------------------------------------------------------- evaluate ----------

export interface AutomapResult {
  edits: AutomapEdit[];
  /** number of distinct target cells touched (for the status line). */
  changed: number;
}

/** Evaluate every enabled rule against `map` and return the collected edits.
 *  Pure: `map` is only read. Later edits to the same (type, cell, layer) win, so
 *  the returned list is already de-duplicated to what Apply would leave behind. */
export function evaluateAutomap(map: AutomapMap, rules: AutomapRule[] | undefined, opts: AutomapOptions = {}): AutomapResult {
  const raw: AutomapEdit[] = [];
  for (const rule of rules || []) {
    if (rule.enabled === false) continue;
    if (!rule.then || !rule.then.length) continue;
    const rng = mulberry32(seedFor(rule, opts));
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!cellMatches(map, rule, x, y, opts)) continue;
        for (const action of rule.then) actionEdits(map, action, x, y, rng, opts, raw);
      }
    }
  }
  // Last-wins de-dupe by target key.
  const byKey = new Map<string, AutomapEdit>();
  for (const e of raw) {
    const key = e.type === "region"
      ? `r:${e.x},${e.y}`
      : `t:${e.x},${e.y},${e.role ?? "L" + e.layerId}`;
    byKey.set(key, e);
  }
  return { edits: [...byKey.values()], changed: byKey.size };
}

// ----------------------------------------------------------- apply -----------

/** Write the evaluated edits into `map` in place. Region writes materialize a
 *  zero-filled `regions` array on first use (same shape the region tools keep).
 *  The editor takes a whole-map undo snapshot before calling this, so the batch
 *  reverts as one step. Returns the number of cells actually changed. */
export function applyAutomapEdits(map: AutomapMap, edits: AutomapEdit[]): number {
  let n = 0;
  for (const e of edits) {
    if (e.type === "region") {
      if (!map.regions || map.regions.length !== map.width * map.height) {
        map.regions = new Array(map.width * map.height).fill(0);
      }
      map.regions[e.y * map.width + e.x] = e.region ?? 0;
      n++;
      continue;
    }
    const arr = e.role ? map.layers[e.role] : resolveLayer(map, e.layerId as number)?.arr;
    if (!arr) continue;
    arr[e.y * map.width + e.x] = e.tile ?? 0;
    n++;
  }
  return n;
}
