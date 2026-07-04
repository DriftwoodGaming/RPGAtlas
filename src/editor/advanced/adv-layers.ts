/* RPGAtlas — src/editor/advanced/adv-layers.ts
   The Advanced Map Editor's interactive Layers panel (Phase 8 Stage B).

   Renders the generalized stack top-first with per-row visibility / lock /
   active-selection, a toolbar (add tile layer, add group, group / ungroup,
   reorder, delete) and a properties block for the selected layer
   (opacity / blend / tint / slot / rename). Every mutation goes through the
   adv-state ops (which promote a classic map to a stored layersAdv on first
   edit) and the shared pushUndo()/touch() seams. Cores (the four role layers)
   can be reordered, hidden, dimmed and grouped but not deleted — they are the
   tile storage the Standard editor shares.
   Copyright (C) 2026 RPGAtlas contributors — GPL-3.0-or-later (see LICENSE). */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { curMap, t, LAYER_LABELS } from "../editor-state";
import { h } from "../dom";
import { touch } from "../persistence";
import { pushUndo } from "../map-editor/history";
import { classicStack, type BlendMode } from "../../shared/layer-view";
import type { AdvLayer } from "../../shared/schema";
import {
  advState, advHooks, findLayer, addTileLayer, addGroup,
  groupLayer, ungroupLayer, deleteLayer, moveLayer, patchLayer,
} from "./adv-state";
import { nameDialog } from "./adv-dialogs";

const BLEND_MODES: BlendMode[] = ["normal", "add", "multiply", "screen"];

/** The stack to display: the stored generalized stack, or the synthesized
 *  classic four cores when the map is still classic (display must NOT promote
 *  — only an actual edit does). */
function displayStack(m: any): AdvLayer[] {
  return (m.layersAdv as AdvLayer[]) || classicStack();
}

/** Find a layer object by id in the display stack (read-only view). */
function displayLayer(m: any, id: number): AdvLayer | null {
  const hit = findLayer(displayStack(m), id);
  return hit ? hit.list[hit.index] : null;
}

/** Ensure advState.activeLayerId points at a real layer; default to ground. */
export function ensureActiveLayer(m: any) {
  const stack = displayStack(m);
  if (advState.activeLayerId != null && findLayer(stack, advState.activeLayerId)) return;
  const ground = findLayer(stack, stack.find((l) => l.type === "core" && l.role === "ground")?.id ?? -1);
  advState.activeLayerId = ground ? ground.list[ground.index].id : (stack[0]?.id ?? null);
}

function commit(label: string, fn: () => void) {
  pushUndo(label);
  fn();
  touch();
  advHooks.rebuild();
}

// ---- toolbar ----
export function buildLayersToolbar(): HTMLElement {
  const btn = (icon: string, title: string, onclick: () => void) =>
    h("button", { class: "adv-mini-btn", title, onclick }, icon);
  const active = () => {
    const m = curMap();
    return m ? displayLayer(m, advState.activeLayerId ?? -1) : null;
  };
  return h("div", { class: "adv-layers-toolbar" },
    btn("＋", t("Add Layer"), () => {
      const m = curMap(); if (!m) return;
      commit("Add layer", () => {
        const n = (m.layersAdv || []).filter((l: AdvLayer) => l.type === "tile").length + 1;
        advState.activeLayerId = addTileLayer(m, t("Layer") + " " + n);
      });
    }),
    btn("🗀", t("Add Group"), () => {
      const m = curMap(); if (!m) return;
      commit("Add group", () => { advState.activeLayerId = addGroup(m, t("Group")); });
    }),
    btn("⊞", t("Group Layer"), () => {
      const m = curMap(); const a = active(); if (!m || !a) return;
      commit("Group layer", () => {
        const gid = groupLayer(m, a.id, t("Group"));
        if (gid != null) advState.activeLayerId = gid;
      });
    }),
    btn("⊟", t("Ungroup"), () => {
      const m = curMap(); const a = active(); if (!m || !a || a.type !== "group") return;
      commit("Ungroup", () => ungroupLayer(m, a.id));
    }),
    btn("▲", t("Move Up"), () => {
      const m = curMap(); const a = active(); if (!m || !a) return;
      commit("Reorder layer", () => moveLayer(m, a.id, 1));
    }),
    btn("▼", t("Move Down"), () => {
      const m = curMap(); const a = active(); if (!m || !a) return;
      commit("Reorder layer", () => moveLayer(m, a.id, -1));
    }),
    btn("✕", t("Delete Layer"), () => {
      const m = curMap(); const a = active(); if (!m || !a || a.type === "core") return;
      commit("Delete layer", () => { deleteLayer(m, a.id); advState.activeLayerId = null; });
    }),
  ) as HTMLElement;
}

// ---- rows ----
function labelFor(l: AdvLayer): string {
  if (l.type === "core") return t(LAYER_LABELS[l.role]);
  return l.name || (l.type === "group" ? t("Group") : t("Layer"));
}

function layerRow(m: any, l: AdvLayer, depth: number): HTMLElement {
  const visible = l.visible !== false;
  const badges: HTMLElement[] = [];
  if (l.opacity != null && l.opacity < 1) badges.push(h("span", { class: "adv-layer-badge" }, Math.round(l.opacity * 100) + "%") as HTMLElement);
  if (l.blend && l.blend !== "normal") badges.push(h("span", { class: "adv-layer-badge" }, l.blend) as HTMLElement);
  if (l.type === "tile" && l.slot === "above") badges.push(h("span", { class: "adv-layer-badge" }, "▲") as HTMLElement);
  const icon = l.type === "group" ? "🗀" : l.type === "core" ? "▦" : "▧";
  const row = h("div", {
    class: "adv-layer-row" + (visible ? "" : " adv-layer-hidden") + (l.id === advState.activeLayerId ? " sel" : ""),
    style: "padding-left:" + (8 + depth * 14) + "px",
    onclick: () => { advState.activeLayerId = l.id; advHooks.rebuild(); },
  },
    h("span", {
      class: "adv-layer-eye", title: t("Toggle Visibility"),
      onclick: (e: any) => {
        e.stopPropagation();
        commit("Toggle layer", () => patchLayer(m, l.id, { visible: !visible }));
      },
    }, visible ? "👁" : "—"),
    h("span", {
      class: "adv-layer-icon", title: t("Toggle Lock"),
      onclick: (e: any) => {
        e.stopPropagation();
        commit("Lock layer", () => patchLayer(m, l.id, { locked: !l.locked }));
      },
    }, l.locked ? "🔒" : icon),
    h("span", {
      class: "adv-layer-name",
      ondblclick: (e: any) => {
        e.stopPropagation();
        if (l.type === "core") return; // cores keep their role names
        nameDialog(t("Rename…"), l.name, (name) => commit("Rename layer", () => patchLayer(m, l.id, { name })));
      },
    }, labelFor(l)),
    ...badges,
  ) as HTMLElement;
  return row;
}

/** Render the stack top-first into listEl (groups shown, children indented). */
export function renderLayersList(listEl: HTMLElement) {
  listEl.innerHTML = "";
  const m = curMap();
  if (!m) return;
  ensureActiveLayer(m);
  const walk = (list: AdvLayer[], depth: number) => {
    for (let i = list.length - 1; i >= 0; i--) { // top-most first
      const l = list[i];
      listEl.appendChild(layerRow(m, l, depth));
      if (l.type === "group") walk(l.children, depth + 1);
    }
  };
  walk(displayStack(m), 0);
}

// ---- properties ----
function labeled(label: string, control: HTMLElement): HTMLElement {
  return h("label", { class: "adv-prop-row" }, h("span", { class: "adv-prop-label" }, label), control) as HTMLElement;
}

export function renderLayerProps(propsEl: HTMLElement) {
  propsEl.innerHTML = "";
  const m = curMap();
  if (!m || advState.activeLayerId == null) return;
  const l = displayLayer(m, advState.activeLayerId);
  if (!l) return;

  const opacity = h("input", {
    type: "range", min: "0", max: "100", value: String(Math.round((l.opacity == null ? 1 : l.opacity) * 100)),
    class: "adv-prop-range",
    oninput: (e: any) => { patchLayer(m, l.id, { opacity: Number(e.target.value) / 100 }); advHooks.render(); },
    onchange: () => { touch(); advHooks.rebuild(); },
  }) as HTMLInputElement;

  const blend = h("select", {
    class: "adv-prop-select",
    onchange: (e: any) => commit("Layer blend", () => patchLayer(m, l.id, { blend: e.target.value })),
  }, ...BLEND_MODES.map((b) => h("option", { value: b, selected: (l.blend || "normal") === b ? "selected" : null }, b))) as HTMLSelectElement;

  const tint = h("input", {
    type: "color", value: l.tint || "#ffffff", class: "adv-prop-color",
    oninput: (e: any) => { patchLayer(m, l.id, { tint: e.target.value }); advHooks.render(); },
    onchange: () => { touch(); advHooks.rebuild(); },
  }) as HTMLInputElement;
  const tintClear = h("button", {
    class: "adv-mini-btn", title: t("Clear Tint"),
    onclick: () => commit("Layer tint", () => patchLayer(m, l.id, { tint: undefined })),
  }, "⌫");

  const rows: HTMLElement[] = [
    h("div", { class: "adv-prop-head" }, labelFor(l)) as HTMLElement,
  ];
  if (l.type !== "group") {
    rows.push(labeled(t("Opacity"), opacity));
    rows.push(labeled(t("Blend"), blend));
    rows.push(labeled(t("Tint"), h("span", { class: "adv-prop-tint" }, tint, tintClear) as HTMLElement));
  } else {
    // groups only expose opacity (multiplies onto children) and visibility
    rows.push(labeled(t("Opacity"), opacity));
  }
  if (l.type === "tile") {
    const slot = h("select", {
      class: "adv-prop-select",
      onchange: (e: any) => commit("Layer slot", () => patchLayer(m, l.id, { slot: e.target.value })),
    },
      h("option", { value: "below", selected: (l.slot || "below") === "below" ? "selected" : null }, t("Below characters")),
      h("option", { value: "above", selected: l.slot === "above" ? "selected" : null }, t("Above (overhead)")),
    ) as HTMLSelectElement;
    rows.push(labeled(t("Draw slot"), slot));
  }
  for (const r of rows) propsEl.appendChild(r);
}
