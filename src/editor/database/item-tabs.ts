/* RPGAtlas — src/editor/database/item-tabs.ts
   The equipment/inventory Database tabs: Items, Weapons, Armors, Troops, and
   Common Events. All built on the shared listFormTab scaffold; Common Events
   embeds the shared command-list widget.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, editorState as S } from "../editor-state";
import { h, tIn, nIn, sel, chk, field, row, dbOpts, switchOpts, typeSelOpts } from "../dom";
import { touch } from "../persistence";
import { cmdListWidget } from "../event-editor/command-list";
import { PARAM_KEYS, listFormTab, nameRefresher, iconPickerField, subTabs } from "./shared";
import { extraEffectsEditor } from "./battler-tabs";

export const itemsTab = () => listFormTab({
  kind: "items",
  list: () => S.proj.items,
  blank: () => ({ id: 0, name: "Item", icon: 24, price: 50, hp: 50, mp: 0, desc: "" }),
  form(e: any, box: any, redrawList: any) {
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList), field("Price", nIn(e, "price", 0))));
    box.appendChild(row(field("Restores HP", nIn(e, "hp", 0, 9999)), field("Restores MP", nIn(e, "mp", 0, 9999)),
      field("Revives fallen ally", chk(e, "revive")),
      // M3·C: the MZ escape effect — a Smoke Bomb item.
      field("Escapes the battle", chk(e, "escapeBattle"))));
    box.appendChild(field("Description", tIn(e, "desc")));
    box.appendChild(h("div", { class: "dim" }, "Revive: this item works only on a fallen (0 HP) ally, bringing them back with the “Restores HP” amount. Non-revive items can't be used on the fallen."));
    // M3·B: state add/cure (the Antidote pattern) + TP + buff/grow/learn extras.
    if (e.stateId == null) e.stateId = 0;
    if (!e.stateOp) e.stateOp = "remove";
    if (e.stateChance == null) e.stateChance = 100;
    box.appendChild(h("div", { class: "subhead" }, "State effect (optional)"));
    box.appendChild(row(
      field("Effect", sel(e, "stateOp", [{ v: "remove", l: "Cure state" }, { v: "add", l: "Add state" }])),
      field("State", sel(e, "stateId", dbOpts(S.proj.states, "(none)"))),
      field("Chance %", nIn(e, "stateChance", 0, 100)),
      field("TP given", nIn(e, "gainTp", 0, 100))));
    box.appendChild(h("div", { class: "subhead" }, "Extra effects (optional)"));
    box.appendChild(extraEffectsEditor(e));
  },
});

export const weaponsTab = () => listFormTab({
  kind: "weapons",
  list: () => S.proj.weapons,
  blank: () => ({ id: 0, name: "Weapon", icon: 48, price: 100, wtypeId: 1, params: { atk: 5 } }),
  form(e: any, box: any, redrawList: any) {
    e.params = e.params || {};
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList),
      field("Type", sel(e, "wtypeId", typeSelOpts("weaponTypes"))), field("Price", nIn(e, "price", 0))));
    const pr = h("div", { class: "frow" });
    for (const k of PARAM_KEYS) { if (e.params[k] == null) e.params[k] = 0; pr.appendChild(field(k.toUpperCase() + " +", nIn(e.params, k, -999, 999))); }
    box.appendChild(pr);
    // Normal-attack battle animation (Phase 5). "(default FX)" = legacy hit FX.
    if (e.animationId == null) e.animationId = 0;
    box.appendChild(field("Attack animation", sel(e, "animationId", dbOpts(S.proj.animations || [], "(default FX)"))));
  },
});

export const armorsTab = () => listFormTab({
  kind: "armors",
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
  kind: "troops",
  list: () => S.proj.troops,
  blank: () => ({ id: 0, name: "Troop", enemies: [], pages: [] }),
  form(e: any, box: any, redrawList: any) {
    // Post-1.0 UX: name stays on top; members and battle-event pages live on
    // sub-tabs. curPage sits at form scope so switching sub-tabs (or back)
    // keeps the selected battle-event page.
    box.appendChild(field("Name", nameRefresher(e, redrawList)));
    e.pages = Array.isArray(e.pages) ? e.pages : [];
    let curPage = e.pages[0] || null;
    box.appendChild(subTabs("troops", [
      { label: "Members", build: buildMembers },
      { label: "Battle events", build: buildBattleEvents },
    ]));
    return;

    function buildMembers() {
      const p = h("div");
      const mbox = h("div", { class: "frow" });
      // M3·C: per-slot "hidden at start" (revealed by the Enemy Appear
      // command). Stored sparsely — no hidden slots, no field.
      const hiddenSet = new Set<number>(e.hiddenSlots || []);
      const syncHidden = () => {
        const list = [...hiddenSet].filter((i) => i < e.enemies.length).sort();
        if (list.length) e.hiddenSlots = list;
        else delete e.hiddenSlots;
      };
      function redrawM() {
        mbox.innerHTML = "";
        for (let i = 0; i < 4; i++) {
          const slot = { v: e.enemies[i] || 0 };
          mbox.appendChild(field("Slot " + (i + 1), sel(slot, "v", dbOpts(S.proj.enemies, "(empty)"), () => {
            const arr: any[] = [];
            const slots = mbox.querySelectorAll("select");
            slots.forEach((s2: any) => { const v = Number(s2.value); if (v) arr.push(v); });
            e.enemies = arr;
            syncHidden();
            touch();
          })));
          mbox.appendChild(field("hidden at start", h("input", {
            type: "checkbox",
            onchange(ev2: any) {
              if (ev2.target.checked) hiddenSet.add(i);
              else hiddenSet.delete(i);
              syncHidden();
              touch();
            },
            ...(hiddenSet.has(i) ? { checked: "" } : {}),
          })));
        }
      }
      redrawM();
      p.appendChild(h("div", { class: "subhead", style: "margin-top:0" }, "Members (up to 4)"));
      p.appendChild(mbox);
      p.appendChild(h("div", { class: "dim" }, "A hidden member joins the fight when a battle event runs “Enemy Appear” on its slot."));
      return p;
    }

    function buildBattleEvents() {
      const p = h("div");
      // ---- battle-event pages (Phase 5): commands that run mid-battle ----
      const pageBar = h("div", { class: "troop-pagebar" });
      const pageBody = h("div");
      function blankPage() {
        return { cond: { turn: { a: 1, b: 0 } }, span: "battle", commands: [] };
      }
      function redrawPages() {
        pageBar.innerHTML = "";
        e.pages.forEach((pg: any, i: any) => {
          pageBar.appendChild(h("button", { class: "mini" + (pg === curPage ? " sel" : ""),
            onclick() { curPage = pg; redrawPages(); } }, "Page " + (i + 1)));
        });
        pageBar.appendChild(h("button", { class: "mini", title: "Add a battle-event page", onclick() {
          const pg = blankPage();
          e.pages.push(pg); curPage = pg; touch(); redrawPages();
        } }, "+ page"));
        if (curPage) {
          pageBar.appendChild(h("button", { class: "mini danger", title: "Delete this page", onclick() {
            e.pages.splice(e.pages.indexOf(curPage), 1);
            curPage = e.pages[0] || null;
            touch(); redrawPages();
          } }, "× delete"));
        }
        redrawPageBody();
      }
      function redrawPageBody() {
        pageBody.innerHTML = "";
        const pg = curPage;
        if (!pg) {
          pageBody.appendChild(h("div", { class: "dim" },
            "No battle events. Add a page to run event commands mid-battle when its condition is met (boss dialogue, reinforcement switches, phase changes…)."));
          return;
        }
        pg.cond = pg.cond || {};
        if (!["battle", "turn", "moment"].includes(pg.span)) pg.span = "battle";
        pg.commands = Array.isArray(pg.commands) ? pg.commands : [];
        const c = pg.cond;
        // condition editors: each block is optional; ALL set blocks must hold
        c.turn = c.turn || { a: 0, b: 0 };
        c.enemyHpBelow = c.enemyHpBelow || { index: 0, pct: 0 };
        c.actorHpBelow = c.actorHpBelow || { actorId: 0, pct: 0 };
        if (c.switchId == null) c.switchId = 0;
        pageBody.appendChild(row(
          field("Turn a (0 = off)", nIn(c.turn, "a", 0, 999)),
          field("+ every b turns", nIn(c.turn, "b", 0, 999)),
          // M3·C: the MZ "Turn End" condition — only the between-turns
          // check can fire the page.
          field("Only at turn end", chk(c, "turnEnd")),
          field("Span", sel(pg, "span", [
            { v: "battle", l: "Once per battle" },
            { v: "turn", l: "Once per turn" },
            { v: "moment", l: "Each time it becomes true" },
          ]))));
        pageBody.appendChild(row(
          field("Enemy slot", sel(c.enemyHpBelow, "index",
            e.enemies.map((eid: any, i: any) => {
              const en = RA.byId(S.proj.enemies, eid);
              return { v: i, l: "Slot " + (i + 1) + (en ? " · " + en.name : "") };
            }))),
          field("enemy HP ≤ % (0 = off)", nIn(c.enemyHpBelow, "pct", 0, 100)),
          field("Actor", sel(c.actorHpBelow, "actorId", dbOpts(S.proj.actors, "(off)"))),
          field("actor HP ≤ %", nIn(c.actorHpBelow, "pct", 0, 100)),
          field("Switch ON", sel(c, "switchId", switchOpts()))));
        pageBody.appendChild(h("div", { class: "subhead" }, "Commands (run while the battle pauses)"));
        pageBody.appendChild(cmdListWidget(() => pg.commands, { snapshot() {} }).el);
      }
      p.appendChild(pageBar);
      p.appendChild(pageBody);
      redrawPages();
      return p;
    }
  },
});

export const commonEventsTab = () => listFormTab({
  kind: "commonEvents",
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
