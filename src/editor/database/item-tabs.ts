/* RPGAtlas — src/editor/database/item-tabs.ts
   The equipment/inventory Database tabs: Items, Weapons, Armors, Troops, and
   Common Events. All built on the shared listFormTab scaffold; Common Events
   embeds the shared command-list widget.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, editorState as S } from "../editor-state";
import { h, tIn, nIn, sel, field, row, dbOpts, switchOpts, typeSelOpts } from "../dom";
import { touch } from "../persistence";
import { cmdListWidget } from "../event-editor/command-list";
import { PARAM_KEYS, listFormTab, nameRefresher, iconPickerField } from "./shared";

export const itemsTab = () => listFormTab({
  list: () => S.proj.items,
  blank: () => ({ id: 0, name: "Item", icon: 24, price: 50, hp: 50, mp: 0, desc: "" }),
  form(e: any, box: any, redrawList: any) {
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList), field("Price", nIn(e, "price", 0))));
    box.appendChild(row(field("Restores HP", nIn(e, "hp", 0, 9999)), field("Restores MP", nIn(e, "mp", 0, 9999))));
    box.appendChild(field("Description", tIn(e, "desc")));
  },
});

export const weaponsTab = () => listFormTab({
  list: () => S.proj.weapons,
  blank: () => ({ id: 0, name: "Weapon", icon: 48, price: 100, wtypeId: 1, params: { atk: 5 } }),
  form(e: any, box: any, redrawList: any) {
    e.params = e.params || {};
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList),
      field("Type", sel(e, "wtypeId", typeSelOpts("weaponTypes"))), field("Price", nIn(e, "price", 0))));
    const pr = h("div", { class: "frow" });
    for (const k of PARAM_KEYS) { if (e.params[k] == null) e.params[k] = 0; pr.appendChild(field(k.toUpperCase() + " +", nIn(e.params, k, -999, 999))); }
    box.appendChild(pr);
  },
});

export const armorsTab = () => listFormTab({
  list: () => S.proj.armors,
  blank: () => ({ id: 0, name: "Armor", icon: 56, price: 80, atypeId: 1, etypeId: 4, params: { def: 4 } }),
  form(e: any, box: any, redrawList: any) {
    e.params = e.params || {};
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList), field("Price", nIn(e, "price", 0))));
    box.appendChild(row(field("Type", sel(e, "atypeId", typeSelOpts("armorTypes"))),
      field("Equip slot", sel(e, "etypeId", typeSelOpts("equipTypes")))));
    const pr = h("div", { class: "frow" });
    for (const k of PARAM_KEYS) { if (e.params[k] == null) e.params[k] = 0; pr.appendChild(field(k.toUpperCase() + " +", nIn(e.params, k, -999, 999))); }
    box.appendChild(pr);
  },
});

export const troopsTab = () => listFormTab({
  list: () => S.proj.troops,
  blank: () => ({ id: 0, name: "Troop", enemies: [] }),
  form(e: any, box: any, redrawList: any) {
    box.appendChild(field("Name", nameRefresher(e, redrawList)));
    const mbox = h("div", { class: "frow" });
    function redrawM() {
      mbox.innerHTML = "";
      for (let i = 0; i < 4; i++) {
        const slot = { v: e.enemies[i] || 0 };
        mbox.appendChild(field("Slot " + (i + 1), sel(slot, "v", dbOpts(S.proj.enemies, "(empty)"), () => {
          const arr: any[] = [];
          const slots = mbox.querySelectorAll("select");
          slots.forEach((s2: any) => { const v = Number(s2.value); if (v) arr.push(v); });
          e.enemies = arr;
          touch();
        })));
      }
    }
    redrawM();
    box.appendChild(h("div", { class: "subhead" }, "Members (up to 4)"));
    box.appendChild(mbox);
  },
});

export const commonEventsTab = () => listFormTab({
  list: () => S.proj.commonEvents,
  allowEmpty: true,
  blank: () => RA.defaultCommonEvent(),
  form(e: any, box: any, redrawList: any) {
    e.commands = Array.isArray(e.commands) ? e.commands : [];
    e.trigger = ["none", "auto", "parallel"].includes(e.trigger) ? e.trigger : "none";
    e.switchId = Math.max(0, Number(e.switchId) || 0);
    box.appendChild(h("div", { class: "subhead" }, "Common event settings"));
    box.appendChild(row(
      field("Name", nameRefresher(e, redrawList)),
      field("Trigger", sel(e, "trigger", [
        { v: "none", l: "None" },
        { v: "auto", l: "Autorun" },
        { v: "parallel", l: "Parallel" },
      ])),
      field("Activation switch", sel(e, "switchId", switchOpts())),
    ));
    box.appendChild(h("div", { class: "dim" },
      "Autorun and Parallel run while the selected switch is ON. Choose (none) to keep the trigger always active. Direct calls run regardless of this switch."));
    box.appendChild(h("div", { class: "subhead" }, "Contents"));
    box.appendChild(cmdListWidget(() => e.commands, { snapshot() {} }).el);
  },
});
