/* RPGAtlas — src/editor/database/types-tab.ts
   The Database "Types" tab (elements / skill / weapon / armor / equipment
   type columns) plus the generic name-list tabs used for Switches and
   Variables.
   Verbatim move from the editor monolith (Phase 1 Stage C, Package 3):
   logic unchanged, closure vars routed through editor-state.ts.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { RA, editorState as S } from "../editor-state";
import { h, field } from "../dom";
import { touch } from "../persistence";

// A unique string key for a new element / skill type, kept stable so that
// renaming or reordering never breaks references stored on skills & traits.
function uniqueTypeKey(prefix: any, list: any) {
  let n = list.length + 1, key: any;
  do { key = prefix + n; n++; } while (list.some((e: any) => e.key === key));
  return key;
}

function typeColumn(list: any, label: any, blank: any, lockedNote?: any) {
  const col = h("div", { class: "types-col" });
  col.appendChild(h("div", { class: "types-col-head" }, label));
  const rows = h("div", { class: "types-rows" });
  function redraw() {
    rows.innerHTML = "";
    list.forEach((entry: any, i: any) => {
      const num = h("span", { class: "types-num" }, String(i + 1).padStart(2, "0"));
      const input = h("input", { type: "text", value: entry.name || "",
        oninput(ev: any) { entry.name = ev.target.value; touch(); } });
      const del = h("button", {
        class: "mini danger", title: "Delete", "aria-label": "Delete " + (entry.name || "entry"),
        onclick() {
          if (list.length <= 1) { alert("Keep at least one entry."); return; }
          list.splice(i, 1); touch(); redraw();
        },
      }, "✕");
      rows.appendChild(h("div", { class: "types-row" }, num, input, del));
    });
  }
  redraw();
  col.appendChild(rows);
  col.appendChild(h("button", { class: "mini types-add",
    onclick() { list.push(blank()); touch(); redraw(); } }, "+ Add"));
  if (lockedNote) col.appendChild(h("div", { class: "dim" }, lockedNote));
  return col;
}

export function typesTab() {
  const t = S.proj.system.types;
  const box = h("div", { class: "dbform single" });
  box.appendChild(h("div", { class: "dim", style: "margin-bottom:10px" },
    "Define the categories your game uses. Elements drive resistances (set them on Classes ▸ Traits and pick one per skill). " +
    "Skill types label the three combat classes — only Physical, Magical and Heal affect the damage formula. " +
    "Weapon, armor and equipment types tag equipment for organisation. Renaming or reordering is always safe."));
  const cols = h("div", { class: "types-cols" });
  cols.appendChild(typeColumn(t.elements, "Elements",
    () => ({ key: uniqueTypeKey("elem", t.elements), name: "New Element" })));
  cols.appendChild(typeColumn(t.skillTypes, "Skill Types",
    () => ({ key: uniqueTypeKey("stype", t.skillTypes), name: "New Type" }),
    "Extra skill types beyond the first three are labels only."));
  cols.appendChild(typeColumn(t.weaponTypes, "Weapon Types",
    () => ({ id: RA.nextId(t.weaponTypes), name: "New Weapon Type" })));
  cols.appendChild(typeColumn(t.armorTypes, "Armor Types",
    () => ({ id: RA.nextId(t.armorTypes), name: "New Armor Type" })));
  cols.appendChild(typeColumn(t.equipTypes, "Equipment Types",
    () => ({ id: RA.nextId(t.equipTypes), name: "New Slot" })));
  box.appendChild(cols);
  return box;
}

export function nameListTab(key: any, prefix: any, maxEntries: any) {
  const names = S.proj.system[key];
  const box = h("div", { class: "dbform single namegrid" });
  const addBtn = h("button", { class: "namegrid-add" });

  function appendEntry(i: any) {
    const input = h("input", {
      type: "text",
      value: names[i],
      oninput(e: any) { names[i] = e.target.value; touch(); },
    });
    box.insertBefore(field(prefix + String(i + 1).padStart(3, "0"), input), addBtn);
    return input;
  }

  function updateAddButton() {
    const atLimit = names.length >= maxEntries;
    addBtn.disabled = atLimit;
    addBtn.textContent = atLimit ? "Maximum " + maxEntries + " reached" : "Add New";
  }

  box.appendChild(addBtn);
  names.forEach((_: any, i: any) => appendEntry(i));
  addBtn.addEventListener("click", () => {
    if (names.length >= maxEntries) return;
    names.push("");
    const input = appendEntry(names.length - 1);
    updateAddButton();
    touch();
    requestAnimationFrame(() => {
      input.scrollIntoView({ block: "nearest" });
      input.focus();
    });
  });
  updateAddButton();
  return box;
}
