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
import {
  registerDockPanel, initDock, setDockChangeHook,
  focusPanel, togglePanel, isPanelVisible, focusNextPanel,
  resetLayout, saveNamedLayout, loadNamedLayout, listNamedLayouts, deleteNamedLayout,
} from "./dock";

export function initDockWorkspace() {
  registerDockPanel({ id: "maps", title: "Maps", el: $("panel-maps"), closable: true });
  registerDockPanel({ id: "tiles", title: "Tiles", el: $("panel-tiles"), closable: true });
  registerDockPanel({ id: "map", title: "Map", el: $("panel-map"), closable: false });

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
