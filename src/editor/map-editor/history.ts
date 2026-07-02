/* RPGAtlas — src/editor/map-editor/history.ts
   Unified undo / redo (Phase 3 Stage F). One stack, two entry kinds:
     kind "map"   — full map snapshots {layers, shadows, passOv, heights,
                    events}, exactly the pre-Stage-F behavior;
     kind "scope" — scoped snapshots pushed by edit-scope.ts transactions
                    (Database / Map Properties dialogs): the scope's data as
                    it was BEFORE the edit window, restored in place.
   undo()/redo() dispatch on the tag; every entry carries a short label the
   Edit menu / toolbar tooltips surface ("Undo — Paint", "Undo — Database
   edit"). The import cycle with edit-scope.ts is function-only (safe, same
   pattern as workspace ↔ help).
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, editorState as S } from "../editor-state";
import { touch } from "../persistence";
import { renderMap } from "./map-render";
import { heightsOf } from "./painting";
import { rebuildMapList } from "./map-list";
import { flashStatus } from "./status";
import { refreshToolbar } from "../workspace";
import { commitEdit, withEditsSuppressed, resyncEditBaseline } from "../edit-scope";
import { type ScopeSpec, cloneScoped, restoreScoped } from "../scoped-restore";

const STACK_MAX = 60;

  // ---- map snapshots (tiles, shadows, passability, heights, events) ----
  export function snapshotOf(mapId: any, label?: string) {
    const m = RA.byId(S.proj.maps, mapId);
    return { kind: "map", label: label || "Map edit", mapId, layers: RA.clone(m.layers), shadows: m.shadows.slice(), passOv: m.passOv.slice(), heights: heightsOf(m).slice(), events: RA.clone(m.events) };
  }
  export function applySnapshot(s: any) {
    const m = RA.byId(S.proj.maps, s.mapId);
    if (!m) return;
    m.layers = s.layers; m.shadows = s.shadows; m.passOv = s.passOv; m.heights = s.heights; m.events = s.events;
    if (S.curMapId !== s.mapId) { S.curMapId = s.mapId; rebuildMapList(); }
    S.selectedEvent = null;
    touch(); renderMap(); refreshToolbar();
  }
  export function pushUndo(label?: string) {
    S.undoStack.push(snapshotOf(S.curMapId, label));
    if (S.undoStack.length > STACK_MAX) S.undoStack.shift();
    S.redoStack.length = 0;
    refreshToolbar();
  }

  // ---- scoped snapshots (Database / Map Properties transactions) ----
  export function pushScopedUndo(scope: ScopeSpec, data: any) {
    S.undoStack.push({ kind: "scope", label: scope.label, scope, data });
    if (S.undoStack.length > STACK_MAX) S.undoStack.shift();
    S.redoStack.length = 0;
    refreshToolbar();
  }
  function applyScoped(e: any) {
    // The restore mutates data the active scope may cover — suppress noteEdit
    // so the undo itself doesn't open a new edit window, then re-baseline.
    withEditsSuppressed(() => {
      restoreScoped(e.scope, e.data);
      touch();
    });
    resyncEditBaseline();
    if (e.scope.refresh) e.scope.refresh();
    refreshToolbar();
  }

  // ---- the unified stack ----
  function captureOf(e: any) {
    return e.kind === "scope"
      ? { kind: "scope", label: e.label, scope: e.scope, data: cloneScoped(e.scope) }
      : snapshotOf(e.mapId, e.label);
  }
  function applyEntry(e: any) {
    if (e.kind === "scope") applyScoped(e); else applySnapshot(e);
  }
  /** Label of the entry the next undo/redo would apply ("" when empty). */
  export function undoTopLabel() {
    return S.undoStack.length ? S.undoStack[S.undoStack.length - 1].label || "" : "";
  }
  export function redoTopLabel() {
    return S.redoStack.length ? S.redoStack[S.redoStack.length - 1].label || "" : "";
  }
  export function undo() {
    commitEdit(); // pending scoped typing becomes the top entry first
    const u = S.undoStack.pop();
    if (!u) { flashStatus("Nothing to undo"); return; }
    S.redoStack.push(captureOf(u));
    applyEntry(u);
  }
  export function redo() {
    commitEdit(); // a fresh scoped edit invalidates redo (commit clears it)
    const r = S.redoStack.pop();
    if (!r) { flashStatus("Nothing to redo"); return; }
    S.undoStack.push(captureOf(r));
    applyEntry(r);
  }
