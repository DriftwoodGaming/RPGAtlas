/* RPGAtlas — src/editor/event-editor/quick-events.ts
   Quick-event builders: place a Sign/Transfer/Chest event from a single small
   dialog without opening the full event editor.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 2):
   logic unchanged, closure vars routed through editor-state.ts; the toolbar
   refresh is imported directly from workspace.ts (Package 3 owns actions/
   toolbar; one-way edge — workspace does not import quick-events).
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { DataDefaults, RA, editorState as S, curMap } from "../editor-state";
import { h, sel, nIn, field, row, dbOpts, DIR_OPTS } from "../dom";
import { modal } from "../modals";
import { touch } from "../persistence";
import { renderMap } from "../map-editor/map-render";
import { refreshToolbar } from "../workspace";
import { pushUndo } from "../map-editor/history";
import { eventAt } from "../map-editor/painting";
import { flashStatus } from "../map-editor/status";
import { editCommand } from "./command-defs";
import { openLocationPicker } from "./location-picker";

  // ---- quick-event builders ----
  // Build a page from the defaults, merging cond onto (not over) the default cond.
  function mkPage(opts: any, commands: any) {
    const p = DataDefaults.newPage();
    opts = opts || {};
    if (opts.cond) Object.assign(p.cond, opts.cond);
    for (const k in opts) if (k !== "cond") p[k] = opts[k];
    p.commands = commands || [];
    return p;
  }
  function placeQuickEvent(cell: any, name: any, pages: any) {
    if (eventAt(cell.x, cell.y)) { flashStatus("That cell already has an event"); return null; }
    pushUndo("Quick event");
    const ev = DataDefaults.newEvent(RA.nextId(curMap().events), cell.x, cell.y, name);
    ev.pages = pages;
    curMap().events.push(ev);
    S.selectedEvent = ev;
    touch(); renderMap(); refreshToolbar();
    return ev;
  }
  export function quickSign(cell: any) {
    if (eventAt(cell.x, cell.y)) { flashStatus("That cell already has an event"); return; }
    // Like Transfer/Chest: collect the content in a small dialog (here, the Show Text editor),
    // then build & place the event — no detour through the full event editor.
    const c = { t: "text", name: "", face: "", text: "" };
    // editCommand(cmd, onOK, skipSnapshot, snapFn, onCancel): skip the editor's own undo snapshot
    // (placeQuickEvent pushes one) and, on Cancel, do nothing so no empty event is left behind.
    editCommand(c, () => {
      placeQuickEvent(cell, "Sign", [
        mkPage({ charset: "sign", trigger: "action" }, [c]),
      ]);
    }, true, null, () => {});
  }
  export function quickTransfer(cell: any) {
    if (eventAt(cell.x, cell.y)) { flashStatus("That cell already has an event"); return; }
    const w = { mapId: S.proj.maps[0] ? S.proj.maps[0].id : 0, x: 0, y: 0, dir: 0 };
    // Keep refs to the Map/X/Y inputs so the visual picker can write back into them
    // (mirrors the full Transfer Player command form's "Pick destination" button).
    const mapSel = sel(w, "mapId", dbOpts(S.proj.maps));
    const xIn = nIn(w, "x", 0);
    const yIn = nIn(w, "y", 0);
    const content = h("div", null,
      row(field("Map", mapSel), field("X", xIn), field("Y", yIn),
        field("Facing", sel(w, "dir", DIR_OPTS))),
      h("button", { class: "mini", onclick() {
        openLocationPicker(w.mapId, w.x, w.y, (res: any) => {
          w.mapId = res.mapId; w.x = res.x; w.y = res.y;
          mapSel.value = String(res.mapId); xIn.value = res.x; yIn.value = res.y;
        });
      } }, "📍 Pick destination on map…"));
    modal({
      title: "New Transfer Event",
      content,
      buttons: [
        { label: "Create", primary: true, onClick(close: any) {
          close();
          placeQuickEvent(cell, "Transfer", [
            mkPage({ charset: "", trigger: "touch", priority: "below", through: true },
              [{ t: "transfer", mapId: w.mapId, x: w.x, y: w.y, dir: w.dir }]),
          ]);
        } },
        { label: "Cancel" },
      ],
      dialogKeys: true,
    });
  }
  export function quickChest(cell: any) {
    if (eventAt(cell.x, cell.y)) { flashStatus("That cell already has an event"); return; }
    const w = { kind: "item", id: S.proj.items[0] ? S.proj.items[0].id : 0, val: 1 };
    const entryWrap = h("span");
    function redrawEntry() {
      const isGold = w.kind === "gold";
      const arr = w.kind === "weapon" ? S.proj.weapons : w.kind === "armor" ? S.proj.armors : S.proj.items;
      if (!isGold) w.id = arr[0] ? arr[0].id : 0; // keep id valid when kind changes
      entryWrap.innerHTML = "";
      entryWrap.appendChild(isGold ? h("span", null, "—") : sel(w, "id", dbOpts(arr)));
    }
    const content = h("div", null,
      row(field("Kind", sel(w, "kind",
          [{ v: "item", l: "Item" }, { v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" }, { v: "gold", l: "Gold" }],
          redrawEntry)),
        field("Entry", entryWrap),
        field("Amount", nIn(w, "val", 1, 9999))));
    redrawEntry();
    modal({
      title: "New Chest",
      content,
      buttons: [
        { label: "Create", primary: true, onClick(close: any) {
          close();
          const give = w.kind === "gold"
            ? { t: "gold", op: "add", val: w.val }
            : { t: "item", kind: w.kind, id: w.id, op: "add", val: w.val };
          const label = w.kind === "gold" ? (w.val + " Gold") : ("×" + w.val);
          placeQuickEvent(cell, "Chest", [
            mkPage({ charset: "chest", trigger: "action" }, [
              { t: "se", name: "chest" },
              give,
              { t: "text", name: "", text: "Found " + label + "!" },
              { t: "selfsw", key: "A", val: true },
            ]),
            mkPage({ cond: { selfSw: "A" }, charset: "chest_open", trigger: "action" }, []),
          ]);
        } },
        { label: "Cancel" },
      ],
      dialogKeys: true,
    });
  }
