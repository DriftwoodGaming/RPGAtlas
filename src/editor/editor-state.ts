/* RPGAtlas — src/editor/editor-state.ts
   The editor's shared-state seam (Phase 1 Stage C, Package 1).

   The editor monolith was one big IIFE closure sharing mutable variables
   (proj, curMapId, tool state, clipboards, undo stacks, popup state …).
   This module lifts that closure state into one plain exported object so the
   extracted editor modules (map-editor/*, dom, modals, persistence, and the
   later event-editor / database / tools packages) can read and mutate the
   exact same fields the closure vars used to be:

     import { editorState as S } from "./editor-state";
     S.proj, S.curMapId = 2, S.undoStack.push(...)

   No framework, no reactivity: change notification stays what it always was —
   explicit calls (touch(), renderMap(), editorHooks.refreshToolbar(), …).
   `editorHooks` is the one indirection: named slots for functions that still
   live inside the editor.js closure (or in a not-yet-extracted package) but
   are called from extracted modules. editor.js registers its implementations
   at module-evaluation time, before boot() runs. Packages 2/3 shrink this
   registry as the remaining sections become real modules.

   GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createEditorI18n } from "../../js/editor/i18n.js";

// ---- classic-script deps (window.RPGAtlasDeps is populated by the classic
// <script> tags in index.html before the module graph evaluates) ----
export const { Assets, AtlasBuiltins, DataDefaults, GLRender, Music, RA, Sfx } =
  (window as any).RPGAtlasDeps;

// ---- i18n (single shared instance; editor.js used to create this) ----
export const editorI18n = createEditorI18n({
  storage: window.localStorage,
  document,
  browserLocale: navigator.language,
});
export const t = editorI18n.t;

// ---- shared constants (verbatim from the top of the old closure) ----
export const TILE = Assets.TILE;
export const LAYER_ORDER = ["ground", "decor", "decor2", "over"];
export const LAYER_LABELS: Record<string, string> = { auto: "Auto layer", ground: "Layer 1 (Ground)", decor: "Layer 2 (Decor)", decor2: "Layer 3 (Decor 2)", over: "Layer 4 (Overhead)" };
export const TOOL_LABELS: Record<string, string> = { pen: "Pen", erase: "Eraser", rect: "Rectangle", circle: "Circle", fill: "Fill", shadow: "Shadow Pen" };
export const ZOOMS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 1, 1.5, 2];

// ---- the shared mutable editor state (one field per old closure var,
// same names, same initial values) ----
export interface EditorState {
  proj: any;                 // the loaded project document
  curMapId: number;
  layer: string;             // auto | ground | decor | decor2 | over
  tool: string;              // pen | erase | rect | circle | fill | shadow
  mode: string;              // map | event | pass | start | height
  selectedTile: number;
  heightVal: number;         // HD-2D elevation value painted in height mode (0–9)
  zoom: number;
  selectedEvent: any;
  hoverCell: any;
  hoverQuad: number;         // shadow-pen quadrant bit under the cursor
  rectStart: any;            // drag origin for the rect/circle tools
  dragEvent: any;
  dragPushed: boolean;       // undo snapshot taken for the current event drag
  painting: boolean;
  shadowSet: boolean;        // shadow pen: adding (left button) or erasing (right)
  passVal: number;           // passability value being painted during a drag
  selecting: boolean;        // shift-drag marquee in progress
  selAnchor: any;
  selection: any;            // {x1,y1,x2,y2} inclusive (map mode)
  clipTiles: any;            // tile clipboard {w,h,layers,shadows}
  clipEvent: any;            // event clipboard (cloned event)
  clipCmd: any;              // event-command clipboard (array of cloned commands) — shared across event editors
  clipPage: any;             // event-page clipboard (cloned page) — shared across event editors
  pasteMode: null | "tiles" | "event";
  popupMenuEl: any;          // active canvas context menu (menu-drop), or null
  popupSubTimer: any;        // pending submenu-open timer (hover-intent delay), or null
  suppressNextCtxMenu: boolean; // right-click that cancelled a paste shouldn't also open the menu
  undoStack: any[];
  redoStack: any[];
  mapCanvas: any;            // the map <canvas> (assigned in boot)
  mapCtx: any;               // its 2d context (assigned in boot)
  palCanvas: any;            // the palette <canvas> (assigned in boot)
}

export const editorState: EditorState = {
  proj: null,
  curMapId: 1,
  layer: "auto",
  tool: "pen",
  mode: "map",
  selectedTile: 1,
  heightVal: 1,
  zoom: 0.75,
  selectedEvent: null,
  hoverCell: null,
  hoverQuad: 0,
  rectStart: null,
  dragEvent: null,
  dragPushed: false,
  painting: false,
  shadowSet: true,
  passVal: 0,
  selecting: false,
  selAnchor: null,
  selection: null,
  clipTiles: null,
  clipEvent: null,
  clipCmd: null,
  clipPage: null,
  pasteMode: null,
  popupMenuEl: null,
  popupSubTimer: null,
  suppressNextCtxMenu: false,
  undoStack: [],
  redoStack: [],
  mapCanvas: null,
  mapCtx: null,
  palCanvas: null,
};

// ---- derived helper shared by every module (was `curMap()` in the closure) ----
export function curMap() {
  return RA.byId(editorState.proj.maps, editorState.curMapId);
}

// ---- change-notification / cross-boundary hooks ----
// Slots for functions that live in a section that has not been extracted yet
// (still inside src/editor/editor.js) but are called from extracted modules.
// editor.js fills these at module-evaluation time (before boot()). When a
// later package extracts the implementation, the extracted module keeps the
// registration (or callers switch to a direct import and the slot is removed).
export interface EditorHooks {
  refreshToolbar: () => void;                              // actions/toolbar section
  setMode: (m: string) => void;                            // modes/zoom section
  rebuildAll: () => void;                                  // boot/wiring section
  openEventEditor: (ev: any, onCommitNew?: () => void) => void; // event editor (Package 2)
  quickTransfer: (cell: any) => void;                      // quick-event builders (Package 2)
  quickSign: (cell: any) => void;                          // quick-event builders (Package 2)
  quickChest: (cell: any) => void;                         // quick-event builders (Package 2)
  walkCommands: (list: any[], cb: (c: any) => void) => void; // command definitions (Package 2)
}

export const editorHooks = {} as EditorHooks;
