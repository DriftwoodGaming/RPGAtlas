/* RPGAtlas — src/editor/database/index.ts
   The Database modal shell: the left vertical tab rail (.dbtabs-vert) and the
   tab list (dbTabs). Each tab's builder lives in its own module; this file
   assembles them and owns the modal open/close (rebuilding the map list &
   re-rendering the map on close, since edits can change names/graphics).
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA } from "../editor-state";
import { h } from "../dom";
import { modal } from "../modals";
import { renderMap } from "../map-editor/map-render";
import { rebuildMapList } from "../map-editor/map-list";
import { systemTab, controlsTab } from "./system-tab";
import { actorsTab, classesTab, skillsTab, enemiesTab, statesTab } from "./battler-tabs";
import { itemsTab, weaponsTab, armorsTab, troopsTab, commonEventsTab } from "./item-tabs";
import { questsTab } from "./quests-tab";
import { tilesetTab } from "./tilesets-tab";
import { typesTab, nameListTab } from "./types-tab";

function dbTabs() {
  return [
    { label: "System", build: systemTab },
    { label: "Controls", build: controlsTab },
    { label: "Actors", build: actorsTab },
    { label: "Classes", build: classesTab },
    { label: "Skills", build: skillsTab },
    { label: "Items", build: itemsTab },
    { label: "Weapons", build: weaponsTab },
    { label: "Armors", build: armorsTab },
    { label: "Enemies", build: enemiesTab },
    { label: "Troops", build: troopsTab },
    { label: "Common Events", build: commonEventsTab },
    { label: "Quests", build: questsTab },
    { label: "States", build: statesTab },
    { label: "Tilesets", build: () => tilesetTab() },
    { label: "Types", build: () => typesTab() },
    { label: "Switches", build: () => nameListTab("switches", "S", RA.MAX_SWITCHES) },
    { label: "Variables", build: () => nameListTab("variables", "V", RA.MAX_VARIABLES) },
  ];
}

export function openDatabase() {
  const tabs = dbTabs();
  const tabBar = h("div", { class: "dbtabs-vert" });
  const body = h("div", { class: "dbbody" });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- tracks the active tab; verbatim from the monolith (never read back)
  let cur = 0;
  function show(i: any) {
    cur = i;
    tabBar.querySelectorAll("button").forEach((b: any, bi: any) => b.classList.toggle("sel", bi === i));
    body.innerHTML = "";
    body.appendChild(tabs[i].build());
  }
  tabs.forEach((t, i) => tabBar.appendChild(h("button", { onclick: () => show(i) }, t.label)));
  const content = h("div", { class: "dbwrap" }, tabBar, body);
  modal({ title: "Database", content, wide: true, class: "db-modal", dismissable: false,
    buttons: [{ label: "Close", primary: true, onClick(c: any) { c(); rebuildMapList(); renderMap(); } }] });
  show(0);
}
