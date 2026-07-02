/* RPGAtlas — src/editor/workspace.ts
   The editor workspace chrome: the action registry (ACT), toolbar + menubar
   builders, and the mode/tool/layer/zoom setters. This is the hub the menus,
   toolbar, keyboard shortcuts, and boot wiring all drive.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts. Help/About
   dialogs live in help.ts (imported here for their action bindings); the
   function-only import cycle between the two is safe (help calls back into ACT
   / build* only when a dialog is opened, long after both modules evaluate).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as host from "../../js/editor/host.js";
import {
  Assets, DataDefaults,
  TILE, LAYER_LABELS, TOOL_LABELS, ZOOMS,
  editorI18n, editorState as S, curMap, editorHooks,
} from "./editor-state";
import { $, h } from "./dom";
import { confirmBox } from "./modals";
import {
  touch, saveNow, desktopSave, exportProject, openStandaloneExport,
} from "./persistence";
import { renderMap } from "./map-editor/map-render";
import { undo, redo } from "./map-editor/history";
import { canCopy, copySelection, startPaste, clearSelection } from "./map-editor/clipboard";
import { setStatus, flashStatus } from "./map-editor/status";
import { openMapProps } from "./map-editor/map-list";
import { toggleHdPreview, isHdPreviewOpen } from "./map-editor/hd-preview";
import { ICONS } from "./icons";
import { openDatabase } from "./database";
import { openPluginManager } from "./tools/plugin-manager";
import { openAudioManager } from "./tools/audio-manager";
import { openEventSearcher } from "./tools/event-searcher";
import { openResourceManager } from "./tools/resource-manager";
import { openCharGenerator } from "./tools/character-generator";
import {
  openLanguageSettings, openPatchNotes, openKeyboardShortcuts, openHelp, openAbout,
} from "./help";
import { openCommandPalette } from "./command-palette";

const t = editorI18n.t;

function playtestUrl() { return "play.html?playtest=" + Date.now(); }

// ============================ actions / menus / toolbar ============================
// The command registry (Phase 3 Stage A): every editor capability is a
// registered EditorCommand, so the toolbar, menubar, shortcuts dialog, and the
// command palette all drive one table. Stages B–F (and later plugin/graph
// phases) add their commands through registerCommand.
export interface EditorCommand {
  label: string;              // i18n key; localized via actionLabel()
  icon?: string;
  key?: string;               // display-only key hint ("Ctrl+S") — boot.ts's binding table is the execution truth
  tip?: string;
  enabled?: () => boolean;
  active?: () => boolean;
  run: () => void;
  labelKey?: string;          // set at registration (label/tip are re-localized on language change)
  tipKey?: string;
  btn?: any;                  // toolbar button, when the command is on the toolbar
}
export const ACT: Record<string, EditorCommand> = {};
export function registerCommand(id: string, def: EditorCommand) {
  def.labelKey = def.label;
  def.tipKey = def.tip;
  ACT[id] = def;
}
const act = registerCommand;
export function actionLabel(action: any) { return t(action.labelKey); }
function actionTip(action: any) { return t(action.tipKey || action.labelKey); }
export function runAct(id: any) {
  const a = ACT[id];
  if (!a || (a.enabled && !a.enabled())) return;
  a.run();
  refreshToolbar();
}

act("new", { label: "New Project…", icon: "new", tip: "New project (resets to the bundled sample game)", run() {
  confirmBox("Start a fresh project (the bundled sample game)? Your current project will be replaced — Export first if you want to keep it.", () => {
    S.proj = DataDefaults.newProject();
    Assets.registerCustomChars(S.proj.customChars);
    Assets.bindExternalAssets(S.proj);
    S.curMapId = S.proj.maps[0].id;
    S.selectedEvent = null; S.selection = null; S.pasteMode = null;
    S.undoStack.length = 0; S.redoStack.length = 0;
    editorHooks.rebuildAll(); touch();
  });
} });
act("open", { label: "Open Project (.json)…", icon: "open", tip: "Open / import a project file", run() { $("import-file").click(); } });
act("save", { label: "Save Project", icon: "save", key: "Ctrl+S",
  tip: host.isTauri ? "Save the project to its file" : "Save the project to this browser now",
  run() {
    if (host.isTauri) { desktopSave(false); return; }
    saveNow();
    flashStatus("Project saved to this browser — use File ▸ Export for a backup file");
  } });
act("export", { label: "Export Project As File…", run: exportProject });
act("build", { label: "Export Standalone Game…", run: openStandaloneExport });
act("play", { label: "Playtest", icon: "play", key: "F5", tip: "Save and run the game", run() {
  saveNow();
  if (host.isTauri) {
    host.openPlaytest().catch((e: any) => alert("Could not open play-test window: " + ((e && e.message) || e)));
  } else {
    window.open(playtestUrl(), "rpgatlas_play");
  }
} });
act("mapprops", { label: "Map Properties…", run: openMapProps });
act("hdpreview", { label: "HD-2D Preview", icon: "hd2d", key: "F2", tip: "Toggle the live HD-2D preview panel (uses this map's HD-2D settings)", active: () => isHdPreviewOpen(), run: toggleHdPreview });

act("undo", { label: "Undo", icon: "undo", key: "Ctrl+Z", enabled: () => S.undoStack.length > 0, run: undo });
act("redo", { label: "Redo", icon: "redo", key: "Ctrl+Y", enabled: () => S.redoStack.length > 0, run: redo });
act("cut", { label: "Cut", icon: "cut", key: "Ctrl+X", tip: "Cut the selected area / event", enabled: canCopy, run: () => copySelection(true) });
act("copy", { label: "Copy", icon: "copy", key: "Ctrl+C", tip: "Copy the selected area / event (Shift+drag selects tiles)", enabled: canCopy, run: () => copySelection(false) });
act("paste", { label: "Paste", icon: "paste", key: "Ctrl+V", tip: "Paste — then click the map to place", enabled: () => !!(S.clipTiles || S.clipEvent), run: startPaste });
act("deselect", { label: "Clear Selection", key: "Esc", enabled: () => !!(S.selection || S.pasteMode), run: clearSelection });

act("mode-map", { label: "Map (Tile) Mode", icon: "map", key: "Tab ⇆", tip: "Tile layer — draw the map", active: () => S.mode === "map", run: () => setMode("map") });
act("mode-event", { label: "Event Mode", icon: "event", key: "Tab ⇆", tip: "Event layer — place and edit events", active: () => S.mode === "event", run: () => setMode("event") });
act("mode-pass", { label: "Passability Mode", icon: "pass", key: "Tab ⇆", tip: "Passability — click tiles to cycle auto → ✕ block → ○ pass", active: () => S.mode === "pass", run: () => setMode("pass") });
act("mode-height", { label: "Height Mode (HD-2D)", icon: "height", key: "Tab ⇆",
  tip: "Heights — paint HD-2D elevation with the Pen / Rectangle / Circle / Fill tools (digits 0–9 set the value)",
  active: () => S.mode === "height", run: () => setMode("height") });
act("mode-start", { label: "Set Start Position…", active: () => S.mode === "start", run() {
  setMode("start");
  flashStatus("Click the map to set the player start position");
} });

[["auto", "`"], ["ground", "1"], ["decor", "2"], ["decor2", "3"], ["over", "4"]].forEach(([ln, key]) => {
  act("layer-" + ln, { label: LAYER_LABELS[ln], icon: "layer-" + ln, key,
    active: () => S.layer === ln && S.mode === "map",
    run() { if (S.mode !== "map") setMode("map"); setLayer(ln); } });
});
[["pen", "Q"], ["erase", "W"], ["rect", "E"], ["circle", "R"], ["fill", "T"], ["shadow", "Y"]].forEach(([t, key]) => {
  act("tool-" + t, { label: TOOL_LABELS[t], icon: t, key,
    tip: t === "shadow" ? "Shadow Pen — left paints a shadow quadrant, right erases" : TOOL_LABELS[t],
    active: () => S.tool === t && (S.mode === "map" || S.mode === "height"),
    run() { if (S.mode !== "map" && S.mode !== "height") setMode("map"); setTool(t); } });
});

act("zoomin", { label: "Zoom In", icon: "zoomin", key: "+", run: () => zoomStep(1) });
act("zoomout", { label: "Zoom Out", icon: "zoomout", key: "−", run: () => zoomStep(-1) });
act("zoom1", { label: "Zoom 1:1", icon: "zoom1", key: "0", tip: "Set zoom to 100%", active: () => Math.abs(S.zoom - 1) < 0.01, run: () => setZoom(1) });
act("zoomfit", { label: "Fit Map In View", run: () => zoomFit() });

act("db", { label: "Database…", icon: "db", key: "F1", tip: "Database — actors, items, enemies, switches…", run: openDatabase });
act("plugins", { label: "Plugin Manager…", icon: "plugins", tip: "Plugin Manager — project JavaScript run at game boot", run: openPluginManager });
act("audio", { label: "Audio Manager…", icon: "audio", tip: "Audio Manager — preview sounds and music", run: openAudioManager });
act("search", { label: "Event Searcher…", icon: "search", tip: "Event Searcher — find text / switches / variables across maps", run: openEventSearcher });
act("resources", { label: "Resource Manager…", icon: "resources", tip: "Resource Manager — browse and export generated assets", run: openResourceManager });
act("chargen", { label: "Character Generator…", icon: "chargen", tip: "Character Generator — build original walking sprites", run: openCharGenerator });
act("cmdpal", { label: "Command Palette…", key: "Ctrl+P", tip: "Search and run any editor command", run: openCommandPalette });
act("language", { label: "Interface Language…", run: openLanguageSettings });
act("patchnotes", { label: "Patch Notes", run: openPatchNotes });
act("shortcuts", { label: "Keyboard Shortcuts…", key: "?", run: openKeyboardShortcuts });
act("help", { label: "Quick Help", run: openHelp });
act("about", { label: "About RPGAtlas", run: openAbout });

const TOOLBAR = [
  ["new", "open", "save"],
  ["cut", "copy", "paste"],
  ["undo", "redo"],
  ["mode-map", "mode-event", "mode-pass", "mode-height"],
  ["layer-auto", "layer-ground", "layer-decor", "layer-decor2", "layer-over"],
  ["tool-pen", "tool-erase", "tool-rect", "tool-circle", "tool-fill", "tool-shadow"],
  ["zoomin", "zoomout", "zoom1"],
  ["db", "plugins", "audio", "search", "resources", "chargen"],
  ["hdpreview", "play"],
];
export function buildToolbar() {
  const bar = $("toolbar");
  bar.innerHTML = "";
  TOOLBAR.forEach((group, gi) => {
    if (gi) bar.appendChild(h("span", { class: "tb-sep" }));
    for (const id of group) {
      const a = ACT[id];
      const btn = h("button", {
        class: "tbtn" + (id === "play" ? " play-btn" : ""),
        title: actionTip(a) + (a.key ? "  (" + a.key + ")" : ""),
        onclick: () => runAct(id),
      });
      btn.innerHTML = (a.icon && ICONS[a.icon]) || "";
      if (id === "play") btn.appendChild(document.createTextNode(actionLabel(a)));
      a.btn = btn;
      bar.appendChild(btn);
    }
  });
}
export function refreshToolbar() {
  for (const id of Object.keys(ACT)) {
    const a = ACT[id];
    if (!a.btn) continue;
    a.btn.classList.toggle("sel", !!(a.active && a.active()));
    a.btn.disabled = !!(a.enabled && !a.enabled());
  }
}

const MENUS = [
  { label: "File", items: ["new", "open", "save", "export", "build", "-", "play"] },
  { label: "Edit", items: ["undo", "redo", "-", "cut", "copy", "paste", "-", "deselect"] },
  { label: "Mode", items: ["mode-map", "mode-event", "mode-pass", "mode-height", "-", "mode-start"] },
  { label: "Draw", items: ["tool-pen", "tool-erase", "tool-rect", "tool-circle", "tool-fill", "tool-shadow"] },
  { label: "Layer", items: ["layer-auto", "layer-ground", "layer-decor", "layer-decor2", "layer-over"] },
  { label: "Scale", items: ["zoomin", "zoomout", "zoom1", "zoomfit"] },
  { label: "View", items: ["panel-maps", "panel-tiles", "panel-map", "-", "focus-next-panel", "-", "dock-reset", "dock-save", "dock-load"] },
  { label: "Tools", items: ["db", "plugins", "audio", "search", "resources", "chargen", "-", "cmdpal"] },
  { label: "Game", items: ["play", "build", "-", "mapprops", "hdpreview", "mode-start"] },
  { label: "Help", items: ["language", "-", "shortcuts", "patchnotes", "help", "about"] },
];
// Palette feed: every registered command with its localized label, key hint,
// and a category derived from MENUS membership (first menu containing the id
// wins; commands on no menu get "Other") — one source of truth for grouping.
export interface CommandEntry {
  id: string;
  label: string;      // localized
  category: string;   // localized menu label
  key?: string;
  enabled: boolean;
}
export function commandEntries(): CommandEntry[] {
  const category: Record<string, string> = {};
  for (const menu of MENUS) {
    for (const it of menu.items) {
      if (it !== "-" && !(it in category)) category[it] = menu.label;
    }
  }
  return Object.keys(ACT).map((id) => {
    const a = ACT[id];
    return {
      id,
      label: actionLabel(a),
      category: t(category[id] || "Other"),
      key: a.key,
      enabled: !(a.enabled && !a.enabled()),
    };
  });
}

let menuOpenRef: any = null;
let menuDismissBound = false;
export function closeMenus() {
  if (!menuOpenRef) return;
  menuOpenRef.drop.remove();
  menuOpenRef.lab.classList.remove("open");
  menuOpenRef = null;
}
export function isMenuOpen() { return !!menuOpenRef; }
function openMenuFor(menu: any, lab: any) {
  closeMenus();
  const drop = h("div", { class: "menu-drop" });
  for (const it of menu.items) {
    if (it === "-") { drop.appendChild(h("div", { class: "menu-sep" })); continue; }
    const a = ACT[it];
    const dis = !!(a.enabled && !a.enabled());
    drop.appendChild(h("div", {
      class: "menu-item" + (dis ? " disabled" : ""),
      onclick() { if (dis) return; closeMenus(); a.run(); refreshToolbar(); },
    },
      h("span", { class: "mi-check" }, a.active && a.active() ? "✓" : ""),
      h("span", { class: "mi-label" }, actionLabel(a)),
      a.key ? h("span", { class: "mi-key" }, a.key) : null));
  }
  const r = lab.getBoundingClientRect();
  drop.style.left = r.left + "px";
  drop.style.top = (r.bottom + 2) + "px";
  document.body.appendChild(drop);
  lab.classList.add("open");
  menuOpenRef = { drop, lab };
}
export function buildMenubar() {
  const nav = $("menus");
  nav.innerHTML = "";
  for (const menu of MENUS) {
    const lab = h("span", { class: "menu-label" }, t(menu.label));
    lab.addEventListener("mousedown", (e: any) => {
      e.preventDefault(); e.stopPropagation();
      if (menuOpenRef && menuOpenRef.lab === lab) closeMenus();
      else openMenuFor(menu, lab);
    });
    lab.addEventListener("mouseenter", () => {
      if (menuOpenRef && menuOpenRef.lab !== lab) openMenuFor(menu, lab);
    });
    nav.appendChild(lab);
  }
  if (!menuDismissBound) {
    document.addEventListener("mousedown", (e: any) => {
      if (menuOpenRef && !menuOpenRef.drop.contains(e.target)) closeMenus();
    });
    menuDismissBound = true;
  }
}

// ============================ modes / zoom ============================
export function setMode(m: any) {
  S.mode = m;
  S.selectedEvent = null;
  S.pasteMode = null;
  renderMap(); refreshToolbar(); setStatus();
}
const MODE_CYCLE = ["map", "event", "pass", "height"]; // "start" intentionally excluded
export function cycleMode(dir: any) {
  let i = MODE_CYCLE.indexOf(S.mode);
  if (i < 0) i = 0; // "start"/unexpected -> enter at "map"
  const n = MODE_CYCLE.length;
  setMode(MODE_CYCLE[(i + dir + n) % n]);
}
export function setTool(t: any) {
  S.tool = t;
  renderMap(); refreshToolbar(); setStatus();
}
export function setLayer(l: any) {
  S.layer = l;
  renderMap(); refreshToolbar(); setStatus();
}
export function setZoom(z: any, pivot?: any) {
  z = Math.max(0.15, Math.min(3, z));
  const sc = $("mapscroll");
  const px = pivot ? pivot.x : sc.clientWidth / 2;
  const py = pivot ? pivot.y : sc.clientHeight / 2;
  const wx = (sc.scrollLeft + px - 14) / S.zoom;  // 14 = #mapscroll padding
  const wy = (sc.scrollTop + py - 14) / S.zoom;
  S.zoom = z;
  renderMap();
  sc.scrollLeft = wx * S.zoom + 14 - px;
  sc.scrollTop = wy * S.zoom + 14 - py;
  setStatus(); refreshToolbar();
}
export function zoomStep(d: any, pivot?: any) {
  let best = 0, bd = Infinity;
  ZOOMS.forEach((z: any, i: any) => { const dd = Math.abs(z - S.zoom); if (dd < bd) { bd = dd; best = i; } });
  setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, best + d))], pivot);
}
export function zoomFit() {
  const m = curMap(), sc = $("mapscroll");
  if (!m) return;
  setZoom(Math.min((sc.clientWidth - 30) / (m.width * TILE), (sc.clientHeight - 30) / (m.height * TILE), 1.5));
}
