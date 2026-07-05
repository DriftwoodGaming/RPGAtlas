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
import { parseFormula } from "../../shared/formula";
import {
  STAT_KEYS, listFormTab, nameRefresher, iconPickerField,
  traitsEditor, subTabs,
} from "./shared";

export const actorsTab = () => listFormTab({
  kind: "actors",
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
    if (e.row !== "back") e.row = "front";
    box.appendChild(row(field("Initial weapon", sel(e, "weaponId", dbOpts(S.proj.weapons, "(none)"))),
      field("Initial armor", sel(e, "armorId", dbOpts(S.proj.armors, "(none)"))),
      field("Battle row", sel(e, "row", rowOpts()))));
    rp();
  },
});

// Battle row options (Phase 5): back row deals/takes 25% less physical
// damage and is targeted less. Absent = front, so old actors are unchanged.
function rowOpts() {
  const o: any = [{ v: "front", l: "Front row" }, { v: "back", l: "Back row" }];
  o.stringValues = true;
  return o;
}

export const classesTab = () => listFormTab({
  kind: "classes",
  list: () => S.proj.classes,
  blank: () => ({ id: 0, name: "Class", icon: 0, base: { mhp: 40, mmp: 12, atk: 10, def: 9, mat: 8, mdf: 8, agi: 8 },
    growth: { mhp: 7, mmp: 2, atk: 2, def: 1.8, mat: 1.8, mdf: 1.8, agi: 1.5 }, traits: [], learnings: [] }),
  form(e: any, box: any, redrawList: any) {
    // Post-1.0 UX: name/icon stay on top; the heavy sections live on sub-tabs.
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList)));
    e.traits = Array.isArray(e.traits) ? e.traits : [];
    box.appendChild(subTabs("classes", [
      { label: "Stats & curve", build: buildStats },
      { label: "Traits", build: buildTraits },
      { label: "Skills learned", build: buildLearnings },
    ]));

    function buildStats() {
      const p = h("div");
      const bRow = h("div", { class: "frow" }), gRow = h("div", { class: "frow" });
      for (const k of STAT_KEYS) bRow.appendChild(field(k.toUpperCase(), nIn(e.base, k, 0, 9999)));
      for (const k of STAT_KEYS) gRow.appendChild(field("+" + k.toUpperCase() + "/lv", nIn(e.growth, k, 0, 999, 0.1)));
      p.appendChild(h("div", { class: "subhead", style: "margin-top:0" }, "Base stats (level 1)"));
      p.appendChild(bRow);
      p.appendChild(h("div", { class: "subhead" }, "Growth per level"));
      p.appendChild(gRow);
      // Stat-curve preview (Stage E "formula fields"): the engine derives each
      // battle param as floor(base + growth·(level−1)); this shows that curve live
      // as the base/growth fields above change. Equipment/traits are excluded — it
      // is the class curve, not a fully-equipped actor.
      const curveBox = h("div", { class: "stat-curve" });
      const LEVELS = [1, 25, 50, 99];
      function recomputeCurve() {
        curveBox.innerHTML = "";
        const head = h("div", { class: "sc-row sc-head" }, h("span", { class: "sc-key" }, "Lv"));
        for (const L of LEVELS) head.appendChild(h("span", { class: "sc-cell" }, String(L)));
        curveBox.appendChild(head);
        for (const k of STAT_KEYS) {
          const rowEl = h("div", { class: "sc-row" }, h("span", { class: "sc-key" }, k.toUpperCase()));
          const base = Number(e.base[k]) || 0, g = Number(e.growth[k]) || 0;
          for (const L of LEVELS) rowEl.appendChild(h("span", { class: "sc-cell" }, String(Math.floor(base + g * (L - 1)))));
          curveBox.appendChild(rowEl);
        }
      }
      recomputeCurve();
      p.appendChild(h("div", { class: "subhead" }, "Stat curve preview"));
      p.appendChild(h("div", { class: "dim" }, "floor(base + growth × (level − 1)), matching the engine. Equipment and traits are not applied here."));
      p.appendChild(curveBox);
      p.addEventListener("input", recomputeCurve); // reflect base/growth edits live
      return p;
    }

    function buildTraits() {
      // The shared M3·B traits editor (also on Enemies and States).
      return traitsEditor(e, "No traits. This class uses the engine's normal rules.");
    }

    function buildLearnings() {
      const p = h("div");
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
      p.appendChild(lbox);
      return p;
    }
  },
});

export const skillsTab = () => listFormTab({
  kind: "skills",
  list: () => S.proj.skills,
  blank: () => ({ id: 0, name: "Skill", icon: 8, type: "magic", power: 20, mp: 5, scope: "enemy", color: "#f07030", stateId: 0, stateOp: "add", stateChance: 100 }),
  form(e: any, box: any, redrawList: any) {
    // Post-1.0 UX: General fields on one sub-tab, the optional state effect
    // and the damage preview on the other. Rebuild-on-switch keeps the
    // preview in sync with Power/Type edits made on the General panel.
    if (!e.element) e.element = RA.elementOfSkill(e);
    box.appendChild(subTabs("skills", [
      { label: "General", build: buildGeneral },
      { label: "Effects & preview", build: buildEffects },
    ]));

    function buildGeneral() {
      const p = h("div");
      p.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList),
        field("Type", sel(e, "type", skillTypeSelOpts())),
        field("Element", sel(e, "element", elementSelOpts())),
        field("Power", nIn(e, "power", 0, 9999)), field("MP cost", nIn(e, "mp", 0, 999)),
        // M3·B: TP — costs/gains only matter once the project uses TP
        // (System ▸ “Show TP in battle”, or any skill with a TP cost).
        field("TP cost", nIn(e, "tpCost", 0, 100)),
        field("TP gained", nIn(e, "gainTp", 0, 100))));
      p.appendChild(row(field("Scope", sel(e, "scope", [
        { v: "enemy", l: "One enemy" }, { v: "enemies", l: "All enemies" },
        { v: "ally", l: "One ally" }, { v: "allies", l: "All allies" }])),
        field("Revives fallen ally", chk(e, "revive"))));
      p.appendChild(h("div", { class: "dim" }, "Revive: a heal-type ally/allies skill that targets fallen (0 HP) party members and brings them back to life with its healed amount. Ordinary heals never touch the fallen."));
      // Battle animation + multi-hit + action-sequence hook (Phase 5).
      // Animation "(default FX)" keeps the legacy castFx/travel/burst effects;
      // the common event runs after the skill resolves in battle.
      if (e.animationId == null) e.animationId = 0;
      if (e.hits == null) e.hits = 1;
      if (e.commonEventId == null) e.commonEventId = 0;
      p.appendChild(row(
        field("Battle animation", sel(e, "animationId", dbOpts(S.proj.animations || [], "(default FX)"))),
        field("Hits", nIn(e, "hits", 1, 8)),
        field("After-use common event", sel(e, "commonEventId", dbOpts(S.proj.commonEvents || [], "(none)")))));
      return p;
    }

    function buildEffects() {
      const p = h("div");
      if (e.stateId == null) e.stateId = 0;
      if (!e.stateOp) e.stateOp = "add";
      if (e.stateChance == null) e.stateChance = 100;
      p.appendChild(h("div", { class: "subhead", style: "margin-top:0" }, "State effect (optional)"));
      p.appendChild(row(field("Effect", sel(e, "stateOp", [{ v: "add", l: "Add state" }, { v: "remove", l: "Remove state" }])),
        field("State", sel(e, "stateId", dbOpts(S.proj.states, "(none)"))),
        field("Chance %", nIn(e, "stateChance", 0, 100))));
      p.appendChild(h("div", { class: "dim" }, "Damage: physical = power + 2·ATK − 1.2·DEF · magical = power + 2·MAT − 1.5·MDF · heal = power + 1.2·MAT. The state effect rolls per target hit (see the States tab)."));
      // Damage preview (Stage E "formula fields"): plug in a reference attacker
      // stat and target defense to see the base hit for this skill, using the
      // exact engine formula (pre-variance). Updates live as Power/Type change.
      const ref = { atk: 30, def: 10 };
      const out = h("span", { class: "dmg-out" });
      function recomputeDmg() {
        const power = Number(e.power) || 0;
        const heal = e.type === "heal";
        const phys = e.type === "phys";
        let d;
        if (heal) d = power + ref.atk * 1.2;
        else if (phys) d = power + ref.atk * 2 - ref.def * 1.2;
        else d = power + ref.atk * 2 - ref.def * 1.5;
        d = Math.max(heal ? 0 : 1, Math.round(d));
        out.textContent = (heal ? "Heals ≈ " : "Deals ≈ ") + d + " HP";
      }
      const previewNum = (obj: any, key: any) => h("input", {
        type: "number", value: String(obj[key]), style: "width:64px",
        oninput(ev: any) { obj[key] = Number(ev.target.value) || 0; recomputeDmg(); },
      });
      const atkLbl = h("span", null, "");
      const defWrap = h("label", { class: "dmg-fld dmg-def" }, h("span", null, "Target DEF/MDF"), previewNum(ref, "def"));
      function relabel() {
        atkLbl.textContent = e.type === "phys" ? "Attacker ATK" : "Attacker MAT";
        defWrap.style.display = e.type === "heal" ? "none" : "";
      }
      relabel();
      recomputeDmg();
      p.appendChild(h("div", { class: "subhead" }, "Damage preview"));
      p.appendChild(h("div", { class: "dmg-preview" },
        h("label", { class: "dmg-fld" }, atkLbl, previewNum(ref, "atk")),
        defWrap, out));
      p.addEventListener("input", () => { relabel(); recomputeDmg(); });
      // Advanced damage (Project Compass M3·A): an optional MZ-style formula
      // that replaces Power when set, plus the variance/critical companions.
      // The sandboxed parser (decision D1) validates live, in plain language.
      p.appendChild(h("div", { class: "subhead" }, "Advanced damage (optional)"));
      const verdict = h("div", { class: "dim" });
      function checkFormula() {
        const src = String(e.formula || "").trim();
        if (!src) {
          verdict.textContent =
            "No formula — this skill uses Power above (the classic way).";
          return;
        }
        const res = parseFormula(src);
        verdict.textContent = res.ok
          ? "✓ The formula replaces Power (a = user, b = target, v[n] = game variables)."
          : "This formula can't run yet — " + res.error + ". The skill uses Power until it's fixed.";
      }
      const fIn = h("input", {
        type: "text",
        value: e.formula == null ? "" : e.formula,
        placeholder: "a.atk * 4 - b.def * 2",
        oninput(ev: any) {
          const v = String(ev.target.value);
          if (v.trim()) e.formula = v;
          else delete e.formula;
          touch();
          checkFormula();
        },
      });
      checkFormula();
      if (e.variance == null) e.variance = 0;
      p.appendChild(row(
        field("Formula", fIn),
        field("Variance %", nIn(e, "variance", 0, 100)),
        field("Can critical", chk(e, "critical")),
      ));
      p.appendChild(verdict);
      // M3·B: buffs/debuffs, permanent growth, and taught skills.
      p.appendChild(h("div", { class: "subhead" }, "Extra effects (optional)"));
      p.appendChild(extraEffectsEditor(e));
      return p;
    }
  },
});

/** M3·B: the buff/debuff + grow + learn effect lists, shared by the Skills
 *  and Items forms. Buffs raise/lower a stat ±25% per step for a few rounds;
 *  Grow adds to the stat permanently; Learn teaches a skill for good. */
export function extraEffectsEditor(e: any) {
  const wrap = h("div", { class: "minilist" });
  const statOpts = () => {
    const o: any = STAT_KEYS.map((k) => ({ v: k, l: k.toUpperCase() }));
    o.stringValues = true;
    return o;
  };
  const opOpts = () => {
    const o: any = [
      { v: "buff", l: "Raise (buff)" }, { v: "debuff", l: "Lower (debuff)" },
      { v: "removeBuff", l: "Remove raise" }, { v: "removeDebuff", l: "Remove lower" },
    ];
    o.stringValues = true;
    return o;
  };
  function redraw() {
    wrap.innerHTML = "";
    (e.buffs || []).forEach((b: any, i: number) => {
      const turnsCtl = b.op === "buff" || b.op === "debuff"
        ? [h("span", null, "for"), nIn(b, "turns", 1, 99), h("span", null, "rounds")]
        : [];
      wrap.appendChild(h("div", { class: "minirow" },
        sel(b, "op", opOpts(), () => { touch(); redraw(); }),
        sel(b, "stat", statOpts()),
        ...turnsCtl,
        h("button", { class: "mini", onclick() { e.buffs.splice(i, 1); if (!e.buffs.length) delete e.buffs; touch(); redraw(); } }, "✕")));
    });
    (e.grow || []).forEach((g: any, i: number) => {
      wrap.appendChild(h("div", { class: "minirow" },
        h("span", null, "Grow"), sel(g, "stat", statOpts()),
        h("span", null, "by"), nIn(g, "amount", 1, 999), h("span", null, "forever"),
        h("button", { class: "mini", onclick() { e.grow.splice(i, 1); if (!e.grow.length) delete e.grow; touch(); redraw(); } }, "✕")));
    });
    (e.learn || []).forEach((_id: any, i: number) => {
      const holder = { v: e.learn[i] };
      wrap.appendChild(h("div", { class: "minirow" },
        h("span", null, "Teach skill"),
        sel(holder, "v", dbOpts(S.proj.skills), (v: any) => { e.learn[i] = Number(v); touch(); }),
        h("button", { class: "mini", onclick() { e.learn.splice(i, 1); if (!e.learn.length) delete e.learn; touch(); redraw(); } }, "✕")));
    });
    wrap.appendChild(h("div", null,
      h("button", { class: "mini", onclick() {
        (e.buffs || (e.buffs = [])).push({ stat: "atk", op: "buff", turns: 3 });
        touch(); redraw();
      } }, "+ buff/debuff"),
      h("button", { class: "mini", onclick() {
        (e.grow || (e.grow = [])).push({ stat: "atk", amount: 1 });
        touch(); redraw();
      } }, "+ permanent growth"),
      h("button", { class: "mini", onclick() {
        (e.learn || (e.learn = [])).push(S.proj.skills[0] ? S.proj.skills[0].id : 1);
        touch(); redraw();
      } }, "+ teach a skill"),
    ));
  }
  redraw();
  return wrap;
}

export const enemiesTab = () => listFormTab({
  kind: "enemies",
  list: () => S.proj.enemies,
  blank: () => ({ id: 0, name: "Enemy", sprite: "slime", color: "#5aa84f",
    stats: { mhp: 30, atk: 10, def: 6, mat: 5, mdf: 5, agi: 6 }, exp: 10, gold: 10, actions: [{ skillId: 0, weight: 5 }] }),
  form(e: any, box: any, redrawList: any) {
    // Post-1.0 UX: identity row (name/sprite/color/preview) stays on top;
    // stats & rewards and the AI action table live on sub-tabs.
    const preview = h("span", { class: "enemy-preview" });
    function rp() {
      preview.innerHTML = "";
      preview.appendChild(Assets.enemyCanvas(e.sprite, e.color, 96));
    }
    const colorIn = h("input", { type: "color", value: e.color || "#5aa84f", oninput(ev2: any) { e.color = ev2.target.value; touch(); rp(); } });
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)),
      field("Sprite", sel(e, "sprite", Assets.ENEMY_TYPES.map((t: any) => ({ v: t, l: Assets.assetLabel(t) })), rp)),
      field("Color", colorIn), preview));
    box.appendChild(subTabs("enemies", [
      { label: "Stats & rewards", build: buildStats },
      { label: "Actions (AI)", build: buildActions },
      // M3·B: enemies carry their own traits (element/state rates, counters…).
      { label: "Traits", build: () => traitsEditor(e, "No traits. This enemy uses the engine's normal rules.") },
    ]));
    rp();
    return;

    function buildStats() {
      const p = h("div");
      const st = h("div", { class: "frow" });
      for (const k of ["mhp", "atk", "def", "mat", "mdf", "agi"]) st.appendChild(field(k.toUpperCase(), nIn(e.stats, k, 0, 99999)));
      p.appendChild(st);
      p.appendChild(row(field("EXP reward", nIn(e, "exp", 0)), field("Gold reward", nIn(e, "gold", 0))));
      return p;
    }

    function buildActions() {
      const p = h("div");
      const abox = h("div", { class: "minilist" });
      // Per-action condition (Phase 5): rows whose condition fails drop out of
      // the weighted roll that turn. "(always)" = pre-Phase-5 behavior.
      function condKindOpts() {
        const o: any = [
          { v: "always", l: "(always)" },
          { v: "turn", l: "Turn a + b·x" },
          { v: "hpBelow", l: "HP ≤ %" },
          { v: "hpAbove", l: "HP ≥ %" },
          { v: "random", l: "Chance %" },
          { v: "stateSelf", l: "Has state" },
        ];
        o.stringValues = true;
        return o;
      }
      function condFields(a: any): any {
        const wrap = h("span", { class: "cond-fields" });
        const cond = a.cond;
        if (!cond || cond.kind === "always") return wrap;
        if (cond.kind === "turn") {
          wrap.appendChild(h("span", null, "a")); wrap.appendChild(nIn(cond, "a", 0, 999));
          wrap.appendChild(h("span", null, "+ b·x")); wrap.appendChild(nIn(cond, "b", 0, 999));
        } else if (cond.kind === "stateSelf") {
          wrap.appendChild(sel(cond, "stateId", dbOpts(S.proj.states)));
        } else {
          wrap.appendChild(nIn(cond, "pct", 0, 100)); wrap.appendChild(h("span", null, "%"));
        }
        return wrap;
      }
      function redrawA() {
        abox.innerHTML = "";
        (e.actions || []).forEach((a: any, i: any) => {
          const kindHolder = { v: (a.cond && a.cond.kind) || "always" };
          abox.appendChild(h("div", { class: "minirow" },
            sel(a, "skillId", [{ v: 0, l: "(basic attack)" }].concat(dbOpts(S.proj.skills))),
            h("span", null, "weight"), nIn(a, "weight", 1, 99),
            h("span", null, "if"),
            sel(kindHolder, "v", condKindOpts(), (kind: any) => {
              if (kind === "always") delete a.cond;
              else if (kind === "turn") a.cond = { kind, a: 1, b: 0 };
              else if (kind === "stateSelf") a.cond = { kind, stateId: S.proj.states[0] ? S.proj.states[0].id : 1 };
              else a.cond = { kind, pct: 50 };
              touch(); redrawA();
            }),
            condFields(a),
            h("button", { class: "mini", onclick() { e.actions.splice(i, 1); touch(); redrawA(); } }, "✕")));
        });
        abox.appendChild(h("button", { class: "mini", onclick() {
          e.actions = e.actions || [];
          e.actions.push({ skillId: 0, weight: 1 });
          touch(); redrawA();
        } }, "+ add action"));
      }
      redrawA();
      p.appendChild(h("div", { class: "dim" }, "Each turn the enemy picks one action by weight among the rows whose condition holds."));
      p.appendChild(abox);
      return p;
    }
  },
});

export const statesTab = () => listFormTab({
  kind: "states",
  list: () => S.proj.states,
  blank: () => ({ id: 0, name: "State", icon: 12, color: "#a050d8", restrict: "none", hpTurn: 0, minTurns: 2, maxTurns: 4, removeAtEnd: true }),
  form(e: any, box: any, redrawList: any) {
    const colorIn = h("input", { type: "color", value: e.color || "#a050d8", oninput(ev2: any) { e.color = ev2.target.value; touch(); } });
    box.appendChild(row(field("Name", nameRefresher(e, redrawList)), iconPickerField(e, redrawList), field("Color", colorIn)));
    box.appendChild(subTabs("states", [
      { label: "General", build: buildGeneral },
      { label: "Removal", build: buildRemoval },
      // M3·B: states can carry traits while active (Silence/Blind-style).
      { label: "Traits", build: () => traitsEditor(e, "No traits. This state only does what General says.") },
    ]));

    function buildGeneral() {
      const p = h("div");
      p.appendChild(row(field("Restriction", sel(e, "restrict", [{ v: "none", l: "None" }, { v: "act", l: "Cannot act" }])),
        field("HP per turn %", nIn(e, "hpTurn", -100, 100)),
        field("Min turns", nIn(e, "minTurns", 1, 99)), field("Max turns", nIn(e, "maxTurns", 1, 99))));
      p.appendChild(h("div", { class: "dim" }, "Negative HP per turn deals damage each round (poison); positive restores (regen). “Cannot act” makes the battler skip its turns (stun). States are inflicted or cured by skills and items — set that on their tabs. Full recovery cures all states."));
      return p;
    }

    function buildRemoval() {
      // M3·B: the MZ state-timing set — battle end, walking, damage, restriction.
      const p = h("div");
      if (e.stepsToRemove == null) e.stepsToRemove = 0;
      if (e.removeByDamage == null) e.removeByDamage = 0;
      p.appendChild(row(
        field("Removed after battle", chk(e, "removeAtEnd")),
        field("Steps to walk it off (0 = never)", nIn(e, "stepsToRemove", 0, 9999)),
        field("Chance % removed when hit (0 = never)", nIn(e, "removeByDamage", 0, 100)),
        field("Removed when stunned", chk(e, "removeByRestriction"))));
      p.appendChild(h("div", { class: "dim" }, "“Steps to walk it off” cures the state after that many map steps. “Removed when hit” rolls each time the battler takes HP damage. “Removed when stunned” sheds the state the moment a cannot-act state lands."));
      return p;
    }
  },
});
