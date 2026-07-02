/* RPGAtlas — src/editor/boot.ts
   The editor composition root: loads/creates the project, wires the palette and
   map-canvas events, installs the global keyboard map, and boots the workspace.
   This is the last piece of the old editor.js closure; main.ts imports it.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts. rebuildAll,
   setMode, and refreshToolbar are now direct imports/exports rather than the
   editorHooks slots the earlier packages used.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  Assets, DataDefaults, RA, TILE, editorI18n, editorState as S, editorHooks,
} from "./editor-state";
import { $ } from "./dom";
import { modalRoot } from "./modals";
import { loadStored, saveNow, importProject } from "./persistence";
import { renderMap, renderPalette } from "./map-editor/map-render";
import { undo, redo } from "./map-editor/history";
import { copySelection, startPaste, clearSelection } from "./map-editor/clipboard";
import { setStatus } from "./map-editor/status";
import { rebuildMapList, addMap, deleteMap, openMapGenProps } from "./map-editor/map-list";
import {
  deleteSelectedEvent, openCanvasMenu,
  onCanvasDown, onCanvasMove, onCanvasUp, onCanvasDbl,
} from "./map-editor/painting";
import {
  buildMenubar, buildToolbar, refreshToolbar, runAct,
  setMode, setTool, setLayer, setZoom, zoomStep, cycleMode,
  closeMenus, isMenuOpen,
} from "./workspace";
import { openKeyboardShortcuts } from "./help";
import { dispatchKey, type KeyBinding } from "./keymap";
import { initDockWorkspace } from "./dock/panels";

// The editor's global key bindings (Phase 3 Stage A). This table replaces the
// old hardcoded keydown cascade one branch per binding, IN ORDER — the order
// is load-bearing (height digits above layer digits above the zoom reset; the
// bare {ctrl:true} barrier reproduces "an unmatched Ctrl chord still swallows
// the event"). Command `key` strings in workspace.ts are display-only; THIS
// table is the execution truth.
const mapMode = () => S.mode === "map";
const mapOrHeight = () => S.mode === "map" || S.mode === "height";
const EDITOR_KEYS: KeyBinding[] = [
  { codes: ["Escape"], run() {
    if (isMenuOpen()) { closeMenus(); return; }
    if (S.pasteMode || S.selection) { clearSelection(); return; }
    if (S.selectedEvent) { S.selectedEvent = null; renderMap(); refreshToolbar(); }
  } },
  { key: "?", ctrl: false, preventDefault: true, run: () => openKeyboardShortcuts() },
  // Mode cycle (always available). Tab forward, Shift+Tab back. Skip when Ctrl/Meta held.
  { codes: ["Tab"], ctrl: false, preventDefault: true, run: (e) => cycleMode(e.shiftKey ? -1 : 1) },
  // Ctrl/Meta chords
  { codes: ["KeyZ"], ctrl: true, preventDefault: true, run: () => undo() },
  { codes: ["KeyY"], ctrl: true, preventDefault: true, run: () => redo() },
  { codes: ["KeyX"], ctrl: true, preventDefault: true, run: () => copySelection(true) },
  { codes: ["KeyC"], ctrl: true, preventDefault: true, run: () => copySelection(false) },
  { codes: ["KeyV"], ctrl: true, preventDefault: true, run: () => startPaste() },
  { codes: ["KeyS"], ctrl: true, preventDefault: true, run: () => runAct("save") },
  { codes: ["KeyP"], ctrl: true, preventDefault: true, run: () => runAct("cmdpal") }, // Ctrl+Shift+P too (shift: don't care)
  { ctrl: true, run() {} }, // barrier: unmatched Ctrl chords never fall through
  // Application shortcuts — global (any mode). F1/F5 override the browser's Help/Reload.
  { codes: ["F1"], preventDefault: true, run: () => runAct("db") },
  { codes: ["F2"], preventDefault: true, run: () => runAct("hdpreview") },
  { codes: ["F5"], preventDefault: true, run: () => runAct("play") },
  { codes: ["F6"], preventDefault: true, run: () => runAct("focus-next-panel") },
  // Height mode consumes ALL digits for the painted elevation (0–9). Must stay above the layer gate.
  { codes: ["Digit0", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"],
    when: () => S.mode === "height",
    run(e) { S.heightVal = Number(e.code.slice(5)); setStatus(); } },
  // Tools (Map or Height mode)
  { codes: ["KeyQ"], when: mapOrHeight, run: () => setTool("pen") },
  { codes: ["KeyW"], when: mapOrHeight, run: () => setTool("erase") },
  { codes: ["KeyE"], when: mapOrHeight, run: () => setTool("rect") },
  { codes: ["KeyR"], when: mapOrHeight, run: () => setTool("circle") },
  { codes: ["KeyT"], when: mapOrHeight, run: () => setTool("fill") },
  { codes: ["KeyY"], when: mapOrHeight, run: () => setTool("shadow") },
  // Layers (Map mode)
  { codes: ["Backquote"], when: mapMode, run: () => setLayer("auto") },
  { codes: ["Digit1"], when: mapMode, run: () => setLayer("ground") },
  { codes: ["Digit2"], when: mapMode, run: () => setLayer("decor") },
  { codes: ["Digit3"], when: mapMode, run: () => setLayer("decor2") },
  { codes: ["Digit4"], when: mapMode, run: () => setLayer("over") },
  // View / selection
  { codes: ["Equal", "NumpadAdd"], run: () => zoomStep(1) },
  { codes: ["Minus", "NumpadSubtract"], run: () => zoomStep(-1) },
  { codes: ["Digit0", "Numpad0"], run: () => setZoom(1) }, // reset to 100% (height mode consumes Digit0 above)
  { codes: ["Delete", "Backspace"], when: () => S.mode === "event", run: () => deleteSelectedEvent() },
];

export function rebuildAll() {
  if (!RA.byId(S.proj.maps, S.curMapId)) S.curMapId = S.proj.maps[0].id;
  rebuildMapList();
  renderPalette();
  renderMap();
  refreshToolbar();
  setStatus();
}

async function boot() {
  S.proj = loadStored() || DataDefaults.newProject();
  Assets.registerCustomChars(S.proj.customChars);
  await Promise.all([Assets.loadIconSet(), Assets.loadExternalAssets(S.proj)]);
  S.mapCanvas = $("mapcanvas");
  S.mapCtx = S.mapCanvas.getContext("2d");
  S.palCanvas = $("palette");

  editorI18n.localizeStatic();
  // Build the dockable workspace (registers the View-menu commands the menubar
  // references) before the menubar/toolbar are built.
  initDockWorkspace();
  buildMenubar();
  buildToolbar();

  // palette
  S.palCanvas.addEventListener("mousedown", (e: any) => {
    const r = S.palCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / TILE), y = Math.floor((e.clientY - r.top) / TILE);
    const id = y * Assets.PALETTE_COLS + x;
    if (id >= 0 && Assets.tiles[id]) { S.selectedTile = id; renderPalette(); setStatus(); }
  });
  S.palCanvas.addEventListener("mousemove", (e: any) => {
    const r = S.palCanvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / TILE), y = Math.floor((e.clientY - r.top) / TILE);
    const id = y * Assets.PALETTE_COLS + x;
    S.palCanvas.title = Assets.tiles[id] ? Assets.tiles[id].name : "";
  });

  // map canvas
  S.mapCanvas.addEventListener("mousedown", onCanvasDown);
  S.mapCanvas.addEventListener("mousemove", onCanvasMove);
  window.addEventListener("mouseup", onCanvasUp);
  S.mapCanvas.addEventListener("dblclick", onCanvasDbl);
  S.mapCanvas.addEventListener("contextmenu", (e: any) => {
    e.preventDefault();
    if (S.suppressNextCtxMenu) { S.suppressNextCtxMenu = false; return; }
    if (S.mode === "event") openCanvasMenu(e);
  });
  S.mapCanvas.addEventListener("mouseleave", () => { S.hoverCell = null; S.hoverQuad = 0; renderMap(); });

  // ctrl+wheel zooms around the cursor
  $("mapscroll").addEventListener("wheel", (e: any) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = $("mapscroll").getBoundingClientRect();
    zoomStep(e.deltaY < 0 ? 1 : -1, { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });

  $("import-file").addEventListener("change", (e: any) => {
    if (e.target.files[0]) importProject(e.target.files[0]);
    e.target.value = "";
  });
  $("map-add").addEventListener("click", addMap);
  $("map-del").addEventListener("click", deleteMap);
  $("map-gen").addEventListener("click", openMapGenProps);

  document.addEventListener("keydown", (e: any) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if (modalRoot().children.length) return;
    dispatchKey(EDITOR_KEYS, e);
  });

  setTool("pen");
  setLayer("auto");
  setMode("map");
  rebuildAll();
  saveNow();
}

// The "new" action (workspace.ts) and project import (persistence.ts) rebuild
// everything; register our impl in the one remaining editorHooks slot.
editorHooks.rebuildAll = rebuildAll;

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
