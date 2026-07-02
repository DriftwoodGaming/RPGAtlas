/* RPGAtlas — src/editor/database/battler-tabs.ts
   The stat-driven Database tabs: Actors, Classes (with traits & learnings),
   Skills, Enemies, and States. All built on the shared listFormTab scaffold.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, editorState as S } from "../editor-state";
import {
  h, nIn, sel, chk, field, row, dbOpts, charsetOpts,
  elementSelOpts, skillTypeSelOpts,
} from "../dom";
import { touch } from "../persistence";
import {
  STAT_KEYS, listFormTab, nameRefresher, iconPickerField,
  traitDefault, skillTypeTraitOpts,
} from "./shared";

export const actorsTab = () => listFormTab({
  list: () => S.proj.actors,
  blank: () => ({ id: 0, name: "Actor", classId: S.proj.classes[0].id, level: 1, charset: "hero", weaponId: 0, armorId: 0 }),
  form(e: any, box: any, redrawList: any) {
    const preview = h("span", { class: "char-preview" });
    function rp() {
      preview.innerHTML = "";
      const ci = Assets.charsetIndex(e.charset);
      if (ci >= 0) { preview.appendChild(Assets.faceCanvas(ci)); }
    }
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), field("Class", sel(e, "classId", dbOpts(S.proj.classes))), field("Initial level", nIn(e, "level", 1, 99))));
    box.appendChild(row(field("Sprite", sel(e, "charset", charsetOpts(true), rp)), preview));
    box.appendChild(row(field("Initial weapon", sel(e, "weaponId", dbOpts(S.proj.weapons, "(none)"))),
      field("Initial armor", sel(e, "armorId", dbOpts(S.proj.armors, "(none)")))));
    rp();
  },
});

export const classesTab = () => listFormTab({
  list: () => S.proj.classes,
  blank: () => ({ id: 0, name: "Class", icon: 0, base: { mhp: 40, mmp: 12, atk: 10, def: 9, mat: 8, mdf: 8, agi: 8 },
    growth: { mhp: 7, mmp: 2, atk: 2, def: 1.8, mat: 1.8, mdf: 1.8, agi: 1.5 }, traits: [], learnings: [] }),
  form(e: any, box: any, redrawList: any) {
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList)));
    const bRow = h("div", { class: "frow" }), gRow = h("div", { class: "frow" });
    for (const k of STAT_KEYS) bRow.appendChild(field(k.toUpperCase(), nIn(e.base, k, 0, 9999)));
    for (const k of STAT_KEYS) gRow.appendChild(field("+" + k.toUpperCase() + "/lv", nIn(e.growth, k, 0, 999, 0.1)));
    box.appendChild(h("div", { class: "subhead" }, "Base stats (level 1)"));
    box.appendChild(bRow);
    box.appendChild(h("div", { class: "subhead" }, "Growth per level"));
    box.appendChild(gRow);
    // traits
    e.traits = Array.isArray(e.traits) ? e.traits : [];
    const traitBox = h("div", { class: "trait-list" });
    function traitKeyOptions(t: any) {
      if (t.type === "param") {
        const opts: any = STAT_KEYS.map((k) => ({ v: k, l: k.toUpperCase() }));
        opts.stringValues = true;
        return opts;
      }
      if (t.type === "element") {
        return elementSelOpts();
      }
      if (t.type === "state") {
        const opts: any = dbOpts(S.proj.states);
        opts.stringValues = true;
        return opts;
      }
      if (t.type === "skill") {
        return skillTypeTraitOpts();
      }
      if (t.type === "equip") {
        const opts: any = [{ v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" }];
        opts.stringValues = true;
        return opts;
      }
      const opts: any = RA.TRAIT_SPECIALS.slice();
      opts.stringValues = true;
      return opts;
    }
    function traitValueLabel(t: any) {
      if (t.type === "param") return "Stat rate %";
      if (t.type === "element") return "Damage taken %";
      if (t.type === "state") return "Infliction chance %";
      if (t.type === "skill") return "Power rate %";
      return "Value %";
    }
    function redrawTraits() {
      traitBox.innerHTML = "";
      e.traits.forEach((t: any, i: any) => {
        const typeOpts: any = RA.TRAIT_TYPES.slice();
        typeOpts.stringValues = true;
        const typeSelect = sel(t, "type", typeOpts, (type: any) => {
          Object.assign(t, traitDefault(type));
          redrawTraits();
        });
        const keySelect = sel(t, "key", traitKeyOptions(t), () => {
          if (t.type === "equip") {
            const db = t.key === "armor" ? S.proj.armors : S.proj.weapons;
            if (!db.some((item: any) => item.id === Number(t.value))) t.value = db[0] ? db[0].id : 0;
            redrawTraits();
          }
        });
        let valueControl;
        if (t.type === "equip") {
          const db = t.key === "armor" ? S.proj.armors : S.proj.weapons;
          valueControl = field("Allowed item", sel(t, "value", dbOpts(db, "(none)")));
        } else {
          const max = t.type === "special" && t.key === "critChance" ? 100 : 999;
          valueControl = field(traitValueLabel(t), nIn(t, "value", 0, max));
        }
        const controls = h("div", { class: "trait-actions" },
          h("button", {
            class: "mini", title: "Move trait up", "aria-label": "Move trait up",
            ...(i === 0 ? { disabled: "" } : {}),
            onclick() {
              if (i <= 0) return;
              const [moved] = e.traits.splice(i, 1); e.traits.splice(i - 1, 0, moved);
              touch(); redrawTraits();
            },
          }, "↑"),
          h("button", {
            class: "mini", title: "Move trait down", "aria-label": "Move trait down",
            ...(i === e.traits.length - 1 ? { disabled: "" } : {}),
            onclick() {
              if (i >= e.traits.length - 1) return;
              const [moved] = e.traits.splice(i, 1); e.traits.splice(i + 1, 0, moved);
              touch(); redrawTraits();
            },
          }, "↓"),
          h("button", {
            class: "mini danger", title: "Delete trait", "aria-label": "Delete trait",
            onclick() { e.traits.splice(i, 1); touch(); redrawTraits(); },
          }, "Delete"),
        );
        traitBox.appendChild(h("div", { class: "trait-row" },
          field("Trait type", typeSelect), field("Target", keySelect), valueControl, controls));
      });
      if (!e.traits.length) {
        traitBox.appendChild(h("div", { class: "dim trait-empty" }, "No traits. This class uses the engine's normal rules."));
      }
      traitBox.appendChild(h("button", {
        class: "mini trait-add",
        onclick() { e.traits.push(traitDefault("param")); touch(); redrawTraits(); },
      }, "+ Add trait"));
    }
    redrawTraits();
    box.appendChild(h("div", { class: "subhead" }, "Traits"));
    box.appendChild(h("div", { class: "dim" },
      "Rates use 100% as normal, 50% as half, and 0% as immunity. Multiple matching rates multiply. Equipment permissions become a whitelist for that slot."));
    box.appendChild(traitBox);
    // learnings
    const lbox = h("div", { class: "minilist" });
    function redrawL() {
      lbox.innerHTML = "";
      (e.learnings || []).forEach((l: any, i: any) => {
        lbox.appendChild(h("div", { class: "minirow" },
          h("span", null, "Lv"), nIn(l, "level", 1, 99), sel(l, "skillId", dbOpts(S.proj.skills)),
          h("button", { class: "mini", onclick() { e.learnings.splice(i, 1); touch(); redrawL(); } }, "✕")));
      });
      lbox.appendChild(h("button", { class: "mini", onclick() {
        e.learnings = e.learnings || [];
        e.learnings.push({ level: 1, skillId: S.proj.skills[0] ? S.proj.skills[0].id : 1 });
        touch(); redrawL();
      } }, "+ add skill"));
    }
    redrawL();
    box.appendChild(h("div", { class: "subhead" }, "Skills learned"));
    box.appendChild(lbox);
  },
});

export const skillsTab = () => listFormTab({
  list: () => S.proj.skills,
  blank: () => ({ id: 0, name: "Skill", icon: 8, type: "magic", power: 20, mp: 5, scope: "enemy", color: "#f07030", stateId: 0, stateOp: "add", stateChance: 100 }),
  form(e: any, box: any, redrawList: any) {
    if (!e.element) e.element = RA.elementOfSkill(e);
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList),
      field("Type", sel(e, "type", skillTypeSelOpts())),
      field("Element", sel(e, "element", elementSelOpts())),
      field("Power", nIn(e, "power", 0, 9999)), field("MP cost", nIn(e, "mp", 0, 999))));
    box.appendChild(field("Scope", sel(e, "scope", [
      { v: "enemy", l: "One enemy" }, { v: "enemies", l: "All enemies" },
      { v: "ally", l: "One ally" }, { v: "allies", l: "All allies" }])));
    if (e.stateId == null) e.stateId = 0;
    if (!e.stateOp) e.stateOp = "add";
    if (e.stateChance == null) e.stateChance = 100;
    box.appendChild(h("div", { class: "subhead" }, "State effect (optional)"));
    box.appendChild(row(field("Effect", sel(e, "stateOp", [{ v: "add", l: "Add state" }, { v: "remove", l: "Remove state" }])),
      field("State", sel(e, "stateId", dbOpts(S.proj.states, "(none)"))),
      field("Chance %", nIn(e, "stateChance", 0, 100))));
    box.appendChild(h("div", { class: "dim" }, "Damage: physical = power + 2·ATK − 1.2·DEF · magical = power + 2·MAT − 1.5·MDF · heal = power + 1.2·MAT. The state effect rolls per target hit (see the States tab)."));
  },
});

export const enemiesTab = () => listFormTab({
  list: () => S.proj.enemies,
  blank: () => ({ id: 0, name: "Enemy", sprite: "slime", color: "#5aa84f",
    stats: { mhp: 30, atk: 10, def: 6, mat: 5, mdf: 5, agi: 6 }, exp: 10, gold: 10, actions: [{ skillId: 0, weight: 5 }] }),
  form(e: any, box: any, redrawList: any) {
    const preview = h("span", { class: "enemy-preview" });
    function rp() {
      preview.innerHTML = "";
      preview.appendChild(Assets.enemyCanvas(e.sprite, e.color, 96));
    }
    const colorIn = h("input", { type: "color", value: e.color || "#5aa84f", oninput(ev2: any) { e.color = ev2.target.value; touch(); rp(); } });
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)),
      field("Sprite", sel(e, "sprite", Assets.ENEMY_TYPES.map((t: any) => ({ v: t, l: Assets.assetLabel(t) })), rp)),
      field("Color", colorIn), preview));
    const st = h("div", { class: "frow" });
    for (const k of ["mhp", "atk", "def", "mat", "mdf", "agi"]) st.appendChild(field(k.toUpperCase(), nIn(e.stats, k, 0, 99999)));
    box.appendChild(st);
    box.appendChild(row(field("EXP reward", nIn(e, "exp", 0)), field("Gold reward", nIn(e, "gold", 0))));
    const abox = h("div", { class: "minilist" });
    function redrawA() {
      abox.innerHTML = "";
      (e.actions || []).forEach((a: any, i: any) => {
        abox.appendChild(h("div", { class: "minirow" },
          sel(a, "skillId", [{ v: 0, l: "(basic attack)" }].concat(dbOpts(S.proj.skills))),
          h("span", null, "weight"), nIn(a, "weight", 1, 99),
          h("button", { class: "mini", onclick() { e.actions.splice(i, 1); touch(); redrawA(); } }, "✕")));
      });
      abox.appendChild(h("button", { class: "mini", onclick() {
        e.actions = e.actions || [];
        e.actions.push({ skillId: 0, weight: 1 });
        touch(); redrawA();
      } }, "+ add action"));
    }
    redrawA();
    box.appendChild(h("div", { class: "subhead" }, "Actions (picked by weight)"));
    box.appendChild(abox);
    rp();
  },
});

export const statesTab = () => listFormTab({
  list: () => S.proj.states,
  blank: () => ({ id: 0, name: "State", icon: 12, color: "#a050d8", restrict: "none", hpTurn: 0, minTurns: 2, maxTurns: 4, removeAtEnd: true }),
  form(e: any, box: any, redrawList: any) {
    const colorIn = h("input", { type: "color", value: e.color || "#a050d8", oninput(ev2: any) { e.color = ev2.target.value; touch(); } });
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList), field("Color", colorIn)));
    box.appendChild(row(field("Restriction", sel(e, "restrict", [{ v: "none", l: "None" }, { v: "act", l: "Cannot act" }])),
      field("HP per turn %", nIn(e, "hpTurn", -100, 100)),
      field("Min turns", nIn(e, "minTurns", 1, 99)), field("Max turns", nIn(e, "maxTurns", 1, 99)),
      field("Removed after battle", chk(e, "removeAtEnd"))));
    box.appendChild(h("div", { class: "dim" }, "Negative HP per turn deals damage each round (poison); positive restores (regen). “Cannot act” makes the battler skip its turns (stun). States are inflicted or cured by skills — set that on the Skills tab. Full recovery cures all states."));
  },
});
