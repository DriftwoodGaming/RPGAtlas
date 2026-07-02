/* RPGAtlas — src/editor/scoped-restore.ts
   Pure core of the unified undo's scoped snapshots (Phase 3 Stage F).
   A "scope" names a live container inside the project document (the whole
   project minus its maps for the Database dialog, one map object for Map
   Properties). cloneScoped captures its JSON state; restoreScoped writes a
   captured state back INTO the same live container in place, recursively, so
   every object/array reference other modules hold (S.proj, S.proj.items, a
   map's layers) survives an undo. No imports — unit-tested in isolation.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ScopeSpec {
  label: string;        // Edit-menu / tooltip descriptor ("Database edit")
  get(): any;           // the LIVE container the scope covers (array or object)
  skip?: string[];      // top-level keys left untouched (["maps"] for the project scope)
  refresh?(): void;     // UI redraw after an undo/redo restores this scope
}

// JSON round-trip clone — same semantics as RA.clone (drops undefined, plain data only).
const clone = (v: any) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/** Snapshot the scope's current data (skipped keys excluded). */
export function cloneScoped(scope: ScopeSpec): any {
  const src = scope.get();
  if (!scope.skip || !scope.skip.length || Array.isArray(src)) return clone(src);
  const out: any = {};
  for (const k of Object.keys(src)) if (!scope.skip.includes(k)) out[k] = src[k];
  return clone(out);
}

/** Cheap structural equality for the commit-time "did anything change" check. */
export function sameScoped(a: any, b: any) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Write a captured snapshot back into the scope's live container, in place. */
export function restoreScoped(scope: ScopeSpec, data: any) {
  restoreInto(scope.get(), clone(data), scope.skip || []);
}

/** Recursive in-place restore: arrays are replaced wholesale; objects keep
    their identity — extra keys deleted, shared keys descended into, the rest
    assigned. `skip` applies to the top level only. */
export function restoreInto(target: any, data: any, skip: string[] = []) {
  if (Array.isArray(target)) {
    target.length = 0;
    target.push(...data);
    return;
  }
  for (const k of Object.keys(target)) {
    if (!skip.includes(k) && !(k in data)) delete target[k];
  }
  for (const k of Object.keys(data)) {
    if (skip.includes(k)) continue;
    const t = target[k], d = data[k];
    if (t && d && typeof t === "object" && typeof d === "object" &&
        Array.isArray(t) === Array.isArray(d)) {
      restoreInto(t, d);
    } else {
      target[k] = d;
    }
  }
}
