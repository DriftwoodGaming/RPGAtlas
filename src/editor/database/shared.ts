/* RPGAtlas — src/editor/database/shared.ts
   Shared helpers for the Database tabs: the generic list+form tab scaffold,
   name/icon field helpers, and the stat/trait constants the battler tabs use.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Assets, RA, editorState as S } from "../editor-state";
import { h, tIn, sel, nIn, field, dbOpts, elementSelOpts } from "../dom";
import { modal, confirmBox } from "../modals";
import { touch } from "../persistence";
import { flashStatus } from "../map-editor/status";
import {
  sharedNumericFields, applyBulk, cloneEntries, writeDbClip, readDbClip, type BulkOp,
} from "./bulk";

export const STAT_KEYS = ["mhp", "mmp", "atk", "def", "mat", "mdf", "agi", "luk"];
export const PARAM_KEYS = ["atk", "def", "mat", "mdf", "agi", "luk"];
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

// ---------------------------------------------------------------------------
// The shared traits editor (Project Compass M3·B): one builder for Classes,
// Enemies, and States. Extends the classic key dropdowns with the M3·B
// prefixed keys — attack elements, on-attack/resist states, skill grant/seal,
// equip lock/seal, and debuff chances — in plain language.
// ---------------------------------------------------------------------------

function traitKeyOptions(t: any) {
  if (t.type === "param") {
    const opts: any = STAT_KEYS.map((k) => ({ v: k, l: k.toUpperCase() }));
    for (const k of STAT_KEYS) opts.push({ v: "debuff:" + k, l: "Debuff chance: " + k.toUpperCase() });
    opts.stringValues = true;
    return opts;
  }
  if (t.type === "element") {
    const opts: any = elementSelOpts();
    const base = opts.slice();
    for (const e of base) opts.push({ v: "attack:" + e.v, l: "Attack element: " + e.l });
    opts.stringValues = true;
    return opts;
  }
  if (t.type === "state") {
    const opts: any = dbOpts(S.proj.states);
    const base = opts.slice();
    for (const s of base) opts.push({ v: "resist:" + s.v, l: "Resist: " + s.l });
    for (const s of base) opts.push({ v: "attack:" + s.v, l: "Inflict on attack: " + s.l });
    opts.stringValues = true;
    return opts;
  }
  if (t.type === "skill") {
    const opts: any = skillTypeTraitOpts();
    for (const st of RA.typeList(S.proj, "skillTypes")) {
      opts.push({ v: "addType:" + st.key, l: "Grant type: " + st.name });
      opts.push({ v: "sealType:" + st.key, l: "Seal type: " + st.name });
    }
    for (const s of S.proj.skills) {
      opts.push({ v: "add:" + s.id, l: "Grant skill: " + s.name });
      opts.push({ v: "seal:" + s.id, l: "Seal skill: " + s.name });
    }
    opts.stringValues = true;
    return opts;
  }
  if (t.type === "equip") {
    const opts: any = [
      { v: "weapon", l: "Weapon" }, { v: "armor", l: "Armor" },
      { v: "lock:weapon", l: "Lock weapon slot" }, { v: "lock:armor", l: "Lock armor slot" },
      { v: "seal:weapon", l: "Seal weapon slot" }, { v: "seal:armor", l: "Seal armor slot" },
    ];
    opts.stringValues = true;
    return opts;
  }
  const opts: any = RA.TRAIT_SPECIALS.slice();
  opts.stringValues = true;
  return opts;
}

function traitValueLabel(t: any) {
  const key = String(t.key || "");
  if (t.type === "param") return key.startsWith("debuff:") ? "Debuff chance %" : "Stat rate %";
  if (t.type === "element") return key.startsWith("attack:") ? "(always on)" : "Damage taken %";
  if (t.type === "state") {
    if (key.startsWith("resist:")) return "(immune)";
    if (key.startsWith("attack:")) return "Inflict chance %";
    return "Infliction chance %";
  }
  if (t.type === "skill") {
    if (/^(add|seal|addType|sealType):/.test(key)) return "(always on)";
    return "Power rate %";
  }
  return "Value %";
}

/** Build the trait-list editor for any record with a `traits` array (M3·B:
 *  shared by Classes, Enemies, and States). `emptyNote` is the friendly line
 *  shown when the list is empty. */
export function traitsEditor(e: any, emptyNote: string) {
  e.traits = Array.isArray(e.traits) ? e.traits : [];
  const p = h("div");
  const traitBox = h("div", { class: "trait-list" });
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
          if (!String(t.key).includes(":") && !db.some((item: any) => item.id === Number(t.value))) {
            t.value = db[0] ? db[0].id : 0;
          }
          redrawTraits();
        } else redrawTraits(); // value label/control can change with the key
      });
      let valueControl;
      const key = String(t.key || "");
      if (t.type === "equip" && !key.includes(":")) {
        const db = t.key === "armor" ? S.proj.armors : S.proj.weapons;
        valueControl = field("Allowed item", sel(t, "value", dbOpts(db, "(none)")));
      } else if (t.type === "special" && t.key === "attackSkill") {
        // Attack-skill trait: the value is a skill id, not a percent.
        valueControl = field("Skill", sel(t, "value", dbOpts(S.proj.skills)));
      } else if (traitValueLabel(t).startsWith("(")) {
        // Presence-only rows (grants, seals, locks, resists): keep value 100.
        t.value = 100;
        valueControl = field("Effect", h("span", { class: "dim" }, traitValueLabel(t)));
      } else {
        const max = t.type === "special" && t.key === "critChance" ? 100 : 999;
        valueControl = field(traitValueLabel(t), nIn(t, "value", -999, max));
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
      traitBox.appendChild(h("div", { class: "dim trait-empty" }, emptyNote));
    }
    traitBox.appendChild(h("button", {
      class: "mini trait-add",
      onclick() { e.traits.push(traitDefault("param")); touch(); redrawTraits(); },
    }, "+ Add trait"));
  }
  redrawTraits();
  p.appendChild(h("div", { class: "dim" },
    "Rates use 100% as normal, 50% as half, and 0% as immunity. Multiple matching rates multiply. Equipment permissions become a whitelist for that slot."));
  p.appendChild(traitBox);
  return p;
}

// Sub-tabs (post-1.0 UX): a horizontal tab strip that splits a big tab's
// content into digestible panels inside the main section. `key` remembers the
// active sub-tab for the whole session, so switching entries, leaving the tab,
// or an undo-refresh rebuild all land back on the same panel. Builders run
// fresh on every activation — the same contract as the main dbTabs show().
const subTabMemory = new Map<string, number>();

export function subTabs(key: string, tabs: Array<{ label: string; build: () => any }>) {
  const bar = h("div", { class: "dbsubtabs" });
  const body = h("div", { class: "dbsubbody" });
  function show(i: number) {
    subTabMemory.set(key, i);
    bar.querySelectorAll("button").forEach((b: any, bi: any) => b.classList.toggle("sel", bi === i));
    body.innerHTML = "";
    body.appendChild(tabs[i].build());
  }
  tabs.forEach((t, i) => bar.appendChild(h("button", { type: "button", onclick: () => show(i) }, t.label)));
  show(Math.min(subTabMemory.get(key) || 0, tabs.length - 1));
  return h("div", { class: "dbsubwrap" }, bar, body);
}

export function listFormTab(spec: any) {
  // spec: {list(), blank(), form(e, box), kind?, reorderable?, allowEmpty?}
  // Stage E upgrades: a search box filters the list; per-row checkboxes drive
  // multi-select bulk actions (Bulk Edit / Duplicate / Copy / Delete); Copy/
  // Paste use a cross-project clipboard keyed by `spec.kind`.
  const kind = spec.kind || "misc";
  const wrap = h("div", { class: "dbtab" });
  const listEl = h("ul", { class: "dblist" });
  const formEl = h("div", { class: "dbform" });
  const bulkBar = h("div", { class: "dbbulk", style: "display:none" });
  let cur: any = null;
  let filter = "";
  const checked = new Set<any>();

  function matches(e: any) {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return String(e.id).includes(q) || String(e.name || "").toLowerCase().includes(q);
  }
  function checkedList() { return spec.list().filter((e: any) => checked.has(e)); }

  function redrawList() {
    listEl.innerHTML = "";
    // drop stale checkbox refs (deleted entries)
    for (const e of [...checked]) if (!spec.list().includes(e)) checked.delete(e);
    const shown = spec.list().filter(matches);
    if (!shown.length) {
      listEl.appendChild(h("li", { class: "db-empty dim" },
        filter ? "No entries match “" + filter + "”." : "No entries yet."));
    }
    for (const e of shown) {
      const box = h("input", { type: "checkbox", class: "db-entry-check",
        title: "Select for bulk actions",
        onclick(ev: any) {
          ev.stopPropagation();
          if (ev.target.checked) checked.add(e); else checked.delete(e);
          redrawBulk();
        } });
      if (checked.has(e)) (box as HTMLInputElement).checked = true;
      const li = h("li", { class: e === cur ? "sel" : "", onclick() { cur = e; redrawList(); redrawForm(); } },
        box, h("span", { class: "db-entry-id" }, e.id + ":"));
      if (e.icon != null) li.appendChild(Assets.iconSpan(e.icon, "db-entry-icon"));
      li.appendChild(h("span", null, e.name || "—"));
      listEl.appendChild(li);
    }
    redrawBulk();
  }
  function redrawForm() {
    formEl.innerHTML = "";
    if (cur) spec.form(cur, formEl, () => { redrawList(); });
  }

  function redrawBulk() {
    const sel = checkedList();
    const n = sel.length;
    bulkBar.innerHTML = "";
    bulkBar.style.display = n ? "" : "none";
    if (!n) return;
    bulkBar.appendChild(h("span", { class: "dbbulk-count" }, n + " selected"));
    bulkBar.appendChild(h("button", { class: "mini", title: "Adjust a shared numeric field on all selected",
      onclick: () => openBulkEdit(sel) }, "Bulk Edit…"));
    bulkBar.appendChild(h("button", { class: "mini", title: "Duplicate the selected entries",
      onclick: () => duplicate(sel) }, "Duplicate"));
    bulkBar.appendChild(h("button", { class: "mini", title: "Copy to the cross-project clipboard",
      onclick: () => { writeDbClip(kind, sel); flashStatus("Copied " + n + " " + kind + " to clipboard"); } }, "Copy"));
    bulkBar.appendChild(h("button", { class: "mini danger", title: "Delete the selected entries",
      onclick: () => bulkDelete(sel) }, "Delete"));
    bulkBar.appendChild(h("button", { class: "mini", title: "Clear selection",
      onclick: () => { checked.clear(); redrawList(); } }, "Clear"));
  }

  function duplicate(sel: any[]) {
    if (!sel.length) return;
    const clones = cloneEntries(sel, spec.list());
    spec.list().push(...clones);
    checked.clear(); cur = clones[0]; touch(); redrawList(); redrawForm();
    flashStatus("Duplicated " + clones.length + (clones.length > 1 ? " entries" : " entry"));
  }
  function bulkDelete(sel: any[]) {
    if (!sel.length) return;
    const arr = spec.list();
    if (spec.allowEmpty !== true && arr.length - sel.length < 1) { alert("Keep at least one entry."); return; }
    confirmBox("Delete " + sel.length + " selected " + (sel.length > 1 ? "entries" : "entry") + "?", () => {
      spec.list().splice(0, arr.length, ...arr.filter((e: any) => !checked.has(e)));
      checked.clear();
      if (!spec.list().includes(cur)) cur = spec.list()[0] || null;
      touch(); redrawList(); redrawForm();
    });
  }
  function pasteClip() {
    const clip = readDbClip();
    if (!clip) { flashStatus("Clipboard is empty — Copy some entries first"); return; }
    if (clip.kind !== kind) { flashStatus("Clipboard holds " + clip.kind + ", not " + kind); return; }
    const clones = cloneEntries(clip.entries, spec.list());
    spec.list().push(...clones);
    cur = clones[0]; touch(); redrawList(); redrawForm();
    flashStatus("Pasted " + clones.length + " " + kind);
  }

  function openBulkEdit(sel: any[]) {
    const fields = sharedNumericFields(sel);
    if (!fields.length) { alert("The selected entries share no numeric fields to edit."); return; }
    const work: any = { field: fields[0], op: "set", value: 0 };
    const content = h("div", null,
      h("p", { class: "dim", style: "margin:0 0 8px" }, "Apply to " + sel.length + " selected " + (sel.length > 1 ? "entries" : "entry") + "."),
      field("Field", sel2(work, "field", fields.map((f) => ({ v: f, l: f })))),
      row(field("Operation", sel2(work, "op", [
        { v: "set", l: "Set to" }, { v: "add", l: "Add" }, { v: "mul", l: "Multiply by" }])),
        field("Value", nIn(work, "value", -99999, 99999, 0.1))));
    modal({
      title: "Bulk Edit", content, dialogKeys: true,
      buttons: [
        { label: "Apply", primary: true, onClick(c: any) {
          const n = applyBulk(sel, work.field, work.op as BulkOp, Number(work.value) || 0);
          touch(); redrawList(); redrawForm(); c();
          flashStatus("Updated " + work.field + " on " + n + (n > 1 ? " entries" : " entry"));
        } },
        { label: "Cancel" },
      ],
    });
  }

  const search = h("input", { type: "search", class: "dbsearch", placeholder: "Search…", spellcheck: "false",
    oninput(e: any) { filter = e.target.value; redrawList(); },
    // Keyboard navigation (Stage F): ↑/↓ from the search box walk the filtered
    // list without leaving the field, so search → arrow → edit needs no mouse.
    onkeydown(e: any) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const shown = spec.list().filter(matches);
      if (!shown.length) return;
      const i = shown.indexOf(cur);
      const next = i < 0 ? 0 : Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      cur = shown[next];
      redrawList(); redrawForm();
      const selRow = listEl.querySelector("li.sel");
      if (selRow) selRow.scrollIntoView({ block: "nearest" });
    } });

  const btns = h("div", { class: "dbbtns" },
    h("button", { onclick() {
      const e = spec.blank();
      e.id = RA.nextId(spec.list());
      spec.list().push(e);
      cur = e; touch(); redrawList(); redrawForm();
    } }, "+ New"),
    h("button", { class: "mini", title: "Paste entries from the cross-project clipboard", onclick: pasteClip }, "Paste"),
    h("button", { title: "Delete the selected entry", onclick() {
      if (!cur) return;
      if (spec.allowEmpty !== true && spec.list().length <= 1) { alert("Keep at least one entry."); return; }
      confirmBox("Delete \"" + cur.name + "\"?", () => {
        const arr = spec.list();
        arr.splice(arr.indexOf(cur), 1);
        cur = arr[0] || null;
        touch(); redrawList(); redrawForm();
      });
    } }, "Delete"),
    // Reorder buttons go last so on narrow toolbars they wrap onto their own
    // row as a pair instead of splitting the New/Paste/Delete group.
    ...(spec.reorderable ? [
      h("button", { class: "mini dbmove", title: "Move earlier", onclick() {
        if (!cur) return;
        const arr = spec.list();
        const i = arr.indexOf(cur);
        if (i <= 0) return;
        const [moved] = arr.splice(i, 1);
        arr.splice(i - 1, 0, moved);
        touch(); redrawList(); redrawForm();
      } }, "↑ Move up"),
      h("button", { class: "mini dbmove", title: "Move later", onclick() {
        if (!cur) return;
        const arr = spec.list();
        const i = arr.indexOf(cur);
        if (i < 0 || i >= arr.length - 1) return;
        const [moved] = arr.splice(i, 1);
        arr.splice(i + 1, 0, moved);
        touch(); redrawList(); redrawForm();
      } }, "↓ Move down"),
    ] : []),
  );
  cur = spec.list()[0] || null;
  redrawList(); redrawForm();
  wrap.appendChild(h("div", { class: "dbside" }, search, btns, bulkBar, listEl));
  wrap.appendChild(formEl);
  return wrap;
}

// Local aliases so the bulk-edit dialog can build bound selects/rows without
// colliding with the `sel` set names above.
function sel2(obj: any, key: any, options: any) { return sel(obj, key, options); }
function row(...kids: any[]) { return h("div", { class: "frow" }, ...kids); }

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
