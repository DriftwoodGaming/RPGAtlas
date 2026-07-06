/* RPGAtlas — src/editor/map-editor/clipboard.ts
   Tile / event clipboard: copy, cut, paste, selection.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 1):
   logic unchanged, closure vars routed through editor-state.ts; setMode and
   refreshToolbar are imported directly from workspace.ts (function-only cycle —
   workspace binds copy/cut/paste/deselect to actions; safe).
   Copyright (C) 2026 RPGAtlas contributors - GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, LAYER_ORDER, editorState as S, curMap } from "../editor-state";
import { touch } from "../persistence";
import { renderMap } from "./map-render";
import { pushUndo } from "./history";
import { eventAt, heightsOf, shadowsOf } from "./painting";
import { setStatus, flashStatus } from "./status";
import { setMode, refreshToolbar } from "../workspace";

  // ---- clipboard ----
  export function canCopy() {
    return S.mode === "map" ? !!S.selection : S.mode === "event" ? !!S.selectedEvent : false;
  }
  export function copySelection(cut: any) {
    if (S.mode === "event") {
      if (!S.selectedEvent) { flashStatus("Select an event first (click one in Event mode)"); return; }
      S.clipEvent = RA.clone(S.selectedEvent);
      S.clipTiles = null;
      if (cut) {
        pushUndo("Cut event");
        const m = curMap();
        m.events = m.events.filter((ev: any) => ev !== S.selectedEvent);
        S.selectedEvent = null;
        touch(); renderMap();
      }
      flashStatus((cut ? "Event cut" : "Event copied") + " — Paste (Ctrl+V), then click to place");
      refreshToolbar();
      return;
    }
    if (S.mode !== "map" || !S.selection) { flashStatus("Shift+drag on the map to select an area first"); return; }
    const m = curMap(), r = S.selection;
    const w = r.x2 - r.x1 + 1, h2 = r.y2 - r.y1 + 1;
    const clip: any = { w, h: h2, layers: {}, shadows: [], heights: [] };
    for (const ln of LAYER_ORDER) clip.layers[ln] = [];
    const hts = heightsOf(m), shs = shadowsOf(m);
    for (let y = r.y1; y <= r.y2; y++) {
      for (let x = r.x1; x <= r.x2; x++) {
        const i = y * m.width + x;
        for (const ln of LAYER_ORDER) clip.layers[ln].push(m.layers[ln][i]);
        clip.shadows.push(shs[i]);
        clip.heights.push(hts[i] || 0);
      }
    }
    S.clipTiles = clip;
    S.clipEvent = null;
    if (cut) {
      pushUndo("Cut tiles");
      for (let y = r.y1; y <= r.y2; y++) {
        for (let x = r.x1; x <= r.x2; x++) {
          const i = y * m.width + x;
          for (const ln of LAYER_ORDER) m.layers[ln][i] = 0;
          shs[i] = 0;
          heightsOf(m)[i] = 0;
        }
      }
      touch(); renderMap();
    }
    flashStatus((cut ? "Cut " : "Copied ") + w + "×" + h2 + " tiles — Paste (Ctrl+V), then click to stamp");
    refreshToolbar();
  }
  export function startPaste() {
    if (S.clipEvent && (S.mode === "event" || !S.clipTiles)) {
      if (S.mode !== "event") setMode("event");
      S.pasteMode = "event";
    } else if (S.clipTiles) {
      if (S.mode !== "map") setMode("map");
      S.pasteMode = "tiles";
    } else {
      flashStatus("Clipboard is empty — Copy or Cut something first");
      return;
    }
    flashStatus("Click the map to paste (Esc or right-click cancels)");
    refreshToolbar(); renderMap();
  }
  export function stampPaste(cell: any) {
    if (S.pasteMode === "tiles" && S.clipTiles) {
      pushUndo("Paste tiles");
      const m = curMap(), shs = shadowsOf(m);
      for (let dy = 0; dy < S.clipTiles.h; dy++) {
        for (let dx = 0; dx < S.clipTiles.w; dx++) {
          const x = cell.x + dx, y = cell.y + dy;
          if (x >= m.width || y >= m.height) continue;
          const si = dy * S.clipTiles.w + dx, di = y * m.width + x;
          for (const ln of LAYER_ORDER) m.layers[ln][di] = S.clipTiles.layers[ln][si];
          shs[di] = S.clipTiles.shadows[si];
          heightsOf(m)[di] = (S.clipTiles.heights && S.clipTiles.heights[si]) || 0;
        }
      }
      touch(); renderMap();
    } else if (S.pasteMode === "event" && S.clipEvent) {
      if (eventAt(cell.x, cell.y)) { flashStatus("That cell already has an event"); return; }
      pushUndo("Paste event");
      const m = curMap();
      const ev = RA.clone(S.clipEvent);
      ev.id = RA.nextId(m.events);
      ev.x = cell.x; ev.y = cell.y;
      m.events.push(ev);
      S.selectedEvent = ev;
      S.pasteMode = null; // events place one at a time
      touch(); renderMap(); refreshToolbar(); setStatus();
    }
  }
  export function cancelPaste() {
    S.pasteMode = null;
    renderMap(); refreshToolbar(); setStatus();
  }
  export function clearSelection() {
    S.selection = null;
    S.pasteMode = null;
    renderMap(); refreshToolbar(); setStatus();
  }
