/* RPGAtlas — src/editor/dock/panels.ts
   Dock-workspace wiring (Phase 3 Stage B): registers the built-in panels
   (Maps / Tiles / Map — the existing editor DOM, relocated out of #panel-store
   by the dock engine), registers the dock/panel operations as editor commands
   (so the menus, the command palette, and keyboard shortcuts all reach them for
   free), and boots the dock. boot.ts calls initDockWorkspace() before the
   menubar is built, so the "View" menu's command ids already exist.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { $, h } from "../dom";
import { modal } from "../modals";
import { registerCommand, refreshToolbar } from "../workspace";
import { flashStatus } from "../map-editor/status";
import { mountViewport, VIEWPORT_PANEL } from "../map-editor/hd-viewport";
import { mountWorldView, WORLD_PANEL } from "../map-editor/world-view";
import { mountConsole, CONSOLE_PANEL } from "../console/console-panel";
import { mountAdvanced, ADV_PANEL, captureStampCommand, toggleStampRandom, stampRandomActive } from "../advanced/adv-panel";
import { openTerrainStudio } from "../advanced/terrain-studio";
import { flipBrushH, flipBrushV, rotateBrush, advFocus } from "../advanced/adv-transform";
import {
  registerDockPanel, initDock, setDockChangeHook,
  focusPanel, togglePanel, isPanelVisible, focusNextPanel, getFocusedPanel,
  resetLayout, saveNamedLayout, loadNamedLayout, listNamedLayouts, deleteNamedLayout,
} from "./dock";

export function initDockWorkspace() {
  registerDockPanel({ id: "maps", title: "Maps", el: $("panel-maps"), closable: true });
  registerDockPanel({ id: "tiles", title: "Tiles", el: $("panel-tiles"), closable: true });
  registerDockPanel({ id: "map", title: "Map", el: $("panel-map"), closable: false });
  // The live HD-2D viewport (Stage C) mounts lazily — its WebGL canvas is only
  // built the first time the panel is shown (F2 / the View menu).
  registerDockPanel({ id: VIEWPORT_PANEL, title: "HD-2D", mount: mountViewport, closable: true });
  // The World View (Stage E) — the map-connection graph — also mounts lazily.
  registerDockPanel({ id: WORLD_PANEL, title: "World", mount: mountWorldView, closable: true });
  // The Console (post-1.0) — first tab of the map region, lazy-mounted; the
  // power-user command line over the same operations the menus drive.
  registerDockPanel({ id: CONSOLE_PANEL, title: "Console", mount: mountConsole, closable: true });
  // The Advanced Map Editor (Phase 8) — Tiled-class mapping over the same
  // document as the Map panel; lazy-mounted like HD-2D/World/Console.
  registerDockPanel({ id: ADV_PANEL, title: "Advanced", mount: mountAdvanced, closable: true });

  // Keep menu check-marks live after a panel is toggled/closed by drag.
  setDockChangeHook(refreshToolbar);

  registerCommand("panel-maps", {
    label: "Maps Panel", tip: "Show or hide the map-list panel",
    active: () => isPanelVisible("maps"), run: () => togglePanel("maps"),
  });
  registerCommand("panel-tiles", {
    label: "Tiles Panel", tip: "Show or hide the tile-palette panel",
    active: () => isPanelVisible("tiles"), run: () => togglePanel("tiles"),
  });
  registerCommand("panel-map", {
    label: "Focus Map", tip: "Focus the map view panel", run: () => focusPanel("map"),
  });
  registerCommand("panel-console", {
    label: "Console Panel", tip: "Show or hide the Console — type commands to inspect, build, and playtest",
    active: () => isPanelVisible(CONSOLE_PANEL), run: () => togglePanel(CONSOLE_PANEL),
  });
  registerCommand("panel-advanced", {
    label: "Advanced Map Editor", key: "F4",
    tip: "Show or hide the Advanced Map Editor — generalized layers, terrain, zones, and automapping over this same map",
    active: () => isPanelVisible(ADV_PANEL), run: () => togglePanel(ADV_PANEL),
  });
  registerCommand("terrain-studio", {
    label: "Terrain & Autotile Studio…",
    tip: "Turn a sheet into a terrain brush — pick the arrangement, animate water, add variations, preview live",
    run: () => openTerrainStudio(),
  });
  // Advanced-editor brush transforms (Stage E). Key bindings in boot.ts fire
  // only while the Advanced panel is focused (advFocus); the palette/menus reach
  // them anywhere. advFocus is bound here so boot's key table stays dock-free.
  advFocus.isFocused = () => getFocusedPanel() === ADV_PANEL;
  registerCommand("adv-flip-h", {
    label: "Flip Brush Horizontal", key: "X",
    tip: "Flip the paint brush left-to-right (Advanced editor; plain tiles)",
    run: flipBrushH,
  });
  registerCommand("adv-flip-v", {
    label: "Flip Brush Vertical", key: "Y",
    tip: "Flip the paint brush top-to-bottom (Advanced editor; plain tiles)",
    run: flipBrushV,
  });
  registerCommand("adv-rotate", {
    label: "Rotate Brush 90°", key: "R",
    tip: "Rotate the paint brush 90° clockwise (Advanced editor; plain tiles)",
    run: rotateBrush,
  });
  registerCommand("adv-capture-stamp", {
    label: "Save Selection as Stamp…",
    tip: "Save the current tile selection as a reusable stamp (select an area in the Map editor first)",
    run: captureStampCommand,
  });
  registerCommand("adv-stamp-random", {
    label: "Random Stamp Scatter",
    tip: "Toggle random-scatter placement for the armed stamp",
    active: () => stampRandomActive(), run: toggleStampRandom,
  });
  registerCommand("focus-next-panel", {
    label: "Focus Next Panel", key: "F6", tip: "Move keyboard focus to the next panel", run: focusNextPanel,
  });
  registerCommand("dock-reset", {
    label: "Reset Panel Layout", tip: "Restore the default workspace arrangement",
    run: () => { resetLayout(); flashStatus("Workspace layout reset to default"); },
  });
  registerCommand("dock-save", {
    label: "Save Layout As…", tip: "Save the current panel arrangement under a name", run: saveLayoutDialog,
  });
  registerCommand("dock-load", {
    label: "Saved Layouts…", tip: "Load or delete a saved panel arrangement", run: loadLayoutDialog,
  });

  initDock($("dock-root"));
}

function saveLayoutDialog() {
  const input = h("input", { type: "text", placeholder: "Layout name", style: "width:100%", spellcheck: "false" }) as HTMLInputElement;
  const m = modal({
    title: "Save Layout As",
    content: h("div", null, h("p", { class: "dim", style: "margin:0 0 8px" }, "Name this workspace arrangement so you can restore it later."), input),
    buttons: [
      { label: "Save", primary: true, onClick(c: any) {
        const name = input.value.trim();
        if (!name) return;
        saveNamedLayout(name);
        c();
        flashStatus("Saved layout “" + name + "”");
      } },
      { label: "Cancel" },
    ],
    dialogKeys: true,
  });
  setTimeout(() => input.focus(), 0);
  return m;
}

function loadLayoutDialog() {
  const names = listNamedLayouts();
  const body = h("div", { class: "dock-layout-list" });
  const rebuild = () => {
    body.innerHTML = "";
    const current = listNamedLayouts();
    if (!current.length) { body.appendChild(h("p", { class: "dim" }, "No saved layouts yet. Use “Save Layout As…” first.")); return; }
    for (const name of current) {
      body.appendChild(h("div", { class: "dock-layout-row" },
        h("span", { class: "dll-name" }, name),
        h("span", { class: "dll-btns" },
          h("button", { onclick() { loadNamedLayout(name); m.close(); flashStatus("Loaded layout “" + name + "”"); } }, "Load"),
          h("button", { class: "danger", onclick() { deleteNamedLayout(name); rebuild(); } }, "Delete"))));
    }
  };
  rebuild();
  const m = modal({ title: "Saved Layouts", content: body, buttons: [{ label: "Close" }] });
  void names;
  return m;
}
