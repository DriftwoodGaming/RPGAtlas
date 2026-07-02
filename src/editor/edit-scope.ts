/* RPGAtlas — src/editor/edit-scope.ts
   Scoped-snapshot transactions for the unified undo (Phase 3 Stage F).
   A dialog that edits shared project data (Database, Map Properties) begins a
   scope on open and ends it on close. While a scope is active every touch()
   notes an edit; a debounced commit then diffs the scope's data against the
   baseline captured when the window opened (edits mutate BEFORE touch() runs,
   so the baseline must be taken eagerly, not at first change) and pushes one
   tagged {scope, before} entry onto the same stack as the map snapshots.
   Function-only import cycle with map-editor/history.ts (same pattern as
   workspace ↔ help): history pushes/undoes entries, this module owns the
   active-transaction state.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */

import { type ScopeSpec, cloneScoped, sameScoped } from "./scoped-restore";
import { pushScopedUndo } from "./map-editor/history";

const COMMIT_MS = 800; // idle time that closes one undoable edit window

let active: ScopeSpec | null = null;
let baseline: unknown = null;   // scope state at window start (pre-edit)
let timer: ReturnType<typeof setTimeout> | null = null;
let suppressed = false;         // an undo/redo restore is mutating the scope

export function activeEditScope() { return active; }

/** A scoped dialog opened: baseline its data for the first edit window. */
export function beginEdit(scope: ScopeSpec) {
  commitEdit();
  active = scope;
  baseline = cloneScoped(scope);
}

/** The dialog closed: flush any pending window, then deactivate. */
export function endEdit() {
  commitEdit();
  active = null;
  baseline = null;
}

/** Called from touch(): a project edit landed — extend the debounced window. */
export function noteEdit() {
  if (!active || suppressed) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(commitEdit, COMMIT_MS);
}

/** Close the current edit window into one undo entry (no-op if unchanged).
    Also called by undo()/redo() so pending typing is undoable immediately.
    Always diffs while a scope is active — never gated on whether touch()
    fired — because dialogs may mutate first and only touch() after close()
    (Map Properties' OK handler does exactly that). */
export function commitEdit() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!active) return;
  const now = cloneScoped(active);
  if (sameScoped(baseline, now)) return;
  pushScopedUndo(active, baseline);
  baseline = now;
}

/** Run an undo/redo restore without noting its mutations as new edits. */
export function withEditsSuppressed(fn: () => void) {
  suppressed = true;
  try { fn(); } finally { suppressed = false; }
}

/** After a restore changed data an active scope covers, re-baseline it so the
    next edit window diffs against what is now on screen. */
export function resyncEditBaseline() {
  if (!active) return;
  baseline = cloneScoped(active);
}
