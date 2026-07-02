/* RPGAtlas — src/editor/database/shared.ts
   Shared helpers for the Database tabs: the generic list+form tab scaffold,
   name/icon field helpers, and the stat/trait constants the battler tabs use.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, editorState as S } from "../editor-state";
import { h, tIn } from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";

export const STAT_KEYS = ["mhp", "mmp", "atk", "def", "mat", "mdf", "agi"];
export const PARAM_KEYS = ["atk", "def", "mat", "mdf", "agi"];
export const TRAIT_SKILL_TYPES = [
  { v: "phys", l: "Physical skills" },
  { v: "magic", l: "Magical skills" },
  { v: "heal", l: "Healing skills" },
];

export function skillTypeTraitOpts() {
  const st = RA.typeList(S.proj, "skillTypes");
  const o: any = TRAIT_SKILL_TYPES.map((d) => {
    const f = st.find((s: any) => s.key === d.v);
    return { v: d.v, l: f ? f.name + " skills" : d.l };
  });
  o.stringValues = true;
  return o;
}

export function traitDefault(type: any) {
  if (type === "element") return { type, key: (RA.typeList(S.proj, "elements")[0] || { key: "physical" }).key, value: 100 };
  if (type === "state") return { type, key: String(S.proj.states[0] ? S.proj.states[0].id : 1), value: 100 };
  if (type === "skill") return { type, key: "phys", value: 100 };
  if (type === "equip") return { type, key: "weapon", value: S.proj.weapons[0] ? S.proj.weapons[0].id : 0 };
  if (type === "special") return { type, key: "critChance", value: 5 };
  return { type: "param", key: "atk", value: 100 };
}

export function listFormTab(spec: any) {
  // spec: {list(), blank(), label(e), form(e, box)}
  const wrap = h("div", { class: "dbtab" });
  const listEl = h("ul", { class: "dblist" });
  const formEl = h("div", { class: "dbform" });
  let cur: any = null;
  function redrawList() {
    listEl.innerHTML = "";
    for (const e of spec.list()) {
      const li = h("li", { class: e === cur ? "sel" : "", onclick() { cur = e; redrawList(); redrawForm(); } },
        h("span", { class: "db-entry-id" }, e.id + ":"));
      if (e.icon != null) li.appendChild(Assets.iconSpan(e.icon, "db-entry-icon"));
      li.appendChild(h("span", null, e.name || "—"));
      listEl.appendChild(li);
    }
  }
  function redrawForm() {
    formEl.innerHTML = "";
    if (cur) spec.form(cur, formEl, () => { redrawList(); });
  }
  const btns = h("div", { class: "dbbtns" },
    h("button", { onclick() {
      const e = spec.blank();
      e.id = RA.nextId(spec.list());
      spec.list().push(e);
      cur = e; touch(); redrawList(); redrawForm();
    } }, "+ New"),
    ...(spec.reorderable ? [
      h("button", { class: "mini", title: "Move earlier", onclick() {
        if (!cur) return;
        const arr = spec.list();
        const i = arr.indexOf(cur);
        if (i <= 0) return;
        const [moved] = arr.splice(i, 1);
        arr.splice(i - 1, 0, moved);
        touch(); redrawList(); redrawForm();
      } }, "↑"),
      h("button", { class: "mini", title: "Move later", onclick() {
        if (!cur) return;
        const arr = spec.list();
        const i = arr.indexOf(cur);
        if (i < 0 || i >= arr.length - 1) return;
        const [moved] = arr.splice(i, 1);
        arr.splice(i + 1, 0, moved);
        touch(); redrawList(); redrawForm();
      } }, "↓"),
    ] : []),
    h("button", { onclick() {
      if (!cur) return;
      if (spec.allowEmpty !== true && spec.list().length <= 1) { alert("Keep at least one entry."); return; }
      confirmBox("Delete \"" + cur.name + "\"?", () => {
        const arr = spec.list();
        arr.splice(arr.indexOf(cur), 1);
        cur = arr[0] || null;
        touch(); redrawList(); redrawForm();
      });
    } }, "Delete"),
  );
  cur = spec.list()[0] || null;
  redrawList(); redrawForm();
  wrap.appendChild(h("div", { class: "dbside" }, btns, listEl));
  wrap.appendChild(formEl);
  return wrap;
}

export function nameRefresher(e: any, redrawList: any) {
  const inp = tIn(e, "name");
  inp.addEventListener("input", redrawList);
  return inp;
}

export function iconPickerField(entry: any, redrawList: any) {
  if (entry.icon == null) entry.icon = 0;
  const preview = h("span", { class: "icon-preview-wrap" }, Assets.iconSpan(entry.icon, "icon-preview"));
  const button = h("button", { class: "icon-pick-button", onclick(ev: any) {
    ev.preventDefault();
    const grid = h("div", { class: "icon-picker-grid" });
    let picker: any = null;
    for (let i = 0; i < Assets.ICON_COUNT; i++) {
      grid.appendChild(h("button", {
        class: "icon-choice" + (i === entry.icon ? " sel" : ""),
        title: "Icon " + i,
        onclick() {
          entry.icon = i;
          touch();
          redrawList();
          preview.innerHTML = "";
          preview.appendChild(Assets.iconSpan(i, "icon-preview"));
          picker.close();
        },
      }, Assets.iconSpan(i)));
    }
    picker = modal({ title: "Choose Icon", content: grid, wide: true, buttons: [{ label: "Cancel" }] });
  } }, preview, h("span", null, "Choose Icon"));
  return h("div", { class: "fld icon-field" }, h("span", null, "Icon"), button);
}
