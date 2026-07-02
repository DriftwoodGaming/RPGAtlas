/* RPGAtlas — src/editor/database/quests-tab.ts
   The Database "Quests" tab: objectives, start requirements, fail conditions,
   rewards, fail effects, next-quest chaining, and live warnings — built on the
   shared listFormTab scaffold.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, editorState as S } from "../editor-state";
import { h, tIn, nIn, sel, chk, field, row, dbOpts, switchOpts, varOpts, stringSelOpts } from "../dom";
import { touch } from "../persistence";
import { listFormTab, nameRefresher } from "./shared";

export const questsTab = () => listFormTab({
  list: () => S.proj.quests,
  allowEmpty: true,
  reorderable: true,
  blank: () => ({
    id: 0,
    name: "Quest",
    shortDesc: "",
    desc: "",
    category: "side",
    visible: true,
    objectives: [],
    startReqs: [],
    failConditions: [],
    rewards: [],
    failEffects: [],
    failText: "",
    nextQuestIds: [],
    autoStartNext: false,
    allowRestartOnFail: false,
    canAbandon: false,
  }),
  form(e: any, box: any, redrawList: any) {
    if (!e.name) e.name = "Quest";
    if (e.shortDesc == null) e.shortDesc = "";
    if (e.desc == null) e.desc = "";
    if (!Array.isArray(e.objectives)) e.objectives = [];
    if (!Array.isArray(e.rewards)) e.rewards = [];
    if (!Array.isArray(e.startReqs)) e.startReqs = [];
    if (!Array.isArray(e.failConditions)) e.failConditions = [];
    if (!Array.isArray(e.failEffects)) e.failEffects = [];
    if (!Array.isArray(e.nextQuestIds)) e.nextQuestIds = [];
    if (!e.category) e.category = "side";
    if (e.visible == null) e.visible = true;
    if (e.autoStartNext == null) e.autoStartNext = false;
    if (e.failText == null) e.failText = "";
    if (e.allowRestartOnFail == null) e.allowRestartOnFail = false;
    if (e.canAbandon == null) e.canAbandon = false;

    const warningWrap = h("div");
    const warningBox = h("div", { class: "minilist" });
    function pushQuestWarning(list: any, text: any) {
      if (!list.includes(text)) list.push(text);
    }
    function questWarnings() {
      const warnings: any[] = [];
      const questById = (id: any) => RA.byId(S.proj.quests, Number(id) || 0);
      const itemDbFor = (kind: any) => kind === "weapon" ? S.proj.weapons : kind === "armor" ? S.proj.armors : S.proj.items;
      if (!e.objectives.length) pushQuestWarning(warnings, "This quest has no objectives.");

      const seenNext = new Set();
      e.nextQuestIds.forEach((nextId: any) => {
        const id = Number(nextId) || 0;
        if (!id) return;
        if (id === e.id) pushQuestWarning(warnings, "A quest cannot list itself as a next quest.");
        if (seenNext.has(id)) pushQuestWarning(warnings, "This quest lists the same next quest more than once.");
        seenNext.add(id);
        if (!questById(id)) pushQuestWarning(warnings, "Next quest #" + id + " does not exist.");
      });

      e.startReqs.forEach((rq: any) => {
        if (rq.kind === "quest") {
          const id = Number(rq.questId) || 0;
          if (id && !questById(id)) pushQuestWarning(warnings, "Start requirement references missing quest #" + id + ".");
        }
      });

      e.failEffects.forEach((fx: any) => {
        if (fx.kind === "questUnlock" || fx.kind === "questLock") {
          const id = Number(fx.questId) || 0;
          if (id && !questById(id)) pushQuestWarning(warnings, "Fail effect references missing quest #" + id + ".");
        }
      });

      e.failConditions.forEach((fc: any) => {
        if (fc.kind === "battleLose") {
          const id = Number(fc.troopId) || 0;
          if (id && !RA.byId(S.proj.troops, id)) pushQuestWarning(warnings, "Fail condition references missing troop #" + id + ".");
        } else if (fc.kind === "enemyDefeatCount") {
          const id = Number(fc.enemyId) || 0;
          if (id && !RA.byId(S.proj.enemies, id)) pushQuestWarning(warnings, "Fail condition references missing enemy #" + id + ".");
        }
      });

      e.objectives.forEach((obj: any, i: any) => {
        const idx = i + 1;
        if (obj.kind === "kill") {
          const id = Number(obj.enemyId) || 0;
          if (id && !RA.byId(S.proj.enemies, id)) pushQuestWarning(warnings, "Objective " + idx + " references missing enemy #" + id + ".");
        } else if (obj.kind === "fetch") {
          const kind = obj.itemKind || "item";
          const id = Number(obj.id) || 0;
          if (id && !RA.byId(itemDbFor(kind), id)) pushQuestWarning(warnings, "Objective " + idx + " references missing " + kind + " #" + id + ".");
          const mapId = Number(obj.targetMapId) || 0;
          const eventId = Number(obj.targetEventId) || 0;
          const map = mapId ? RA.byId(S.proj.maps, mapId) : null;
          if (mapId && !map) pushQuestWarning(warnings, "Objective " + idx + " references missing turn-in map #" + mapId + ".");
          if (eventId && !mapId) pushQuestWarning(warnings, "Objective " + idx + " has a turn-in event but no turn-in map.");
          if (map && eventId && !(map.events || []).some((ev2: any) => ev2.id === eventId)) {
            pushQuestWarning(warnings, "Objective " + idx + " references missing turn-in event #" + eventId + " on map #" + mapId + ".");
          }
        }
      });

      return warnings;
    }
    function renderWarnings() {
      const warnings = questWarnings();
      warningWrap.innerHTML = "";
      if (!warnings.length) return;
      warningBox.innerHTML = "";
      warnings.forEach((text: any) => {
        warningBox.appendChild(h("div", { class: "minirow", style: "color:#ffd1a8; white-space:normal" }, text));
      });
      warningWrap.appendChild(h("div", { class: "subhead" }, "Warnings (" + warnings.length + ")"));
      warningWrap.appendChild(warningBox);
    }

    function effectEditor(list: any, title: any, addLabel: any, blank: any, kinds: any) {
      const panel = h("div", { class: "minilist" });
      function redraw() {
        panel.innerHTML = "";
        list.forEach((rw: any, i: any) => {
          if (!rw.kind) rw.kind = kinds[0].v;
          const rowEl = h("div", { class: "minirow" });
          rowEl.appendChild(sel(rw, "kind", kinds, redraw));
          if (rw.kind === "item") {
            if (!rw.itemKind) rw.itemKind = "item";
            const entryWrap = h("span");
            const redrawEntry = () => {
              const arr = rw.itemKind === "weapon" ? S.proj.weapons : rw.itemKind === "armor" ? S.proj.armors : S.proj.items;
              if (!arr.some((it: any) => it.id === Number(rw.id))) rw.id = arr[0] ? arr[0].id : 0;
              entryWrap.innerHTML = "";
              entryWrap.appendChild(sel(rw, "id", dbOpts(arr, "(none)")));
            };
            rowEl.appendChild(sel(rw, "itemKind", [
              { v: "item", l: "Item" },
              { v: "weapon", l: "Weapon" },
              { v: "armor", l: "Armor" },
            ], redrawEntry));
            redrawEntry();
            rowEl.appendChild(entryWrap);
            rowEl.appendChild(nIn(rw, "count", 1, 99));
          } else if (rw.kind === "switch") {
            rowEl.appendChild(sel(rw, "id", switchOpts()));
            rowEl.appendChild(sel(rw, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }]));
          } else if (rw.kind === "var") {
            rowEl.appendChild(sel(rw, "id", varOpts()));
            rowEl.appendChild(sel(rw, "op", [{ v: "set", l: "Set" }, { v: "add", l: "Add" }, { v: "sub", l: "Sub" }]));
            rowEl.appendChild(nIn(rw, "amount", -9999999, 9999999));
          } else if (rw.kind === "questUnlock" || rw.kind === "questLock") {
            rowEl.appendChild(sel(rw, "questId", dbOpts(S.proj.quests, "(none)")));
          } else {
            rowEl.appendChild(nIn(rw, "amount", 0, 9999999));
          }
          rowEl.appendChild(h("button", { class: "mini", onclick() { list.splice(i, 1); touch(); redraw(); } }, "✕"));
          panel.appendChild(rowEl);
        });
        panel.appendChild(h("button", { class: "mini", onclick() {
          list.push(blank());
          touch(); redraw();
        } }, addLabel));
        renderWarnings();
      }
      redraw();
      box.appendChild(h("div", { class: "subhead" }, title));
      box.appendChild(panel);
    }
    function failConditionEditor() {
      const panel = h("div", { class: "minilist" });
      function redraw() {
        panel.innerHTML = "";
        e.failConditions.forEach((fc: any, i: any) => {
          if (!fc.kind) fc.kind = "manual";
          const rowEl = h("div", { class: "minirow", style: "align-items:flex-start; flex-wrap:wrap" });
          rowEl.appendChild(field("Type", sel(fc, "kind", stringSelOpts(["manual", "switch", "var", "battleLose", "enemyDefeatCount"]), redraw)));
          if (fc.kind === "switch") {
            rowEl.appendChild(field("Switch", sel(fc, "id", switchOpts())));
            rowEl.appendChild(field("State", sel(fc, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }])));
          } else if (fc.kind === "var") {
            rowEl.appendChild(field("Variable", sel(fc, "id", varOpts())));
            rowEl.appendChild(field("Cmp", sel(fc, "cmp", [{ v: ">=", l: "≥" }, { v: "==", l: "=" }, { v: "<=", l: "≤" }])));
            rowEl.appendChild(field("Value", nIn(fc, "val", -9999999, 9999999)));
          } else if (fc.kind === "battleLose") {
            rowEl.appendChild(field("Troop", sel(fc, "troopId", dbOpts(S.proj.troops, "(none)"))));
          } else if (fc.kind === "enemyDefeatCount") {
            rowEl.appendChild(field("Enemy", sel(fc, "enemyId", dbOpts(S.proj.enemies, "(none)"))));
            rowEl.appendChild(field("Losses", nIn(fc, "count", 1, 99)));
          } else {
            rowEl.appendChild(h("div", { class: "dim" }, "Manual fail only — use the Fail Quest command."));
          }
          rowEl.appendChild(h("button", { class: "mini", onclick() { e.failConditions.splice(i, 1); touch(); redraw(); } }, "✕"));
          panel.appendChild(rowEl);
        });
        panel.appendChild(h("button", { class: "mini", onclick() {
          e.failConditions.push({ kind: "manual" });
          touch(); redraw();
        } }, "+ add fail condition"));
        renderWarnings();
      }
      redraw();
      box.appendChild(h("div", { class: "subhead" }, "Fail conditions"));
      box.appendChild(panel);
    }

    function requirementEditor() {
      const panel = h("div", { class: "minilist" });
      function redraw() {
        panel.innerHTML = "";
        e.startReqs.forEach((rq: any, i: any) => {
          if (!rq.kind) rq.kind = "quest";
          const rowEl = h("div", { class: "minirow" });
          rowEl.appendChild(sel(rq, "kind", [
            { v: "quest", l: "Quest state" },
            { v: "switch", l: "Switch" },
            { v: "var", l: "Variable" },
          ], redraw));
          if (rq.kind === "quest") {
            const questOpts = [{ v: 0, l: "(none)" }].concat(S.proj.quests.filter((q: any) => q !== e).map((q: any) => ({ v: q.id, l: q.id + ": " + (q.name || "Quest") })));
            rowEl.appendChild(sel(rq, "questId", questOpts));
            rowEl.appendChild(sel(rq, "status", stringSelOpts(["active", "completed", "failed", "abandoned"])));
          } else if (rq.kind === "switch") {
            rowEl.appendChild(sel(rq, "id", switchOpts()));
            rowEl.appendChild(sel(rq, "val", [{ v: "true", l: "ON" }, { v: "false", l: "OFF" }]));
          } else {
            rowEl.appendChild(sel(rq, "id", varOpts()));
            rowEl.appendChild(sel(rq, "cmp", [{ v: ">=", l: "≥" }, { v: "==", l: "=" }, { v: "<=", l: "≤" }]));
            rowEl.appendChild(nIn(rq, "val", -9999999, 9999999));
          }
          rowEl.appendChild(h("button", { class: "mini", onclick() { e.startReqs.splice(i, 1); touch(); redraw(); } }, "✕"));
          panel.appendChild(rowEl);
        });
        panel.appendChild(h("button", { class: "mini", onclick() {
          e.startReqs.push({ kind: "quest", questId: 0, status: "completed" });
          touch(); redraw();
        } }, "+ add requirement"));
        renderWarnings();
      }
      redraw();
      box.appendChild(h("div", { class: "subhead" }, "Availability / start requirements"));
      box.appendChild(panel);
    }
    function objectiveEditor() {
      const panel = h("div", { class: "minilist" });
      function redraw() {
        panel.innerHTML = "";
        e.objectives.forEach((obj: any, i: any) => {
          if (!obj.kind) obj.kind = "event";
          if (!obj.label) obj.label = "";
          if (obj.count == null) obj.count = 1;
          const rowEl = h("div", { class: "minirow", style: "align-items:flex-start; flex-wrap:wrap" });
          rowEl.appendChild(field("Type", sel(obj, "kind", stringSelOpts(["event", "kill", "fetch"]), redraw)));
          rowEl.appendChild(field("Label", tIn(obj, "label")));
          rowEl.appendChild(field("Count", nIn(obj, "count", 1, 999)));
          if (obj.kind === "kill") {
            rowEl.appendChild(field("Enemy", sel(obj, "enemyId", dbOpts(S.proj.enemies, "(none)"))));
          } else if (obj.kind === "fetch") {
            const itemWrap = h("span");
            const eventWrap = h("span");
            const redrawItem = () => {
              const arr = obj.itemKind === "weapon" ? S.proj.weapons : obj.itemKind === "armor" ? S.proj.armors : S.proj.items;
              if (!arr.some((it: any) => it.id === Number(obj.id))) obj.id = arr[0] ? arr[0].id : 0;
              itemWrap.innerHTML = "";
              itemWrap.appendChild(sel(obj, "id", dbOpts(arr, "(none)")));
            };
            const redrawEvent = () => {
              const map = RA.byId(S.proj.maps, obj.targetMapId);
              const eventOpts = [{ v: 0, l: "(any)" }].concat((map || { events: [] }).events.map((ev2: any) => ({ v: ev2.id, l: ev2.id + ": " + ev2.name })));
              eventWrap.innerHTML = "";
              eventWrap.appendChild(sel(obj, "targetEventId", eventOpts));
            };
            if (!obj.itemKind) obj.itemKind = "item";
            rowEl.appendChild(field("Kind", sel(obj, "itemKind", [
              { v: "item", l: "Item" },
              { v: "weapon", l: "Weapon" },
              { v: "armor", l: "Armor" },
            ], redrawItem)));
            redrawItem();
            rowEl.appendChild(field("Entry", itemWrap));
            rowEl.appendChild(field("Turn-in map", sel(obj, "targetMapId", dbOpts(S.proj.maps, "(any)"), redrawEvent)));
            redrawEvent();
            rowEl.appendChild(field("Turn-in event", eventWrap));
            rowEl.appendChild(field("Consume on complete", chk(obj, "consumeOnComplete")));
          }
          rowEl.appendChild(h("button", { class: "mini", onclick() { e.objectives.splice(i, 1); touch(); redraw(); } }, "✕"));
          panel.appendChild(rowEl);
        });
        panel.appendChild(h("div", { class: "minirow" },
          h("button", { class: "mini", onclick() { e.objectives.push({ kind: "event", label: "Talk to target", count: 1 }); touch(); redraw(); } }, "+ Event objective"),
          h("button", { class: "mini", onclick() { e.objectives.push({ kind: "kill", label: "Defeat target enemies", enemyId: S.proj.enemies[0] ? S.proj.enemies[0].id : 0, count: 3 }); touch(); redraw(); } }, "+ Kill objective"),
          h("button", { class: "mini", onclick() { e.objectives.push({ kind: "fetch", label: "Bring requested item", itemKind: "item", id: S.proj.items[0] ? S.proj.items[0].id : 0, count: 1, targetMapId: 0, targetEventId: 0, consumeOnComplete: false }); touch(); redraw(); } }, "+ Fetch objective")));
        renderWarnings();
      }
      redraw();
      box.appendChild(h("div", { class: "subhead" }, "Objectives"));
      box.appendChild(panel);
    }

    box.appendChild(row(field("Title", nameRefresher(e, redrawList)),
      field("Category", sel(e, "category", stringSelOpts(["main", "side", "guild", "hidden"]))),
      field("Visible in journal", chk(e, "visible"))));
    const shortDesc = h("input", { type: "text", value: e.shortDesc || "", oninput(ev: any) { e.shortDesc = ev.target.value; touch(); } });
    const desc = h("textarea", { rows: 5, oninput(ev: any) { e.desc = ev.target.value; touch(); } }, e.desc || "");
    box.appendChild(field("Short description", shortDesc));
    box.appendChild(field("Long description", desc));
    renderWarnings();
    box.appendChild(warningWrap);

    objectiveEditor();
    requirementEditor();
    failConditionEditor();

    effectEditor(e.rewards, "Rewards", "+ add reward", () => ({ kind: "gold", amount: 100 }), [
      { v: "exp", l: "XP" },
      { v: "gold", l: "Money" },
      { v: "item", l: "Item" },
    ]);

    effectEditor(e.failEffects, "Fail effects", "+ add fail effect", () => ({ kind: "switch", id: 1, val: "true" }), [
      { v: "gold", l: "Money" },
      { v: "item", l: "Item" },
      { v: "switch", l: "Switch" },
      { v: "var", l: "Variable" },
      { v: "questUnlock", l: "Unlock quest" },
      { v: "questLock", l: "Lock quest" },
    ]);
    box.appendChild(field("Failure / consequence text", h("textarea", { rows: 3, oninput(ev: any) { e.failText = ev.target.value; touch(); } }, e.failText || "")));

    const nextBox = h("div", { class: "minilist" });
    function redrawNext() {
      nextBox.innerHTML = "";
      e.nextQuestIds.forEach((id: any, i: any) => {
        const slot = { id };
        const options = [{ v: 0, l: "(none)" }].concat(S.proj.quests.filter((q: any) => q !== e).map((q: any) => ({ v: q.id, l: q.id + ": " + (q.name || "Quest") })));
        nextBox.appendChild(h("div", { class: "minirow" },
          sel(slot, "id", options, () => {
            e.nextQuestIds[i] = slot.id;
            e.nextQuestIds = e.nextQuestIds.filter((qid: any) => qid && qid !== e.id);
            touch();
          }),
          h("button", { class: "mini", onclick() { e.nextQuestIds.splice(i, 1); touch(); redrawNext(); } }, "✕")));
      });
      nextBox.appendChild(h("button", { class: "mini", onclick() {
        const candidate = S.proj.quests.find((q: any) => q !== e && !e.nextQuestIds.includes(q.id));
        if (!candidate) return;
        e.nextQuestIds.push(candidate.id);
        touch(); redrawNext();
      } }, "+ add next quest"));
      renderWarnings();
    }
    redrawNext();
    box.appendChild(h("div", { class: "subhead" }, "Next quests"));
    box.appendChild(nextBox);
    box.appendChild(field("Auto-start next quests", chk(e, "autoStartNext")));
    box.appendChild(row(field("Allow restart after fail", chk(e, "allowRestartOnFail")), field("Player can abandon", chk(e, "canAbandon"))));
  },
});
